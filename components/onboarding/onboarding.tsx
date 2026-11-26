"use client";
/**
 * THE INNFØRING (2026-11, Thomas: «en digital idiot skal kunne laste ned
 * dette og starte øving innen 10 min, selv om de er 14 år»). Five steps, one
 * at a time, big buttons, short text, «1/5» on top:
 *
 *   1 Velkommen   one sentence and «Kom i gang»
 *   2 Koble til AI  Claude (Claude Code) or ChatGPT: the existing flows,
 *                 started from one big button each; then the model choice
 *                 through the existing SetupDialog
 *   3 Fagene dine the courses the fagmappe brought in, plus «Legg til fag»
 *   4 Materiale   earlier exams per course, «Åpne fagmappen» and the
 *                 Canvas prompt for Claude Code or Codex
 *   5 Klar        «Start første økt» opens the first course's fag-chat
 *
 * It opens by itself at first start (settings.json onboarding.done unset,
 * and not someone who already has courses and a connection), and from the
 * help centre (OPEN_ONBOARDING_EVENT). Finishing or skipping writes
 * onboarding.done. The host also scans the fagmappe when the window gets
 * focus (src/server/course-folders.ts).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CheckIcon, ClipboardCopyIcon, ExternalLinkIcon, FolderOpenIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { canvasPrompt, CLAUDE_CODE_MINIMUM_VERSION, type ClaudeCodeStatus, type UserSettings } from "@/src/core";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useModelCatalog } from "@/components/model-catalog";
import { notifySettingsSaved } from "@/components/settings-signal";
import { useSettingsDialog } from "@/components/settings/settings-dialog";
import { useChatGPTConnect } from "@/components/settings/chatgpt-connection";
import { SetupDialog } from "@/components/setup-dialog";
import { AddCourse } from "@/components/courses/add-course";
import { courseApi } from "@/components/courses/course-api";
import { openCourseChatId } from "@/components/courses/course-chats";
import { useCoursesChanged } from "@/components/courses/use-courses";
import {
	ONBOARDING_STEPS,
	OPEN_ONBOARDING_EVENT,
	aiConnection,
	connectionName,
	examLine,
	isCourseFolderScan,
	onboardingDecision,
	stepLabel,
	type CourseFolderScan,
	type OnboardingStep,
} from "./onboarding-model";

const CLAUDE_SETUP_URL = "https://code.claude.com/docs/en/setup";
/** The window-focus rescan of the fagmappe, at most this often. */
const FOCUS_SCAN_MS = 5_000;

async function markOnboardingDone(): Promise<void> {
	try {
		const res = await fetch("/api/settings/onboarding", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ done: true }),
		});
		if (res.ok) notifySettingsSaved("onboarding");
	} catch {
		/* the innføring may open again next start; nothing else breaks */
	}
}

async function readCourseFolders(): Promise<CourseFolderScan | null> {
	try {
		const res = await fetch("/api/course-folders", { cache: "no-store" });
		const body: unknown = res.ok ? await res.json() : null;
		return isCourseFolderScan(body) ? body : null;
	} catch {
		return null;
	}
}

// ─── The host: when it opens, and the focus scan ─────────────────────────────

export function OnboardingHost() {
	const [open, setOpen] = useState(false);
	const decided = useRef(false);
	const { catalog, failed } = useModelCatalog();

	// From anywhere: the help centre and the palette dispatch the event.
	useEffect(() => {
		const onOpen = () => setOpen(true);
		window.addEventListener(OPEN_ONBOARDING_EVENT, onOpen);
		return () => window.removeEventListener(OPEN_ONBOARDING_EVENT, onOpen);
	}, []);

	// First start: decide once, after the catalog (the connection truth) is in.
	useEffect(() => {
		if (decided.current || (!catalog && !failed)) return;
		decided.current = true;
		void (async () => {
			try {
				const body = (await fetch("/api/settings", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))) as { settings: UserSettings | null } | null;
				if (!body) return;
				const courses = await courseApi.list().catch(() => null);
				if (courses === null) return;
				const decision = onboardingDecision({
					done: body.settings?.onboarding?.done === true,
					courseCount: courses.length,
					connected: aiConnection(catalog).connected,
				});
				if (decision === "show") setOpen(true);
				else if (decision === "mark-done") void markOnboardingDone();
			} catch {
				/* no innføring this time; the app works without it */
			}
		})();
	}, [catalog, failed]);

	// «Når vinduet får fokus»: the fagmappe may have new folders or files
	// (a setup AI just wrote them). The scan announces courses-changed itself.
	useEffect(() => {
		let last = 0;
		const onFocus = () => {
			if (Date.now() - last < FOCUS_SCAN_MS) return;
			last = Date.now();
			void readCourseFolders();
		};
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, []);

	const close = useCallback(() => {
		setOpen(false);
		void markOnboardingDone();
	}, []);

	return open ? <Onboarding onClose={close} /> : null;
}

// ─── The frame ───────────────────────────────────────────────────────────────

/** The surface every step shares: progress on top, one column, the
 *  step's own buttons at the bottom. Pure (SSR-pinned). */
export function OnboardingFrame({ step, title, lead, children, footer, onSkip }: {
	step: OnboardingStep;
	title: string;
	lead?: string;
	children?: React.ReactNode;
	footer: React.ReactNode;
	onSkip: () => void;
}) {
	const index = ONBOARDING_STEPS.indexOf(step);
	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Innføring"
			data-testid="onboarding"
			data-step={step}
			className="lh-no-drag fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background font-ui text-foreground"
		>
			{/* The top band stays a window-drag region in the desktop app; its
			    buttons carve themselves out (globals.css auto carve-out). */}
			<div className="lh-drag flex h-14 shrink-0 items-center justify-end px-4">
				<button
					type="button"
					onClick={onSkip}
					data-testid="onboarding-skip"
					className="flex items-center gap-1.5 rounded-sm px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
				>
					Hopp over innføringen
					<XIcon className="size-4" aria-hidden="true" />
				</button>
			</div>
			<div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-6 pb-10">
				<div className="flex items-center gap-3" data-testid="onboarding-progress">
					<span className="font-title text-sm font-semibold tabular-nums text-muted-foreground">{stepLabel(step)}</span>
					<div className="flex flex-1 gap-1.5" aria-hidden="true">
						{ONBOARDING_STEPS.map((id, i) => (
							<span key={id} className={cn("h-1.5 flex-1 rounded-sm", i <= index ? "bg-primary" : "bg-border")} />
						))}
					</div>
				</div>
				<h1 className="mt-10 font-title text-3xl font-semibold leading-tight tracking-tight text-balance">{title}</h1>
				{lead && <p className="mt-3 text-base leading-relaxed text-muted-foreground">{lead}</p>}
				<div className="mt-8 flex flex-col gap-4">{children}</div>
				<div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-10" data-testid="onboarding-footer">{footer}</div>
			</div>
		</div>
	);
}

const BIG = "h-12 px-8 text-base";

function BackButton({ onClick }: { onClick: () => void }) {
	return <Button variant="ghost" className={BIG} onClick={onClick} data-testid="onboarding-back">Tilbake</Button>;
}

/** A green tick and a line: «this is done». */
export function DoneLine({ children, testid }: { children: React.ReactNode; testid?: string }) {
	return (
		<p data-testid={testid} className="flex items-center gap-3 rounded-md border border-status-green/40 bg-status-green-soft px-4 py-3 text-base text-status-green-ink">
			<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-status-green text-status-green-foreground">
				<CheckIcon className="size-4" aria-hidden="true" />
			</span>
			<span>{children}</span>
		</p>
	);
}

// ─── The flow ────────────────────────────────────────────────────────────────

export function Onboarding({ onClose }: { onClose: () => void }) {
	const router = useRouter();
	const [step, setStep] = useState<OnboardingStep>("welcome");
	const [folders, setFolders] = useState<CourseFolderScan | null>(null);
	const reload = useCallback(() => {
		void readCourseFolders().then((scan) => { if (scan) setFolders(scan); });
	}, []);
	useEffect(() => reload(), [reload]);
	useCoursesChanged(reload);

	const go = (to: OnboardingStep) => setStep(to);
	const at = ONBOARDING_STEPS.indexOf(step);
	const next = () => go(ONBOARDING_STEPS[Math.min(at + 1, ONBOARDING_STEPS.length - 1)]!);
	const back = () => go(ONBOARDING_STEPS[Math.max(at - 1, 0)]!);

	const [starting, setStarting] = useState(false);
	const [startError, setStartError] = useState<string | null>(null);
	const start = () => {
		const first = folders?.courses[0];
		if (!first) {
			onClose();
			router.push("/");
			return;
		}
		setStarting(true);
		setStartError(null);
		openCourseChatId(first.code, fetch)
			.then((chat) => {
				onClose();
				router.push(`/chat/${chat.id}`);
			})
			.catch(() => {
				setStarting(false);
				setStartError("Kunne ikke åpne fag-chatten. Prøv igjen.");
			});
	};

	const body = (() => {
		switch (step) {
			case "welcome":
				return (
					<OnboardingFrame
						step={step}
						title="Velkommen til Eksamenshjelp"
						lead="Appen finner ut hva du kan, lager en plan og øver med deg på det som kommer på eksamen."
						onSkip={onClose}
						footer={<><span /><Button className={BIG} onClick={next} data-testid="onboarding-next" autoFocus>Kom i gang</Button></>}
					>
						<p className="text-base text-muted-foreground">Oppsettet tar noen få minutter. Vi tar det ett steg om gangen.</p>
					</OnboardingFrame>
				);
			case "ai":
				return <AiStep onNext={next} onBack={back} onSkip={onClose} />;
			case "courses":
				return <CoursesStep folders={folders} onAdded={reload} onNext={next} onBack={back} onSkip={onClose} />;
			case "material":
				return <MaterialStep folders={folders} onNext={next} onBack={back} onSkip={onClose} />;
			case "ready":
				return (
					<OnboardingFrame
						step={step}
						title="Du er klar"
						lead={folders?.courses[0]
							? `Første økt starter i ${folders.courses[0].code}. Læreren spør deg litt først, så den vet hvor du står.`
							: "Legg til et fag når du er klar, så lager appen en plan for deg."}
						onSkip={onClose}
						footer={<>
							<BackButton onClick={back} />
							<Button className={BIG} onClick={start} disabled={starting} data-testid="onboarding-start" autoFocus>
								{starting && <LoaderCircleIcon className="animate-spin" aria-hidden="true" />}
								{folders?.courses[0] ? "Start første økt" : "Gå til forsiden"}
							</Button>
						</>}
					>
						<p className="flex items-center gap-3 text-base">
							<span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gold-soft text-gold-ink">
								<CheckIcon className="size-5" aria-hidden="true" />
							</span>
							Du finner innføringen igjen under Hjelp.
						</p>
						{startError && <p role="alert" className="text-sm text-destructive">{startError}</p>}
					</OnboardingFrame>
				);
		}
	})();

	return typeof document === "undefined" ? body : createPortal(body, document.body);
}

// ─── Step 2: Koble til AI ────────────────────────────────────────────────────

function AiStep({ onNext, onBack, onSkip }: { onNext: () => void; onBack: () => void; onSkip: () => void }) {
	const { catalog } = useModelCatalog();
	const chatgpt = useChatGPTConnect();
	const { open: openSettings } = useSettingsDialog();
	const ai = aiConnection(catalog, chatgpt.connected);
	const [setup, setSetup] = useState(false);

	const ready = ai.connected && ai.models;
	return (
		<>
			<OnboardingFrame
				step="ai"
				title="Koble til AI"
				lead="Eksamenshjelp bruker AI-en du allerede har. Du trenger bare én av dem."
				onSkip={onSkip}
				footer={<>
					<BackButton onClick={onBack} />
					{ready ? (
						<Button className={BIG} onClick={onNext} data-testid="onboarding-next" autoFocus>Neste</Button>
					) : ai.connected ? (
						<Button className={BIG} onClick={() => setSetup(true)} data-testid="onboarding-pick-models">Velg modeller</Button>
					) : (
						<Button variant="ghost" className={BIG} onClick={onNext} data-testid="onboarding-later">Gjør dette senere</Button>
					)}
				</>}
			>
				{ai.connected ? (
					<>
						<DoneLine testid="onboarding-ai-connected">{connectionName(ai)} er koblet til.</DoneLine>
						{ai.models ? (
							<DoneLine testid="onboarding-models-ready">Modellene er valgt.</DoneLine>
						) : (
							<p className="text-base text-muted-foreground">Ett steg til: velg hvilke modeller appen skal bruke. Ta den beste du har som «Kraftig modell».</p>
						)}
						{ai.models && <p className="text-sm text-muted-foreground">Vil du bytte senere, finner du det under Innstillinger → Koble til AI.</p>}
					</>
				) : (
					<>
						<ClaudeOption />
						<ConnectOption
							title="ChatGPT"
							line="Logg inn med ChatGPT-kontoen din. Grensene i abonnementet ditt gjelder."
							testid="onboarding-chatgpt"
							action={
								<Button className={BIG} onClick={chatgpt.connect} disabled={!chatgpt.available || chatgpt.busy} data-testid="onboarding-connect-chatgpt">
									{chatgpt.busy && <LoaderCircleIcon className="animate-spin" aria-hidden="true" />}
									Koble til ChatGPT
								</Button>
							}
						>
							{!chatgpt.available && <p className="text-sm text-muted-foreground">Innlogging med ChatGPT virker bare i skrivebordsappen.</p>}
							{chatgpt.error && <p role="alert" className="text-sm text-destructive">{chatgpt.error}</p>}
						</ConnectOption>
						<button
							type="button"
							onClick={() => openSettings("keys")}
							className="self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
							data-testid="onboarding-other-ai"
						>
							Har du en API-nøkkel eller en annen AI? Åpne innstillingene
						</button>
					</>
				)}
			</OnboardingFrame>
			{/* The existing model picker (the send-interception flow's dialog);
			    portaled after the innføring, so it sits on top of it. */}
			<SetupDialog open={setup} onClose={() => setSetup(false)} onDone={() => setSetup(false)} saveLabel="Fortsett" />
		</>
	);
}

function ConnectOption({ title, line, action, children, testid }: {
	title: string;
	line: string;
	action: React.ReactNode;
	children?: React.ReactNode;
	testid?: string;
}) {
	return (
		<div data-testid={testid} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
			<div>
				<h2 className="font-title text-xl font-semibold">{title}</h2>
				<p className="mt-1 text-base text-muted-foreground">{line}</p>
			</div>
			<div>{action}</div>
			{children}
		</div>
	);
}

/** Claude through Claude Code: the same switch and installation check as
 *  Innstillinger → Koble til AI (PUT /api/settings/claudeCode, GET
 *  /api/claude-code). Signing in happens in Claude Code itself. */
function ClaudeOption() {
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState<ClaudeCodeStatus | null>(null);
	const [error, setError] = useState<string | null>(null);

	const check = async () => {
		const res = await fetch("/api/claude-code", { cache: "no-store", headers: { "x-learnharness-claude-code": "1" } });
		if (!res.ok) throw new Error("status");
		setStatus((await res.json()) as ClaudeCodeStatus);
		// The catalog decides «connected»: enabled AND installed.
		notifySettingsSaved("claudeCode");
	};
	const connect = async () => {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch("/api/settings/claudeCode", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ enabled: true }),
			});
			if (!res.ok) throw new Error("save");
			await check();
		} catch {
			setError("Det gikk ikke å koble til Claude. Prøv igjen.");
		} finally {
			setBusy(false);
		}
	};
	const again = async () => {
		setBusy(true);
		setError(null);
		try { await check(); } catch { setError("Kunne ikke sjekke Claude Code. Prøv igjen."); } finally { setBusy(false); }
	};

	const missing = status?.state === "not-found";
	const outdated = status?.state === "update-required";
	return (
		<ConnectOption
			title="Claude"
			line="Du trenger et Claude Pro- eller Max-abonnement."
			testid="onboarding-claude"
			action={
				<Button className={BIG} onClick={() => void (status ? again() : connect())} disabled={busy} data-testid="onboarding-connect-claude">
					{busy && <LoaderCircleIcon className="animate-spin" aria-hidden="true" />}
					{status ? "Sjekk på nytt" : "Koble til Claude"}
				</Button>
			}
		>
			{(missing || outdated) && (
				<ol className="flex list-decimal flex-col gap-2 pl-5 text-base" data-testid="onboarding-claude-steps">
					<li>
						{missing ? "Installer Claude Code. " : `Oppdater Claude Code til versjon ${CLAUDE_CODE_MINIMUM_VERSION} eller nyere (du har ${status?.version}). `}
						<a href={CLAUDE_SETUP_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">
							Slik gjør du det <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
						</a>
					</li>
					<li>Åpne Terminal, skriv <code className="rounded-sm bg-muted px-1 font-mono text-sm">claude</code> og logg inn med Claude-kontoen din.</li>
					<li>Kom tilbake hit og trykk «Sjekk på nytt».</li>
				</ol>
			)}
			{status && !missing && !outdated && (
				<p className="text-sm text-muted-foreground">Claude Code er installert. Har du ikke logget inn ennå: åpne Terminal, skriv <code className="rounded-sm bg-muted px-1 font-mono">claude</code> og logg inn.</p>
			)}
			{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
		</ConnectOption>
	);
}

// ─── Step 3: Fagene dine ─────────────────────────────────────────────────────

function CoursesStep({ folders, onAdded, onNext, onBack, onSkip }: {
	folders: CourseFolderScan | null;
	onAdded: () => void;
	onNext: () => void;
	onBack: () => void;
	onSkip: () => void;
}) {
	const courses = folders?.courses ?? [];
	const fromFolder = courses.filter((c) => c.folder);
	return (
		<OnboardingFrame
			step="courses"
			title="Fagene dine"
			lead={fromFolder.length > 0
				? "Vi fant disse fagene i fagmappen din. Mangler noen, søker du dem opp under."
				: "Søk opp fagene du skal ta eksamen i. Appen henter eksamensdato og pensum fra NTNU."}
			onSkip={onSkip}
			footer={<>
				<BackButton onClick={onBack} />
				<Button className={BIG} onClick={onNext} data-testid="onboarding-next">{courses.length > 0 ? "Neste" : "Hopp over"}</Button>
			</>}
		>
			{folders === null ? (
				<p role="status" className="flex items-center gap-2 text-base text-muted-foreground">
					<LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" /> Ser etter fag …
				</p>
			) : (
				<CourseList courses={courses} />
			)}
			<AddCourse onAdded={onAdded} />
			{folders && folders.unknown.length > 0 && (
				<p className="text-sm text-muted-foreground" data-testid="onboarding-unknown">
					Fant ikke {folders.unknown.join(", ")} hos NTNU. Sjekk at mappen heter det samme som fagkoden.
				</p>
			)}
		</OnboardingFrame>
	);
}

/** The course rows of step 3. Pure (SSR-pinned). */
export function CourseList({ courses }: { courses: readonly CourseFolderScan["courses"][number][] }) {
	if (courses.length === 0) return null;
	return (
		<ul className="flex flex-col gap-2" data-testid="onboarding-courses">
			{courses.map((c) => (
				<li key={c.code} className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-3">
					<CheckIcon className="size-5 shrink-0 text-status-green" aria-hidden="true" />
					<span className="w-24 shrink-0 font-title text-base font-semibold tabular-nums">{c.code}</span>
					<span className="min-w-0 flex-1 truncate text-base">{c.name}</span>
					{c.folder && <span className="shrink-0 text-xs text-muted-foreground">i fagmappen</span>}
				</li>
			))}
		</ul>
	);
}

// ─── Step 4: Materiale ───────────────────────────────────────────────────────

function MaterialStep({ folders, onNext, onBack, onSkip }: {
	folders: CourseFolderScan | null;
	onNext: () => void;
	onBack: () => void;
	onSkip: () => void;
}) {
	const courses = folders?.courses ?? [];
	const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
	const [openError, setOpenError] = useState<string | null>(null);

	const openFolder = async () => {
		setOpenError(null);
		const res = await fetch("/api/course-folders/open", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => null);
		if (!res?.ok) {
			const body = (await res?.json().catch(() => null)) as { error?: string } | null;
			setOpenError(body?.error ?? "Kunne ikke åpne fagmappen.");
		}
	};
	const copy = async () => {
		const text = canvasPrompt({ codes: courses.map((c) => c.code), ...(folders?.available ? { folder: folders.root } : {}) });
		try {
			await navigator.clipboard.writeText(text);
			setCopied("yes");
		} catch {
			setCopied("failed");
		}
	};

	return (
		<OnboardingFrame
			step="material"
			title="Tidligere eksamener"
			lead="Det som virker best, er å øve på gamle eksamener. Legg dem i fagmappen, så bruker appen dem når du øver."
			onSkip={onSkip}
			footer={<>
				<BackButton onClick={onBack} />
				<Button className={BIG} onClick={onNext} data-testid="onboarding-next">Neste</Button>
			</>}
		>
			<MaterialList courses={courses} />
			{folders?.available && (
				<p className="text-sm text-muted-foreground">
					Fagmappen: <span className="break-all font-mono text-foreground" data-testid="onboarding-root">{folders.root}</span>
				</p>
			)}
			<div className="flex flex-wrap gap-3">
				<Button variant="outline" className={BIG} onClick={() => void openFolder()} data-testid="onboarding-open-folder">
					<FolderOpenIcon aria-hidden="true" /> Åpne fagmappen
				</Button>
				<Button className={BIG} onClick={() => void copy()} data-testid="onboarding-copy-prompt">
					<ClipboardCopyIcon aria-hidden="true" /> Kopier Canvas-prompt
				</Button>
			</div>
			<div role="status" className="empty:hidden">
				{copied === "yes" && <DoneLine>Kopiert. Lim den inn i Claude Code eller Codex.</DoneLine>}
				{copied === "failed" && <p className="text-sm text-destructive">Fikk ikke kopiert. Prøv igjen.</p>}
			</div>
			{openError && <p role="alert" className="text-sm text-destructive">{openError}</p>}
			<details className="group rounded-md border border-border bg-card px-4 py-3 text-base" data-testid="onboarding-prompt-help">
				<summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">Slik bruker du prompten</summary>
				<ol className="mt-3 flex list-decimal flex-col gap-2 pl-5">
					<li>Åpne Claude Code eller Codex.</li>
					<li>Lim inn prompten og trykk Enter.</li>
					<li>Logg inn i Canvas selv hvis den ber om det. Den skal aldri be om passordet ditt.</li>
					<li>Filene dukker opp her av seg selv.</li>
				</ol>
			</details>
		</OnboardingFrame>
	);
}

/** Per course: the exams the fagmappe holds. Pure (SSR-pinned). */
export function MaterialList({ courses }: { courses: readonly CourseFolderScan["courses"][number][] }) {
	if (courses.length === 0) return <p className="text-base text-muted-foreground">Legg til et fag først, så ser du eksamenene her.</p>;
	return (
		<ul className="flex flex-col gap-2" data-testid="onboarding-material">
			{courses.map((c) => {
				const has = c.exams > 0;
				return (
					<li key={c.code} className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-3">
						{has
							? <CheckIcon className="size-5 shrink-0 text-status-green" aria-hidden="true" />
							: <span className="size-5 shrink-0 rounded-full border-2 border-border" aria-hidden="true" />}
						<span className="w-24 shrink-0 font-title text-base font-semibold tabular-nums">{c.code}</span>
						<span className={cn("min-w-0 flex-1 text-base", !has && "text-muted-foreground")}>{examLine(c)}</span>
					</li>
				);
			})}
		</ul>
	);
}
