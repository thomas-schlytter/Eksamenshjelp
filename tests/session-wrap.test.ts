/**
 * «Avslutt økt» (session wrap): the økt scope, the quiz checks (3-10
 * questions), the closing appends, the teacher-facing marker, the
 * /api/chats/[id]/wrap routes driven with the model call replaced through
 * wrapSeams — including the end flow that stops a running turn and closes
 * an open question instead of refusing with 409 — and the course-topic
 * update that follows an ended økt.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import type { PiEngine } from "../src/agent/models.ts";

// ── the seam, BEFORE any config-loading import ──────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-wrap-"));
process.env.LH_DATA_DIR = path.join(TMP, "data");
process.env.LH_AUTH_FILE = path.join(TMP, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");

const core = await import("../src/core/index.ts");
const { wrapSeams } = await import("../src/server/session-wrap.ts");
const { stores } = await import("../src/server/stores.ts");
const { beginTurn, endTurn } = await import("../src/server/turn-liveness.ts");
const { registerTurn, unregisterTurn } = await import("../src/server/turn-runs.ts");
const { sessionTopicSeams, topicUpdatesProblem, updateTopicsAfterWrap } = await import("../src/server/session-topics.ts");
const { courseStore } = await import("../src/store/courses.ts");
const wrapRoute = await import("../app/api/chats/[id]/wrap/route.ts");
const completeRoute = await import("../app/api/chats/[id]/wrap/complete/route.ts");

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

type LhMessage = import("../src/core/native-messages.ts").LhMessage;

function question(n: number): import("../src/core/session-wrap.ts").WrapQuestion {
	return {
		question: `Spørsmål ${n}: hva er $x_${n}$?`,
		options: [`riktig ${n}`, `feil a ${n}`, `feil b ${n}`, `feil c ${n}`],
		correctIndex: 0,
		explanation: `Fordi ${n}.`,
	};
}
const SUBMISSION = {
	summary: [
		{ title: "Laplace-transformen", text: "Du brukte $\\mathcal{L}$ til å gjøre ODE-er om til algebra." },
		{ title: "Poler og nullpunkter", text: "Polene er røttene i nevneren til $H(s)$." },
		{ title: "Stabilitet", text: "Alle poler i venstre halvplan:\n\n$$\\operatorname{Re}(p) < 0$$" },
	],
	questions: Array.from({ length: 10 }, (_, i) => question(i + 1)),
};

function assistant(text: string, toolCall?: { id: string; name: string; arguments?: Record<string, unknown> }): LhMessage {
	return {
		id: core.newMessageId(),
		role: "assistant",
		content: [{ type: "text", text }, ...(toolCall ? [{ type: "toolCall" as const, id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments ?? {} }] : [])],
		api: "faux",
		provider: "faux",
		model: "faux",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: toolCall ? "toolUse" : "stop",
		timestamp: Date.now(),
	} as LhMessage;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const postWrap = (id: string) => wrapRoute.POST(new Request(`http://lh.test/api/chats/${id}/wrap`, { method: "POST" }), params(id));
const patchWrap = (id: string, body: unknown) =>
	wrapRoute.PATCH(new Request(`http://lh.test/api/chats/${id}/wrap`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), params(id));
const complete = (id: string, body?: unknown) =>
	completeRoute.POST(
		new Request(`http://lh.test/api/chats/${id}/wrap/complete`, {
			method: "POST",
			...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
		}),
		params(id),
	);

/** A posed ask_user_question call with a parseable input (answerable). */
const ASK = { id: "ask1", name: "ask_user_question", arguments: { question: "Hva er en pol?", options: [{ label: "Rot i nevneren" }, { label: "Rot i telleren" }] } };

/** A fake running turn: abort settles it a beat later, like onFinish. */
function fakeTurn(id: string, settleMs = 20): { aborted: () => number } {
	let aborts = 0;
	assert.ok(beginTurn(id));
	registerTurn(id, {
		abort: () => {
			aborts++;
			setTimeout(() => {
				endTurn(id);
				unregisterTurn(id);
			}, settleMs);
		},
	} as never);
	return { aborted: () => aborts };
}

let prompts: string[] = [];
let ended: { chatId: string; markerId: string }[] = [];
beforeEach(() => {
	prompts = [];
	ended = [];
	wrapSeams.afterEnd = (chatId, markerId) => void ended.push({ chatId, markerId });
	wrapSeams.settleTimeoutMs = 2_000;
	wrapSeams.engine = () => ({ engine: {} as PiEngine, modelId: "faux:wrap" });
	wrapSeams.generate = async (prompt) => {
		prompts.push(prompt);
		return { submission: structuredClone(SUBMISSION), usage: [{ inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0, reasoningTokens: 0 }] };
	};
	// Identity shuffle keeps the right answer at index 0 for the assertions.
	wrapSeams.random = () => 0.999;
});

function chatWith(messages: LhMessage[]): string {
	const chat = stores.chatStore.createChat("Reguleringsteknikk");
	stores.chatStore.saveMessages(chat.id, messages);
	return chat.id;
}

describe("the økt scope", () => {
	it("starts after the newest wrap's covered message", () => {
		const a = core.newUserMessage("første økt");
		const b = assistant("svar");
		const c = core.newUserMessage("skrevet mens quizen gikk");
		const draft = { id: "d", createdAt: "t", model: "m", coversThroughId: b.id, summary: ["x"], questions: [], answers: [], usage: [] };
		const marker = core.newSessionWrapMarker(draft, "2026-11-22T10:00:00.000Z") as LhMessage;
		const d = core.newUserMessage("andre økt");
		const scope = core.wrapScope([a, b, c, marker, d]);
		assert.deepEqual(scope.map((m) => m.id), [c.id, d.id]);
	});

	it("needs something the learner did", () => {
		assert.equal(core.hasWrapContent([assistant("hei")]), false);
		assert.equal(core.hasWrapContent([assistant("hei"), core.newUserMessage("svar")]), true);
	});

	it("does not count a question left unanswered as work", () => {
		const call = assistant("spørsmål", ASK);
		const closed = core.wrapClosingAppends([call]);
		assert.equal(core.hasWrapContent([call, ...closed]), false);
	});

	it("sees a question waiting for its answer", () => {
		const call = assistant("spørsmål", { id: "q1", name: "quiz" });
		assert.equal(core.hasDanglingToolCall([call]), true);
		const result = { id: core.newMessageId(), role: "toolResult", toolCallId: "q1", toolName: "quiz", content: [{ type: "text", text: "svar" }], details: {}, isError: false, timestamp: Date.now() } as LhMessage;
		assert.equal(core.hasDanglingToolCall([call, result]), false);
	});
});

describe("the quiz checks", () => {
	it("accepts 3 to 10 questions with four distinct options", () => {
		assert.equal(core.wrapSubmissionProblem(SUBMISSION), null);
		assert.equal(core.wrapSubmissionProblem({ ...SUBMISSION, questions: SUBMISSION.questions.slice(0, 3) }), null);
		assert.equal(core.wrapSubmissionProblem({ ...SUBMISSION, questions: SUBMISSION.questions.slice(0, 6) }), null);
	});
	it("refuses fewer than 3 or more than 10, duplicates and a bad index", () => {
		assert.match(core.wrapSubmissionProblem({ ...SUBMISSION, questions: SUBMISSION.questions.slice(0, 2) }) ?? "", /3 to 10 questions are required, got 2/);
		assert.match(core.wrapSubmissionProblem({ ...SUBMISSION, questions: [...SUBMISSION.questions, question(11)] }) ?? "", /3 to 10 questions are required, got 11/);
		const dup = structuredClone(SUBMISSION);
		dup.questions[2]!.options[1] = "Riktig 3";
		assert.match(core.wrapSubmissionProblem(dup) ?? "", /duplicate/);
		const bad = structuredClone(SUBMISSION);
		bad.questions[0]!.correctIndex = 4;
		assert.match(core.wrapSubmissionProblem(bad) ?? "", /correctIndex/);
	});
	it("refuses cards without a title, without a text, or too long", () => {
		const noTitle = structuredClone(SUBMISSION);
		noTitle.summary[0]!.title = "  ";
		assert.match(core.wrapSubmissionProblem(noTitle) ?? "", /card 1 needs a title/);
		const noText = structuredClone(SUBMISSION);
		noText.summary[1]!.text = "";
		assert.match(core.wrapSubmissionProblem(noText) ?? "", /card 2 needs a text/);
		const long = structuredClone(SUBMISSION);
		long.summary[2]!.text = "x".repeat(core.WRAP_TEXT_MAX + 1);
		assert.match(core.wrapSubmissionProblem(long) ?? "", /card 3: the text must be at most/);
		const longTitle = structuredClone(SUBMISSION);
		longTitle.summary[0]!.title = "y".repeat(core.WRAP_TITLE_MAX + 1);
		assert.match(core.wrapSubmissionProblem(longTitle) ?? "", /card 1: the title/);
	});
	it("turns a lone $$…$$ line into a display block for the card", () => {
		assert.equal(core.wrapCardMarkdown("Ved lading:\n\n$$t = \\tau$$"), "Ved lading:\n\n$$\nt = \\tau\n$$");
		assert.equal(core.wrapCardMarkdown("Inline $$x$$ i tekst"), "Inline $$x$$ i tekst");
		assert.equal(core.wrapCardMarkdown("A\n$$\nx\n$$"), "A\n$$\nx\n$$");
	});
	it("reads cards and legacy strings alike", () => {
		assert.deepEqual(core.wrapPointOf({ title: " RC ", text: "tekst" }), { title: "RC", text: "tekst" });
		assert.deepEqual(core.wrapPointOf("gammelt punkt"), { title: null, text: "gammelt punkt" });
		assert.deepEqual(core.wrapPointOf(42), { title: null, text: "" });
		assert.equal(core.wrapPointLine({ title: "Stabilitet", text: "Alle poler\n\n$$p<0$$" }), "Stabilitet: Alle poler $$p<0$$");
		assert.equal(core.wrapPointLine("gammelt punkt"), "gammelt punkt");
	});
	it("shuffles options and moves the correct index with them", () => {
		let i = 0;
		const seq = [0, 0, 0];
		const shuffled = core.shuffleWrapOptions([question(1)], () => seq[i++ % seq.length]!);
		const q = shuffled[0]!;
		assert.equal(q.options[q.correctIndex], "riktig 1");
		assert.deepEqual([...q.options].sort(), [...question(1).options].sort());
	});
});

describe("closing what the økt left open", () => {
	it("dismisses an open question as sessionEnded: a pause, no continuation", () => {
		const call = assistant("spørsmål", ASK);
		const closed = core.wrapClosingAppends([core.newUserMessage("hei"), call]);
		assert.equal(closed.length, 1);
		const result = closed[0]!;
		assert.equal(result.role === "toolResult" && result.toolCallId, "ask1");
		const details = (result as { details: Record<string, unknown> }).details;
		assert.equal(details.dismissed, true);
		assert.equal(details.sessionEnded, true);
		assert.equal(details.questionText, "Hva er en pol?");
		// The model reads which non-answer it was.
		assert.deepEqual(JSON.parse((result as { content: { text: string }[] }).content[0]!.text), { kind: "ask", dismissed: true, sessionEnded: true });
		const after = [core.newUserMessage("hei"), call, ...closed];
		assert.equal(core.hasDanglingToolCall(after), false);
		assert.equal(core.endsInDismissal(after), true);
		assert.equal(core.needsContinuation(after), false);
		assert.equal(core.closedQuestionCount(closed), 1);
	});

	it("closes a non-question call too, question dismissals last", () => {
		const m = assistant("to kall", ASK);
		(m as { content: unknown[] }).content.unshift({ type: "toolCall", id: "other1", name: "read", arguments: {} });
		const closed = core.wrapClosingAppends([m]);
		assert.deepEqual(closed.map((x) => (x as { toolCallId: string }).toolCallId), ["other1", "ask1"]);
		assert.equal(core.hasDanglingToolCall([m, ...closed]), false);
		assert.equal(core.needsContinuation([m, ...closed]), false);
		assert.equal(core.closedQuestionCount(closed), 1);
	});

	it("leaves a quiet chat and an aborted reply alone", () => {
		assert.deepEqual(core.wrapClosingAppends([core.newUserMessage("hei"), assistant("svar")]), []);
		const aborted = { ...assistant("halv", ASK), stopReason: "aborted" } as LhMessage;
		assert.deepEqual(core.wrapClosingAppends([aborted]), []);
	});
});

describe("the teacher's note", () => {
	it("carries the summary, the score and the missed questions", () => {
		const draft = { id: "d", createdAt: "t", model: "m", coversThroughId: "x", summary: SUBMISSION.summary, questions: SUBMISSION.questions, answers: [0, 1, ...Array(8).fill(0)] as (number | null)[], usage: [] };
		draft.answers[9] = null;
		const text = core.wrapMarkerContent(draft);
		assert.match(text, /\[SESSION WRAPPED\] The learner pressed «Avslutt økt»/);
		assert.match(text, /- Poler og nullpunkter: Polene er røttene i nevneren til \$H\(s\)\$\./);
		assert.match(text, /- Stabilitet: Alle poler i venstre halvplan: \$\$/);
		assert.match(text, /8\/10 correct \(1 not answered\)/);
		assert.match(text, /Q2: .*\n {2}Learner chose: feil a 2\n {2}Correct: riktig 2/);
		assert.match(text, /Not answered:\n- Q10/);
	});

	it("says what ending interrupted", () => {
		const draft = { summary: SUBMISSION.summary, questions: SUBMISSION.questions.slice(0, 3), answers: [0, 0, 0], interrupted: { turn: true, questions: 1 } };
		const text = core.wrapMarkerContent(draft);
		assert.match(text, /your last reply was cut off/);
		assert.match(text, /Your open question was closed unanswered/);
		assert.match(text, /3\/3 correct/);
	});

	it("writes a bare marker for «Bare avslutt»", () => {
		const marker = core.newSessionEndMarker({ id: "e", coversThroughId: "x", completedAt: "2026-11-23T10:00:00.000Z" });
		assert.match(marker.content, /without a summary or quiz/);
		assert.doesNotMatch(marker.content, /Recall quiz/);
		const details = core.readWrap(marker.details)!;
		assert.equal(core.isBareWrap(details), true);
		assert.equal((details as { coversThroughId: string }).coversThroughId, "x");
	});

	it("still reads a legacy draft with plain-string points", () => {
		const legacy = { summary: ["Hva en pol er"], questions: [question(1)], answers: [0] };
		assert.match(core.wrapMarkerContent(legacy), /- Hva en pol er\n/);
	});

	it("reaches the model as user text and the view as a divider", () => {
		const draft = { id: "d", createdAt: "t", model: "m", coversThroughId: "x", summary: ["a"], questions: [question(1)], answers: [0], usage: [] };
		const marker = core.newSessionWrapMarker(draft, "2026-11-22T10:00:00.000Z") as LhMessage;
		const llm = core.toLlmMessages([core.newUserMessage("hei"), marker] as never);
		assert.equal(llm.at(-1)?.role, "user");
		assert.match(JSON.stringify(llm.at(-1)), /SESSION WRAPPED/);
		const view = core.projectView([marker]);
		assert.equal(view[0]?.parts[0]?.type, "data-session-wrap");
	});
});

describe("/api/chats/[id]/wrap", () => {
	it("generates a draft once, records answers and ends the økt", async () => {
		const id = chatWith([core.newUserMessage("Hva er en pol?"), assistant("En pol er …")]);
		const res = await postWrap(id);
		assert.equal(res.status, 200);
		const { draft } = (await res.json()) as { draft: import("../src/core/session-wrap.ts").SessionWrapDraft };
		assert.equal(draft.questions.length, 10);
		assert.deepEqual(draft.answers, Array(10).fill(null));
		assert.match(prompts[0]!, /Hva er en pol\?/);

		// A second press returns the same draft without a new model call.
		const again = (await (await postWrap(id)).json()) as { draft: { id: string } };
		assert.equal(again.draft.id, draft.id);
		assert.equal(prompts.length, 1);

		assert.equal((await patchWrap(id, { index: 0, choice: 0 })).status, 200);
		assert.equal((await patchWrap(id, { index: 1, choice: 2 })).status, 200);
		// The first answer sticks.
		await patchWrap(id, { index: 1, choice: 0 });
		assert.deepEqual(stores.chatStore.getChat(id)!.wrapDraft!.answers.slice(0, 2), [0, 2]);
		assert.equal((await patchWrap(id, { index: 10, choice: 0 })).status, 400);

		assert.equal((await complete(id)).status, 200);
		const record = stores.chatStore.getChat(id)!;
		assert.equal(record.wrapDraft, undefined);
		const marker = record.messages.at(-1)!;
		assert.equal(marker.role === "custom" && marker.customType, "session-wrap");
		assert.match((marker as { content: string }).content, /1\/10 correct \(8 not answered\)/);
		assert.equal(record.turns?.at(-1)?.messageId, marker.id);

		// Nothing new since the divider: nothing to wrap.
		const empty = await postWrap(id);
		assert.equal(empty.status, 400);
		// The next økt covers only what came after.
		stores.chatStore.saveMessages(id, [...record.messages, core.newUserMessage("Ny økt: Bode-plott")]);
		assert.equal((await postWrap(id)).status, 200);
		assert.doesNotMatch(prompts.at(-1)!, /Hva er en pol\?/);
		assert.match(prompts.at(-1)!, /Bode-plott/);
	});

	it("fits the quiz to the økt: three questions are a full quiz", async () => {
		wrapSeams.generate = async () => ({ submission: { ...structuredClone(SUBMISSION), questions: SUBMISSION.questions.slice(0, 3) }, usage: [] });
		const id = chatWith([core.newUserMessage("Kort økt"), assistant("svar")]);
		const { draft } = (await (await postWrap(id)).json()) as { draft: import("../src/core/session-wrap.ts").SessionWrapDraft };
		assert.equal(draft.questions.length, 3);
		assert.deepEqual(draft.answers, [null, null, null]);
		assert.equal((await patchWrap(id, { index: 3, choice: 0 })).status, 400);
	});

	it("stops a running turn instead of refusing, then generates", async () => {
		const id = chatWith([core.newUserMessage("hei"), assistant("svar")]);
		const turn = fakeTurn(id);
		const res = await postWrap(id);
		assert.equal(res.status, 200);
		assert.ok(turn.aborted() >= 1);
		const { draft } = (await res.json()) as { draft: import("../src/core/session-wrap.ts").SessionWrapDraft };
		assert.deepEqual(draft.interrupted, { turn: true, questions: 0 });
		assert.equal((await complete(id)).status, 200);
		assert.match((stores.chatStore.getChat(id)!.messages.at(-1) as { content: string }).content, /your last reply was cut off/);
	});

	it("closes a waiting question instead of refusing, then generates", async () => {
		const id = chatWith([core.newUserMessage("hei"), assistant("spørsmål", ASK)]);
		const res = await postWrap(id);
		assert.equal(res.status, 200);
		const record = stores.chatStore.getChat(id)!;
		const closed = record.messages.at(-1)!;
		assert.equal(closed.role === "toolResult" && (closed.details as { sessionEnded?: boolean }).sessionEnded, true);
		assert.equal(record.wrapDraft!.coversThroughId, closed.id);
		assert.deepEqual(record.wrapDraft!.interrupted, { turn: false, questions: 1 });
		assert.equal(core.hasDanglingToolCall(record.messages), false);
	});

	it("«Bare avslutt» ends at once: stops the turn, closes the question, writes the divider", async () => {
		const id = chatWith([core.newUserMessage("hei"), assistant("spørsmål", ASK)]);
		const turn = fakeTurn(id);
		const res = await complete(id, { mode: "end" });
		assert.equal(res.status, 200);
		assert.ok(turn.aborted() >= 1);
		const { markerId } = (await res.json()) as { markerId: string };
		const record = stores.chatStore.getChat(id)!;
		const marker = record.messages.at(-1)!;
		assert.equal(marker.id, markerId);
		assert.equal(marker.role === "custom" && marker.customType, "session-wrap");
		assert.equal(core.isBareWrap(core.readWrap((marker as { details: unknown }).details)!), true);
		assert.match((marker as { content: string }).content, /without a summary or quiz/);
		assert.match((marker as { content: string }).content, /cut off/);
		assert.match((marker as { content: string }).content, /open question was closed/);
		assert.equal(core.hasDanglingToolCall(record.messages), false);
		assert.equal(prompts.length, 0, "no model call");
		assert.deepEqual(ended, [{ chatId: id, markerId }]);
		// The next økt starts empty: the closed question is not new work.
		assert.equal(core.hasWrapContent(record.messages), false);
		assert.equal((await complete(id, { mode: "end" })).status, 400);
	});

	it("keeps the quiz completion strict: no draft, no body = 409", async () => {
		const id = chatWith([core.newUserMessage("hei"), assistant("svar")]);
		const res = await complete(id);
		assert.equal(res.status, 409);
		assert.equal(((await res.json()) as { code: string }).code, "no_draft");
	});

	it("«Bare avslutt» with a draft keeps the answers given so far", async () => {
		const id = chatWith([core.newUserMessage("hei"), assistant("svar")]);
		await postWrap(id);
		await patchWrap(id, { index: 0, choice: 0 });
		assert.equal((await complete(id, { mode: "end" })).status, 200);
		const marker = stores.chatStore.getChat(id)!.messages.at(-1) as { content: string };
		assert.match(marker.content, /1\/10 correct \(9 not answered\)/);
	});

	it("answers 409 still_busy when a turn will not stop in time", async () => {
		wrapSeams.settleTimeoutMs = 100;
		const id = chatWith([core.newUserMessage("hei"), assistant("svar")]);
		assert.ok(beginTurn(id)); // no handle: nothing can abort it
		try {
			const res = await complete(id, { mode: "end" });
			assert.equal(res.status, 409);
			assert.equal(((await res.json()) as { code: string }).code, "still_busy");
			assert.equal(stores.chatStore.getChat(id)!.messages.length, 2, "nothing written");
		} finally {
			endTurn(id);
		}
	});

	it("says so when no model is set up", async () => {
		wrapSeams.engine = () => undefined;
		const id = chatWith([core.newUserMessage("hei")]);
		assert.equal((await postWrap(id)).status, 503);
	});
});

describe("the course topics after an ended økt", () => {
	function seedCourse(code: string, topics: import("../src/core/courses.ts").CourseTopic[]) {
		courseStore.saveCourse({
			code,
			name: "Reguleringsteknikk",
			custom: true,
			exam: { date: "2026-12-10" },
			minutesPerDay: 120,
			sources: [],
			topics,
			planDone: [],
			createdAt: "2026-11-01T00:00:00.000Z",
			updatedAt: "2026-11-01T00:00:00.000Z",
		} as import("../src/core/courses.ts").Course);
	}
	const TOPICS = [
		{ id: "poler", title: "Poler og nullpunkter", weight: 3 as const, status: "unknown" as const },
		{ id: "bode", title: "Bode-plott", weight: 2 as const, status: "unknown" as const },
	];

	let calls: { prompt: string; greenAllowed: boolean }[] = [];
	beforeEach(() => {
		calls = [];
		sessionTopicSeams.engine = () => ({ engine: {} as PiEngine, modelId: "faux:cheap" });
		sessionTopicSeams.assess = async ({ prompt, greenAllowed }) => {
			calls.push({ prompt, greenAllowed });
			return {
				updates: [
					{ topicId: "poler", status: "yellow", note: "Fant polene, men byttet fortegn  to ganger." },
					{ topicId: "bode", status: "green", note: "Uten forklaring." },
				],
				usage: [{ inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0, reasoningTokens: 0 }],
			};
		};
	});

	async function endedChat(code: string): Promise<{ id: string; markerId: string }> {
		const chat = stores.chatStore.createChat("Fag", undefined, { code });
		stores.chatStore.saveMessages(chat.id, [core.newUserMessage("Hva er polene til $H(s)$?"), assistant("Røttene i nevneren.")]);
		const res = await complete(chat.id, { mode: "end" });
		const { markerId } = (await res.json()) as { markerId: string };
		return { id: chat.id, markerId };
	}

	it("colors the topics the økt gave evidence on, through the topic_status port", async () => {
		seedCourse("TTK4105", TOPICS);
		const { id, markerId } = await endedChat("TTK4105");
		await updateTopicsAfterWrap(id, markerId);
		assert.equal(calls.length, 1);
		assert.match(calls[0]!.prompt, /\[poler\] Poler og nullpunkter: unknown/);
		assert.match(calls[0]!.prompt, /Hva er polene til/);
		assert.equal(calls[0]!.greenAllowed, false, "no answered explain in the økt");
		const course = courseStore.getCourse("TTK4105")!;
		const poler = course.topics.find((t) => t.id === "poler")!;
		assert.equal(poler.status, "yellow");
		assert.equal(poler.statusSource, "agent");
		assert.equal(poler.statusNote, "Fant polene, men byttet fortegn to ganger.");
		// Green without an answered explain never lands.
		assert.equal(course.topics.find((t) => t.id === "bode")!.status, "unknown");
		assert.equal(stores.chatStore.getChat(id)!.turns?.at(-1)?.messageId, markerId);
	});

	it("does nothing without a course, without topics, or without a model", async () => {
		const plain = chatWith([core.newUserMessage("hei"), assistant("svar")]);
		const res = await complete(plain, { mode: "end" });
		await updateTopicsAfterWrap(plain, ((await res.json()) as { markerId: string }).markerId);
		seedCourse("TTK4106", []);
		const empty = await endedChat("TTK4106");
		await updateTopicsAfterWrap(empty.id, empty.markerId);
		assert.equal(calls.length, 0);
		seedCourse("TTK4107", TOPICS);
		sessionTopicSeams.engine = () => undefined;
		const noModel = await endedChat("TTK4107");
		await updateTopicsAfterWrap(noModel.id, noModel.markerId);
		assert.equal(calls.length, 0);
		assert.equal(courseStore.getCourse("TTK4107")!.topics[0]!.status, "unknown");
	});

	it("never throws when the model call fails", async () => {
		seedCourse("TTK4108", TOPICS);
		sessionTopicSeams.assess = async () => {
			throw new Error("boom");
		};
		const { id, markerId } = await endedChat("TTK4108");
		await updateTopicsAfterWrap(id, markerId);
		assert.equal(courseStore.getCourse("TTK4108")!.topics[0]!.status, "unknown");
	});

	it("refuses unknown ids, duplicates, an empty note and an ungated green", () => {
		const ids = ["poler", "bode"];
		assert.equal(topicUpdatesProblem([], ids, false), null);
		assert.equal(topicUpdatesProblem([{ topicId: "poler", status: "green", note: "Løste en explain riktig." }], ids, true), null);
		assert.match(topicUpdatesProblem([{ topicId: "nyquist", status: "red", note: "x" }], ids, true) ?? "", /not in the list/);
		assert.match(topicUpdatesProblem([{ topicId: "poler", status: "red", note: "x" }, { topicId: "poler", status: "yellow", note: "y" }], ids, true) ?? "", /appears twice/);
		assert.match(topicUpdatesProblem([{ topicId: "poler", status: "green", note: "x" }], ids, false) ?? "", /can't be green/);
		assert.match(topicUpdatesProblem([{ topicId: "poler", status: "red", note: " " }], ids, false) ?? "", /needs a note/);
	});
});
