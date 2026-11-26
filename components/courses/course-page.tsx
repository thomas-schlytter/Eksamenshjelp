"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	ChevronDownIcon, ChevronRightIcon, EllipsisIcon, ExternalLinkIcon, LoaderCircleIcon, PencilIcon, RefreshCwIcon, SparklesIcon, Trash2Icon, XIcon,
} from "lucide-react";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { MAKE_MOCK_EXAM_TEXT } from "@/src/core";
import { FlameCard } from "@/components/streak/flame-card";
import { cn } from "@/lib/utils";
import { courseVerdict, groupChatsByCourse, VERDICT_RULE, type CourseVerdict, type MockExamResult } from "@/src/core";
import { ConfirmDialog } from "./confirm-dialog";
import { courseApi, CourseApiError, courseErrorMessage, type CourseAndPlan } from "./course-api";
import { CourseChatList } from "./course-chat-list";
import { openCourseChatId, useChatList } from "./course-chats";
import { type SelfStatus } from "./course-format";
import { SourcesPanel } from "./course-sources";
import {
	countdownParts, examDayLabel, greenToastText, mockExamChange, mockExamPoints, newlyGreen, workNowTopics, workOnTopicText,
	type MockExamPoint, type WorkNowTopic,
} from "./course-summary";
import { localIsoDate, topicCounts, TOPIC_STATUS_LABEL, type Course, type CourseTopic, type TopicStatus } from "./course-types";
import { CourseWizard } from "./course-wizard";
import { ExamPlanView } from "./exam-plan";
import { LauncherSetupDialog, usePageTabCycle, useSessionLauncher, type LaunchOutcome } from "./session-launcher";
import { beginNavigation } from "@/components/navigation-progress";
import { TopicBoard } from "./topic-board";
import { flashcardApi, flashcardErrorMessage, useFlashcards } from "@/components/flashcards/flashcard-api";
import { FlashcardsCard } from "@/components/flashcards/flashcards-card";

/** The collapsed sections at the bottom of the fag page (fase 7b). */
export type CourseSectionId = "chats" | "topics" | "plan" | "sources";
const SECTION_HASH: Record<CourseSectionId, string> = { chats: "chatter", topics: "temaer", plan: "plan", sources: "kilder" };

/** `#temaer` / `#plan` / `#kilder` (and the old `#kontekst`) open a
 *  section (help center, shared links). */
export function sectionFromHash(hash: string): CourseSectionId | null {
	if (hash === "#kontekst") return "sources";
	const entry = (Object.entries(SECTION_HASH) as [CourseSectionId, string][]).find(([, h]) => `#${h}` === hash);
	return entry?.[0] ?? null;
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
	const item = "flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left font-ui text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent";
	return (
		<div ref={root} className="relative">
			<Button
				ref={button}
				variant="outline"
				size="icon-lg"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label="Flere valg for faget"
				data-testid="course-menu"
				onClick={() => setOpen((v) => !v)}
			>
				{refreshing ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : <EllipsisIcon aria-hidden="true" />}
			</Button>
			{open && (
				<div role="menu" data-lh-menu className="absolute right-0 top-full z-30 mt-1 flex w-56 flex-col gap-0.5 rounded-lg border bg-popover p-1.5 shadow-xl">
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

const CARD = "rounded-lg border bg-card p-5";

// ─── the countdown ───────────────────────────────────────────────────────────

const VERDICT_CHIP: Record<CourseVerdict["id"], string> = {
	"on-track": "bg-status-green-soft text-status-green-ink",
	behind: "bg-status-yellow-soft text-status-yellow-ink",
	"speed-up": "bg-status-red-soft text-status-red-ink",
};

/** The verdict chip; the rule is its tooltip. */
export function VerdictChip({ verdict }: { verdict: CourseVerdict }) {
	return (
		<Hint label={VERDICT_RULE} side="bottom">
			<span
				tabIndex={0}
				data-testid="course-verdict"
				data-verdict={verdict.id}
				className={cn("inline-flex cursor-default items-center self-start rounded-sm px-2.5 py-1 font-ui text-xs font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", VERDICT_CHIP[verdict.id])}
			>
				{verdict.label}
			</span>
		</Hint>
	);
}

/** The exam date, editable in place (the small pencil). */
function ExamDateLine({ course, onExamDate }: { course: Course; onExamDate: (date: string) => Promise<boolean> }) {
	const inputId = useId();
	const saved = course.exam.date ?? "";
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(saved);
	const [saving, setSaving] = useState(false);
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (editing) input.current?.focus();
	}, [editing]);
	const commit = () => {
		if (saving) return;
		if (draft === saved) {
			setEditing(false);
			return;
		}
		setSaving(true);
		void onExamDate(draft).then(() => {
			setSaving(false);
			setEditing(false);
		});
	};
	const day = examDayLabel(course.exam.date);
	if (editing) {
		return (
			<div className="flex items-center gap-2" data-tour="exam-date">
				<label htmlFor={inputId} className="font-ui text-sm text-primary-foreground/80">Eksamensdato</label>
				<input
					ref={input}
					id={inputId}
					type="date"
					value={draft}
					disabled={saving}
					onChange={(e) => setDraft(e.target.value)}
					onBlur={commit}
					onKeyDown={(e) => {
						if (e.key === "Enter") e.currentTarget.blur();
						if (e.key === "Escape") {
							e.preventDefault();
							e.stopPropagation();
							setDraft(saved);
							setEditing(false);
						}
					}}
					data-testid="exam-date-input"
					className="h-8 rounded-sm border border-input bg-card px-2 font-ui text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
				/>
				{saving && <LoaderCircleIcon className="size-4 animate-spin" aria-label="Lagrer" />}
			</div>
		);
	}
	return (
		<div className="flex min-w-0 items-center gap-1.5" data-tour="exam-date">
			<p className="min-w-0 truncate font-ui text-sm text-primary-foreground/80" data-testid="course-exam-day">
				{day ? `Eksamen ${day}` : "Ingen eksamensdato"}
			</p>
			<Hint label={day ? "Endre eksamensdato" : "Sett eksamensdato"} side="bottom">
				<button
					type="button"
					onClick={() => {
						setDraft(saved);
						setEditing(true);
					}}
					aria-label={day ? "Endre eksamensdato" : "Sett eksamensdato"}
					data-testid="exam-date-edit"
					className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-sm text-primary-foreground/80 outline-none transition-colors hover:bg-primary-foreground/10 hover:text-primary-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
				>
					<PencilIcon className="size-3.5" aria-hidden="true" />
				</button>
			</Hint>
		</div>
	);
}

/** Marine: the date, form and duration, the big «N dager igjen», the verdict. */
export function CountdownCard({ course, daysLeft, verdict, onExamDate }: {
	course: Course;
	daysLeft: number | null;
	verdict: CourseVerdict | null;
	onExamDate: (date: string) => Promise<boolean>;
}) {
	const parts = countdownParts(daysLeft);
	const facts = [course.exam.form, course.exam.duration].filter(Boolean).join(" · ");
	return (
		<section
			data-testid="course-countdown"
			aria-label="Nedtelling til eksamen"
			className="flex min-h-44 flex-col justify-between gap-4 rounded-lg border border-primary bg-primary p-5 text-primary-foreground"
		>
			<div className="flex flex-col gap-0.5">
				<ExamDateLine course={course} onExamDate={onExamDate} />
				{facts && <p className="truncate font-ui text-xs text-primary-foreground/65" title={facts}>{facts}</p>}
			</div>
			<p className="flex items-baseline gap-3" data-testid="course-days-left">
				{parts.big !== null && (
					<span className="font-title text-7xl font-semibold leading-[0.9] tracking-tight tabular-nums">{parts.big}</span>
				)}
				<span className={cn("font-title font-medium", parts.big !== null ? "text-xl" : "text-2xl")}>{parts.words}</span>
			</p>
			{verdict && <VerdictChip verdict={verdict} />}
		</section>
	);
}

// ─── the progress ring ───────────────────────────────────────────────────────

const LEGEND: { status: Exclude<TopicStatus, "unknown">; dot: string; label: (n: number) => string }[] = [
	{ status: "green", dot: "bg-status-green", label: (n) => `${n} sitter` },
	{ status: "yellow", dot: "bg-status-yellow", label: (n) => `${n} på vei` },
	{ status: "red", dot: "bg-status-red", label: (n) => `${n} må jobbes med` },
];

/** Green topics of the total, with the counts per colour. `pulse` replays
 *  the reward animation (a new key per new green). */
export function ProgressRingCard({ counts, pulse = 0, onMakeTopics }: {
	counts: Record<TopicStatus, number>;
	pulse?: number;
	onMakeTopics?: () => void;
}) {
	const total = counts.green + counts.yellow + counts.red + counts.unknown;
	const r = 50, c = 2 * Math.PI * r;
	const share = total === 0 ? 0 : counts.green / total;
	// The reward: the arc grows to its new share (CSS transition) and the
	// ring pulses once. Never with reduced motion.
	const ring = useRef<SVGSVGElement>(null);
	useEffect(() => {
		if (pulse === 0 || !ring.current?.animate) return;
		if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
		ring.current.animate(
			[{ transform: "scale(1)" }, { transform: "scale(1.06)" }, { transform: "scale(1)" }],
			{ duration: 700, easing: "ease-out" },
		);
	}, [pulse]);
	if (total === 0) {
		return (
			<section data-testid="course-progress" aria-label="Temaer" className={cn(CARD, "flex flex-col items-start justify-center gap-3")}>
				<p className="font-title text-lg font-semibold">Ingen temaer ennå</p>
				{onMakeTopics && <Button variant="outline" onClick={onMakeTopics}>Lag temaliste</Button>}
			</section>
		);
	}
	return (
		<section data-testid="course-progress" aria-label="Temaer" className={cn(CARD, "flex items-center gap-5")}>
			<svg
				ref={ring}
				width="120"
				height="120"
				viewBox="0 0 120 120"
				role="img"
				aria-label={`${counts.green} av ${total} temaer sitter`}
				className="shrink-0 origin-center"
			>
				<circle cx="60" cy="60" r={r} fill="none" stroke="var(--accent)" strokeWidth="11" />
				<circle
					cx="60"
					cy="60"
					r={r}
					fill="none"
					stroke="var(--gold)"
					strokeWidth="11"
					strokeLinecap={share > 0 && share < 1 ? "round" : "butt"}
					strokeDasharray={`${share * c} ${c}`}
					transform="rotate(-90 60 60)"
					className="lh-ring-arc"
					data-testid="course-ring-arc"
				/>
				<text x="60" y="62" textAnchor="middle" fontFamily="var(--font-heading)" fontSize="28" fontWeight="600" fill="var(--foreground)">
					{counts.green}/{total}
				</text>
				<text x="60" y="80" textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">temaer sitter</text>
			</svg>
			<ul className="flex flex-col gap-2 font-ui text-sm" data-testid="course-progress-legend">
				{LEGEND.map((entry) => (
					<li key={entry.status} className="flex items-center gap-2">
						<span className={cn("size-2.5 shrink-0 rounded-full", entry.dot)} aria-hidden="true" />
						{entry.label(counts[entry.status])}
					</li>
				))}
				{counts.unknown > 0 && (
					<li className="flex items-center gap-2 text-muted-foreground">
						<span className="size-2.5 shrink-0 rounded-full bg-muted-foreground/40" aria-hidden="true" />
						{counts.unknown} ikke kartlagt
					</li>
				)}
			</ul>
		</section>
	);
}

// ─── what to work on ─────────────────────────────────────────────────────────

const DOT: Record<TopicStatus, string> = {
	red: "bg-status-red",
	yellow: "bg-status-yellow",
	green: "bg-status-green",
	unknown: "bg-muted-foreground/40",
};

/** «Jobb med dette nå»: the three most important red and yellow topics;
 *  a click starts work on it in the fag-chat. */
export function WorkNowCard({ topics, items, onWork, onAllTopics, onMakeTopics }: {
	topics: readonly CourseTopic[];
	items: readonly WorkNowTopic[];
	onWork: (topic: CourseTopic) => void;
	onAllTopics: () => void;
	onMakeTopics?: () => void;
}) {
	const allGreen = topics.length > 0 && topics.every((t) => t.status === "green");
	return (
		<section data-testid="course-work-now" aria-labelledby="work-now-title" className={cn(CARD, "flex flex-col gap-2.5")}>
			<div className="flex items-baseline justify-between gap-3">
				<h2 id="work-now-title" className="font-title text-xl font-semibold tracking-tight">Jobb med dette nå</h2>
				{topics.length > 0 && (
					<button type="button" onClick={onAllTopics} data-testid="course-all-topics" className="cursor-pointer rounded-sm font-ui text-sm text-primary underline-offset-4 outline-none hover:text-gold-ink hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:text-foreground">
						Alle temaer
					</button>
				)}
			</div>
			{items.length > 0 ? (
				<ul className="flex flex-col gap-2">
					{items.map(({ topic, reason }) => (
						<li key={topic.id}>
							<button
								type="button"
								onClick={() => onWork(topic)}
								data-testid="work-now-topic"
								data-status={topic.status}
								className="flex w-full cursor-pointer items-start gap-3 rounded-md bg-muted px-3.5 py-2.5 text-left font-ui outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
							>
								<span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", DOT[topic.status])} aria-hidden="true" />
								<span className="sr-only">{TOPIC_STATUS_LABEL[topic.status]}:</span>
								{/* The reason under the title: side by side, both were cut in a third of the row. */}
								<span className="flex min-w-0 flex-1 flex-col">
									<span className="truncate text-sm font-medium" title={topic.title}>{topic.title}</span>
									<span className="truncate text-xs text-muted-foreground" title={reason}>{reason}</span>
								</span>
							</button>
						</li>
					))}
				</ul>
			) : topics.length === 0 ? (
				<div className="flex flex-col items-start gap-3">
					<p className="font-ui text-sm text-muted-foreground">Faget har ingen temaliste ennå.</p>
					{onMakeTopics && <Button variant="outline" onClick={onMakeTopics}>Lag temaliste</Button>}
				</div>
			) : allGreen ? (
				<p className="font-ui text-sm text-muted-foreground">Alle temaene sitter. Ta en prøveeksamen for å sjekke.</p>
			) : (
				<p className="font-ui text-sm text-muted-foreground">Ingen temaer er røde eller gule. Sett fargene under «Alle temaer».</p>
			)}
		</section>
	);
}

// ─── the mock exams ──────────────────────────────────────────────────────────

/** The score curve (percent per prøveeksamen) with dates and the change. */
export function MockExamsCard({ points, loaded, busy, pending, onMake }: {
	points: readonly MockExamPoint[];
	/** false until the first read. */
	loaded: boolean;
	busy?: boolean;
	/** «Lag prøveeksamen» was pressed and waits for the server. */
	pending?: boolean;
	onMake: () => void;
}) {
	const change = mockExamChange(points);
	const W = 360, H = 120;
	const x = (i: number) => 20 + (i * (W - 40)) / (points.length - 1);
	const y = (p: number) => 104 - (p / 100) * 88;
	return (
		<section data-testid="course-mock-exams" aria-labelledby="mock-exams-title" className={cn(CARD, "flex flex-col gap-2.5")}>
			<div className="flex items-baseline justify-between gap-3">
				<h2 id="mock-exams-title" className="font-title text-xl font-semibold tracking-tight">Prøveeksamener</h2>
				{change && (
					<span
						data-testid="mock-exam-change"
						className={cn(
							"rounded-sm px-2.5 py-1 font-ui text-xs font-semibold",
							change.delta > 0 ? "bg-status-green-soft text-status-green-ink" : change.delta < 0 ? "bg-status-red-soft text-status-red-ink" : "bg-muted text-muted-foreground",
						)}
					>
						{change.label}
					</span>
				)}
			</div>
			{points.length === 0 ? (
				<div className="flex flex-1 flex-col items-start justify-center gap-3" data-testid="mock-exams-empty">
					<p className="font-ui text-sm text-muted-foreground">
						{loaded ? "Ingen rettede prøveeksamener ennå." : "Laster …"}
					</p>
					{loaded && (
						<Button variant="outline" onClick={onMake} disabled={busy} pending={pending}>
							<SparklesIcon aria-hidden="true" />
							Lag prøveeksamen
						</Button>
					)}
				</div>
			) : points.length === 1 ? (
				// One result: a lone dot on an empty axis says nothing — show the number.
				<div className="flex flex-1 flex-col justify-center gap-1" data-testid="mock-exam-single">
					<p className="font-title text-4xl font-semibold tabular-nums tracking-tight text-status-green-ink">{points[0]!.percent} %</p>
					<p className="font-ui text-sm text-muted-foreground">
						{points[0]!.label ? `Første prøveeksamen, ${points[0]!.label}.` : "Første prøveeksamen."} Ta en til, så ser du utviklingen.
					</p>
				</div>
			) : (
				<>
					<svg
						viewBox={`0 0 ${W} ${H}`}
						className="h-auto w-full"
						role="img"
						aria-label={`Poeng fra ${points[0]!.percent} til ${points.at(-1)!.percent} prosent`}
					>
						<line x1="0" y1="104" x2={W} y2="104" stroke="var(--accent)" />
						{points.length > 1 && (
							<polyline
								points={points.map((p, i) => `${x(i)},${y(p.percent)}`).join(" ")}
								fill="none"
								stroke="var(--primary)"
								strokeWidth="2.5"
								strokeLinejoin="round"
							/>
						)}
						{points.map((p, i) => (
							<circle
								key={p.id}
								cx={x(i)}
								cy={y(p.percent)}
								r={i === points.length - 1 ? 6 : 5}
								fill={i === points.length - 1 ? "var(--gold)" : "var(--primary)"}
							/>
						))}
					</svg>
					<ol className="flex justify-between font-ui text-xs text-muted-foreground">
						{points.map((p, i) => (
							<li key={p.id} className={cn("tabular-nums", i === points.length - 1 && "font-semibold text-status-green-ink")}>
								{p.label ? `${p.label} · ` : ""}{p.percent} %
							</li>
						))}
					</ol>
				</>
			)}
		</section>
	);
}

// ─── the collapsed sections ──────────────────────────────────────────────────

export function CourseSection({ id, title, open, onToggle, children, meta }: {
	id: CourseSectionId;
	title: string;
	open: boolean;
	onToggle: () => void;
	children: ReactNode;
	meta?: string;
}) {
	const panelId = useId();
	return (
		<section id={`seksjon-${SECTION_HASH[id]}`} data-testid={`course-section-${id}`} data-open={open || undefined} className="rounded-lg border bg-card">
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={open}
				aria-controls={panelId}
				data-section={id}
				className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-5 py-4 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
			>
				<span className="font-title text-base font-semibold">{title}</span>
				{meta && <span className="font-ui text-xs tabular-nums text-muted-foreground">{meta}</span>}
				<ChevronDownIcon className={cn("ml-auto size-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
			</button>
			{open && (
				<div id={panelId} className="border-t px-5 py-5">
					{children}
				</div>
			)}
		</section>
	);
}

// ─── the toast for a new green topic ─────────────────────────────────────────

export function GreenToast({ text, onClose }: { text: string; onClose: () => void }) {
	return (
		<div className="pointer-events-none fixed right-5 top-20 z-40 flex justify-end">
			<div role="status" data-testid="green-toast" className="lh-toast-in pointer-events-auto flex items-center gap-3 rounded-lg border border-l-4 border-l-status-green bg-card px-4 py-3 shadow-lg">
				<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-status-green-soft text-status-green" aria-hidden="true">
					<SparklesIcon className="size-3.5" />
				</span>
				<p className="font-ui text-sm font-semibold">{text}</p>
				<button
					type="button"
					onClick={onClose}
					aria-label="Lukk"
					className="cursor-pointer rounded-sm p-0.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
				>
					<XIcon className="size-4" aria-hidden="true" />
				</button>
			</div>
		</div>
	);
}

// ─── the page ────────────────────────────────────────────────────────────────

/** The course's graded prøveeksamener (GET /api/mock-exams/[code]), kept
 *  fresh by `mock-exams-changed` and reconnects. null until the first read. */
function useMockExamResults(code: string): MockExamResult[] | null {
	const [results, setResults] = useState<MockExamResult[] | null>(null);
	const reload = useCallback(async () => {
		try {
			const res = await fetch(`/api/mock-exams/${encodeURIComponent(code)}`, { cache: "no-store" });
			const body = res.ok ? ((await res.json()) as { results?: MockExamResult[] }) : {};
			setResults(Array.isArray(body.results) ? body.results : []);
		} catch {
			setResults((prev) => prev ?? []);
		}
	}, [code]);
	useEffect(() => {
		void reload();
	}, [reload]);
	useServerEvent("mock-exams-changed", (payload) => {
		if (payload.code === code) void reload();
	});
	useServerResync(() => void reload());
	return results;
}

/**
 * THE FAG PAGE (/fag/[code]), fase 7b: a small summary, built as the
 * approved sketch (Main): how long to the exam and the verdict, the
 * topics that sit, the flame; what to work on now and the mock exams; and,
 * collapsed below, the chats, every topic, the exam plan and the sources.
 * The first-run wizard shows while the fag has no topics.
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
	const chats = useChatList();
	const chatGroup = useMemo(
		() => (chats === null ? null : groupChatsByCourse(chats, [code]).byCourse.get(code) ?? { main: null, subs: [] }),
		[chats, code],
	);
	const results = useMockExamResults(code);
	const flashcards = useFlashcards(code);
	const [data, setData] = useState(initial);
	const [gone, setGone] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const [wizard, setWizard] = useState(initial.course.topics.length === 0);
	const [today] = useState(() => localIsoDate());
	const [open, setOpen] = useState<ReadonlySet<CourseSectionId>>(() => new Set());
	const { course, plan } = data;

	// ── the reward: a topic turned green ────────────────────────────────
	const [pulse, setPulse] = useState(0);
	const [greenToast, setGreenToast] = useState<string | null>(null);
	const [lastTopics, setLastTopics] = useState(course.topics);
	if (lastTopics !== course.topics) {
		const fresh = newlyGreen(lastTopics, course.topics);
		setLastTopics(course.topics);
		if (fresh.length > 0) {
			setPulse((n) => n + 1);
			setGreenToast(greenToastText(fresh));
		}
	}
	useEffect(() => {
		if (!greenToast) return;
		const id = setTimeout(() => setGreenToast(null), 5000);
		return () => clearTimeout(id);
	}, [greenToast]);

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

	// Another window, the agent's topic_status tool mid-session, or the
	// topic update after «Avslutt økt».
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

	// ── sections (deep-linkable by hash) ─────────────────────────────────
	const openSection = useCallback((id: CourseSectionId, scroll = false) => {
		setOpen((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
		if (scroll) {
			requestAnimationFrame(() => document.getElementById(`seksjon-${SECTION_HASH[id]}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
		}
	}, []);
	const toggleSection = (id: CourseSectionId) => setOpen((prev) => {
		const next = new Set(prev);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		return next;
	});
	useEffect(() => {
		const fromHash = () => {
			const next = sectionFromHash(window.location.hash);
			if (next) openSection(next, true);
		};
		fromHash();
		window.addEventListener("hashchange", fromHash);
		return () => window.removeEventListener("hashchange", fromHash);
	}, [openSection]);

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
	// The fag-chat (fase 2): «Fortsett i fag-chatten» opens it (created the
	// first time); «Lag prøveeksamen» and a topic send their text into it.
	// An existing fag-chat is a plain prefetched link (2026-11-26): nothing
	// awaits before the navigation. Only the first visit asks the server.
	const [openingChat, setOpeningChat] = useState(false);
	const openMainChat = () => {
		setOpeningChat(true);
		openCourseChatId(code, fetch)
			.then((chat) => {
				beginNavigation();
				router.push(`/chat/${chat.id}`);
			})
			.catch(() => {
				setOpeningChat(false);
				setNotice("Kunne ikke åpne fag-chatten. Prøv igjen.");
			});
	};
	const sendToCourseChat = (text: string, onSettled?: (outcome: LaunchOutcome) => void) => {
		void launcher.sendToCourseChat(code, text).then((outcome) => {
			if (outcome === "failed") setNotice("Kunne ikke åpne fag-chatten. Prøv igjen.");
			onSettled?.(outcome);
		});
	};
	// «Lag prøveeksamen» spins on the button that was pressed (the launcher's
	// busy also covers a topic sent to the fag-chat).
	const [makingExam, setMakingExam] = useState(false);
	const makeMockExam = () => {
		setMakingExam(true);
		sendToCourseChat(MAKE_MOCK_EXAM_TEXT, (outcome) => {
			if (outcome !== "started") setMakingExam(false);
		});
	};
	// «Lag spørsmålskort»: the server starts the job and answers at once;
	// the card shows the waiting state until `flashcards-changed`.
	const [startingCards, setStartingCards] = useState(false);
	const makeFlashcards = () => {
		setStartingCards(true);
		flashcardApi.generate(code, "new")
			.then((view) => flashcards.setView(view))
			.catch((err) => setNotice(`Kunne ikke lage spørsmålskort. ${flashcardErrorMessage(err)}`))
			.finally(() => setStartingCards(false));
	};
	const showWizard = () => {
		setWizard(true);
		root.current?.querySelector("[data-scroll-root]")?.scrollTo({ top: 0, behavior: "smooth" });
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

	const counts = useMemo(() => topicCounts(course.topics), [course.topics]);
	const verdict = useMemo(() => courseVerdict(plan.daysLeft, counts), [plan.daysLeft, counts]);
	const cardMisses = flashcards.view?.weakTopics;
	const workNow = useMemo(() => workNowTopics(course.topics, 3, cardMisses), [course.topics, cardMisses]);
	const points = useMemo(() => mockExamPoints(results ?? []), [results]);
	const hasPlan = plan.days.some((day) => day.items.length > 0);
	const chatCount = chatGroup ? (chatGroup.main ? 1 : 0) + chatGroup.subs.length : 0;

	if (gone) return <CourseNotFound code={code} />;

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

			{/* One scroller (relative: the tour's highlight measures inside it). */}
			<div data-scroll-root className="relative min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-7 sm:px-8 lg:px-11">
					<header data-testid="course-header" className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
						<div className="min-w-0">
							<p className="font-ui text-[11px] font-semibold uppercase tracking-widest text-muted-foreground tabular-nums">
								{course.code}
								{course.credits && ` · ${course.credits.replace(".", ",")} studiepoeng`}
							</p>
							<h1 className="mt-1.5 font-title text-4xl font-semibold leading-tight tracking-tight text-balance">{course.name}</h1>
						</div>
						<div className="flex flex-wrap items-center gap-2.5">
							<Button variant="outline" size="lg" onClick={makeMockExam} disabled={launcher.busy} pending={makingExam} data-testid="course-make-mock-exam">
								Lag prøveeksamen
							</Button>
							{chatGroup?.main && !launcher.busy ? (
								<Button asChild size="lg" data-testid="course-open-chat">
									<Link href={`/chat/${chatGroup.main.id}`}>Fortsett i fag-chatten</Link>
								</Button>
							) : (
								<Button size="lg" onClick={openMainChat} disabled={launcher.busy} pending={openingChat} data-testid="course-open-chat">
									Fortsett i fag-chatten
								</Button>
							)}
							<CourseMenu
								custom={course.custom}
								refreshing={refreshing}
								onRefresh={() => void refresh()}
								onDelete={() => setConfirm("delete")}
							/>
						</div>
					</header>

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

					{wizard && (
						<div className="flex flex-col items-center gap-3">
							<CourseWizard
								course={course}
								actions={{
									onExamDate: setExamDate,
									onAddSource: (source) => mutate(null, () => courseApi.addSource(code, source)),
									onRemoveSource: removeSource,
									onGenerate: generateTopics,
									onStatus: setStatus,
									onOpenSetup: launcher.openSetup,
									onDone: () => setWizard(false),
								}}
							/>
							<Button variant="ghost" size="sm" onClick={() => setWizard(false)}>Lukk veiviseren</Button>
						</div>
					)}

					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]">
						<CountdownCard course={course} daysLeft={plan.daysLeft} verdict={verdict} onExamDate={setExamDate} />
						<ProgressRingCard counts={counts} pulse={pulse} onMakeTopics={showWizard} />
						<FlameCard />
					</div>

					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]">
						<WorkNowCard
							topics={course.topics}
							items={workNow}
							onWork={(topic) => sendToCourseChat(workOnTopicText(topic.title))}
							onAllTopics={() => openSection("topics", true)}
							onMakeTopics={showWizard}
						/>
						<MockExamsCard points={points} loaded={results !== null} busy={launcher.busy} pending={makingExam} onMake={makeMockExam} />
						<FlashcardsCard code={code} view={flashcards.view} starting={startingCards} onMake={makeFlashcards} />
					</div>

					{/* The rest, collapsed. `course-tabs` keeps the help center's
					    tours working: they open a section by its title. */}
					<div data-tour="course-tabs" className="mt-2 flex flex-col gap-3">
						<div data-tour="course-chats">
							<CourseSection id="chats" title="Chatter" meta={chatCount > 0 ? String(chatCount) : undefined} open={open.has("chats")} onToggle={() => toggleSection("chats")}>
								<CourseChatList code={code} group={chatGroup} onOpenMain={openMainChat} opening={openingChat} />
							</CourseSection>
						</div>
						<CourseSection id="topics" title="Alle temaer" meta={course.topics.length > 0 ? String(course.topics.length) : undefined} open={open.has("topics")} onToggle={() => toggleSection("topics")}>
							<TopicBoard
								course={course}
								simple
								onOpenWizard={showWizard}
								actions={{
									onStatus: setStatus,
									onSaveTopics: saveTopics,
									onRegenerate: () => setConfirm("regenerate"),
									regenerating: generating,
								}}
							/>
						</CourseSection>
						{hasPlan && (
							<CourseSection id="plan" title="Eksamensplan" open={open.has("plan")} onToggle={() => toggleSection("plan")}>
								<ExamPlanView
									course={course}
									plan={plan}
									today={today}
									compact
									actions={{
										onToggleDone: togglePlanItem,
										onMinutesPerDay: setMinutesPerDay,
										onOpenWizard: showWizard,
										onMapTopics: () => openSection("topics", true),
										onEditExamDate: () => root.current?.querySelector<HTMLElement>("[data-testid='exam-date-edit']")?.click(),
									}}
								/>
							</CourseSection>
						)}
						<CourseSection id="sources" title="Kilder" meta={course.sources.length > 0 ? String(course.sources.length) : undefined} open={open.has("sources")} onToggle={() => toggleSection("sources")}>
							<div className="flex flex-col gap-4">
								{course.url && (
									<a
										href={course.url}
										target="_blank"
										rel="noreferrer"
										className="flex items-center gap-1 self-start rounded-sm font-ui text-sm text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
									>
										Emnesiden hos NTNU
										<ExternalLinkIcon className="size-3.5" aria-hidden="true" />
									</a>
								)}
								<SourcesPanel
									course={course}
									onAdd={(source) => mutate(null, () => courseApi.addSource(code, source))}
									onRemove={removeSource}
								/>
							</div>
						</CourseSection>
					</div>
				</div>
			</div>

			{greenToast && <GreenToast text={greenToast} onClose={() => setGreenToast(null)} />}

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
