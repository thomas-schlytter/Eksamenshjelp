/**
 * Hints on request (owner, 2026-11-23): the Hint button is always on a task.
 * Authored hints pass straight through; a task without them gets one
 * generated ladder, cached per chat, never written into the transcript.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import type { LhMessage } from "../src/core/index.ts";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-task-hints-"));
process.env.LH_DATA_DIR = path.join(TMP, "data");
process.env.LH_AUTH_FILE = path.join(TMP, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");

const { taskHints, taskHintSeams, findTaskCall } = await import("../src/server/task-hints.ts");
const { stores } = await import("../src/server/stores.ts");
const route = await import("../app/api/chats/[id]/hints/route.ts");

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function task(callId: string, args: Record<string, unknown>): LhMessage {
	return {
		id: `m_${callId}`,
		role: "assistant",
		content: [{ type: "toolCall", id: callId, name: "explain", arguments: args }],
		timestamp: Date.now(),
	} as unknown as LhMessage;
}

describe("hints on request", () => {
	const chat = stores.chatStore.createChat("Fag-chat");
	stores.chatStore.saveMessages(chat.id, [
		task("call_authored", { question: "Løs 3x = 6.", hints: ["Tenk på hva som er gitt.", "Isoler x.", "Del på 3."] }),
		task("call_bare", { question: "Finn arealet under $x^2e^{-x}$ på $[0,2]$.", correctAnswer: "$2-10e^{-2}$" }),
	]);
	let calls = 0;
	let lastPrompt = "";
	taskHintSeams.engine = () => ({}) as never;
	taskHintSeams.generate = async ({ prompt }) => {
		calls++;
		lastPrompt = prompt;
		return ["Hva slags integral er dette?", "Start med delvis integrasjon.", "Deriver $x^2$ og integrer $e^{-x}$."];
	};

	it("finds the task call with its text, reference and authored hints", () => {
		const found = findTaskCall(stores.chatStore.getChat(chat.id)!.messages, "call_bare");
		assert.match(found!.question, /arealet/);
		assert.equal(found!.reference, "$2-10e^{-2}$");
		assert.deepEqual(found!.hints, []);
	});

	it("authored hints pass through without a model call", async () => {
		const out = await taskHints(chat.id, "call_authored");
		assert.ok(out.ok);
		assert.equal(out.ok && out.generated, false);
		assert.equal(out.ok && out.hints.length, 3);
		assert.equal(calls, 0);
	});

	it("a task without hints gets one generated ladder, cached and not in the transcript", async () => {
		const first = await route.POST(
			new Request("http://x", { method: "POST", body: JSON.stringify({ toolCallId: "call_bare" }), headers: { "content-type": "application/json" } }),
			{ params: Promise.resolve({ id: chat.id }) },
		);
		assert.equal(first.status, 200);
		const body = (await first.json()) as { hints: string[]; generated: boolean };
		assert.equal(body.hints.length, 3);
		assert.equal(body.generated, true);
		assert.match(lastPrompt, /never reveal it/, "the reference answer is marked as hidden");
		const again = await taskHints(chat.id, "call_bare");
		assert.equal(again.ok && again.generated, false, "the second press is served from the cache");
		assert.equal(calls, 1);
		assert.ok(fs.existsSync(path.join(process.env.LH_DATA_DIR!, "task-hints", `${chat.id}.json`)));
		const args = (stores.chatStore.getChat(chat.id)!.messages[1] as unknown as { content: { arguments: Record<string, unknown> }[] }).content[0]!.arguments;
		assert.equal(args.hints, undefined, "the transcript is untouched");
	});

	it("refuses unknown chats and tasks, and says so when no model is set up", async () => {
		assert.equal((await taskHints("chat_none", "call_bare")).ok, false);
		const missing = await taskHints(chat.id, "call_none");
		assert.equal(!missing.ok && missing.status, 404);
		stores.chatStore.saveMessages(chat.id, [...stores.chatStore.getChat(chat.id)!.messages, task("call_new", { question: "Ny oppgave." })]);
		taskHintSeams.engine = () => undefined;
		const noModel = await taskHints(chat.id, "call_new");
		assert.equal(!noModel.ok && noModel.status, 409);
	});
});
