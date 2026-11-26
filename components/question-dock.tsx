"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownIcon, ChevronRightIcon, MessageCircleQuestionIcon, PlayIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { finishDictation, isDictationActive, joinDictation, useDictationTarget } from "@/components/dictation";
import { useEnterSubmits } from "@/components/enter-submits";
import { PathInput } from "@/components/path-input";
import { AnswerUploadButton, withAnswerPaths } from "@/components/answer-upload";
import { MalformedQuestion } from "@/components/malformed-question";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { HintRequestButton, HintStepper } from "@/components/hint-stepper";
import { useParams } from "next/navigation";
import { SvgImage } from "@/components/artifacts/svg-image";
import { useSessionMermaid } from "@/components/session-overlay";
import { cn } from "@/lib/utils";
import {
	buildAnswer,
	normalizeHints,
	repairMathForDisplay,
	explainLabel,
	normalizeQuizType,
	CONFIDENCE_STOPS,
	DEFAULT_CONFIDENCE_INDEX,
	emptyDockSelection,
	explanationRequiredFor,
	explanationSatisfied,
	normalizeOptions,
	resolveCorrect,
	seededRandom,
	shuffleOptions,
	toolQuestionKind,
	parseAskInput,
	parseQuizInput,
	parseExplainInput,
	toggleOption,
	toggleOther,
	type AnswerRequest,
	type AskToolInput,
	type DockSelection,
	type ExplainToolInput,
	type QuestionAnswerData,
	type QuestionFormDraft,
	type QuestionData,
	type QuestionMode,
	type QuizToolInput,
	type SelectMode,
	type Phase3,
} from "@/src/core";
import { CONFIDENCE_COLORS, confidenceRailStyle } from "@/components/confidence-rail";

/**
 * The question dock — a pending quiz/ask REPLACES the chat composer: the
 * persistent bottom blob morphs into the question. Two voices meet here:
 * the teacher's (question, options, explanation) and the learner's —
 * "Your thinking", a labeled composer-twin field for dumping reasoning,
 * with Submit docked inside it exactly like the chat composer's send.
 *
 * The thinking field is the transfer channel of the whole product (wave-2):
 * never called "optional", Enter makes a NEWLINE (it is for dumping — soon
 * dictated, not typed), submission is the button only, and its size scales
 * with the phase (probing stays quick; teaching invites depth). The
 * "Other…" option is an editable option ROW — circle + inline input,
 * styled like its siblings — so picking Other never displaces thinking.
 *
 * Collapse behavior (scroll-up → slim bar) is owned by the DockOverlay in the
 * chat view, which also owns the persistent shell and its height morph. This
 * component is content only. The expanded form stays MOUNTED while collapsed
 * (hidden, not unmounted) so a half-made selection survives scrolling.
 */

export interface QuestionDockProps {
	toolName: "quiz" | "probe" | "ask_user_question" | "explain" | "recall";
	toolCallId: string;
	input: QuizToolInput | AskToolInput | ExplainToolInput;
	/** Collapse state, owned by the DockOverlay (it drives the shell's height morph). */
	expanded: boolean;
	/**
	 * Teach-phase check awaiting its reveal (vision §2, W5): while collapsed,
	 * the bar is the "Check your understanding" invitation instead of the
	 * scroll-collapse strip. Owned by the DockOverlay; false once the learner
	 * has revealed (afterwards the normal collapse machine rules apply).
	 */
	reveal?: boolean;
	onExpand: () => void;
	onSubmit: (output: QuestionAnswerData) => void;
	/** "Hopp over" (2026-11): leave the question unanswered and let the
	 *  agent move on. One click, no confirm; the page builds the skipped
	 *  answer and sends it on the ordinary answer path. Absent = no button. */
	onSkip?: () => void;
	/** "Spør agenten" (2026-11): park the question and hand the composer
	 *  back. `draft` is whatever the learner had typed in the answer/
	 *  thinking field, so it is never lost (it becomes the composer draft).
	 *  Nothing is dismissed here: the question stays (parked) until the
	 *  learner's message is actually sent (fase 4). Absent = no button. */
	onHold?: (draft: string) => void;
	/** The question is PARKED (fase 4): the learner is writing to the agent
	 *  in the composer below. The dock shows a slim «På vent» row with the
	 *  way back; the form stays mounted (hidden, inert) so nothing typed or
	 *  picked is lost. */
	parked?: boolean;
	/** «Tilbake til spørsmålet»: leave the parked state without sending. */
	onUnpark?: () => void;
	/** The question's figure (fase 4): the svg its `figure` id points at,
	 *  shown above the question text. Null/absent = no figure. */
	figureSvg?: string | null;
	/** Restore only this call's unconfirmed submission after recovery. */
	initialDraft?: QuestionFormDraft;
	onSaveDraft?: (draft: QuestionFormDraft) => void;
	/** Escape in a question field stops dictation (STT wave) — threaded
	 *  from the page that owns the dictation hook. */
	onEscape?: () => void;
	/** The keyboard machine (wave B) is armed only while the dock is
	 *  expanded — the collapsed bar keeps its native Enter-to-expand. */
	active?: boolean;
	/** Session phase at the question — scales the thinking field: probing
	 *  stays quick (one row), teaching invites dumping (three rows). */
	phase?: Phase3;
	/** Dictation claim (owner 2026-10-03): false while a teach-phase check
	 *  sits UNREVEALED — the reading-thinking field owns dictated speech
	 *  during the reading; the dock reclaims on reveal. Default true (probe
	 *  questions, predictions, old callers). */
	dictationClaim?: boolean;
	/** Compaction is running for this chat (owner round 14): the answer
	 *  POST would block on the server's compaction gate — disable submit
	 *  and say so in the hint row. The server registry is the real gate;
	 *  this is the affordance. */
	compactionRunning?: boolean;
	/** The turn that posed this question has not settled yet (the local
	 *  stream is still open): an answer or skip POST would be refused, so
	 *  those two wait with a small "Et øyeblikk…" hint. "Spør agenten" stays
	 *  live: the session model queues it and applies it at the settle. */
	turnSettling?: boolean;
}

export function QuestionDock({
	toolName,
	toolCallId,
	input,
	expanded,
	reveal = false,
	onExpand,
	onSubmit,
	onSkip,
	onHold,
	parked = false,
	onUnpark,
	figureSvg,
	initialDraft,
	onSaveDraft,
	onEscape,
	phase = "probe",
	dictationClaim = true,
	compactionRunning = false,
	turnSettling = false,
}: QuestionDockProps) {
	// The probe-phase names (owner, 2026-10-09) canonicalize onto their
	// teach twins for every dock concern — parse dispatch, labels, kinds:
	// the probe quiz ("probe") is quiz-shaped, the probe free-recall
	// ("recall") is explain-shaped. Old records keep the teach names.
	const canonical =
		toolName === "probe" ? "quiz" : toolName === "recall" ? "explain" : toolName;
	// Parse, don't cast (src/core/tool-parts.ts): the model authored this
	// input, and only the schema the tool declared vouches for its shape.
	// The dock mounts on input-available parts (already validated at the
	// bridge), so this is pure defense in depth — but it is STRUCTURAL now:
	// anything that slips through renders the quiet fallback, never a
	// crash on `.map` over model-authored bytes.
	const parsed =
		canonical === "quiz" ? parseQuizInput(input) : canonical === "explain" ? parseExplainInput(input) : parseAskInput(input);
	if (!parsed) {
		return <MalformedQuestion />;
	}
	// The chip's display name carries the tool's OWN name (owner
	// 2026-10-09): probe-phase questions label Kartlegging in the composer.
	// A teach explain is the node's approval (owner 2026-11-14) and says so;
	// old recall/explain calls keep their labels (explainLabel).
	const toolLabel =
		toolName === "probe"
			? "Kartlegging"
			: canonical === "explain"
				? explainLabel(toolName, (parsed as { type?: unknown }).type)
				: undefined;
	// Parked (fase 4): the slim «På vent» row replaces every other variant;
	// the composer renders below it (the DockOverlay owns that). The form
	// stays mounted, hidden and inert, so the learner's picks survive.
	const visible = expanded && !parked;
	return (
		<>
			{parked && <QuestionParkedBar question={parsed.question} onUnpark={onUnpark} />}
			{!expanded && !parked && (
				<QuestionDockBar
					toolName={canonical}
					question={parsed.question}
					onExpand={onExpand}
					variant={reveal ? "reveal" : "collapsed"}
					toolLabel={toolLabel}
					label={
						(canonical === "quiz" || canonical === "explain") &&
						normalizeQuizType((parsed as { type?: unknown }).type) === "predict"
							? "Forutsi"
							: undefined
					}
				/>
			)}
			{/* The two ways out stay reachable while a teach check sits behind
			    its reveal (owner 2026-11): a learner who would rather ask or
			    move on must not have to open the check first. Quiet, small,
			    under the invitation. They carry the help center's anchors
			    here; the form's own pair takes them over once it is open. */}
			{!expanded && !parked && reveal && (onHold || onSkip) && (
				<div data-testid="question-collapsed-actions" className="flex flex-wrap items-center justify-end gap-1 border-t border-border/60 px-2 py-1">
					{turnSettling && onSkip && (
						<span role="status" className="mr-auto pl-2 text-xs text-muted-foreground">Et øyeblikk…</span>
					)}
					{onHold && (
						<Button
							type="button"
							variant="ghost"
							data-testid="question-hold-collapsed"
							data-tour="question-hold"
							title="Sett spørsmålet på vent og skriv til agenten"
							// A live dictation belongs to the reading-thinking field
							// here: let its tail land before the hand-over, so it
							// rides the dismissal like it does on Esc.
							onClick={() => {
								if (!isDictationActive()) onHold("");
								else void finishDictation().then(() => onHold(""));
							}}
							className="h-7 rounded-md px-2 text-xs font-normal text-muted-foreground"
						>
							<MessageCircleQuestionIcon aria-hidden />
							Spør agenten
						</Button>
					)}
					{onSkip && (
						<Button
							type="button"
							variant="ghost"
							data-testid="question-skip-collapsed"
							data-tour="question-skip"
							title={turnSettling ? "Et øyeblikk, agenten gjør seg ferdig" : "Gå videre uten å svare. Teller ikke som feil."}
							disabled={compactionRunning || turnSettling}
							onClick={() => {
								if (!isDictationActive()) onSkip();
								else void finishDictation().then(onSkip);
							}}
							className="h-7 rounded-md px-2 text-xs font-normal text-muted-foreground"
						>
							Hopp over
						</Button>
					)}
				</div>
			)}
			<div className={visible ? "dock-variant" : "invisible h-0 overflow-hidden"}>
				<QuestionDockForm
					toolName={toolName}
					toolCallId={toolCallId}
					input={parsed}
					phase={phase}
					active={visible}
					parked={parked}
					figureSvg={figureSvg}
					onSubmit={onSubmit}
					onSkip={onSkip}
					onHold={onHold}
					initialDraft={initialDraft}
					onSaveDraft={onSaveDraft}
					onEscape={onEscape}
					// Parked: the composer owns dictated speech.
					dictationClaim={dictationClaim && !parked}
					compactionRunning={compactionRunning}
					turnSettling={turnSettling}
				/>
			</div>
		</>
	);
}

/** A plain-text teaser of a question for the collapsed bar: unwrap math, flatten common LaTeX. */
function teaserText(q: string): string {
	return repairMathForDisplay(q)
		.replace(/\\\(([\s\S]*?)\\\)/g, "$1") // \(...\) inline math
		.replace(/\\\[([\s\S]*?)\\\]/g, "$1") // \[...\] display math
		.replace(/\$\$?([^$]*)\$\$?/g, "$1") // standard $...$/$$...$$ math
		.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2")
		.replace(/\\([a-zA-Z]+)/g, "$1")
		.replace(/[{}]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** The collapsed strip. Two species (W5): "collapsed" is the scroll minimization
 *  (kind chip + one-liner + Answer ↓); "reveal" is the teach-check invitation —
 *  a distinct, more inviting affordance, because it asks the learner to start
 *  something, not to resume something. */
export function QuestionDockBar({
	toolName,
	question,
	onExpand,
	variant = "collapsed",
	label,
	toolLabel,
}: {
	toolName: "quiz" | "ask_user_question" | "explain";
	question: string;
	onExpand: () => void;
	variant?: "collapsed" | "reveal";
	/** The kind chip's text (owner 2026-10-03): "Forutsi" when a
	 *  predict-type quiz minimizes by scroll — predictions never use the
	 *  reveal variant, but the scroll-collapse strip can still hide them. */
	label?: string;
	/** The chip's TOOL display name (owner 2026-10-09): probe-phase calls
	 *  label Kartlegging/Gjenkalling — the phase boundary visible in the composer. */
	toolLabel?: string;
}) {
	if (variant === "reveal") {
		return (
			<button
				type="button"
				data-testid="teach-check-reveal"
				onClick={onExpand}
				className="dock-variant flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40"
			>
				<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
					<PlayIcon className="size-3.5" />
				</span>
				<span className="min-w-0 flex-1">
					<span className="block text-sm font-medium">{toolLabel === "Godkjenning" ? "Godkjenning" : "Sjekk forståelsen"}</span>
					<span className="block truncate text-xs text-muted-foreground">{teaserText(question)}</span>
				</span>
				<span className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
					Åpne <ChevronRightIcon className="size-3.5" />
				</span>
			</button>
		);
	}
	return (
		<button
			type="button"
			data-testid="question-dock-bar"
			onClick={onExpand}
			className="dock-variant flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent/40"
		>
			<span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{label ??
							toolLabel ??
							(toolName === "quiz" ? "Sjekk" : "Spørsmål")}
			</span>
			<span className="min-w-0 flex-1 truncate text-muted-foreground">{teaserText(question)}</span>
			<span className="flex shrink-0 items-center gap-1 text-xs font-medium">
				Svar <ArrowDownIcon className="size-3.5" />
			</span>
		</button>
	);
}

/** The PARKED question (fase 4, «Spør agenten»): one slim row above the
 *  composer — the question stays visible while the learner writes, and
 *  the way back is one click. Nothing is dismissed until he sends. */
export function QuestionParkedBar({ question, onUnpark }: { question: string; onUnpark?: () => void }) {
	return (
		<div
			data-testid="question-parked"
			className="dock-variant flex items-center gap-2.5 border-b border-border/60 px-4 py-2 text-sm"
		>
			<span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">På vent</span>
			<span className="min-w-0 flex-1 truncate text-muted-foreground">{teaserText(question)}</span>
			{onUnpark && (
				<Button
					type="button"
					variant="ghost"
					data-testid="question-unpark"
					onClick={onUnpark}
					className="h-7 shrink-0 rounded-md px-2 text-xs font-medium"
				>
					Tilbake til spørsmålet
				</Button>
			)}
		</div>
	);
}

/** The question's figure (fase 4): a waited visual on the same white
 *  backing as the transcript's figure card. Beside the task text when the
 *  dock is wide enough, above it when narrow (the caller's layout); a
 *  click opens it full size. */
function QuestionFigure({ svg }: { svg: string }) {
	const overlay = useSessionMermaid();
	const image = <SvgImage svg={svg} className="mx-auto block h-auto max-h-[40dvh] max-w-full" />;
	const frame = "w-full overflow-hidden rounded-lg bg-white @2xl:w-[45%] @2xl:shrink-0";
	if (!overlay) return <div data-testid="question-figure" className={frame}>{image}</div>;
	return (
		<button
			type="button"
			data-testid="question-figure"
			aria-label="Forstørr figuren"
			title="Forstørr figuren"
			onClick={() => overlay.openFigure(svg, false)}
			className={cn(frame, "block cursor-zoom-in")}
		>
			{image}
		</button>
	);
}

/** The expanded question: label, question, options, and the unified bottom row. */
function QuestionDockForm({
	toolName,
	toolCallId,
	input,
	phase = "probe",
	active,
	parked = false,
	figureSvg,
	onSubmit,
	onSkip,
	onHold,
	initialDraft,
	onSaveDraft,
	onEscape,
	dictationClaim = true,
	compactionRunning = false,
	turnSettling = false,
}: Omit<QuestionDockProps, "expanded" | "onExpand" | "reveal" | "onUnpark">) {
	const kind = toolQuestionKind(toolName);
	// The task's hidden hints (fase 4): authored with the call, opened only
	// by the learner. The high-water mark rides the answer.
	const authoredHints = useMemo(() => normalizeHints((input as { hints?: unknown }).hints), [input]);
	// The Hint button is always on a task (owner, 2026-11-23): without
	// authored hints, the first press asks the server for a ladder (made
	// once, cached per chat — src/server/task-hints.ts).
	const [requestedHints, setRequestedHints] = useState<string[]>([]);
	const hints = authoredHints.length > 0 ? authoredHints : requestedHints;
	const [hintsRevealed, setHintsRevealed] = useState(() => Math.min(authoredHints.length, initialDraft?.hintsRevealed ?? 0));
	const chatId = useParams<{ id?: string }>()?.id;
	const canRequestHints = kind === "explain" && phase !== "probe" && typeof chatId === "string" && chatId.length > 0;

	// Canonical QuestionData, built once per question. Quiz options are
	// deterministically shuffled (seeded by toolCallId) so position never leaks
	// correctness AND server/client render the same order (hydration-safe);
	// the display order is snapshotted into the answer record at submit time.
	const qd = useMemo<QuestionData>(() => {
		const quizInput = kind === "quiz" ? (input as QuizToolInput) : null;
		const askInput = kind === "ask" ? (input as AskToolInput) : null;
		const explainInput = kind === "explain" ? (input as ExplainToolInput) : null;
		const multi = input instanceof Object && "multiSelect" in input ? input.multiSelect === true : false;
		const mode: QuestionMode =
			kind === "quiz"
				? multi
					? "multi-select"
					: "single-select"
				: askInput?.options?.length
					? multi
						? "multi-select"
						: "single-select"
						: "text";
		const options = normalizeOptions(
			(quizInput?.options ?? askInput?.options ?? []) as { label: string; value?: string }[],
		);
		const ordered = kind === "quiz" && options.length > 0 ? shuffleOptions(options, seededRandom(toolCallId)) : options;
		const q: QuestionData = {
			id: toolCallId,
			kind,
			// The role (owner 2026-10-03): predict questions gate by it in the
			// view (never collapsed) and the answered card tucks the explanation.
			questionType: kind === "quiz" ? normalizeQuizType((input as { type?: unknown }).type) : undefined,
			question: input.question,
			context: input.details,
			mode,
			options: ordered,
			createdAt: new Date().toISOString(),
		};
		if (quizInput) {
			const resolved = resolveCorrect(quizInput.correctAnswer, ordered);
			if (resolved.error) console.error("[quiz] correctAnswer did not resolve:", resolved.error);
			q.correctIndices = resolved.indices;
			q.explanation = quizInput.explanation;
		}
		if (explainInput) {
			// The commitment rides the question data (never sent to the
			// client before answering) and snapshots into the answer at submit.
			// One field, reasoning included — no separate explanation
			// (owner ruling 2026-09-27).
			q.committedAnswer = explainInput.correctAnswer;
		}
		return q;
	}, [toolCallId, kind, input]);

	// The selection state machine lives in question-core (pure, tested):
	// single-select displaces, multi-select coexists — picking the ask
	// "Other…" row in a multi-select must never clear already-picked
	// options, and picking an option must never clear a typed custom answer.
	const [sel, setSel] = useState<DockSelection>(() => initialDraft?.selection ?? emptyDockSelection());
	// The learner's transfer channel — thinking, never "a note".
	const [thinking, setThinking] = useState(initialDraft?.thinking ?? "");
	const [other, setOther] = useState(initialDraft?.other ?? "");
	const [text, setText] = useState(initialDraft?.text ?? "");
	/* Refs MIRROR the two dictation-target fields ("nothing gets lost"
	 * round, owner 2026-10-01): the run's flush lands via setState, which
	 * a closure waiting through `await finishDictation()` cannot observe
	 * in time — submit reads these, kept current at every write site. */
	const thinkingTextRef = useRef(initialDraft?.thinking ?? "");
	const answerTextRef = useRef(initialDraft?.text ?? "");
	// Confidence (owner, 2026-10-01): an index into CONFIDENCE_STOPS,
	// resting at 50 — a real coin flip by definition, untouched or
	// deliberate (the same number, the same meaning). The dock unmounts
	// between questions, so each question starts fresh at 50.
	const [confIdx, setConfIdx] = useState<number>(initialDraft?.confidenceIndex ?? DEFAULT_CONFIDENCE_INDEX);
	const selectMode: SelectMode = qd.mode === "multi-select" ? "multi-select" : "single-select";

	// The PRIMARY dictation input (owner, STT round 1): while a question
	// waits, dictated finals land HERE, never in the hidden composer — text
	// mode owns "Your answer", select modes own "Your thinking". The claim
	// is effect-scoped, so the question unmounting releases it and
	// dictation falls back to the composer automatically.
	useDictationTarget(
		useCallback(
			(t: string) => {
				// Ref-first (see the refs block above): the join is computed from
				// the mirror, then both mirrors agree with state — a submit
				// resuming post-finish reads the tail, never a stale closure.
				if (qd.mode === "text") {
					const v = joinDictation(answerTextRef.current, t);
					answerTextRef.current = v;
					setText(v);
				} else {
					const v = joinDictation(thinkingTextRef.current, t);
					thinkingTextRef.current = v;
					setThinking(v);
				}
			},
			[qd.mode],
		),
		// Released while a teach check sits unrevealed (owner 2026-10-03):
		// the reading-thinking field owns dictated speech during the reading.
		dictationClaim,
	);

	const toggle = (idx: number) => setSel(toggleOption(selectMode, sel, idx));

	/* THE REQUIRED EXPLANATION (2026-11, owner: "flervalg som gjøres om til
	 * explain for å godkjenne"): a graded multiple-choice pick alone is one
	 * bit, and a guessable one. The thinking field is therefore REQUIRED on
	 * quiz/probe answers (never on "Vet ikke", never on ask): the client
	 * still grades the option, but the agent approves the answer on the
	 * explanation (`explanationRequired` in the answer record). */
	const needsExplanation = qd.mode !== "text" && explanationRequiredFor(kind, sel.dontKnow);
	const answerChosen =
		qd.mode === "text"
			? text.trim().length > 0
			: sel.dontKnow || (sel.otherSelected && other.trim().length > 0) || sel.selected.size > 0;
	const explanationMissing = needsExplanation && !explanationSatisfied(thinking);
	const canSubmit = answerChosen && !explanationMissing;
	// The nudge: a submit attempt with the explanation still owed moves the
	// learner INTO the field and turns the hint into the instruction.
	const [explainNudge, setExplainNudge] = useState(false);

	/** A pick, by pointer or keyboard. Single-select graded choice hands
	 *  focus straight to the explanation field: it is the next thing owed,
	 *  so pick → type → Enter is one uninterrupted motion. Multi-select
	 *  keeps focus (more picks are coming; Tab reaches the field). */
	const pick = (idx: number) => {
		toggle(idx);
		if (kind === "quiz" && selectMode === "single-select") thinkingRef.current?.focus();
	};

	const submit = () => {
		if (!answerChosen || compactionRunning || turnSettling) return;
		/* FINISH DICTATION FIRST (owner, 2026-10-01): Enter may arrive while
		 * a run is live with reasoning still in Deepgram's hands. Stop the
		 * run, let the last finals land in the target field, and only then
		 * build the answer — the spoken reasoning is never lost to a
		 * forgotten stop. The field values below come from the REF mirrors
		 * because the flush lands via setState after an await. The
		 * explanation gate reads the same mirror for the same reason: a
		 * dictated explanation counts the moment its tail lands. */
		if (!isDictationActive()) {
			doSubmit();
			return;
		}
		void finishDictation().then(doSubmit);
	};
	const doSubmit = () => {
		if (!answerChosen) return;
		if (needsExplanation && !explanationSatisfied(thinkingTextRef.current)) {
			setExplainNudge(true);
			thinkingRef.current?.focus();
			return;
		}
		const req: AnswerRequest = {
			dontKnow: sel.dontKnow,
			values: [...sel.selected].map((i) => qd.options[i]!.value),
			other: sel.otherSelected ? other : undefined,
			text: qd.mode === "text" ? answerTextRef.current : undefined,
			thinking: qd.mode !== "text" ? thinkingTextRef.current.trim() || undefined : undefined,
			// Always sent on quiz answers (owner: 50 must mean 50, never
			// "untouched"); buildAnswer drops it on "I don't know".
			confidence: kind === "quiz" ? CONFIDENCE_STOPS[confIdx] : undefined,
			hintsOpened: hintsRevealed,
			hintsTotal: hints.length,
		};
		// Snapshot before optimistic submission unmounts the form. Ref values
		// include the dictation finals that just landed, unlike stale closures.
		onSaveDraft?.({
			selection: { ...sel, selected: new Set(sel.selected) },
			thinking: thinkingTextRef.current,
			other,
			text: answerTextRef.current,
			confidenceIndex: confIdx,
			hintsRevealed,
		});
		onSubmit(buildAnswer(qd, req, toolName));
	};

	/* ENTER SUBMITS FROM ANYWHERE (owner round 6, 2026-10-05): the same
	 * law as the practice dock — dictated answers rarely focus the field.
	 * Rides submit() so the dictation-flush law is shared, not forked.
	 * Parked (fase 4): Enter belongs to the learner's message, never to the
	 * hidden question. */
	useEnterSubmits(() => {
		if (!parked) submit();
	});

	/* "Spør agenten" (2026-11): the question goes on hold and the composer
	 * returns. Whatever sits in the learner's field travels along as the
	 * composer draft — a live dictation is finished first, so the spoken
	 * tail lands here (the nothing-gets-lost law) before the hand-over. */
	const hold = () => {
		if (!onHold) return;
		const go = () => onHold((qd.mode === "text" ? answerTextRef.current : thinkingTextRef.current).trim());
		if (!isDictationActive()) go();
		else void finishDictation().then(go);
	};

	// Selecting Other never clears the thinking field — two channels, the
	// answer and the reasoning behind it, side by side.
	const selectOther = () => setSel(toggleOther(selectMode, sel));

	/* ── The keyboard machine (shortcut wave B, owner rounds 2026-09-17) ──
	   ↑/↓ walk EVERY answerable row in order — options first, then the
	   quiz's "I don't know" or the ask's "Other…" (whichever exists) —
	   CLAMPED at the ends, no wrap (owner: faster to navigate when the
	   walk stops at the last row). Space acts on the walked row exactly
	   like a click (multi toggles, single displaces; Other also focuses
	   its input for typing), Enter submits once an answer exists.
	   Tab toggles FOCUS between the thinking field and the answer rows
	   (owner round 3) — nothing else; Shift+Tab is NOT ours (the global
	   thinking-level cycle owns it). Two guards keep native behavior
	   intact: keys from a TYPING SURFACE keep their meaning (arrows move
	   the caret, space types), and modifier combos are never ours
	   (Alt+arrows cycle sessions — they must not ALSO walk the rows).
	   The listener is document-level and lives only while the dock is
	   expanded — collapsed, the bar's native Enter expands it. */
	const [kbdIdx, setKbdIdx] = useState<number | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const otherInputRef = useRef<HTMLDivElement>(null);
	const thinkingRef = useRef<HTMLDivElement>(null);
	// One row past the options is the trailing row: quiz → don't-know,
	// ask → Other (a question never has both). Text mode (ask/explain)
	// has no rows — the composer IS the answer surface.
	const optionCount = qd.mode === "text" ? 0 : qd.options.length;
	const rowCount = qd.mode === "text" ? 0 : optionCount + 1;

	const kbdAct = (idx: number) => {
		if (idx < optionCount) pick(idx);
		else if (kind === "quiz")
			setSel((prev) => ({ ...prev, selected: new Set(), otherSelected: false, dontKnow: !prev.dontKnow }));
		else {
			// Space on the ask's Other row (owner refinement round,
			// 2026-09-24): SELECTING it focuses the input for typing, but
			// the Space that DESELECTS an already-selected Other must never
			// drop the user back into the typing field — the core's
			// toggleOther has no single-select off-path (it displaces), so
			// the off-path lives here: clear the pick, keep the typed text,
			// focus stays where it is. Re-selecting is the way back into
			// the field.
			if (sel.otherSelected) setSel((prev) => ({ ...prev, otherSelected: false, dontKnow: false }));
			else {
				otherInputRef.current?.focus();
				selectOther();
			}
		}
	};

	// Focus the walked row's focusable element — the Other row is a div,
	// so its inline input is the focus target there.
	const focusRow = (idx: number) => {
		const row = rootRef.current?.querySelector(`[data-kbdrow="${idx}"]`) as HTMLElement | null;
		if (!row) return;
		const el = (row.querySelector("input, [data-file-path-input]") as HTMLElement | null) ?? row;
		el.focus();
	};

	useEffect(() => {
		if (!active || rowCount === 0) return;
		const onKeyDown = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			// A TYPING field is where keys mean text (owner round 4): the
			// thinking/answer fields, search boxes, renames — never a range
			// input, whose focus after a click or drag must not kill the
			// arrow cycling. Everywhere else the arrows act.
			const typing =
				!!t &&
				((t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range") ||
					t.tagName === "TEXTAREA" ||
					t.isContentEditable);
			// Alt/Cmd/Ctrl combos are never ours (Alt+arrows cycle sessions
			// globally — they must not ALSO walk the question rows).
			const modded = e.altKey || e.metaKey || e.ctrlKey;
			// Plain Tab toggles focus: rows → thinking. The confidence
			// slider takes NO focus at all (owner, UI round 2026-10-01) —
			// global ←/→ own its keyboard, so it never joins the chain.
			// Shift+Tab falls through (the global thinking-level cycle owns
			// it), so the shift check matters.
			if (e.key === "Tab" && !e.shiftKey && !modded) {
				e.preventDefault();
				e.stopPropagation();
				if (t?.closest?.("[data-kbdrow]")) thinkingRef.current?.focus();
				else {
					const idx = kbdIdx ?? 0;
					setKbdIdx(idx);
					focusRow(idx);
				}
				return;
			}
			// Keys from a typing surface keep their meaning (arrows move
			// the caret, space types).
			if (typing || modded) return;
			// 1–9 pick an option directly (2026-11): with the explanation now
			// owed on graded choices, the pick itself must cost one key. Acts
			// exactly like a click on that row (the walk follows it).
			if (/^[1-9]$/.test(e.key) && Number(e.key) <= optionCount) {
				e.preventDefault();
				const idx = Number(e.key) - 1;
				setKbdIdx(idx);
				pick(idx);
				return;
			}
			if (e.key === "ArrowDown") {
				e.preventDefault();
				const next = Math.min((kbdIdx ?? -1) + 1, rowCount - 1);
				setKbdIdx(next);
				// Focus follows the walk while the user is IN the rows (Tab
				// put them there) so focused and walked never diverge.
				if (t?.closest?.("[data-kbdrow]")) focusRow(next);
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				const next = Math.max((kbdIdx ?? rowCount) - 1, 0);
				setKbdIdx(next);
				if (t?.closest?.("[data-kbdrow]")) focusRow(next);
			} else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
				// Global confidence cycling (owner, UI round 2026-10-01): the
				// SAME pattern as ↑/↓ over the rows — works wherever focus
				// sits, no click-in, no focus ring. Dead on "I don't know"
				// (the slider grays out and nothing is sent).
				if (kind !== "quiz" || sel.dontKnow) return;
				e.preventDefault();
				setConfIdx((i) =>
					Math.min(
						CONFIDENCE_STOPS.length - 1,
						Math.max(0, i + (e.key === "ArrowRight" ? 1 : -1)),
					),
				);
			} else if (e.key === " ") {
				if (kbdIdx === null) return; // plain Space keeps scrolling the page
				e.preventDefault();
				kbdAct(kbdIdx);
			} else if (e.key === "Enter") {
				// answerChosen, not canSubmit: with the explanation still owed
				// Enter lands the learner in the field (submit's own gate).
				if (kbdIdx === null || !answerChosen) return;
				e.preventDefault();
				submit();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	});

	// Keep the walked row visible (the question area scrolls internally).
	useEffect(() => {
		if (kbdIdx === null) return;
		rootRef.current
			?.querySelector(`[data-kbdrow="${kbdIdx}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [kbdIdx]);

	return (
		<div ref={rootRef} data-testid="question-dock">
			{/* Question area — scrolls internally if very tall; the bottom row stays put.
			    Capped by the measured column (--dock-max-h; the old fixed 55dvh cut
			    long questions short — owner round, 2026-10-05). */}
			<div data-dock-scroll-area="" data-session-find-root="" className="max-h-[var(--dock-max-h,55dvh)] overflow-y-auto px-4 pt-3">
				<div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					{toolName === "probe"
						? "Kartlegging"
						: kind === "quiz"
							? qd.questionType === "predict"
								? "Forutsi"
								: "Sjekk"
							: kind === "explain"
								? explainLabel(toolName, (input as { type?: unknown }).type)
								: "Spørsmål"}
					{qd.mode === "multi-select" && " · velg alle som passer"}
				</div>
				{/* The figure sits BESIDE the task (right, ≤ 45 %) when the dock
				    is wide enough, above it when narrow (owner, 2026-11). */}
				<div className="@container">
					<div className={figureSvg ? "mb-3 flex flex-col gap-3 @2xl:flex-row-reverse @2xl:items-start" : undefined}>
						{figureSvg && <QuestionFigure svg={figureSvg} />}
						<div className="min-w-0 flex-1">
							<div className={cn("font-medium", (!figureSvg || qd.context) && "mb-3")}>
								<ToolContentResponse>{qd.question}</ToolContentResponse>
							</div>
							{qd.context && (
								<div className={cn("text-sm text-muted-foreground", !figureSvg && "mb-3")}>
									<ToolContentResponse>{qd.context}</ToolContentResponse>
								</div>
							)}
						</div>
					</div>
				</div>
				{hints.length > 0 ? (
					<div className="mb-3">
						<HintStepper hints={hints} revealed={hintsRevealed} onReveal={setHintsRevealed} />
					</div>
				) : (
					canRequestHints && (
						<div className="mb-3">
							<HintRequestButton
								chatId={chatId!}
								toolCallId={toolCallId}
								onHints={(got) => {
									setRequestedHints(got);
									setHintsRevealed(1);
								}}
							/>
						</div>
					)
				)}

				{qd.mode !== "text" && (
					<div className="flex flex-col gap-2 pb-2" role={qd.mode === "multi-select" ? "group" : "radiogroup"}>
						{qd.options.map((opt, i) => {
							const isSel = sel.selected.has(i);
							return (
								<button
									key={opt.value}
									type="button"
									role={qd.mode === "multi-select" ? "checkbox" : "radio"}
									aria-checked={isSel}
									data-kbdrow={i}
									onClick={() => pick(i)}
									className={cn(
										"flex items-start gap-3 rounded-lg border px-3 py-2 text-left text-sm outline-none transition-colors",
										isSel ? "border-primary bg-accent" : "hover:bg-accent/50",
										i === kbdIdx && !isSel && "ring-1 ring-border bg-accent/40",
									)}
								>
									<span
										className={cn(
											"mt-0.5 flex size-4 shrink-0 items-center justify-center border",
											qd.mode === "multi-select" ? "rounded-sm" : "rounded-full",
											isSel ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
										)}
									>
										{isSel && (
											<span className={cn(qd.mode === "multi-select" ? "text-base leading-none" : "size-1.5 rounded-full bg-current")}>
												{qd.mode === "multi-select" ? "✓" : ""}
											</span>
										)}
									</span>
									<span>
										<ToolContentResponse>{opt.label}</ToolContentResponse>
										{kind !== "quiz" && opt.description && (
											// Option subtext renders in Source Sans 3 (owner's mockup);
											// the "I don't know" copy stays JetBrains Mono. QUIZ options render
											// NO description (owner ruling 2026-09-26): the model used them to
											// telegraph correctness — the schema dropped the field and old
											// records must not leak either. Same MessageResponse path as the
											// label (owner, 2026-10-12): descriptions are full markdown —
											// LaTeX included — not plain text.
											<ToolContentResponse className="lh-prose block text-xs text-muted-foreground">
												{opt.description}
											</ToolContentResponse>
										)}
									</span>
								</button>
							);
						})}

						{kind === "quiz" && (
							<button
								type="button"
								onClick={() =>
									setSel((prev) => ({ ...prev, selected: new Set(), otherSelected: false, dontKnow: !prev.dontKnow }))
								}
								data-kbdrow={optionCount}
								aria-pressed={sel.dontKnow}
								className={cn(
									// Option-row layout + radio circle (owner); the dashed
									// outline stays — this is the deliberate non-answer.
									"flex items-start gap-3 rounded-lg border border-dashed px-3 py-2 text-left text-sm outline-none transition-colors",
									sel.dontKnow ? "border-primary text-foreground" : "text-muted-foreground",
									kbdIdx === optionCount && !sel.dontKnow && "ring-1 ring-border bg-accent/40",
								)}
							>
								<span
									className={cn(
										"mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
										sel.dontKnow
											? "border-primary bg-primary text-primary-foreground"
											: "border-muted-foreground/40",
									)}
								>
									{sel.dontKnow && <span className="size-1.5 rounded-full bg-current" />}
								</span>
								<span>Vet ikke</span>
							</button>
						)}

						{kind === "ask" && (
							<div
								role={qd.mode === "multi-select" ? "checkbox" : "radio"}
								aria-checked={sel.otherSelected}
								data-testid="other-option"
								data-kbdrow={optionCount}
								onClick={selectOther}
								className={cn(
									"flex items-start gap-3 rounded-lg border px-3 py-2 text-left text-sm outline-none transition-colors",
									sel.otherSelected ? "border-primary bg-accent" : "border-dashed hover:bg-accent/50",
									kbdIdx === optionCount && !sel.otherSelected && "ring-1 ring-border bg-accent/40",
								)}
							>
								<span
									className={cn(
										"mt-0.5 flex size-4 shrink-0 items-center justify-center border",
										qd.mode === "multi-select" ? "rounded-sm" : "rounded-full",
										sel.otherSelected
											? "border-primary bg-primary text-primary-foreground"
											: "border-muted-foreground/40",
									)}
								>
									{sel.otherSelected && (
										<span className={cn(qd.mode === "multi-select" ? "text-base leading-none" : "size-1.5 rounded-full bg-current")}>
											{qd.mode === "multi-select" ? "✓" : ""}
										</span>
									)}
								</span>
								<PathInput
									ref={otherInputRef}
									singleLine
									value={other}
									onValueChange={(value) => {
										setOther(value);
										// Typing selects the row — displacing in
										// single-select, alongside the siblings in multi.
										setSel((prev) => (prev.otherSelected ? prev : toggleOther(selectMode, prev)));
									}}
									onKeyDown={(e) => {
										// Esc escapes the typing (owner refinement round,
										// 2026-09-24): focus leaves the input, the row STAYS
										// selected — deselection is the next Space's job, acting
										// on the row — and the arrow walk resumes from this
										// row (kbdIdx pins it). stopPropagation keeps the
										// window chain from reading this Esc as abort-turn.
										if (e.key === "Escape") {
											e.preventDefault();
											e.stopPropagation();
											e.currentTarget.blur();
											setKbdIdx(optionCount);
										}
											// Enter submits directly (owner, keyboard round 2026-10-06):
											// the custom answer is a single-line input — no newline
											// to protect, and typing has already selected the row, so
											// the payload is ready. Every Enter (shift or not — nothing
											// else could ever happen in a one-line field) rides the
											// same submit seam as the button, dictation finish-first
											// included.
											if (e.key === "Enter") {
												e.preventDefault();
												submit();
											}
									}}
									placeholder="Annet… skriv ditt eget svar"
									className="lh-input w-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
									onClick={(e) => e.stopPropagation()}
								/>
							</div>
						)}
					</div>
				)}
			</div>

			{/* Confidence (owner, 2026-10-01; UI rounds same day): a snapped
				slider below the options and above "Your thinking" — the
				learner's stated probability that his selected answer is
				correct. The thumb's POSITION is the raw fraction; the painted
				RAIL overlays exactly the thumb-center range (inset half a disc
				per side), so 0 and 100 rest flush against the rail's very
				ends. Fill + handle wear the stop's ramp color; SOLID stop
				ticks are background layers behind the fill (empty side only,
				never over the color; 0/100 need no tick — the flush ends say
				them). Keyboard: GLOBAL ←/→ (the ↑/↓ pattern; the ring is gone
				app-wide). Clicking and dragging are native. "I don't know"
				GRAYS it out — the layout holds, no value is sent, the IDK
				signal stands alone. */}
			{kind === "quiz" && (
				<div className="border-t border-border/60 px-4 py-2.5">
					<div className="flex items-center gap-3">
						<span
							className={cn(
								"shrink-0 text-xs font-medium uppercase tracking-wide",
								sel.dontKnow ? "text-muted-foreground/50" : "text-muted-foreground",
							)}
						>
							Sikkerhet
						</span>
						<div
							className={cn("relative h-4 min-w-0 flex-1", sel.dontKnow && "opacity-40")}
							data-testid="confidence-track"
						>
							{/* The RAIL is painted here, not on the input: this overlay spans
								exactly the thumb-CENTER range (inset 8px = half the 16px disc,
								left and right), so at 0 and 100 the disc sits flush against the
								rail's very ends — no bare stub poking past it (owner round 4).
								STACKING LAW (owner round 5): the input is absolute too — a
								positioned overlay paints above an in-flow input no matter the
								DOM order, which put the rail OVER the disc. Both positioned,
								input later in DOM → the disc rides on top. The wrapper's height
								is pinned (h-4) so the rail's top-1/2 and the disc's track share
								one box — centered by construction, not by hope. */}
							<div
								aria-hidden
								data-testid="confidence-rail"
								className="pointer-events-none absolute top-1/2 left-2 right-2 h-1.5 -translate-y-1/2 rounded-full border border-border"
								style={confidenceRailStyle(CONFIDENCE_STOPS[confIdx]!)}
							/>
							<input
								type="range"
								min={0}
								max={100}
								step={1}
								value={CONFIDENCE_STOPS[confIdx]}
								disabled={sel.dontKnow}
								aria-label="Sikkerhet: sannsynligheten for at svaret du valgte er riktig"
								aria-valuetext={`${CONFIDENCE_STOPS[confIdx]} prosent`}
								title="Sannsynligheten for at svaret du valgte er riktig. 50 % er et myntkast. Juster med ←/→."
								data-testid="confidence-slider"
								onChange={(e) => {
									// Snap to the nearest stop; the rendered VALUE is the stop's own
									// percent, so the thumb always rests at its true fraction (50 =
									// halfway). Keyboard needs no handler here: the dock machine treats
									// a focused range as non-typing (see the guard above) and its ←/→
									// branch preventDefaults, which also cancels the native 1% step.
									const v = Number(e.target.value);
									let best = 0;
									for (let i = 1; i < CONFIDENCE_STOPS.length; i++) {
										if (Math.abs(CONFIDENCE_STOPS[i]! - v) < Math.abs(CONFIDENCE_STOPS[best]! - v)) best = i;
									}
									setConfIdx(best);
								}}
								style={{ color: CONFIDENCE_COLORS[confIdx] }}
								className={cn(
									"absolute inset-0 h-4 w-full cursor-pointer appearance-none bg-transparent outline-none",
									"[&::-webkit-slider-runnable-track]:h-4 [&::-webkit-slider-runnable-track]:bg-transparent",
									"[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-current",
									"[&::-moz-range-track]:h-4 [&::-moz-range-track]:bg-transparent",
									"[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-current",
								)}
							/>
						</div>
						<span
							data-testid="confidence-value"
							className={cn(
								"w-9 shrink-0 text-right font-mono text-sm tabular-nums",
								sel.dontKnow && "text-muted-foreground/50",
							)}
						>
							{sel.dontKnow ? "—" : `${CONFIDENCE_STOPS[confIdx]}%`}
						</span>
					</div>
				</div>
			)}

			{/* The learner's half of the dock — a composer TWIN: a labeled, bordered
			    field with Submit docked inside, exactly like the chat composer's
			    send. Select modes get "Your thinking" (Enter makes a newline — it
			    is for dumping, soon dictated; the button submits); text mode
			    keeps "Your answer" with Enter-to-submit. */}
			<form
				className="border-t border-border/60 p-1.5"
				onSubmit={(e) => {
					e.preventDefault();
					submit();
				}}
			>
				<div
					data-testid={qd.mode === "text" ? "answer-field" : "thinking-field"}
					// The help center's anchor for the required explanation.
					data-tour={needsExplanation ? "question-explain" : undefined}
					data-explanation-required={needsExplanation ? "true" : undefined}
					className={cn(
						"rounded-md border bg-background/60 transition-colors focus-within:border-primary/50",
						explainNudge && explanationMissing ? "border-primary/60" : "border-border/70",
					)}
				>
					<div
						data-testid="learner-field-label"
						className={cn(
							"px-2.5 pt-2 text-xs font-medium uppercase tracking-wide",
							needsExplanation && explanationMissing ? "text-foreground" : "text-muted-foreground",
						)}
					>
						{qd.mode === "text"
							? "Svaret ditt"
							: needsExplanation
								? "Forklar kort hvorfor (kreves for å få godkjent)"
								: "Din tankegang"}
					</div>
					{qd.mode === "text" ? (
						<PathInput
							value={text}
							onValueChange={(value) => {
								answerTextRef.current = value;
								setText(value);
							}}
							onKeyDown={(e) => {
								// Esc ends dictation (the dictate decisions: click-again
								// or Esc) — stopPropagation claims it (keyboard wave
								// A) so the window chain doesn't also abort a turn.
								if (e.key === "Escape" && onEscape) {
									e.preventDefault();
									e.stopPropagation();
									onEscape();
									return;
								}
								// Chat convention: Enter submits, Shift+Enter is a newline;
								// ⌘/Ctrl+Enter also submits (universal across the app).
								if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
									e.preventDefault();
									submit();
								}
							}}
							placeholder="Skriv svaret ditt…"
							className="field-sizing-content lh-input max-h-48 min-h-10 w-full resize-none bg-transparent px-2.5 py-2 outline-none placeholder:text-muted-foreground"
						/>
					) : (
						<PathInput
							ref={thinkingRef}
							value={thinking}
							onValueChange={(value) => {
								thinkingTextRef.current = value;
								setThinking(value);
							}}
							onKeyDown={(e) => {
								// Esc ends dictation (the dictate decisions: click-again
								// or Esc) — stopPropagation claims it (keyboard wave
								// A) so the window chain doesn't also abort a turn.
								if (e.key === "Escape" && onEscape) {
									e.preventDefault();
									e.stopPropagation();
									onEscape();
									return;
								}
								// THE STANDARD CHORD (owner round 5, 2026-10-05): Enter
								// submits, Shift+Enter is a newline, ⌘/Ctrl+Enter works
								// too — identical to the practice dock and the composer.
								if (e.key === "Enter" && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
									e.preventDefault();
									submit();
									return;
								}
								// ←/→ in the EMPTY field still set the confidence (2026-11):
								// a pick now lands focus here, and an empty field has no
								// caret to move, so the slider keeps its global keys right
								// up to the first typed character.
								if (
									(e.key === "ArrowLeft" || e.key === "ArrowRight") &&
									!e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey &&
									kind === "quiz" && !sel.dontKnow &&
									thinkingTextRef.current.length === 0
								) {
									e.preventDefault();
									setConfIdx((i) =>
										Math.min(CONFIDENCE_STOPS.length - 1, Math.max(0, i + (e.key === "ArrowRight" ? 1 : -1))),
									);
								}
							}}
							placeholder={
								needsExplanation
									? "Forklar med egne ord hvorfor du valgte dette."
									: "Hvorfor dette svaret? Skriv det du tenker."
							}
							className={cn(
								"field-sizing-content lh-input max-h-48 w-full resize-none bg-transparent px-2.5 py-2 outline-none placeholder:text-muted-foreground/70",
								// Phase-scaled prominence: teaching invites depth,
								// probing stays quick.
								phase === "teach" ? "min-h-[4.5rem]" : "min-h-10",
							)}
						/>
					)}
					<div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 p-1">
						<span
							data-testid="dock-hint"
							// The explanation hint is an instruction, not decoration:
							// announced, and lifted out of the muted register while owed.
							aria-hidden={answerChosen && explanationMissing ? undefined : true}
							role={answerChosen && explanationMissing ? "status" : undefined}
							className={cn(
								"pl-1.5 text-xs",
								answerChosen && explanationMissing ? "font-medium text-foreground" : "text-muted-foreground",
							)}
						>
							{compactionRunning
								? "komprimerer økta…"
								: turnSettling
									? "Et øyeblikk…"
									: answerChosen && explanationMissing
									? "Skriv en kort forklaring for å sende svaret."
									: "↵ sender · ⇧↵ ny linje"}
						</span>
						<div className="ml-auto flex items-center gap-1">
							{/* «Legg inn besvarelse»: a task answered with files (PDF/images). */}
							{qd.mode === "text" && (
								<AnswerUploadButton
									testId="question-answer-upload"
									className="size-9 rounded-md"
									onPaths={(paths) => {
										const v = withAnswerPaths(answerTextRef.current, paths);
										answerTextRef.current = v;
										setText(v);
									}}
								/>
							)}
							{/* The two ways OUT that are not answers (2026-11, owner: "man
							    skal kunne velge å ikke svare, eller sette det på vent").
							    Quiet ghost buttons beside the primary: always visible,
							    never competing with it. type="button": neither is a
							    form submit. */}
							{onHold && (
								<Button
									type="button"
									variant="ghost"
									data-testid="question-hold"
									// One visible anchor at a time: collapsed, the bar's
									// own pair carries the help center's anchors.
									data-tour={active ? "question-hold" : undefined}
									title="Sett spørsmålet på vent og skriv til agenten"
									onClick={hold}
									className="h-9 rounded-md px-2.5 text-sm font-normal text-muted-foreground"
								>
									<MessageCircleQuestionIcon aria-hidden />
									Spør agenten
								</Button>
							)}
							{onSkip && (
								<Button
									type="button"
									variant="ghost"
									data-testid="question-skip"
									data-tour={active ? "question-skip" : undefined}
									title={turnSettling ? "Et øyeblikk, agenten gjør seg ferdig" : "Gå videre uten å svare. Teller ikke som feil."}
									// Skip rides the answer POST, which would block on
									// the compaction gate exactly like a submit, and is
									// refused while the posing turn is still settling.
									disabled={compactionRunning || turnSettling}
									onClick={onSkip}
									className="h-9 rounded-md px-2.5 text-sm font-normal text-muted-foreground"
								>
									Hopp over
								</Button>
							)}
							<Button
								type="submit"
								disabled={!canSubmit || compactionRunning || turnSettling}
								title={answerChosen && explanationMissing ? "Skriv en kort forklaring først" : undefined}
								className="h-9 rounded-md px-3.5 text-sm font-medium"
							>
								Send svar
							</Button>
						</div>
					</div>
				</div>
			</form>
		</div>
	);
}
