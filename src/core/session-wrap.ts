/**
 * «Oppsummering» — the session wrap (owner, 2026-11-22).
 *
 * The learner keeps ONE chat per course; a wrap closes the current økt
 * inside that chat. One model call reads the messages since the previous
 * wrap and writes a short summary plus ten multiple-choice recall
 * questions (the draft, stored on the record while the quiz runs). When
 * the quiz is done — or closed early — the draft becomes a `session-wrap`
 * marker at the record's tail: the transcript's «Økt avsluttet» divider,
 * and a model-facing note that tells the teacher what the økt covered and
 * which questions the learner missed. The chat is never locked; the next
 * message simply starts the next økt.
 *
 * Pure and browser-safe: the client reads the same scope rules to decide
 * whether the button has anything to wrap.
 */
import type { LhMarkerMessage, LhMessage } from "./native-messages.ts";
import { newMessageId } from "./native-messages.ts";

/** Ten questions, four options each (owner, 2026-11-22). */
export const WRAP_QUESTION_COUNT = 10;
export const WRAP_OPTION_COUNT = 4;
export const WRAP_SUMMARY_MIN = 3;
export const WRAP_SUMMARY_MAX = 8;
/** Card limits: a glanceable title and a short body (owner, 2026-11-23:
 *  the long bullets were hard on the eyes). */
export const WRAP_TITLE_MAX = 60;
export const WRAP_TEXT_MAX = 400;

/** One summary card (2026-11-23): a short title and one to three short
 *  sentences. Drafts from before carry a plain string per point. */
export interface WrapPoint {
	title: string;
	/** Markdown + LaTeX, Norwegian; at most one display formula. */
	text: string;
}

/** A stored summary point: the card shape, or a legacy plain string. */
export type WrapSummaryItem = WrapPoint | string;

/** Read any stored point as a card; a legacy string has no title. */
export function wrapPointOf(item: unknown): { title: string | null; text: string } {
	if (typeof item === "string") return { title: null, text: item };
	if (typeof item === "object" && item !== null) {
		const p = item as Partial<WrapPoint>;
		return { title: typeof p.title === "string" && p.title.trim() ? p.title.trim() : null, text: typeof p.text === "string" ? p.text : "" };
	}
	return { title: null, text: "" };
}

/** A card's text for display: a line that holds only `$$…$$` becomes a
 *  display block (`$$` on lines of their own). In this markdown pipeline a
 *  single-line `$$…$$` renders inline and small. Presentation only. */
export function wrapCardMarkdown(text: string): string {
	return text.replace(/^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gm, (_m, body: string) => `\n$$\n${body.trim()}\n$$\n`).replace(/\n{3,}/g, "\n\n").trim();
}

/** One line for the teacher's note: "title: text", newlines folded. */
export function wrapPointLine(item: unknown): string {
	const { title, text } = wrapPointOf(item);
	const flat = text.replace(/\s*\n+\s*/g, " ").trim();
	return title ? `${title}: ${flat}` : flat;
}

export interface WrapQuestion {
	/** Markdown + LaTeX ($…$), Norwegian. */
	question: string;
	/** Exactly four options, shuffled at generation (stored order is final). */
	options: string[];
	correctIndex: number;
	/** One or two sentences on why the right answer is right. */
	explanation: string;
}

/** The model usage of the generating call, folded onto the marker later. */
export interface WrapUsageStep {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	cacheWrite1hTokens: number;
	reasoningTokens: number;
}

/** The generated wrap while its quiz runs: stored on the record
 *  (`ChatRecord.wrapDraft`) so a reload or restart resumes the quiz. */
export interface SessionWrapDraft {
	id: string;
	createdAt: string;
	/** provider:id of the model that wrote it. */
	model: string;
	/** The last record message the wrap covers: the next økt starts after it,
	 *  so messages written while the quiz ran belong to the next økt. */
	coversThroughId: string;
	/** Summary cards, Norwegian (legacy drafts: plain strings). */
	summary: WrapSummaryItem[];
	questions: WrapQuestion[];
	/** The learner's chosen option per question; null = not answered. */
	answers: (number | null)[];
	usage: WrapUsageStep[];
}

/** The marker's UI payload: the finished draft. */
export interface SessionWrapDetails extends Omit<SessionWrapDraft, "usage"> {
	completedAt: string;
}

export const SESSION_WRAP_HEADER = "[SESSION WRAPPED]";

export function isSessionWrapMarker(message: LhMessage): message is LhMessage & LhMarkerMessage {
	return message.role === "custom" && message.customType === "session-wrap";
}

/** Index of the first message of the current økt: right after the newest
 *  wrap's covered message (or the wrap marker itself when that id is gone). */
export function wrapScopeStart(messages: readonly LhMessage[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]!;
		if (!isSessionWrapMarker(m)) continue;
		const through = (m.details as Partial<SessionWrapDetails> | null)?.coversThroughId;
		const at = typeof through === "string" ? messages.findIndex((x) => x.id === through) : -1;
		return at >= 0 && at < i ? at + 1 : i + 1;
	}
	return 0;
}

/** The current økt's messages, without earlier wrap markers. */
export function wrapScope(messages: readonly LhMessage[]): LhMessage[] {
	return messages.slice(wrapScopeStart(messages)).filter((m) => !isSessionWrapMarker(m));
}

/** Has the learner done anything since the last wrap? A typed message, an
 *  answered question or a practice submission counts; scaffolding (the
 *  course card, plan blocks, job deliveries) does not. */
export function hasWrapContent(messages: readonly LhMessage[]): boolean {
	return wrapScope(messages).some(
		(m) =>
			m.role === "user" ||
			(m.role === "toolResult" && !m.isError && m.details != null) ||
			(m.role === "custom" && (m.customType === "practice-thinking" || m.customType === "practice-next")),
	);
}

/** A tool call at the tail with no result yet (a pending question): a
 *  marker may not land between a call and its result. */
export function hasDanglingToolCall(messages: readonly LhMessage[]): boolean {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]!;
		if (m.role !== "assistant") continue;
		if (m.stopReason === "error" || m.stopReason === "aborted") return false;
		const answered = new Set(
			messages.slice(i + 1).flatMap((x) => (x.role === "toolResult" ? [x.toolCallId] : [])),
		);
		return m.content.some((b) => b.type === "toolCall" && !answered.has(b.id));
	}
	return false;
}

export interface WrapScore {
	correct: number;
	answered: number;
	total: number;
}

export function wrapScore(wrap: Pick<SessionWrapDraft, "questions" | "answers">): WrapScore {
	let correct = 0;
	let answered = 0;
	wrap.questions.forEach((q, i) => {
		const a = wrap.answers[i];
		if (a === null || a === undefined) return;
		answered++;
		if (a === q.correctIndex) correct++;
	});
	return { correct, answered, total: wrap.questions.length };
}

/** The model's raw submission, before checks and shuffling. */
export interface WrapSubmission {
	summary: WrapPoint[];
	questions: WrapQuestion[];
}

/** A schema-valid submission can still break the wrap's rules; the
 *  problem string goes back to the model for a retry. null = accept. */
export function wrapSubmissionProblem(value: WrapSubmission): string | null {
	if (value.summary.length < WRAP_SUMMARY_MIN || value.summary.length > WRAP_SUMMARY_MAX) {
		return `summary must have ${WRAP_SUMMARY_MIN} to ${WRAP_SUMMARY_MAX} cards`;
	}
	for (const [i, p] of value.summary.entries()) {
		if (!p.title.trim()) return `summary card ${i + 1} needs a title`;
		if (!p.text.trim()) return `summary card ${i + 1} needs a text`;
		if (p.title.trim().length > WRAP_TITLE_MAX) return `summary card ${i + 1}: the title must be at most ${WRAP_TITLE_MAX} characters`;
		if (p.text.trim().length > WRAP_TEXT_MAX) return `summary card ${i + 1}: the text must be at most ${WRAP_TEXT_MAX} characters — shorten it to one to three short sentences`;
	}
	if (value.questions.length !== WRAP_QUESTION_COUNT) {
		return `exactly ${WRAP_QUESTION_COUNT} questions are required, got ${value.questions.length}`;
	}
	for (const [i, q] of value.questions.entries()) {
		const n = i + 1;
		if (!q.question.trim()) return `question ${n} has an empty question text`;
		if (q.options.length !== WRAP_OPTION_COUNT) return `question ${n} must have exactly ${WRAP_OPTION_COUNT} options`;
		const trimmed = q.options.map((o) => o.trim());
		if (trimmed.some((o) => !o)) return `question ${n} has an empty option`;
		if (new Set(trimmed.map((o) => o.toLowerCase())).size !== trimmed.length) return `question ${n} has duplicate options`;
		if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= WRAP_OPTION_COUNT) {
			return `question ${n} has correctIndex outside 0-${WRAP_OPTION_COUNT - 1}`;
		}
		if (!q.explanation.trim()) return `question ${n} needs an explanation`;
	}
	return null;
}

/** Shuffle each question's options (models put the right answer first far
 *  too often). `random` is injectable for tests. */
export function shuffleWrapOptions(questions: readonly WrapQuestion[], random: () => number = Math.random): WrapQuestion[] {
	return questions.map((q) => {
		const order = q.options.map((_, i) => i);
		for (let i = order.length - 1; i > 0; i--) {
			const j = Math.floor(random() * (i + 1));
			[order[i], order[j]] = [order[j]!, order[i]!];
		}
		return {
			question: q.question.trim(),
			options: order.map((i) => q.options[i]!.trim()),
			correctIndex: order.indexOf(q.correctIndex),
			explanation: q.explanation.trim(),
		};
	});
}

/** The teacher's view of a finished wrap (model-facing, English frame;
 *  the learner's material stays in Norwegian). */
export function wrapMarkerContent(wrap: Pick<SessionWrapDraft, "summary" | "questions" | "answers">): string {
	const score = wrapScore(wrap);
	const missed = wrap.questions.flatMap((q, i) => {
		const a = wrap.answers[i];
		if (a === null || a === undefined || a === q.correctIndex) return [];
		return [`- Q${i + 1}: ${q.question}\n  Learner chose: ${q.options[a]}\n  Correct: ${q.options[q.correctIndex]}`];
	});
	const skipped = wrap.questions.flatMap((q, i) => (wrap.answers[i] === null || wrap.answers[i] === undefined ? [`- Q${i + 1}: ${q.question}`] : []));
	return [
		`${SESSION_WRAP_HEADER} The learner pressed «Oppsummering» and ended this økt (study session). The chat continues: the learner's next message starts a new økt in the same chat.`,
		"",
		"Summary of the økt that just ended:",
		...wrap.summary.map((s) => `- ${wrapPointLine(s)}`),
		"",
		`Recall quiz on that økt: ${score.correct}/${score.total} correct${score.answered < score.total ? ` (${score.total - score.answered} not answered)` : ""}.`,
		...(missed.length > 0 ? ["", "Missed questions — weak points to revisit early in the next økt:", ...missed] : []),
		...(skipped.length > 0 ? ["", "Not answered:", ...skipped] : []),
		"",
		"Do not reply to this note on its own. When the learner writes next, greet the new økt briefly and, where it fits, start from the weak points above.",
	].join("\n");
}

export function newSessionWrapMarker(draft: SessionWrapDraft, completedAt: string): LhMarkerMessage {
	const { usage: _usage, ...rest } = draft;
	const details: SessionWrapDetails = { ...rest, completedAt };
	return {
		id: newMessageId(),
		role: "custom",
		customType: "session-wrap",
		content: wrapMarkerContent(draft),
		display: true,
		details,
		timestamp: Date.parse(completedAt) || Date.now(),
	};
}

/** Guard the untyped marker payload / draft the client receives. */
export function readWrap(raw: unknown): SessionWrapDetails | SessionWrapDraft | null {
	if (typeof raw !== "object" || raw === null) return null;
	const w = raw as Partial<SessionWrapDraft>;
	if (!Array.isArray(w.summary) || !Array.isArray(w.questions) || !Array.isArray(w.answers)) return null;
	if (w.questions.some((q) => typeof q?.question !== "string" || !Array.isArray(q.options) || typeof q.correctIndex !== "number")) return null;
	return raw as SessionWrapDetails | SessionWrapDraft;
}
