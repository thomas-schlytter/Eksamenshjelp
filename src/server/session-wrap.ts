/**
 * «Oppsummering» — the session wrap service (owner, 2026-11-22).
 *
 *   POST  /api/chats/[id]/wrap           generate (or return) the draft
 *   PATCH /api/chats/[id]/wrap           record one quiz answer
 *   POST  /api/chats/[id]/wrap/complete  turn the draft into the marker
 *
 * Generation is one submit call on the chat's OWN conversation model (the
 * compaction precedent: the session's model knows the session best). The
 * draft is stored on the record so a reload resumes the quiz; completion
 * appends the session-wrap marker at the tail and logs the call's usage
 * on it. Both writes refuse while a turn or a compaction holds the chat,
 * and while a question waits for its answer (a marker may not land
 * between a tool call and its result).
 */
import { Type } from "typebox";
import {
	hasDanglingToolCall,
	hasWrapContent,
	newSessionWrapMarker,
	planTreeToText,
	serializeForSummary,
	shuffleWrapOptions,
	wrapScope,
	wrapSubmissionProblem,
	WRAP_OPTION_COUNT,
	WRAP_QUESTION_COUNT,
	WRAP_SUMMARY_MAX,
	WRAP_SUMMARY_MIN,
	type ChatRecord,
	type SessionWrapDraft,
	type WrapSubmission,
	type WrapUsageStep,
} from "../core/index.ts";
import { emit } from "../core/events.ts";
import { resolveConversationSpec } from "../core/settings-resolution.ts";
import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { runSubmitAgent } from "../agent/subagents/submit-agent.ts";
import { effectiveSettings, stores } from "./stores.ts";
import { providerKeyPresent } from "./keys.ts";
import { isTurnRunning } from "./turn-liveness.ts";
import { compactionInFlight } from "./compaction.ts";

export interface WrapFailure {
	ok: false;
	status: 400 | 404 | 409 | 502 | 503;
	code: string;
	error: string;
}
export type WrapOutcome<T> = ({ ok: true } & T) | WrapFailure;

const fail = (status: WrapFailure["status"], code: string, error: string): WrapFailure => ({ ok: false, status, code, error });

export function wrapFailureResponse(failure: WrapFailure): Response {
	return Response.json({ error: failure.error, code: failure.code }, { status: failure.status });
}

const WRAP_TIMEOUT_MS = 180_000;
/** The transcript the model reads, capped from the end (the økt's latest
 *  work matters most; a very long økt keeps its tail). */
const WRAP_TRANSCRIPT_CHARS = 160_000;

const wrapSchema = Type.Object({
	summary: Type.Array(Type.String({ description: "One bullet point in Norwegian bokmål: something the learner worked on, understood or got wrong in this økt. Concrete, in the course's own terminology. Math in $...$." }), {
		minItems: WRAP_SUMMARY_MIN,
		maxItems: WRAP_SUMMARY_MAX,
	}),
	questions: Type.Array(
		Type.Object({
			question: Type.String({ description: "The question in Norwegian bokmål. Markdown; math in $...$ (inline) or $$...$$." }),
			options: Type.Array(Type.String({ description: "One answer option, Norwegian; math in $...$." }), {
				minItems: WRAP_OPTION_COUNT,
				maxItems: WRAP_OPTION_COUNT,
			}),
			correctIndex: Type.Integer({ minimum: 0, maximum: WRAP_OPTION_COUNT - 1, description: "0-based index of the one correct option." }),
			explanation: Type.String({ description: "One or two sentences in Norwegian: why the correct option is right (and, if useful, the typical mistake behind the wrong ones)." }),
		}),
		{ minItems: WRAP_QUESTION_COUNT, maxItems: WRAP_QUESTION_COUNT },
	),
});

const WRAP_SYSTEM_PROMPT = [
	"You close a study session (an \"økt\") for a university student preparing for an exam.",
	"You receive the transcript of ONE økt between the student and their AI tutor. Write a short summary and a recall quiz that gets the student's memory going.",
	"",
	"Rules:",
	`- summary: ${WRAP_SUMMARY_MIN} to ${WRAP_SUMMARY_MAX} bullet points on what the student actually did in this økt: the concepts, methods and results covered, and the mistakes they made and fixed. Only what is in the transcript.`,
	`- questions: exactly ${WRAP_QUESTION_COUNT} multiple-choice questions on the MOST IMPORTANT things from this økt, ordered from the økt's start to its end. Weight the points the student struggled with.`,
	"- Every question must be answerable from what happened in the økt. Test understanding and use, not trivia about the conversation itself (never \"what did the tutor say first\").",
	`- ${WRAP_OPTION_COUNT} options per question, exactly one correct. The wrong options are plausible: the mistakes a student really makes (sign errors, mixed-up definitions, the misconception the student showed). Similar length and form; no \"all of the above\".`,
	"- Write everything in Norwegian bokmål. Use LaTeX in $...$ for every formula, symbol and number with units. Decimal commas inside math as {,}.",
	"- The explanation says briefly why the correct option is right.",
	"",
	"Submit with the tool. Nothing else.",
].join("\n");

export function wrapPrompt(record: ChatRecord): string {
	const scope = wrapScope(record.messages);
	let transcript = serializeForSummary(scope);
	if (transcript.length > WRAP_TRANSCRIPT_CHARS) transcript = `…[earlier part of the økt omitted]\n\n${transcript.slice(-WRAP_TRANSCRIPT_CHARS)}`;
	const plan = planTreeToText(record.tree, record.messages);
	return [
		`Session title: ${record.title}`,
		record.course ? `Course: ${record.course.code}` : "",
		plan ? `\nThe session's learning plan (status per node):\n${plan}` : "",
		`\nTranscript of the økt to wrap:\n\n${transcript}`,
		"\nSubmit the summary and the quiz now.",
	]
		.filter(Boolean)
		.join("\n");
}

// ─── Seams (tests swap these; production uses the defaults) ──────────────────

export const wrapSeams: {
	/** The chat's conversation engine; undefined = no model or no key. */
	engine: (record: ChatRecord) => { engine: PiEngine; modelId: string } | undefined;
	/** The model call; returns the raw submission and its usage. */
	generate: (prompt: string, engine: PiEngine) => Promise<{ submission: WrapSubmission; usage: WrapUsageStep[] }>;
	random: () => number;
	now: () => string;
} = {
	engine: resolveWrapEngine,
	generate: submitWrap,
	random: Math.random,
	now: () => new Date().toISOString(),
};

function resolveWrapEngine(record: ChatRecord): { engine: PiEngine; modelId: string } | undefined {
	try {
		const spec = resolveConversationSpec(record.settings, effectiveSettings().models.strong);
		if (!spec || !providerKeyPresent(spec.provider)) return undefined;
		const engine = piEngineForSpec(spec, false, undefined, () => stores.settingsStore.readSettings()?.models?.strong?.cacheRetention);
		return { engine, modelId: `${engine.model.provider}:${engine.model.id}` };
	} catch (err) {
		console.info("[wrap] no usable model:", err instanceof Error ? err.message : err);
		return undefined;
	}
}

async function submitWrap(prompt: string, engine: PiEngine): Promise<{ submission: WrapSubmission; usage: WrapUsageStep[] }> {
	const usage: WrapUsageStep[] = [];
	const submission = await runSubmitAgent<WrapSubmission>({
		// The engine is always injected; the role is only a label here.
		role: "extractor",
		engine,
		toolName: "submit_session_wrap",
		toolDescription: `Submit the økt's summary (${WRAP_SUMMARY_MIN}-${WRAP_SUMMARY_MAX} bullet points) and exactly ${WRAP_QUESTION_COUNT} multiple-choice questions.`,
		parameters: wrapSchema,
		fill: (input: WrapSubmission) => ({
			summary: input.summary.map((s) => s.trim()).filter(Boolean),
			questions: input.questions.map((q) => ({
				question: q.question,
				options: q.options,
				correctIndex: Number(q.correctIndex),
				explanation: q.explanation,
			})),
		}),
		validate: wrapSubmissionProblem,
		systemPrompt: WRAP_SYSTEM_PROMPT,
		prompt,
		signal: AbortSignal.timeout(WRAP_TIMEOUT_MS),
		onStep: (u) => {
			usage.push({
				inputTokens: u.input,
				outputTokens: u.output,
				cacheReadTokens: u.cacheRead,
				cacheWriteTokens: u.cacheWrite,
				cacheWrite1hTokens: (u as { cacheWrite1h?: number }).cacheWrite1h ?? 0,
				reasoningTokens: (u as { reasoning?: number }).reasoning ?? 0,
			});
		},
		neverSubmitted: "the model never submitted a session wrap",
	});
	return { submission, usage };
}

// ─── Shared gates ────────────────────────────────────────────────────────────

/** The chat must be quiet: no turn, no compaction, no question waiting. */
function busyFailure(chatId: string, record: ChatRecord): WrapFailure | null {
	if (isTurnRunning(chatId)) return fail(409, "turn_in_flight", "Læreren jobber fortsatt. Vent til svaret er ferdig, og prøv igjen.");
	if (compactionInFlight(chatId)) return fail(409, "compacting", "Økta komprimeres akkurat nå. Prøv igjen om et øyeblikk.");
	if (hasDanglingToolCall(record.messages)) return fail(409, "question_pending", "Svar på spørsmålet som venter (eller lukk det) før du oppsummerer.");
	return null;
}

/** One generation per chat at a time; a second click joins the first. */
const g = globalThis as typeof globalThis & { __lhWrapInFlight?: Map<string, Promise<WrapOutcome<{ draft: SessionWrapDraft }>>> };
const inFlight = (g.__lhWrapInFlight ??= new Map());

export function wrapInFlight(chatId: string): boolean {
	return inFlight.has(chatId);
}

// ─── Generate ────────────────────────────────────────────────────────────────

export async function generateSessionWrap(chatId: string): Promise<WrapOutcome<{ draft: SessionWrapDraft }>> {
	const record = stores.chatStore.getChat(chatId);
	if (!record) return fail(404, "not_found", "Fant ikke økta.");
	if (record.wrapDraft) return { ok: true, draft: record.wrapDraft };
	const running = inFlight.get(chatId);
	if (running) return running;
	const busy = busyFailure(chatId, record);
	if (busy) return busy;
	if (!hasWrapContent(record.messages)) {
		return fail(400, "nothing_to_wrap", "Det er ingenting å oppsummere ennå. Jobb litt i økta først.");
	}
	const resolved = wrapSeams.engine(record);
	if (!resolved) {
		return fail(503, "models_not_configured", "Ingen modell er satt opp for denne økta. Velg en modell under Innstillinger → Agent.");
	}
	const coversThroughId = record.messages[record.messages.length - 1]!.id;
	const job = (async (): Promise<WrapOutcome<{ draft: SessionWrapDraft }>> => {
		try {
			const { submission, usage } = await wrapSeams.generate(wrapPrompt(record), resolved.engine);
			const draft: SessionWrapDraft = {
				id: crypto.randomUUID(),
				createdAt: wrapSeams.now(),
				model: resolved.modelId,
				coversThroughId,
				summary: submission.summary,
				questions: shuffleWrapOptions(submission.questions, wrapSeams.random),
				answers: submission.questions.map(() => null),
				usage,
			};
			// Re-read: the record may have moved on while the model worked.
			if (!stores.chatStore.getChat(chatId)) return fail(404, "not_found", "Fant ikke økta.");
			stores.chatStore.saveWrapDraft(chatId, draft);
			emit("record-changed", { chatId });
			return { ok: true, draft };
		} catch (err) {
			console.error(`[chat ${chatId}] session wrap failed:`, err);
			return fail(502, "wrap_failed", "Klarte ikke å lage oppsummeringen. Prøv igjen.");
		}
	})();
	inFlight.set(chatId, job);
	try {
		return await job;
	} finally {
		inFlight.delete(chatId);
	}
}

// ─── Answer ──────────────────────────────────────────────────────────────────

/** `{ index, choice }`: the learner's pick for one question. First answer
 *  sticks (the feedback was already shown). */
export function answerSessionWrap(chatId: string, body: unknown): WrapOutcome<{ draft: SessionWrapDraft }> {
	const record = stores.chatStore.getChat(chatId);
	if (!record) return fail(404, "not_found", "Fant ikke økta.");
	const draft = record.wrapDraft;
	if (!draft) return fail(409, "no_draft", "Quizen er allerede avsluttet.");
	const input = (typeof body === "object" && body !== null ? body : {}) as { index?: unknown; choice?: unknown };
	const index = input.index;
	const choice = input.choice;
	if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= draft.questions.length) {
		return fail(400, "invalid_index", "Ukjent spørsmål.");
	}
	if (typeof choice !== "number" || !Number.isInteger(choice) || choice < 0 || choice >= draft.questions[index]!.options.length) {
		return fail(400, "invalid_choice", "Ukjent svaralternativ.");
	}
	if (draft.answers[index] === null || draft.answers[index] === undefined) {
		draft.answers[index] = choice;
		stores.chatStore.saveWrapDraft(chatId, draft);
	}
	return { ok: true, draft };
}

// ─── Complete ────────────────────────────────────────────────────────────────

export function completeSessionWrap(chatId: string): WrapOutcome<{ markerId: string }> {
	const record = stores.chatStore.getChat(chatId);
	if (!record) return fail(404, "not_found", "Fant ikke økta.");
	const draft = record.wrapDraft;
	if (!draft) return fail(409, "no_draft", "Quizen er allerede avsluttet.");
	const busy = busyFailure(chatId, record);
	if (busy) return busy;
	const completedAt = wrapSeams.now();
	const marker = newSessionWrapMarker(draft, completedAt);
	stores.chatStore.saveMessages(chatId, [...record.messages, { ...marker }]);
	stores.chatStore.saveWrapDraft(chatId, null);
	// The money channel: the generating call was real spend on the
	// session's own model — it keys to the marker, like compaction's.
	if (draft.usage.length > 0) {
		stores.chatStore.appendTurnUsage(chatId, {
			id: `wrap_${draft.id}`,
			messageId: marker.id,
			at: completedAt,
			model: draft.model,
			steps: draft.usage,
		});
	}
	emit("record-changed", { chatId });
	return { ok: true, markerId: marker.id };
}
