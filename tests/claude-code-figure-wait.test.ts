/**
 * The question wait in the CLAUDE CODE path (2026-11 — «figuren kommer
 * etter at jeg har spurt»). Driven through the real chat handler, the real
 * Claude Code stream function and MCP tool bridge (tests/fixtures/
 * claude-code/fake-claude.mjs stands in for the CLI), the real teacher
 * registry, the real job store and the question stopper.
 *
 * Two ways a question becomes pending in a turn that started a figure or
 * demo, both pinned:
 * 1. the teacher poses it himself (quiz after a visual): the quiz's execute
 *    holds until the job is done, so the turn neither settles nor shows the
 *    question first, and the figure attaches to that quiz;
 * 2. the app re-poses a question the learner held («Spør agenten») after the
 *    teacher's reply — the incident path: the reply dispatched a demo, then
 *    ended, and the synthetic re-pose used to land at once, before the demo.
 *    Now the settle holds the turn open until the demo is done (or the
 *    learner stops it), and the re-pose carries the id the job is marked for.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test, { after, type TestContext } from "node:test";

import type { RunClaude } from "../src/agent/claude-code/stream.ts";
import type { PiEngine } from "../src/agent/models.ts";
import type { JobRecord } from "../src/core/contracts.ts";

const testData = mkdtempSync(join(tmpdir(), "lh-cli-figure-wait-data-"));
process.env.LH_DATA_DIR = testData;
after(() => rmSync(testData, { recursive: true, force: true }));
const { PATHS, SETTINGS_FILE } = await import("../config.ts");
const { readSettings, writeSettings } = await import("../src/store/settings.ts");
const { CLAUDE_CODE_MODELS } = await import("../src/agent/claude-code/provider.ts");
const { createClaudeCodeStreamFunction } = await import("../src/agent/claude-code/stream.ts");
const { createTeacherAgent } = await import("../src/agent/teacher-agent.ts");
const { attachedFigureId, danglingQuestionOf, dismissedAnswer, questionFigureSvg } = await import("../src/core/index.ts");
const { handleChatRequest } = await import("../src/server/chat-handler.ts");
const { isTurnRunning } = await import("../src/server/turn-liveness.ts");
const { abortTurn, runningTurn } = await import("../src/server/turn-runs.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { jobStore } = await import("../src/store/jobs.ts");
const { claimAwaited, isAwaited } = await import("../src/agent/subagents/awaited-jobs.ts");

const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/claude-code/fake-claude.mjs", import.meta.url));
const TURN_TIMEOUT_MS = 8000;

const NODE_ID = "opamp";
const FIGURE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M1,1 L9,9" stroke="#000"/></svg>';

function streamEvent(event: object): string {
	return JSON.stringify({ type: "stream_event", event });
}

/** One CLI message calling one harness tool, then the MCP call itself. */
function toolCall(id: string, name: string, args: object): string[] {
	return [
		streamEvent({ type: "message_start", message: { usage: {} } }),
		streamEvent({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name: `mcp__learnharness__${name}`, input: {} } }),
		streamEvent({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(args) } }),
		streamEvent({ type: "content_block_stop", index: 0 }),
		streamEvent({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: {} }),
		streamEvent({ type: "message_stop" }),
		JSON.stringify({ fake: "call", id, name, arguments: args }),
	];
}

const QUIZ_ID = "toolu_fig_quiz";
const QUIZ_ARGS = {
	type: "check", nodeId: NODE_ID, question: "Hva er $V_o$ i kretsen?",
	options: [{ label: "$10$ V", value: "a" }, { label: "$2$ V", value: "b" }],
	explanation: "Ikke-inverterende: $V_o = 5 V_{in}$.", correctAnswer: "a",
};
const HELD_ID = "toolu_fig_held";
const HELD_ARGS = { type: "check", nodeId: NODE_ID, question: "Finn strømmen i $R_2$.", correctAnswer: "2 mA fra utgangen mot $V_-$." };

function createFakeRun(t: TestContext, scenarios: string[][]): { runClaude: RunClaude; children: ChildProcessWithoutNullStreams[] } {
	const settings = readSettings();
	writeSettings({ ...(settings ?? { version: 1 }), claudeCode: { enabled: true } });
	t.after(() => { if (settings) writeSettings(settings); else rmSync(SETTINGS_FILE, { force: true }); });
	const dir = mkdtempSync(join(tmpdir(), "claude-code-figure-wait-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	// Satisfies the presence gate; never executed (the Node fake runs instead).
	writeFileSync(join(dir, process.platform === "win32" ? "claude.exe" : "claude"), "", { mode: 0o755 });
	const savedPath = process.env.PATH;
	process.env.PATH = `${dir}${delimiter}${savedPath ?? ""}`;
	t.after(() => { if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath; });
	const children: ChildProcessWithoutNullStreams[] = [];
	const runClaude: RunClaude = (args, options) => {
		const scenario = scenarios[children.length];
		assert.ok(scenario, `unexpected spawn #${children.length + 1}`);
		const scenarioFile = join(dir, `scenario-${children.length}.jsonl`);
		writeFileSync(scenarioFile, `${scenario.join("\n")}\n`);
		const child = spawn(process.execPath, [FAKE_CLAUDE, ...args], {
			cwd: options.cwd,
			env: { ...options.env, FAKE_CLAUDE_SCENARIO: scenarioFile },
			stdio: ["pipe", "pipe", "pipe", "ipc"],
		}) as ChildProcessWithoutNullStreams;
		t.after(() => child.kill("SIGKILL"));
		children.push(child);
		return child;
	};
	return { runClaude, children };
}

function createChat(t: TestContext): string {
	const chat = chatStore.createChat("Claude Code: figure before the question");
	chatStore.saveSettings(chat.id, { model: { provider: "claude-code", id: "sonnet" } });
	chatStore.saveTree(chat.id, { nodes: [{ id: NODE_ID, title: "Opampkretser" }], edges: [], version: 1 });
	t.after(() => {
		unlinkSync(join(PATHS.chats, `${chat.id}.json`));
		jobStore.deleteJobsForChat(chat.id);
	});
	return chat.id;
}

/** The REAL teacher registry (quiz/explain wrapped by the question wait,
 *  the real job tools) over the Claude Code engine. Spawned jobs are left
 *  running: the test plays the runner's finish. */
function teacherFactory(runClaude: RunClaude): Parameters<typeof handleChatRequest>[1] {
	const model = CLAUDE_CODE_MODELS.find((candidate) => candidate.id === "sonnet");
	assert.ok(model);
	const engine: PiEngine = { model, streamFn: createClaudeCodeStreamFunction(runClaude) };
	return (options) => createTeacherAgent(
		{ chatId: options.chatId!, chatStore, jobStore, spawn: () => {} },
		{ engine, chatId: options.chatId, messages: options.messages },
	);
}

/** Posts the input; resolves at the ack with the view (wrapped: an async
 *  function returning a promise would wait for the whole turn). */
async function post(chatId: string, input: object, factory: Parameters<typeof handleChatRequest>[1]): Promise<{ view: Promise<string> | null }> {
	const ack = await handleChatRequest(new Request("http://test/api/chat", {
		method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, input }),
	}), factory);
	assert.equal(ack.status, 200, await ack.clone().text());
	const handle = runningTurn(chatId);
	return { view: handle ? new Response(handle.subscribe()).text() : null };
}

async function until<T>(what: string, probe: () => T | null | undefined | false): Promise<T> {
	const deadline = Date.now() + TURN_TIMEOUT_MS;
	for (;;) {
		const value = probe();
		if (value) return value;
		assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
		await sleep(10);
	}
}

async function settled(chatId: string): Promise<void> {
	await until("the turn to settle", () => !isTurnRunning(chatId));
}

/** The runner's finish seam, as tests/visual-wait.test.ts plays it: a
 *  waiter that takes the result claims it; no steer follows. */
function finishJob(job: JobRecord, result: unknown): void {
	assert.ok(isAwaited(job.id), "a question is waiting for this job");
	jobStore.updateJob(job.id, { result, status: "done", delivery: { kind: "result", status: "delivered" } });
	assert.equal(claimAwaited(job.id, result), true);
}

test("Claude Code: a quiz posed after a visual in the same turn waits for the figure, then shows it", async (t) => {
	const visualArgs = { brief: "Ikke-inverterende opampkrets med R1 og R2." };
	const fake = createFakeRun(t, [[...toolCall("toolu_fig_visual", "visual", visualArgs), ...toolCall(QUIZ_ID, "quiz", QUIZ_ARGS)]]);
	const chatId = createChat(t);
	const { view } = await post(chatId, { type: "text", text: "Gi meg en kretsoppgave" }, teacherFactory(fake.runClaude));

	const job = await until("the quiz to wait on the figure", () => {
		const found = jobStore.findJobByToolCallId(chatId, "toolu_fig_visual");
		return found?.forQuestion === QUIZ_ID ? found : null;
	});
	assert.equal(isTurnRunning(chatId), true, "the turn is held open while the figure is made");
	assert.equal(danglingQuestionOf(chatStore.getChat(chatId)!.messages), null, "the question is not shown before its figure");

	finishJob(job, { svg: FIGURE, notes: "ok" });
	await view;
	await settled(chatId);

	const messages = chatStore.getChat(chatId)!.messages;
	assert.equal(danglingQuestionOf(messages)?.toolCallId, QUIZ_ID, "the quiz is posed once the figure is done");
	const jobs = jobStore.listJobs(chatId);
	assert.equal(attachedFigureId(jobs, QUIZ_ID), job.id, "the figure is tied to the quiz");
	assert.equal(questionFigureSvg(QUIZ_ARGS, QUIZ_ID, messages, jobs), FIGURE, "and the dock shows it in the task");
	assert.equal(fake.children.length, 1);
});

/** Turn 1 poses the explain the learner then holds; turn 2 is his
 *  message with the hold, where the teacher dispatches a demo and replies. */
function heldScenarios(): string[][] {
	return [
		toolCall(HELD_ID, "explain", HELD_ARGS),
		[...toolCall("toolu_fig_demo", "demo", { title: "Figur: opampkrets", brief: "Tegn kretsen." }), JSON.stringify({ fake: "reply" })],
	];
}

async function holdAndAsk(chatId: string, factory: Parameters<typeof handleChatRequest>[1]): Promise<{ view: Promise<string> | null }> {
	const first = await post(chatId, { type: "text", text: "Gi meg en eksamensoppgave" }, factory);
	await first.view;
	await settled(chatId);
	assert.equal(danglingQuestionOf(chatStore.getChat(chatId)!.messages)?.toolCallId, HELD_ID);
	return post(chatId, {
		type: "text",
		text: "Er veldig vanskelig når jeg ikke ser figuren",
		hold: { toolCallId: HELD_ID, answer: dismissedAnswer("explain", HELD_ARGS.question, { reason: "onHold", tool: "explain" }) },
	}, factory);
}

test("Claude Code: the held question's re-pose waits for the demo the reply started (the incident path)", async (t) => {
	const fake = createFakeRun(t, heldScenarios());
	const chatId = createChat(t);
	const { view } = await holdAndAsk(chatId, teacherFactory(fake.runClaude));

	const job = await until("the re-pose to wait on the demo", () => {
		const found = jobStore.findJobByToolCallId(chatId, "toolu_fig_demo");
		return found?.forQuestion ? found : null;
	});
	assert.match(job.forQuestion!, /^call_repose_/);
	// The reply is done, but the turn stays open and the question stays away.
	await sleep(50);
	assert.equal(isTurnRunning(chatId), true, "the turn is held open while the demo is built");
	const before = chatStore.getChat(chatId)!.messages;
	assert.equal(before.at(-1)?.role, "assistant", "the teacher's reply is persisted");
	assert.equal(danglingQuestionOf(before), null, "the re-pose waits");

	finishJob(job, { title: "Figur: opampkrets", html: "<!doctype html><p>krets</p>", tested: true });
	await view;
	await settled(chatId);

	const after_ = chatStore.getChat(chatId)!.messages;
	const reposed = danglingQuestionOf(after_);
	assert.equal(reposed?.toolCallId, job.forQuestion, "the re-pose carries the id the demo was marked for");
	assert.equal(jobStore.getJob(job.id)?.forQuestion, reposed?.toolCallId, "the demo stays tied to the question (shown before it)");
	assert.equal(fake.children.length, 2);
});

test("Claude Code: the learner's stop ends the re-pose wait; the demo delivers later, the next reply re-poses", async (t) => {
	const fake = createFakeRun(t, heldScenarios());
	const chatId = createChat(t);
	const { view } = await holdAndAsk(chatId, teacherFactory(fake.runClaude));
	const job = await until("the re-pose to wait on the demo", () => {
		const found = jobStore.findJobByToolCallId(chatId, "toolu_fig_demo");
		return found?.forQuestion ? found : null;
	});

	assert.deepEqual(abortTurn(chatId), { ok: true }, "the waiting turn is still abortable");
	await view;
	await settled(chatId);

	assert.equal(danglingQuestionOf(chatStore.getChat(chatId)!.messages), null, "no re-pose on a stop");
	assert.equal(jobStore.getJob(job.id)?.forQuestion, undefined, "released: the demo will arrive as its own message");
	assert.equal(isAwaited(job.id), false);
});
