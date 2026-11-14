/**
 * THE topic_status TOOL (exam mode): registered in the prober, teacher and
 * practice registries only when the session has a course; validates the
 * topic id against the course (a wrong id is a correctable error listing
 * the valid ids); writes the status as the agent's (statusSource "agent")
 * and announces `courses-changed`. Runs under an isolated LH_DATA_DIR.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Course } from "../src/core/courses.ts";

// ── the seam, BEFORE any config-loading import ──────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-courses-tool-"));
process.env.LH_DATA_DIR = path.join(TMP, "data");
process.env.LH_AUTH_FILE = path.join(TMP, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");

const { courseTools } = await import("../src/agent/tools/course.ts");
const { createProberTools, createTeacherTools } = await import("../src/agent/tools.ts");
const { practiceTools } = await import("../src/agent/tools/practice.ts");
const { courseStore } = await import("../src/store/courses.ts");
const { courseToolContextFor } = await import("../src/server/courses.ts");
const { subscribe } = await import("../src/core/events.ts");

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function seed(): Course {
	const course: Course = {
		code: "TTK4100",
		name: "Kybernetikk, introduksjon",
		custom: false,
		exam: { date: "2026-12-10" },
		minutesPerDay: 120,
		sources: [],
		topics: [
			{ id: "pid-regulator", title: "PID-regulator", weight: 3, status: "unknown" },
			{ id: "blokkdiagram", title: "Blokkdiagram", weight: 2, status: "green", statusSource: "self" },
		],
		planDone: [],
		createdAt: "2026-11-01T00:00:00.000Z",
		updatedAt: "2026-11-01T00:00:00.000Z",
	};
	courseStore.saveCourse(course);
	return course;
}

type Result = AgentToolResult<unknown> & { isError?: boolean };
async function call(tool: AgentTool<any>, input: unknown): Promise<Result> {
	const prepared = tool.prepareArguments ? tool.prepareArguments(input) : input;
	return (await tool.execute("call_1", prepared as never, undefined)) as Result;
}
const textOf = (r: Result) => (r.content[0] as { text: string }).text;

const chatStoreStub = { getChat: () => ({ messages: [] }) } as never;
const jobWiring = { jobStore: {} as never, spawn: () => undefined };

describe("topic_status — registration", () => {
	const ctx = { code: "TTK4100", topics: () => [], setStatus: () => true };

	it("prober, teacher and practice registries carry it only for course sessions", () => {
		const base = { chatId: "c1", chatStore: chatStoreStub, deliver: () => undefined, ...jobWiring };
		assert.equal("topic_status" in createProberTools(base), false);
		assert.equal("topic_status" in createProberTools({ ...base, course: ctx }), true);
		assert.equal("topic_status" in createTeacherTools(base), false);
		assert.equal("topic_status" in createTeacherTools({ ...base, course: ctx }), true);
		const practice = { chatId: "c1", chatStore: { getChat: () => ({ messages: [] }) } };
		assert.equal("topic_status" in practiceTools(practice), false);
		assert.equal("topic_status" in practiceTools({ ...practice, course: ctx }), true);
	});

	it("survives the user's tool toggles (it is not a toggleable tool) and keeps probe_done", () => {
		const base = { chatId: "c1", chatStore: chatStoreStub, deliver: () => undefined, ...jobWiring, course: ctx };
		const tools = createProberTools(base, { research: false, pdf: false });
		assert.ok(tools.topic_status && tools.probe_done);
	});

	it("declares the three statuses and a mechanical description", () => {
		const tool = courseTools(ctx).topic_status!;
		assert.equal(tool.name, "topic_status");
		assert.match(tool.description, /real evidence/);
		const schema = JSON.stringify(tool.parameters);
		for (const word of ["topicId", "status", "note", "red", "yellow", "green"]) assert.ok(schema.includes(word), word);
		assert.ok(!schema.includes('"unknown"'), "the agent cannot un-map a topic");
	});
});

describe("topic_status — execution against the course store", () => {
	it("sets the status as the agent's, with the note, and announces the change", async () => {
		seed();
		const events: unknown[] = [];
		const off = subscribe((e) => { if (e.type === "courses-changed") events.push(e); });
		const tool = courseTools(courseToolContextFor({ code: "TTK4100" }, "chat_1")!).topic_status!;
		const result = await call(tool, { topicId: "pid-regulator", status: "yellow", note: "  Kan P og I,\n men usikker på D. " });
		off();
		assert.equal(result.isError, undefined);
		assert.equal(textOf(result), "Status recorded: pid-regulator is now yellow.");
		assert.deepEqual(result.details, { ok: true, topicId: "pid-regulator", status: "yellow", title: "PID-regulator" });
		assert.equal(result.terminate, undefined, "the turn continues");
		const topic = courseStore.getCourse("TTK4100")!.topics[0]!;
		assert.equal(topic.status, "yellow");
		assert.equal(topic.statusSource, "agent");
		assert.equal(topic.statusNote, "Kan P og I, men usikker på D.");
		assert.ok(topic.updatedAt);
		assert.deepEqual(events, [{ type: "courses-changed", code: "TTK4100", chatId: "chat_1" }]);
	});

	it("overwrites the learner's own status and leaves other topics alone", async () => {
		seed();
		const tool = courseTools(courseToolContextFor({ code: "TTK4100" }, "chat_1")!).topic_status!;
		await call(tool, { topicId: "blokkdiagram", status: "red", note: "Klarte ikke å lese diagrammet." });
		const [pid, block] = courseStore.getCourse("TTK4100")!.topics;
		assert.deepEqual([block!.status, block!.statusSource], ["red", "agent"]);
		assert.equal(pid!.status, "unknown");
	});

	it("forgives a bracketed id, a title, or a title-shaped id", async () => {
		seed();
		const tool = courseTools(courseToolContextFor({ code: "TTK4100" }, "chat_1")!).topic_status!;
		for (const topicId of ["[pid-regulator]", "PID-regulator", "pid regulator"]) {
			const result = await call(tool, { topicId, status: "green", note: "ok" });
			assert.equal(result.isError, undefined, topicId);
			assert.deepEqual(result.details, { ok: true, topicId: "pid-regulator", status: "green", title: "PID-regulator" });
		}
	});

	it("an unknown topic id is a correctable error that lists the valid ids; nothing is written", async () => {
		const before = seed();
		const events: unknown[] = [];
		const off = subscribe((e) => { if (e.type === "courses-changed") events.push(e); });
		const tool = courseTools(courseToolContextFor({ code: "TTK4100" }, "chat_1")!).topic_status!;
		const result = await call(tool, { topicId: "stabilitet", status: "red", note: "x" });
		off();
		assert.equal(result.isError, true);
		assert.match(textOf(result), /Invalid tool input for tool "topic_status"/);
		assert.match(textOf(result), /"stabilitet" is not a topic of TTK4100/);
		assert.match(textOf(result), /pid-regulator, blokkdiagram/);
		assert.deepEqual(courseStore.getCourse("TTK4100")!.topics, before.topics);
		assert.deepEqual(events, []);
	});

	it("heals a JSON-encoded status like every other tool in the registry", async () => {
		seed();
		const tools = practiceTools({ chatId: "c1", chatStore: { getChat: () => ({ messages: [] }) }, course: courseToolContextFor({ code: "TTK4100" }, "c1")! });
		const result = await call(tools.topic_status!, { topicId: "pid-regulator", status: '"red"', note: "x" });
		assert.equal(result.isError, undefined);
		assert.equal(courseStore.getCourse("TTK4100")!.topics[0]!.status, "red");
	});

	it("a course without topics, or a deleted course, is an honest error and never throws", async () => {
		const empty = seed();
		courseStore.saveCourse({ ...empty, topics: [] });
		const tool = courseTools(courseToolContextFor({ code: "TTK4100" }, "chat_1")!).topic_status!;
		const none = await call(tool, { topicId: "pid-regulator", status: "red", note: "x" });
		assert.equal(none.isError, true);
		assert.match(textOf(none), /no topic list yet/);
		courseStore.deleteCourse("TTK4100");
		const gone = await call(tool, { topicId: "pid-regulator", status: "red", note: "x" });
		assert.equal(gone.isError, true);
		assert.match(textOf(gone), /no longer exists/);
	});

	it("no course link, or a malformed one: no port, so no tool", () => {
		assert.equal(courseToolContextFor(undefined, "chat_1"), undefined);
		assert.equal(courseToolContextFor({ code: "../x" }, "chat_1"), undefined);
	});
});

// ─── the approval gate (owner 2026-11-14): in the teacher registry green
//     needs an answered explain in the session; the prober has no gate ────

/** A native explain call + (optionally) its answered result. */
function explainExchange(answered: boolean, dismissed = false): unknown[] {
	const call = {
		role: "assistant",
		content: [{ type: "toolCall", id: "e1", name: "explain", arguments: { nodeId: "pid", type: "check", question: "Løs", correctAnswer: "x" } }],
	};
	if (!answered) return [call];
	return [call, {
		role: "toolResult",
		toolCallId: "e1",
		toolName: "explain",
		isError: false,
		content: [{ type: "text", text: "{}" }],
		details: { kind: "explain", questionText: "Løs", dontKnow: false, answers: [], text: "mitt svar", ...(dismissed ? { dismissed: true } : {}) },
	}];
}

describe("topic_status — green is an approval", () => {
	const registry = (messages: unknown[]) => ({
		chatId: "c1",
		chatStore: { getChat: () => ({ messages }) } as never,
		deliver: () => undefined,
		...jobWiring,
		course: courseToolContextFor({ code: "TTK4100" }, "c1")!,
	});

	it("teacher: green is refused until the session holds an ANSWERED explain; red and yellow never need one", async () => {
		seed();
		for (const messages of [[], explainExchange(false), explainExchange(true, true)]) {
			const tool = createTeacherTools(registry(messages)).topic_status!;
			const refused = await call(tool, { topicId: "pid-regulator", status: "green", note: "kan dette" });
			assert.equal(refused.isError, true);
			assert.match(textOf(refused), /pid-regulator can't be green yet: no answered explain in this session/);
			assert.match(textOf(refused), /use yellow/);
			assert.equal(courseStore.getCourse("TTK4100")!.topics[0]!.status, "unknown", "nothing written");
		}
		const open = createTeacherTools(registry([])).topic_status!;
		assert.equal((await call(open, { topicId: "pid-regulator", status: "yellow", note: "halvveis" })).isError, undefined);
		assert.equal((await call(open, { topicId: "pid-regulator", status: "red", note: "nei" })).isError, undefined);

		const approved = createTeacherTools(registry(explainExchange(true))).topic_status!;
		const ok = await call(approved, { topicId: "pid-regulator", status: "green", note: "løste oppgaven med full utregning" });
		assert.equal(ok.isError, undefined);
		assert.equal(courseStore.getCourse("TTK4100")!.topics[0]!.status, "green");
	});

	it("teacher: an unknown topic id is reported before the gate", async () => {
		seed();
		const tool = createTeacherTools(registry([])).topic_status!;
		const result = await call(tool, { topicId: "stabilitet", status: "green", note: "x" });
		assert.match(textOf(result), /is not a topic of TTK4100/);
	});

	it("prober (mapping has only multiple choice) and practice: no gate", async () => {
		seed();
		const prober = createProberTools(registry([])).topic_status!;
		assert.equal((await call(prober, { topicId: "pid-regulator", status: "green", note: "riktig valg og forklaring" })).isError, undefined);
		assert.equal(courseStore.getCourse("TTK4100")!.topics[0]!.status, "green");
		const practice = practiceTools({ chatId: "c1", chatStore: { getChat: () => ({ messages: [] }) }, course: courseToolContextFor({ code: "TTK4100" }, "c1")! }).topic_status!;
		assert.equal((await call(practice, { topicId: "blokkdiagram", status: "green", note: "ok" })).isError, undefined);
	});

	it("only the teacher's description states the rule", () => {
		const ctx = { code: "TTK4100", topics: () => [], setStatus: () => true };
		const base = { chatId: "c1", chatStore: chatStoreStub, deliver: () => undefined, ...jobWiring, course: ctx };
		assert.match(createTeacherTools(base).topic_status!.description, /green before any answered explain in this session is refused/);
		assert.doesNotMatch(createProberTools(base).topic_status!.description, /explain/);
		assert.doesNotMatch(courseTools(ctx).topic_status!.description, /explain/);
	});
});
