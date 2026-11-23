/**
 * The flame, server side (fase 7b): GET/POST /api/streak over an isolated
 * LH_DATA_DIR. Pins the cache (only changed chat files are read again), the
 * best streak surviving a deleted chat, the once-only celebration, and the
 * `streak-changed` event after a settled turn.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import type { LhMessage, StreakSummary } from "../src/core/index.ts";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-streak-"));
process.env.LH_DATA_DIR = path.join(TMP, "data");
process.env.LH_AUTH_FILE = path.join(TMP, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");

const { streakSeams, checkStreakChange, installStreakWatcher } = await import("../src/server/streak.ts");
const { stores } = await import("../src/server/stores.ts");
const { emit, subscribe } = await import("../src/core/events.ts");
const route = await import("../app/api/streak/route.ts");

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let NOW = Date.parse("2026-11-23T12:00:00Z");
streakSeams.now = () => NOW;
streakSeams.timeZone = "Europe/Oslo";

function answer(at: string, extra: Record<string, unknown> = {}): LhMessage {
	return {
		id: `m_${Math.random().toString(36).slice(2)}`,
		role: "toolResult",
		toolCallId: "c1",
		toolName: "quiz",
		content: [{ type: "text", text: "{}" }],
		details: { kind: "quiz", questionText: "Q?", dontKnow: false, answers: [], answeredAt: at, ...extra },
		isError: false,
		timestamp: Date.parse(at),
	} as unknown as LhMessage;
}

async function get(): Promise<StreakSummary> {
	const res = route.GET();
	assert.equal(res.status, 200);
	return (await res.json()) as StreakSummary;
}

async function post(body: unknown): Promise<Response> {
	return route.POST(new Request("http://x/api/streak", { method: "POST", body: JSON.stringify(body) }));
}

describe("GET /api/streak", () => {
	it("no chats: no flame", async () => {
		const s = await get();
		assert.equal(s.current, 0);
		assert.equal(s.level, null);
		assert.equal(s.todayDone, false);
		assert.equal(s.week.length, 7);
	});

	const chat = stores.chatStore.createChat("Økt 1");
	const other = stores.chatStore.createChat("Økt 2");

	it("answers in two chats on consecutive days make one streak; skipped ones do not count", async () => {
		stores.chatStore.saveMessages(chat.id, [answer("2026-11-21T09:00:00Z"), answer("2026-11-22T09:00:00Z", { dismissed: true, skipped: true })]);
		stores.chatStore.saveMessages(other.id, [answer("2026-11-22T20:00:00Z"), answer("2026-11-23T08:00:00Z")]);
		const s = await get();
		assert.equal(s.current, 3);
		assert.equal(s.todayDone, true);
		assert.equal(s.level, "flame");
		assert.equal(s.celebrate, "flame");
		assert.ok(fs.existsSync(path.join(process.env.LH_DATA_DIR!, "streak.json")), "the cache is on disk");
	});

	it("reads only the chat files that changed", async () => {
		const real = stores.chatStore.getChat;
		const reads: string[] = [];
		stores.chatStore.getChat = (id: string) => {
			reads.push(id);
			return real(id);
		};
		try {
			await get();
			assert.deepEqual(reads, [], "nothing changed: no chat is read");
			// mtime has ms resolution on most file systems; make the change certain.
			const later = new Date(Date.now() + 5000);
			stores.chatStore.saveMessages(chat.id, [answer("2026-11-21T09:00:00Z"), answer("2026-11-20T09:00:00Z")]);
			fs.utimesSync(path.join(process.env.LH_DATA_DIR!, "chats", `${chat.id}.json`), later, later);
			const s = await get();
			assert.deepEqual(reads, [chat.id]);
			assert.equal(s.current, 4, "20–23 November");
		} finally {
			stores.chatStore.getChat = real;
		}
	});

	it("just after midnight the streak holds, and today reads «not done»", async () => {
		NOW = Date.parse("2026-11-23T23:05:00Z"); // 00:05 on the 24th in Oslo
		const s = await get();
		assert.equal(s.today, "2026-11-24");
		assert.equal(s.current, 4);
		assert.equal(s.todayDone, false);
		assert.equal(s.week.at(-1)!.label, "i dag");
		NOW = Date.parse("2026-11-23T12:00:00Z");
	});

	it("«Nytt nivå» is celebrated once", async () => {
		assert.equal((await post({ celebrated: "nonsense" })).status, 400);
		const res = await post({ celebrated: "flame" });
		assert.equal(res.status, 200);
		assert.equal(((await res.json()) as StreakSummary).celebrate, null);
		assert.equal((await get()).celebrate, null);
	});

	it("the best streak survives a deleted chat", async () => {
		assert.equal((await get()).best, 4);
		stores.chatStore.deleteChat(other.id);
		const s = await get();
		assert.equal(s.current, 0, "only the 20th and 21st are left");
		assert.equal(s.best, 4);
	});
});

describe("the watcher", () => {
	it("a settled turn with a new answer sends streak-changed; one without does not", async () => {
		installStreakWatcher();
		checkStreakChange(); // settle the baseline after the deletes above
		const seen: string[] = [];
		const off = subscribe((e) => {
			if (e.type === "streak-changed") seen.push(e.type);
		});
		try {
			const fresh = stores.chatStore.createChat("Økt 3");
			emit("turn-settled", { chatId: fresh.id });
			await new Promise((r) => setTimeout(r, 300));
			assert.deepEqual(seen, [], "an empty chat changes nothing");
			stores.chatStore.saveMessages(fresh.id, [answer("2026-11-22T10:00:00Z"), answer("2026-11-23T10:00:00Z")]);
			emit("turn-settled", { chatId: fresh.id });
			await new Promise((r) => setTimeout(r, 300));
			assert.deepEqual(seen, ["streak-changed"]);
		} finally {
			off();
		}
	});
});
