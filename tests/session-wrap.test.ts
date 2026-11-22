/**
 * «Oppsummering» (session wrap): the økt scope, the quiz checks, the
 * teacher-facing marker, and the /api/chats/[id]/wrap routes driven with
 * the model call replaced through wrapSeams.
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
	summary: ["Laplace-transformen", "Poler og nullpunkter", "Stabilitet"],
	questions: Array.from({ length: 10 }, (_, i) => question(i + 1)),
};

function assistant(text: string, toolCall?: { id: string; name: string }): LhMessage {
	return {
		id: core.newMessageId(),
		role: "assistant",
		content: [{ type: "text", text }, ...(toolCall ? [{ type: "toolCall" as const, id: toolCall.id, name: toolCall.name, arguments: {} }] : [])],
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
const complete = (id: string) => completeRoute.POST(new Request(`http://lh.test/api/chats/${id}/wrap/complete`, { method: "POST" }), params(id));

let prompts: string[] = [];
beforeEach(() => {
	prompts = [];
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

	it("sees a question waiting for its answer", () => {
		const call = assistant("spørsmål", { id: "q1", name: "quiz" });
		assert.equal(core.hasDanglingToolCall([call]), true);
		const result = { id: core.newMessageId(), role: "toolResult", toolCallId: "q1", toolName: "quiz", content: [{ type: "text", text: "svar" }], details: {}, isError: false, timestamp: Date.now() } as LhMessage;
		assert.equal(core.hasDanglingToolCall([call, result]), false);
	});
});

describe("the quiz checks", () => {
	it("accepts ten questions with four distinct options", () => {
		assert.equal(core.wrapSubmissionProblem(SUBMISSION), null);
	});
	it("refuses the wrong count, duplicates and a bad index", () => {
		assert.match(core.wrapSubmissionProblem({ ...SUBMISSION, questions: SUBMISSION.questions.slice(0, 9) }) ?? "", /exactly 10/);
		const dup = structuredClone(SUBMISSION);
		dup.questions[2]!.options[1] = "Riktig 3";
		assert.match(core.wrapSubmissionProblem(dup) ?? "", /duplicate/);
		const bad = structuredClone(SUBMISSION);
		bad.questions[0]!.correctIndex = 4;
		assert.match(core.wrapSubmissionProblem(bad) ?? "", /correctIndex/);
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

describe("the teacher's note", () => {
	it("carries the summary, the score and the missed questions", () => {
		const draft = { id: "d", createdAt: "t", model: "m", coversThroughId: "x", summary: SUBMISSION.summary, questions: SUBMISSION.questions, answers: [0, 1, ...Array(8).fill(0)] as (number | null)[], usage: [] };
		draft.answers[9] = null;
		const text = core.wrapMarkerContent(draft);
		assert.match(text, /\[SESSION WRAPPED\]/);
		assert.match(text, /- Poler og nullpunkter/);
		assert.match(text, /8\/10 correct \(1 not answered\)/);
		assert.match(text, /Q2: .*\n {2}Learner chose: feil a 2\n {2}Correct: riktig 2/);
		assert.match(text, /Not answered:\n- Q10/);
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

	it("refuses while the teacher works or a question waits", async () => {
		const id = chatWith([core.newUserMessage("hei"), assistant("svar")]);
		assert.ok(beginTurn(id));
		try {
			assert.equal((await postWrap(id)).status, 409);
		} finally {
			endTurn(id);
		}
		const waiting = chatWith([core.newUserMessage("hei"), assistant("spørsmål", { id: "q9", name: "quiz" })]);
		const res = await postWrap(waiting);
		assert.equal(res.status, 409);
		assert.equal(((await res.json()) as { code: string }).code, "question_pending");
	});

	it("says so when no model is set up", async () => {
		wrapSeams.engine = () => undefined;
		const id = chatWith([core.newUserMessage("hei")]);
		assert.equal((await postWrap(id)).status, 503);
	});
});
