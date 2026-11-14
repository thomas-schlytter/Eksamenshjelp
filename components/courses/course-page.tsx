"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	CalendarIcon, ChevronRightIcon, EllipsisIcon, ExternalLinkIcon, LoaderCircleIcon, RefreshCwIcon, Trash2Icon, XIcon,
} from "lucide-react";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";
import { courseApi, CourseApiError, courseErrorMessage, type CourseAndPlan } from "./course-api";
import { daysLeftLabel, type CourseSessionStart, type SelfStatus } from "./course-format";
import { SourcesPanel } from "./course-sources";
import { localIsoDate, type Course } from "./course-types";
import { CourseWizard } from "./course-wizard";
import { ExamPlanView } from "./exam-plan";
import { useExamSession } from "./exam-session";
import { LauncherSetupDialog, usePageTabCycle, useSessionLauncher } from "./session-launcher";
import { StartBox } from "./start-box";
import { TopicBoard } from "./topic-board";

export type CourseTab = "plan" | "topics" | "context";
const TABS: readonly { id: CourseTab; label: string; hash: string }[] = [
	{ id: "plan", label: "Eksamensplan", hash: "plan" },
	{ id: "topics", label: "Temaer", hash: "temaer" },
	{ id: "context", label: "Kontekst", hash: "kontekst" },
];

/** `#temaer` / `#kontekst` deep-link a tab (help center, shared links). */
export function tabFromHash(hash: string): CourseTab | null {
	return TABS.find((tab) => `#${tab.hash}` === hash)?.id ?? null;
}

/** «Fant ikke faget»: a calm dead end with the way home. */
export function CourseNotFound({ code }: { code: string }) {
	return (
		<div className="flex h-dvh flex-col">
			<TopBar />
			<div className="flex flex-1 items-center justify-center p-6">
				<div className="max-w-md text-center" data-testid="course-not-found">
					<h1 className="font-ui text-2xl font-semibold tracking-tight">Fant ikke faget</h1>
					<p className="mt-3 font-ui text-sm leading-relaxed text-muted-foreground">
						{code ? `Du har ikke lagt til «${code}», eller så er det slettet.` : "Adressen peker ikke på et fag."}{" "}
						Gå til Mine fag for å se fagene dine eller legge til et nytt.
					</p>
					<Button asChild className="mt-6">
						<Link href="/">Til Mine fag</Link>
					</Button>
				</div>
			</div>
		</div>
	);
}

/** The «⋯» menu: the fag's two rare actions. A real menu: arrow keys walk
 *  it, Esc and an outside click close it, focus returns to the button. */
function CourseMenu({ custom, refreshing, onRefresh, onDelete }: {
	custom: boolean;
	refreshing: boolean;
	onRefresh: () => void;
	onDelete: () => void;
}) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	const button = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (!open) return;
		root.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
		const close = (refocus: boolean) => {
			setOpen(false);
			if (refocus) button.current?.focus();
		};
		const onPointerDown = (e: PointerEvent) => {
			if (!root.current?.contains(e.target as Node)) close(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				// Claimed: Esc closes the menu, never also a turn.
				e.preventDefault();
				e.stopPropagation();
				close(true);
				return;
			}
			if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
			e.preventDefault();
			const items = Array.from(root.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? []);
			const index = items.indexOf(document.activeElement as HTMLElement);
			items[(index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);
	const item = "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left font-ui text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent";
	return (
		<div ref={root} className="relative">
			<Button
				ref={button}
				variant="ghost"
				size="icon"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label="Flere valg for faget"
				data-testid="course-menu"
				onClick={() => setOpen((v) => !v)}
			>
				{refreshing ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : <EllipsisIcon aria-hidden="true" />}
			</Button>
			{open && (
				<div role="menu" data-lh-menu className="absolute right-0 top-full z-30 mt-1 flex w-56 flex-col gap-0.5 rounded-xl border bg-popover p-1.5 shadow-xl">
					{!custom && (
						<button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onRefresh(); }}>
							<RefreshCwIcon className="size-4 text-muted-foreground" aria-hidden="true" />
							Oppdater fra NTNU
						</button>
					)}
					<button type="button" role="menuitem" className={cn(item, "text-destructive")} onClick={() => { setOpen(false); onDelete(); }}>
						<Trash2Icon className="size-4" aria-hidden="true" />
						Slett fag …
					</button>
				</div>
			)}
		</div>
	);
}

/**
 * The fag's header: what it is, when the exam is (editable in place), the
 * countdown, and what NTNU says about the exam. Pure apart from the date
 * draft: the page owns saving.
 */
export function CourseHeader({ course, daysLeft, dateRef, onExamDate, menu }: {
	course: Course;
	daysLeft: number | null;
	dateRef?: React.Ref<HTMLInputElement>;
	/** Save the date ("" clears it). Resolves true when saved. */
	onExamDate: (date: string) => Promise<boolean>;
	menu?: React.ReactNode;
}) {
	const dateId = useId();
	const saved = course.exam.date ?? "";
	const [draft, setDraft] = useState(saved);
	const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
	// Follow the server's truth (a refresh from NTNU, another window).
	const [lastSaved, setLastSaved] = useState(saved);
	if (lastSaved !== saved) {
		setLastSaved(saved);
		setDraft(saved);
	}
	const commit = () => {
		// A date field reports "" while half-typed; only a real change saves.
		if (draft === saved || state === "saving") return;
		setState("saving");
		void onExamDate(draft).then((ok) => {
			setState(ok ? "saved" : "idle");
			if (!ok) setDraft(saved);
		});
	};
	const facts = [
		["Eksamensform", course.exam.form],
		["Varighet", course.exam.duration],
		["Hjelpemidler", course.exam.aids],
	].filter((fact): fact is [string, string] => !!fact[1]);
	return (
		<header data-testid="course-header">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="font-ui text-sm font-semibold uppercase tracking-wider tabular-nums text-muted-foreground">
						{course.code}
						{course.credits && <span className="font-normal normal-case tracking-normal"> · {course.credits} studiepoeng</span>}
					</p>
					<h1 className="mt-0.5 font-ui text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{course.name}</h1>
				</div>
				{menu}
			</div>

			<div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
				<div className="flex flex-col gap-1" data-tour="exam-date">
					<label htmlFor={dateId} className="font-ui text-xs font-medium text-muted-foreground">Eksamensdato</label>
					<Input
						ref={dateRef}
						id={dateId}
						type="date"
						value={draft}
						onChange={(e) => {
							setDraft(e.target.value);
							setState("idle");
						}}
						onBlur={commit}
						onKeyDown={(e) => {
							if (e.key === "Enter") e.currentTarget.blur();
						}}
						data-testid="exam-date-input"
						className="h-9 w-44 bg-card"
					/>
				</div>
				<p className="flex h-9 items-center gap-2 font-ui text-base font-semibold" data-testid="course-countdown">
					<CalendarIcon className="size-4 text-muted-foreground" aria-hidden="true" />
					{daysLeftLabel(daysLeft)}
				</p>
				<p role="status" className="flex h-9 items-center font-ui text-xs text-muted-foreground">
					{state === "saving" ? "Lagrer …" : state === "saved" ? "Datoen er lagret" : ""}
				</p>
			</div>

			{(facts.length > 0 || course.url) && (
				<div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 font-ui text-sm">
					{facts.length > 0 && (
						<dl className="flex flex-wrap gap-x-5 gap-y-1">
							{facts.map(([label, value]) => (
								<div key={label} className="flex gap-1.5">
									<dt className="text-muted-foreground">{label}:</dt>
									<dd className="max-w-xs truncate" title={value}>{value}</dd>
								</div>
							))}
						</dl>
					)}
					{course.url && (
						<a
							href={course.url}
							target="_blank"
							rel="noreferrer"
							className="flex items-center gap-1 rounded-sm text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
						>
							Emnesiden hos NTNU
							<ExternalLinkIcon className="size-3.5" aria-hidden="true" />
						</a>
					)}
				</div>
			)}
		</header>
	);
}

/** The three tabs. Arrow keys move between them (the tab pattern). */
export function CourseTabs({ tab, onTab, panelId }: { tab: CourseTab; onTab: (tab: CourseTab) => void; panelId: string }) {
	return (
		<div role="tablist" aria-label="Visninger for faget" data-tour="course-tabs" data-testid="course-tabs" className="flex gap-1 border-b border-border">
			{TABS.map((entry, index) => (
				<button
					key={entry.id}
					type="button"
					role="tab"
					id={`${panelId}-tab-${entry.id}`}
					aria-selected={tab === entry.id}
					aria-controls={panelId}
					data-tour-tab={entry.id}
					onClick={() => onTab(entry.id)}
					onKeyDown={(e) => {
						if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
						e.preventDefault();
						const next = TABS[(index + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length]!;
						onTab(next.id);
						document.getElementById(`${panelId}-tab-${next.id}`)?.focus();
					}}
					className={cn(
						"-mb-px cursor-pointer rounded-t-md border-b-2 px-3 py-2.5 font-ui text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:px-4",
						tab === entry.id
							? "border-primary font-semibold text-foreground"
							: "border-transparent text-muted-foreground hover:text-foreground",
					)}
				>
					{entry.label}
				</button>
			))}
		</div>
	);
}

/**
 * THE FAG PAGE (/fag/[code]): header, the three tabs (Eksamensplan is the
 * default), the first-run wizard while there are no topics, and a start
 * box for a free session linked to the fag.
 *
 * STATE: the server's `{ course, plan }` is the truth. Quick edits (a
 * status, a ticked plan item, minutes per day, removing a source) apply
 * optimistically and are replaced by the server's answer; a failed edit
 * re-reads the fag (the rollback) and says what went wrong. Out-of-order
 * answers cannot overwrite newer ones: only the latest edit's answer lands.
 */
export function CoursePage({ initial, initialConfigured }: { initial: CourseAndPlan; initialConfigured: boolean }) {
	const router = useRouter();
	const code = initial.course.code;
	const root = useRef<HTMLDivElement>(null);
	usePageTabCycle(root);
	const launcher = useSessionLauncher(initialConfigured);
	const examSession = useExamSession(code);
	const [data, setData] = useState(initial);
	const [gone, setGone] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const [tab, setTab] = useState<CourseTab>("plan");
	const [wizard, setWizard] = useState(initial.course.topics.length === 0);
	const [today] = useState(() => localIsoDate());
	const panelId = useId();
	const dateRef = useRef<HTMLInputElement>(null);
	const { course, plan } = data;

	// ── the server round trip ────────────────────────────────────────────
	const sequence = useRef(0);
	const inFlight = useRef(0);
	const reload = useCallback(async () => {
		try {
			const fresh = await courseApi.get(code);
			// Never under a pending edit: its own answer is on the way.
			if (inFlight.current === 0) setData(fresh);
		} catch (err) {
			if (err instanceof CourseApiError && err.status === 404) setGone(true);
		}
	}, [code]);
	/** Run one edit. Resolves to an error message, or null when it worked. */
	const mutate = useCallback(async (
		optimistic: ((current: CourseAndPlan) => CourseAndPlan) | null,
		request: () => Promise<CourseAndPlan>,
	): Promise<string | null> => {
		const mine = ++sequence.current;
		inFlight.current++;
		if (optimistic) setData(optimistic);
		try {
			const result = await request();
			inFlight.current--;
			if (mine === sequence.current) setData({ course: result.course, plan: result.plan });
			return null;
		} catch (err) {
			inFlight.current--;
			if (err instanceof CourseApiError && err.status === 404) setGone(true);
			else if (inFlight.current === 0) void reload(); // roll back to the truth
			return courseErrorMessage(err);
		}
	}, [reload]);
	/** A quick edit: optimistic, and a failure shows in the notice line. */
	const quick = useCallback((optimistic: (current: CourseAndPlan) => CourseAndPlan, request: () => Promise<CourseAndPlan>) => {
		void mutate(optimistic, request).then((error) => {
			if (error) setNotice(`Endringen ble ikke lagret. ${error}`);
		});
	}, [mutate]);

	// Another window, or the agent's topic_status tool mid-session.
	const reloadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useServerEvent("courses-changed", (payload) => {
		if (payload.code && payload.code !== code) return;
		if (reloadTimer.current) clearTimeout(reloadTimer.current);
		reloadTimer.current = setTimeout(() => void reload(), 250);
	});
	useServerResync(() => void reload());
	useEffect(() => () => {
		if (reloadTimer.current) clearTimeout(reloadTimer.current);
	}, []);

	// ── tabs (deep-linkable by hash) ─────────────────────────────────────
	useEffect(() => {
		const fromHash = () => {
			const next = tabFromHash(window.location.hash);
			if (next) setTab(next);
		};
		fromHash();
		window.addEventListener("hashchange", fromHash);
		return () => window.removeEventListener("hashchange", fromHash);
	}, []);
	const selectTab = (next: CourseTab) => {
		setTab(next);
		window.history.replaceState(null, "", `#${TABS.find((entry) => entry.id === next)!.hash}`);
	};

	// ── actions ──────────────────────────────────────────────────────────
	const setStatus = (topicId: string, status: SelfStatus) => quick(
		(current) => ({
			...current,
			course: {
				...current.course,
				topics: current.course.topics.map((topic) =>
					topic.id === topicId ? { ...topic, status, statusSource: "self" as const, statusNote: undefined } : topic),
			},
		}),
		() => courseApi.patchTopic(code, topicId, { status }),
	);
	const togglePlanItem = (key: string, done: boolean) => quick(
		(current) => ({
			course: {
				...current.course,
				planDone: done ? [...current.course.planDone, key] : current.course.planDone.filter((k) => k !== key),
			},
			plan: {
				...current.plan,
				days: current.plan.days.map((day) => ({
					...day,
					items: day.items.map((item) => (item.key === key ? { ...item, done } : item)),
				})),
			},
		}),
		() => courseApi.planDone(code, key, done),
	);
	const setMinutesPerDay = (minutesPerDay: number) => quick(
		(current) => ({ ...current, course: { ...current.course, minutesPerDay } }),
		() => courseApi.patch(code, { minutesPerDay }),
	);
	const removeSource = (id: string) => quick(
		(current) => ({ ...current, course: { ...current.course, sources: current.course.sources.filter((s) => s.id !== id) } }),
		() => courseApi.removeSource(code, id),
	);
	const setExamDate = async (date: string): Promise<boolean> => {
		const error = await mutate(null, () => courseApi.patch(code, { exam: { date } }));
		if (error) setNotice(`Datoen ble ikke lagret. ${error}`);
		return error === null;
	};
	const saveTopics = async (topics: Parameters<typeof courseApi.putTopics>[1]): Promise<boolean> => {
		const error = await mutate(null, () => courseApi.putTopics(code, topics));
		if (error) setNotice(`Temalista ble ikke lagret. ${error}`);
		return error === null;
	};
	const [generating, setGenerating] = useState(false);
	const generateTopics = async (): Promise<"ai" | "fallback" | null> => {
		let how: "ai" | "fallback" | null = null;
		setGenerating(true);
		const error = await mutate(null, async () => {
			const result = await courseApi.generateTopics(code);
			how = result.generatedBy;
			return result;
		});
		setGenerating(false);
		if (error) setNotice(`Kunne ikke lage temaliste. ${error}`);
		return error ? null : how;
	};
	const start = (session: CourseSessionStart) => {
		const { openingText, ...body } = session;
		void launcher.launch(body, openingText).then((outcome) => {
			if (outcome === "failed") setNotice("Kunne ikke starte økta. Prøv igjen.");
		});
	};
	const focusExamDate = () => {
		dateRef.current?.scrollIntoView({ block: "center" });
		dateRef.current?.focus();
		dateRef.current?.showPicker?.();
	};

	const [refreshing, setRefreshing] = useState(false);
	const refresh = async () => {
		setRefreshing(true);
		const error = await mutate(null, () => courseApi.refresh(code));
		setRefreshing(false);
		setNotice(error ? `Kunne ikke oppdatere fra NTNU. ${error}` : "Faget er oppdatert fra NTNU.");
	};
	const [confirm, setConfirm] = useState<"delete" | "regenerate" | null>(null);
	const [confirmBusy, setConfirmBusy] = useState(false);
	const [confirmError, setConfirmError] = useState<string | null>(null);
	const closeConfirm = useCallback(() => {
		setConfirm(null);
		setConfirmError(null);
	}, []);
	const runConfirm = async () => {
		setConfirmBusy(true);
		setConfirmError(null);
		if (confirm === "delete") {
			try {
				await courseApi.remove(code);
				router.push("/");
				return;
			} catch (err) {
				setConfirmError(courseErrorMessage(err));
			}
		} else if (confirm === "regenerate") {
			const how = await generateTopics();
			if (how) {
				closeConfirm();
				if (how === "fallback") {
					setNotice("Temalista ble laget uten AI, rett fra læringsutbyttet. Sett opp modeller under Innstillinger for en bedre liste.");
				}
			} else closeConfirm(); // the failure is already in the notice line
		}
		setConfirmBusy(false);
	};

	if (gone) return <CourseNotFound code={code} />;

	const starting = launcher.busy;
	return (
		<div ref={root} className="flex h-dvh flex-col">
			<TopBar>
				<nav aria-label="Brødsmuler" className="flex min-w-0 items-center gap-1 font-ui text-sm">
					<Link href="/" className="rounded-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
						Mine fag
					</Link>
					<ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
					<span className="truncate font-medium tabular-nums" aria-current="page">{course.code}</span>
				</nav>
			</TopBar>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
					<CourseHeader
						course={course}
						daysLeft={plan.daysLeft}
						dateRef={dateRef}
						onExamDate={setExamDate}
						menu={
							<CourseMenu
								custom={course.custom}
								refreshing={refreshing}
								onRefresh={() => void refresh()}
								onDelete={() => setConfirm("delete")}
							/>
						}
					/>

					{/* One line for everything that needs saying. The live region
					    is always mounted, so a message is announced when it lands. */}
					<div role="alert" className="empty:hidden" data-testid="course-notice">
						{notice && (
							<p className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2 font-ui text-sm">
								<span className="min-w-0 flex-1">{notice}</span>
								<button
									type="button"
									onClick={() => setNotice(null)}
									aria-label="Lukk meldingen"
									className="shrink-0 cursor-pointer rounded-sm p-0.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
								>
									<XIcon className="size-4" aria-hidden="true" />
								</button>
							</p>
						)}
					</div>

					<CourseTabs tab={tab} onTab={selectTab} panelId={panelId} />

					<div role="tabpanel" id={panelId} aria-labelledby={`${panelId}-tab-${tab}`} className="min-h-80">
						{tab === "plan" && (wizard ? (
							<div className="flex flex-col items-center gap-3">
								<CourseWizard
									course={course}
									examSession={examSession}
									actions={{
										onExamDate: setExamDate,
										onAddSource: (source) => mutate(null, () => courseApi.addSource(code, source)),
										onRemoveSource: removeSource,
										onGenerate: generateTopics,
										onStatus: setStatus,
										onStart: start,
										onOpenSetup: launcher.openSetup,
										onDone: () => setWizard(false),
										starting,
									}}
								/>
								<Button variant="ghost" size="sm" onClick={() => setWizard(false)}>Lukk veiviseren</Button>
							</div>
						) : (
							<ExamPlanView
								course={course}
								plan={plan}
								today={today}
								examSession={examSession}
								actions={{
									onToggleDone: togglePlanItem,
									onStart: start,
									onMinutesPerDay: setMinutesPerDay,
									onOpenWizard: () => setWizard(true),
									onMapTopics: () => selectTab("topics"),
									onEditExamDate: focusExamDate,
									starting,
								}}
							/>
						))}
						{tab === "topics" && (
							<TopicBoard
								course={course}
								onOpenWizard={() => {
									setWizard(true);
									selectTab("plan");
								}}
								actions={{
									onStatus: setStatus,
									onStart: start,
									onSaveTopics: saveTopics,
									onRegenerate: () => setConfirm("regenerate"),
									starting,
									regenerating: generating,
								}}
							/>
						)}
						{tab === "context" && (
							<SourcesPanel
								course={course}
								onAdd={(source) => mutate(null, () => courseApi.addSource(code, source))}
								onRemove={removeSource}
							/>
						)}
					</div>
				</div>
			</div>

			{/* A free session about this fag: docked under the scroll area. */}
			<div className="shrink-0 border-t border-border/60 bg-background pb-4 pt-3">
				<div className="mx-auto w-full max-w-[46rem] px-4">
					<StartBox
						launcher={launcher}
						placeholder={`Spør om hva som helst i ${course.code}`}
						ownsFieldCycle={false}
						buildSession={(text) => ({ title: text, course: { code } })}
					/>
				</div>
			</div>

			<ConfirmDialog
				open={confirm === "delete"}
				title={`Slette ${course.code}?`}
				confirmLabel="Slett fag"
				destructive
				busy={confirmBusy}
				error={confirmError}
				onConfirm={() => void runConfirm()}
				onCancel={closeConfirm}
			>
				Temalista, planen og materiallista for {course.code} {course.name} fjernes. Øktene du har hatt i faget beholdes, og filene dine røres ikke. Dette kan ikke angres.
			</ConfirmDialog>
			<ConfirmDialog
				open={confirm === "regenerate"}
				title="Lage temalista på nytt?"
				confirmLabel="Lag på nytt"
				busy={confirmBusy}
				error={confirmError}
				onConfirm={() => void runConfirm()}
				onCancel={closeConfirm}
			>
				Appen lager en ny liste fra emnesiden og materialet ditt. Temaer som finnes fra før, beholder fargen sin. Temaer du har lagt til eller gitt nytt navn selv, kan forsvinne. Det kan ta opptil et minutt.
			</ConfirmDialog>
			<LauncherSetupDialog launcher={launcher} />
		</div>
	);
}
