/**
 * «Avslutt økt» — the session wrap service (owner, 2026-11-22; the end
 * flow 2026-11-23).
 *
 *   POST  /api/chats/[id]/wrap           end the økt with a quiz: settle,
 *                                        then generate (or return) the draft
 *   PATCH /api/chats/[id]/wrap           record one quiz answer
 *   POST  /api/chats/[id]/wrap/complete  write the marker: from the draft,
 *                                        or `{ mode: "end" }` = «Bare avslutt»
 *
 * ENDING NEVER WAITS ON THE LEARNER (owner, 2026-11-23: «Avslutt økt skal
 * gjøre alt det for deg»). Both writes used to 409 while a turn ran, a
 * compaction ran or a question waited. They now SETTLE the chat first, on
 * the server, in one operation (settleThen):
 *   1. a running turn is aborted (abortTurn — the same kill as the Stop
 *      button) and we poll until it has settled: its onFinish persists the
 *      partial, applies any parked dismissal and only then ends the turn,
 *      so "not running" means the record is durable truth. A wake turn
 *      that starts meanwhile is aborted the same way;
 *   2. a running compaction is awaited (it rewrites the record's tail; a
 *      marker must not interleave with it);
 *   3. then, SYNCHRONOUSLY in the same tick (no await between the check
 *      and the writes, so no turn can begin in between): the open question
 *      calls are closed with sessionEnded dismissals, an active practice
 *      problem is dismissed (wrapClosingAppends), and the caller's own
 *      write runs (the marker, or the coversThroughId of a new draft).
 * Done on the server rather than by the client chaining abort + dismiss:
 * the client's dismiss would race the turn's settle (a parked 202 that
 * lands later), and the marker could land before it.
 *
 * Generation is one submit call on the chat's OWN conversation model (the
 * compaction precedent: the session's model knows the session best). The
 * draft is stored on the record so a reload resumes the quiz; completion
 * appends the session-wrap marker at the tail, logs the call's usage on it
 * and starts the course-topic update in the background (session-topics.ts).
 */
import { Type } from "typebox";
import {
	closedQuestionCount,
	hasWrapContent,
	mergeInterruption,
	newSessionEndMarker,
	newSessionWrapMarker,
	planTreeToText,
	serializeForSummary,
	shuffleWrapOptions,
	wrapClosingAppends,
	wrapScope,
	wrapSubmissionProblem,
	WRAP_OPTION_COUNT,
	WRAP_QUESTION_MAX,
	WRAP_QUESTION_MIN,
	WRAP_SUMMARY_MAX,
	WRAP_SUMMARY_MIN,
	WRAP_TEXT_MAX,
	WRAP_TITLE_MAX,
	type ChatRecord,
	type SessionWrapDraft,
	type WrapInterruption,
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
import { abortTurn } from "./turn-runs.ts";
import { awaitCompaction, compactionInFlight } from "./compaction.ts";
import { updateTopicsAfterWrap } from "./session-topics.ts";

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
	summary: Type.Array(
		Type.Object({
			title: Type.String({
				maxLength: WRAP_TITLE_MAX,
				description: "The card's title in Norwegian bokmål: 2-6 words naming the topic, in the course's own terminology (e.g. \"RC-krets med terskel\"). No math, no trailing period.",
			}),
			text: Type.String({
				maxLength: WRAP_TEXT_MAX,
				description: "The card's body in Norwegian bokmål: 1-3 SHORT sentences on what the student did, understood or got wrong on this topic, and the one thing to remember. Inline math in $...$. At most ONE key formula, as display math: a line with only $$, the formula on the next line, then a line with only $$. No lists, no long derivations, no exam point tallies.",
			}),
		}),
		{ minItems: WRAP_SUMMARY_MIN, maxItems: WRAP_SUMMARY_MAX },
	),
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
		{
			minItems: WRAP_QUESTION_MIN,
			maxItems: WRAP_QUESTION_MAX,
			description: `${WRAP_QUESTION_MIN} to ${WRAP_QUESTION_MAX} questions: as many as the økt's material carries, no more.`,
		},
	),
});

const WRAP_SYSTEM_PROMPT = [
	"You close a study session (an \"økt\") for a university student preparing for an exam.",
	"You receive the transcript of ONE økt between the student and their AI tutor. Write a short summary and a recall quiz that gets the student's memory going.",
	"",
	"Rules:",
	`- summary: ${WRAP_SUMMARY_MIN} to ${WRAP_SUMMARY_MAX} cards, one topic per card, in the order the økt took them. The student flips through them one at a time on a small card, so each must be readable at a glance: a title of 2-6 words, and a text of 1-3 short sentences (at most ${WRAP_TEXT_MAX} characters) on what the student did, understood or got wrong, ending in the one thing to remember. At most one key formula per card, as display math with $$ alone on the line above and the line below the formula. No lists, no derivations, no long chains of numbers. Only what is in the transcript.`,
	`- questions: ${WRAP_QUESTION_MIN} to ${WRAP_QUESTION_MAX} multiple-choice questions on the MOST IMPORTANT things from this økt, ordered from the økt's start to its end. Weight the points the student struggled with.`,
	`- How many: fit the count to how much the økt actually covered. A short økt on one or two ideas gets ${WRAP_QUESTION_MIN}; a long økt across several topics gets more, up to ${WRAP_QUESTION_MAX}. Never pad with weak or repetitive questions to reach a higher number.`,
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
	/** How long the end flow waits for a stopped turn / a compaction. */
	settleTimeoutMs: number;
	/** The course-topic update after an ended økt (fire and forget). */
	afterEnd: (chatId: string, markerId: string) => void;
} = {
	engine: resolveWrapEngine,
	generate: submitWrap,
	random: Math.random,
	now: () => new Date().toISOString(),
	settleTimeoutMs: 30_000,
	afterEnd: (chatId, markerId) => void updateTopicsAfterWrap(chatId, markerId),
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
		toolDescription: `Submit the økt's summary (${WRAP_SUMMARY_MIN}-${WRAP_SUMMARY_MAX} cards, each a short title and 1-3 short sentences) and ${WRAP_QUESTION_MIN}-${WRAP_QUESTION_MAX} multiple-choice questions, as many as the økt's material carries.`,
		parameters: wrapSchema,
		fill: (input: WrapSubmission) => ({
			summary: input.summary.map((p) => ({ title: p.title.trim(), text: p.text.trim() })),
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

// ─── Settle: stop what runs, close what is open ──────────────────────────────

const SETTLE_POLL_MS = 50;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Bring the chat to rest, then run `write` synchronously against the
 * settled record (see the header: abort → await → close → write, with no
 * await between the last check and `write`). `interrupted` says what had
 * to be stopped or closed; undefined = the chat was already quiet.
 */
async function settleThen<T>(
	chatId: string,
	write: (record: ChatRecord, interrupted: WrapInterruption | undefined) => WrapOutcome<T>,
): Promise<WrapOutcome<T>> {
	const deadline = Date.now() + wrapSeams.settleTimeoutMs;
	let turn = false;
	for (;;) {
		if (isTurnRunning(chatId)) {
			// Repeated each poll: a turn registers its handle a beat after it
			// begins, and a wake can begin a new one after the first settles.
			if (abortTurn(chatId).ok) turn = true;
		} else if (compactionInFlight(chatId)) {
			await Promise.race([awaitCompaction(chatId), sleep(250)]);
			continue;
		} else {
			break;
		}
		if (Date.now() > deadline) return fail(409, "still_busy", "Klarte ikke å stoppe læreren. Prøv igjen om et øyeblikk.");
		await sleep(SETTLE_POLL_MS);
	}
	if (compactionInFlight(chatId) || isTurnRunning(chatId)) return fail(409, "still_busy", "Klarte ikke å stoppe læreren. Prøv igjen om et øyeblikk.");
	// ── synchronous from here ──
	const record = stores.chatStore.getChat(chatId);
	if (!record) return fail(404, "not_found", "Fant ikke økta.");
	const appends = wrapClosingAppends(record.messages);
	let settled = record;
	if (appends.length > 0) {
		settled = { ...record, messages: [...record.messages, ...appends] };
		stores.chatStore.saveMessages(chatId, settled.messages);
		emit("record-changed", { chatId });
	}
	const questions = closedQuestionCount(appends);
	return write(settled, turn || questions > 0 ? { turn, questions } : undefined);
}

/** One generation per chat at a time; a second click joins the first. */
const g = globalThis as typeof globalThis & {
	__lhWrapInFlight?: Map<string, Promise<WrapOutcome<{ draft: SessionWrapDraft }>>>;
	__lhWrapCompleting?: Map<string, Promise<WrapOutcome<{ markerId: string }>>>;
};
const inFlight = (g.__lhWrapInFlight ??= new Map());
const completing = (g.__lhWrapCompleting ??= new Map());

export function wrapInFlight(chatId: string): boolean {
	return inFlight.has(chatId);
}

// ─── Generate ────────────────────────────────────────────────────────────────

/** «Oppsummering med quiz»: settle the chat, then write the draft. */
export async function generateSessionWrap(chatId: string): Promise<WrapOutcome<{ draft: SessionWrapDraft }>> {
	const record = stores.chatStore.getChat(chatId);
	if (!record) return fail(404, "not_found", "Fant ikke økta.");
	if (record.wrapDraft) return { ok: true, draft: record.wrapDraft };
	const running = inFlight.get(chatId);
	if (running) return running;
	if (!hasWrapContent(record.messages)) {
		return fail(400, "nothing_to_wrap", "Det er ingenting å avslutte ennå. Jobb litt i økta først.");
	}
	// Checked BEFORE settling: no model = nothing is stopped or closed.
	const resolved = wrapSeams.engine(record);
	if (!resolved) {
		return fail(503, "models_not_configured", "Ingen modell er satt opp for denne økta. Velg en modell under Innstillinger → Agent.");
	}
	const job = (async (): Promise<WrapOutcome<{ draft: SessionWrapDraft }>> => {
		const settled = await settleThen(chatId, (fresh, interrupted) => ({
			ok: true as const,
			record: fresh,
			interrupted,
			// The økt ends here: what is written while the quiz runs belongs
			// to the next økt.
			coversThroughId: fresh.messages[fresh.messages.length - 1]!.id,
		}));
		if (!settled.ok) return settled;
		try {
			const { submission, usage } = await wrapSeams.generate(wrapPrompt(settled.record), resolved.engine);
			const draft: SessionWrapDraft = {
				id: crypto.randomUUID(),
				createdAt: wrapSeams.now(),
				model: resolved.modelId,
				coversThroughId: settled.coversThroughId,
				summary: submission.summary,
				questions: shuffleWrapOptions(submission.questions, wrapSeams.random),
				answers: submission.questions.map(() => null),
				usage,
				...(settled.interrupted ? { interrupted: settled.interrupted } : {}),
			};
			// Re-read: the record may have moved on while the model worked.
			if (!stores.chatStore.getChat(chatId)) return fail(404, "not_found", "Fant ikke økta.");
			stores.chatStore.saveWrapDraft(chatId, draft);
			emit("record-changed", { chatId });
			return { ok: true, draft };
		} catch (err) {
			console.error(`[chat ${chatId}] session wrap failed:`, err);
			return fail(502, "wrap_failed", "Klarte ikke å lage oppsummeringen. Prøv igjen, eller avslutt uten quiz.");
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

/**
 * Write the «Økt avsluttet» marker. Default: from the quiz draft (409
 * without one). `{ mode: "end" }` = «Bare avslutt»: the marker with no
 * quiz (a draft that exists is completed as is, so no answers are lost).
 * Settles first, exactly like generation; a second click joins the first.
 */
export async function completeSessionWrap(chatId: string, body?: unknown): Promise<WrapOutcome<{ markerId: string }>> {
	const record = stores.chatStore.getChat(chatId);
	if (!record) return fail(404, "not_found", "Fant ikke økta.");
	const bare = typeof body === "object" && body !== null && (body as { mode?: unknown }).mode === "end";
	const running = completing.get(chatId);
	if (running) return running;
	if (!record.wrapDraft) {
		if (!bare) return fail(409, "no_draft", "Quizen er allerede avsluttet.");
		if (!hasWrapContent(record.messages)) return fail(400, "nothing_to_wrap", "Det er ingenting å avslutte ennå.");
	}
	const job = settleThen(chatId, (fresh, interrupted): WrapOutcome<{ markerId: string }> => {
		const draft = fresh.wrapDraft;
		if (!draft && !bare) return fail(409, "no_draft", "Quizen er allerede avsluttet.");
		const completedAt = wrapSeams.now();
		const marker = draft
			? newSessionWrapMarker({ ...draft, interrupted: mergeInterruption(draft.interrupted, interrupted) }, completedAt)
			: newSessionEndMarker({
					id: crypto.randomUUID(),
					coversThroughId: fresh.messages[fresh.messages.length - 1]!.id,
					completedAt,
					interrupted,
				});
		stores.chatStore.saveMessages(chatId, [...fresh.messages, { ...marker }]);
		if (draft) stores.chatStore.saveWrapDraft(chatId, null);
		// The money channel: the generating call was real spend on the
		// session's own model — it keys to the marker, like compaction's.
		if (draft && draft.usage.length > 0) {
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
	});
	completing.set(chatId, job);
	try {
		const outcome = await job;
		// The course page follows the ended økt — in the background, never
		// in the way of the end itself.
		if (outcome.ok) {
			try {
				wrapSeams.afterEnd(chatId, outcome.markerId);
			} catch (err) {
				console.error(`[chat ${chatId}] topic update could not start:`, err);
			}
		}
		return outcome;
	} finally {
		completing.delete(chatId);
	}
}
