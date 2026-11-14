/**
 * EXISTING EXAM SESSIONS KEEP WORKING (2026-11-14). Records with
 * `kind: "exam"` written by the earlier exam build must read, project and
 * render unchanged in this build, with no edit to the files:
 *
 *  - the store reads them and lists them as kind "exam";
 *  - the plan tree keeps `groups` / `group`;
 *  - the view projection carries the emner into the in-chat plan block;
 *  - the plan popup draws one column per emne and the red/yellow/green
 *    colors that derive from the record's plan_status calls;
 *  - the agent built for them is the exam variant (exam prompt overlay,
 *    the Norwegian language fragment, `plan_status` in the registry, and
 *    `topic_status` beside it when the session is linked to a fag);
 *  - a session CONVERTED to exam midway (no emner, no plan_status call)
 *    keeps the position look on the nodes he has worked on, so the map
 *    never looks empty.
 *
 * Two synthetic records in exactly those two shapes always run. To check
 * real records too, point LH_EXAM_SESSIONS_FROM at a data folder (one with
 * `chats/` and optionally `courses/`): its files are COPIED into this
 * test's temp folder and never written to. Every exam session found there
 * is checked and its numbers are printed.
 *
 *   LH_EXAM_SESSIONS_FROM="$HOME/Library/Application Support/LearnHarness/data" \
 *     NODE_ENV=test npx tsx --test tests/exam-existing-sessions.test.tsx
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createFauxCore } from "@earendil-works/pi-ai";
import type { ChatRecord, NodeMastery, PlanBlockData } from "../src/core/contracts.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
import type { PopupMessage } from "../components/plan-block.tsx";

// ── the seam, BEFORE any config-loading import: never the repo's data/ ──────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-exam-existing-"));
const DATA = path.join(TMP, "data");
const CHATS = path.join(DATA, "chats");
const COURSES = path.join(DATA, "courses");
fs.mkdirSync(CHATS, { recursive: true });
fs.mkdirSync(COURSES, { recursive: true });
process.env.LH_DATA_DIR = DATA;
process.env.LH_AUTH_FILE = path.join(TMP, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// ── the two synthetic records, written as RAW files (as the earlier build
//    left them on disk: no code of this build touches them before the read)
const call = (id: string, name: string, args: unknown) =>
	({ role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }], timestamp: 1 });
const result = (id: string, name: string, details: unknown) =>
	({ role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text: JSON.stringify(details) }], details, isError: false, timestamp: 1 });
const answered = (id: string, tool: "quiz" | "explain") =>
	result(id, tool, { kind: tool, tool, questionText: "Løs", dontKnow: false, answers: [], text: "svar", correct: true, answeredAt: "2026-11-12T10:00:00Z" });

const GROUPED_TREE = {
	nodes: [
		{ id: "polar", title: "Polarform og potenser", group: "komplekse-tall" },
		{ id: "rotter", title: "n-te røtter", group: "komplekse-tall" },
		{ id: "radred", title: "Antall løsninger", group: "linalg" },
		{ id: "lu", title: "LU og Ax=b", group: "linalg" },
		{ id: "euler", title: "Eulers metode", group: "numerikk" },
	],
	edges: [{ from: "polar", to: "rotter" }, { from: "radred", to: "lu" }],
	groups: [
		{ id: "komplekse-tall", title: "Komplekse tall" },
		{ id: "linalg", title: "Lineær algebra" },
		{ id: "numerikk", title: "Numeriske metoder" },
	],
	version: 1,
};
const GROUPED_BLOCK: PlanBlockData = {
	kind: "full",
	at: "2026-11-12T09:00:00.000Z",
	current: null,
	nodes: GROUPED_TREE.nodes.map((n) => ({ id: n.id, title: n.title, status: "upcoming" as const, group: n.group })),
	edges: GROUPED_TREE.edges,
	groups: GROUPED_TREE.groups,
};
const GROUPED_ID = "chat_synthetic_grouped";
const groupedRecord = {
	id: GROUPED_ID,
	title: "Eksamensøving (emner og farger)",
	createdAt: "2026-11-05T10:00:00.000Z",
	updatedAt: "2026-11-13T14:00:00.000Z",
	version: 1,
	kind: "exam",
	course: { code: "TMA4400" },
	tree: GROUPED_TREE,
	messages: [
		{ id: "u1", role: "user", content: "Jeg må gjøre meg klar mot eksamen.", timestamp: 1 },
		call("pd", "probe_done", { strands: [] }),
		result("pd", "probe_done", { ok: true }),
		call("pi", "plan_init", { mermaid: "graph TD" }),
		result("pi", "plan_init", { ok: true, tree: GROUPED_TREE }),
		{ id: "pb1", role: "custom", customType: "plan-block", content: "", display: true, details: { planCallId: "pi", block: GROUPED_BLOCK }, timestamp: 1 },
		call("q1", "quiz", { nodeId: "polar", type: "check", question: "?" }),
		answered("q1", "quiz"),
		call("e1", "explain", { nodeId: "radred", type: "check", question: "Løs" }),
		answered("e1", "explain"),
		call("s1", "plan_status", {
			updates: [
				{ nodeId: "polar", status: "yellow", reason: "fortegnsslurv" },
				{ nodeId: "rotter", status: "red", reason: "ikke sett før" },
				{ nodeId: "radred", status: "yellow", reason: "bommet på én" },
			],
		}),
		result("s1", "plan_status", { ok: true, updated: 3 }),
		// A later call wins per node; a refused one colors nothing.
		call("s2", "plan_status", { updates: [{ nodeId: "radred", status: "green", reason: "full utregning riktig" }] }),
		result("s2", "plan_status", { ok: true, updated: 1 }),
		call("s3", "plan_status", { updates: [{ nodeId: "lu", status: "green", reason: "gjetning" }] }),
		result("s3", "plan_status", { ok: false, error: "Nothing was applied." }),
		call("q2", "quiz", { nodeId: "rotter", type: "check", question: "?" }),
	],
};

const FLAT_TREE = {
	nodes: [
		{ id: "kretslover", title: "Ohm, KVL, KCL" },
		{ id: "effekt", title: "Effekt" },
		{ id: "thevenin", title: "Thévenin" },
		{ id: "opamp", title: "Operasjonsforsterker" },
	],
	edges: [{ from: "kretslover", to: "effekt" }, { from: "kretslover", to: "thevenin" }, { from: "thevenin", to: "opamp" }],
	version: 1,
};
const CONVERTED_ID = "chat_synthetic_converted";
const convertedRecord = {
	id: CONVERTED_ID,
	title: "Konvertert til eksamen underveis",
	createdAt: "2026-11-10T08:00:00.000Z",
	updatedAt: "2026-11-11T12:00:00.000Z",
	version: 1,
	kind: "exam",
	tree: FLAT_TREE,
	messages: [
		{ id: "u1", role: "user", content: "Jeg vil jobbe mot eksamen.", timestamp: 1 },
		call("pd", "probe_done", { strands: [] }),
		result("pd", "probe_done", { ok: true }),
		call("pi", "plan_init", { mermaid: "graph TD" }),
		result("pi", "plan_init", { ok: true, tree: FLAT_TREE }),
		call("q1", "quiz", { nodeId: "kretslover", type: "check", question: "?" }),
		answered("q1", "quiz"),
		call("q2", "quiz", { nodeId: "effekt", type: "check", question: "?" }),
	],
};
fs.writeFileSync(path.join(CHATS, `${GROUPED_ID}.json`), JSON.stringify(groupedRecord, null, "\t"));
fs.writeFileSync(path.join(CHATS, `${CONVERTED_ID}.json`), JSON.stringify(convertedRecord, null, "\t"));
fs.writeFileSync(path.join(COURSES, "TMA4400.json"), JSON.stringify({
	code: "TMA4400", name: "Matematikk 1", custom: false, exam: { date: "2026-12-10" }, minutesPerDay: 120,
	sources: [], topics: [{ id: "komplekse-tall", title: "Komplekse tall", weight: 3, status: "unknown" }], planDone: [],
	createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
}));

// ── optional: real records, copied in (the source folder is only read) ─────
const REAL_FROM = process.env.LH_EXAM_SESSIONS_FROM;
const realIds: string[] = [];
if (REAL_FROM) {
	for (const [sub, dest] of [["chats", CHATS], ["courses", COURSES]] as const) {
		const dir = path.join(REAL_FROM, sub);
		if (!fs.existsSync(dir)) continue;
		for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
			if (fs.existsSync(path.join(dest, file))) continue; // a synthetic one keeps its place
			fs.copyFileSync(path.join(dir, file), path.join(dest, file));
			if (sub === "chats") realIds.push(file.replace(/\.json$/, ""));
		}
	}
}

const { chatStore } = await import("../src/store/chats.ts");
const { jobStore } = await import("../src/store/jobs.ts");
const { projectView } = await import("../src/core/view.ts");
const { hasProbeDone } = await import("../src/core/native-messages.ts");
const { derivePlanMastery, derivePlanMasteryLh } = await import("../src/core/contracts.ts");
const { createProberAgent, createTeacherAgent } = await import("../src/agent/teacher-agent.ts");
const { courseToolContextFor } = await import("../src/server/courses.ts");
const { PlanBlock, PlanPopup, latestTree, masteryCounts } = await import("../components/plan-block.tsx");
const { PlanMarginalia } = await import("../components/plan-window.tsx");

// No model call is ever made: the engine only lets the agent be BUILT, so
// its registry and system prompt can be read.
const faux = createFauxCore({ provider: "anthropic", models: [{ id: "exam-fixture" }] });
const engine = { model: faux.getModel(), streamFn: faux.streamSimple };

const count = (html: string, needle: string) => html.split(needle).length - 1;

/** Everything the session page does with one record, as numbers. */
function inspect(id: string) {
	const record = chatStore.getChat(id) as ChatRecord | null;
	assert.ok(record, `${id}: the store reads the record`);
	const listed = chatStore.listChats().find((c) => c.id === id);
	const view = projectView(record.messages as LhMessage[]) as unknown as PopupMessage[];
	const viewTree = latestTree(view);
	const mastery = viewTree ? derivePlanMastery(viewTree, view as unknown as Parameters<typeof derivePlanMastery>[1]) : new Map();
	const nativeMastery = record.tree ? derivePlanMasteryLh(record.tree, record.messages as LhMessage[]) : new Map();
	const colors: Record<NodeMastery, number> = masteryCounts((viewTree ?? record.tree)?.nodes.map((n) => n.id) ?? [], mastery);
	const blocks = view.flatMap((m) => m.parts).filter((p) => p.type === "data-plan-block").map((p) => (p as unknown as { data: PlanBlockData }).data);
	const popup = renderToStaticMarkup(<PlanPopup messages={view} onClose={() => {}} exam />);
	const margin = renderToStaticMarkup(<PlanMarginalia messages={view} exam />);
	const lastBlock = blocks.at(-1);
	const blockHtml = lastBlock ? renderToStaticMarkup(<PlanBlock data={lastBlock} onOpen={() => {}} />) : "";
	// The agent the handler builds for this record (chat-handler.ts): the
	// teacher once the probe has concluded, else the prober; exam overlay
	// for kind "exam"; topic_status when the session is linked to a fag.
	const teaching = hasProbeDone(record.messages as LhMessage[]);
	const course = courseToolContextFor(record.course, id);
	const opts = { engine, ...(record.kind === "exam" ? { exam: true } : {}) };
	const agent = teaching
		? createTeacherAgent({ chatId: id, chatStore, jobStore, spawn: () => {}, ...(course ? { course } : {}) }, opts)
		: createProberAgent({ chatId: id, chatStore, jobStore, deliver: () => {}, spawn: () => {}, ...(course ? { course } : {}) }, opts);
	return {
		record, listed, viewTree, mastery, nativeMastery, colors, blocks, popup, margin, blockHtml, teaching,
		agentKind: teaching ? "teacher" : "prober",
		toolNames: agent.state.tools.map((t) => t.name),
		systemPrompt: agent.state.systemPrompt,
		columnsInPopup: count(popup, 'data-testid="plan-column-'),
		columnsInBlock: count(blockHtml, 'data-testid="plan-column-'),
	};
}

describe("an exam session with emner and colors (written by the earlier build)", () => {
	it("reads from disk untouched: kind, course link, groups on the tree", () => {
		const before = fs.readFileSync(path.join(CHATS, `${GROUPED_ID}.json`), "utf-8");
		const s = inspect(GROUPED_ID);
		assert.equal(s.record.kind, "exam");
		assert.equal(s.listed?.kind, "exam");
		assert.deepEqual(s.record.course, { code: "TMA4400" });
		assert.deepEqual(s.record.tree!.groups!.map((g) => g.title), ["Komplekse tall", "Lineær algebra", "Numeriske metoder"]);
		assert.deepEqual(s.record.tree!.nodes.map((n) => n.group), ["komplekse-tall", "komplekse-tall", "linalg", "linalg", "numerikk"]);
		assert.equal(fs.readFileSync(path.join(CHATS, `${GROUPED_ID}.json`), "utf-8"), before, "reading never rewrites the file");
	});

	it("the view projection carries the emner; the in-chat block draws the columns", () => {
		const s = inspect(GROUPED_ID);
		assert.equal(s.blocks.length, 1);
		assert.equal(s.blocks[0]!.groups!.length, 3);
		assert.ok(s.blocks[0]!.nodes.every((n) => typeof n.group === "string"));
		assert.equal(s.columnsInBlock, 3);
		assert.doesNotMatch(s.blockHtml, /data-mastery=/, "the in-chat block stays monochrome");
	});

	it("colors derive from the record's plan_status calls (latest wins, refused ignored), same in both folds", () => {
		const s = inspect(GROUPED_ID);
		assert.deepEqual(s.colors, { red: 1, yellow: 1, green: 1, unassessed: 2 });
		assert.equal(s.mastery.get("radred")?.status, "green");
		assert.equal(s.mastery.get("radred")?.reason, "full utregning riktig");
		assert.equal(s.mastery.has("lu"), false);
		assert.deepEqual([...s.nativeMastery.entries()], [...s.mastery.entries()]);
	});

	it("the popup: one column per emne, colored boxes with reasons, the summary, thick outline on the current node", () => {
		const { popup, margin } = inspect(GROUPED_ID);
		assert.equal(count(popup, 'data-testid="plan-column-'), 3);
		assert.match(popup, /KOMPLEKSE TALL · 0\/2/);
		assert.match(popup, /LINEÆR ALGEBRA · 1\/2/);
		assert.match(popup, /Eksamenskart/);
		assert.match(popup, /1 av 5 kan du/);
		assert.match(popup, /data-testid="plan-node-rotter" data-status="current" data-mastery="red"/);
		assert.match(popup, /<title>Kan ikke ennå: ikke sett før<\/title>/);
		assert.match(popup, /<title>Kan dette: full utregning riktig<\/title>/);
		assert.match(popup, /data-testid="plan-current-outline"/);
		assert.equal(count(margin, 'data-mastery="'), 5);
		assert.match(margin, /data-mastery="green"/);
	});

	it("the agent is the exam teacher: overlay + language fragment, plan_status AND topic_status", () => {
		const s = inspect(GROUPED_ID);
		assert.equal(s.agentKind, "teacher");
		assert.ok(s.toolNames.includes("plan_init"));
		assert.ok(s.toolNames.includes("plan_status"), "the session's plan map colors");
		assert.ok(s.toolNames.includes("topic_status"), "the fag's topic colors");
		assert.match(s.systemPrompt, /Exam session — plan and teach for the exam/);
		assert.match(s.systemPrompt, /Norwegian/, "shared/05-language.md is still composed");
	});
});

describe("a session converted to exam midway (no emner, no plan_status)", () => {
	it("reads as kind exam with a flat tree and no colors", () => {
		const s = inspect(CONVERTED_ID);
		assert.equal(s.record.kind, "exam");
		assert.equal(s.record.tree!.groups, undefined);
		assert.deepEqual(s.colors, { red: 0, yellow: 0, green: 0, unassessed: 4 });
		assert.equal(s.columnsInPopup, 0, "no emner: the ordinary DAG layout");
	});

	it("keeps the position look on worked nodes, gray only on untouched ones: the map never looks empty", () => {
		const { popup } = inspect(CONVERTED_ID);
		assert.match(popup, /data-testid="plan-node-kretslover" data-status="visited" data-mastery="unassessed"[^]*?<rect[^>]*class="fill-background\/50 stroke-foreground"/);
		assert.match(popup, /data-testid="plan-node-effekt" data-status="current" data-mastery="unassessed"[^]*?<rect[^>]*class="fill-background\/50 stroke-foreground"/);
		assert.match(popup, /data-testid="plan-node-opamp" data-status="upcoming" data-mastery="unassessed"[^]*?<rect[^>]*class="fill-card stroke-border"/);
		assert.match(popup, /0 av 4 kan du/);
		assert.match(popup, /4 ikke kartlagt/);
	});

	it("the agent is still the exam teacher, told how to repair a converted map; no fag link = no topic_status", () => {
		const s = inspect(CONVERTED_ID);
		assert.ok(s.toolNames.includes("plan_status"));
		assert.equal(s.toolNames.includes("topic_status"), false);
		assert.match(s.systemPrompt, /A session converted to exam mode/);
	});
});

describe("real exam sessions from LH_EXAM_SESSIONS_FROM", { skip: !REAL_FROM && "LH_EXAM_SESSIONS_FROM is not set" }, () => {
	it("every copied exam session reads, projects, renders and builds the exam agent", () => {
		const exam = realIds.filter((id) => chatStore.getChat(id)?.kind === "exam");
		assert.ok(exam.length > 0, "no kind:\"exam\" session in the folder");
		for (const id of exam) {
			const s = inspect(id);
			const tree = s.record.tree;
			assert.ok(tree && s.viewTree, `${id}: has a plan tree, also through the view`);
			assert.deepEqual(s.viewTree.nodes.map((n) => n.id), tree.nodes.map((n) => n.id), `${id}: the popup reads the saved tree`);
			assert.deepEqual(s.viewTree.groups ?? [], tree.groups ?? [], `${id}: the emner survive the projection`);
			const groups = tree.groups ?? [];
			assert.equal(s.columnsInPopup, groups.length, `${id}: one column per emne`);
			assert.equal(count(s.popup, 'data-mastery="'), tree.nodes.length, `${id}: every node is drawn with a mastery`);
			for (const color of ["red", "yellow", "green"] as const) {
				assert.equal(count(s.popup, `data-mastery="${color}"`), s.colors[color], `${id}: ${color} boxes`);
			}
			assert.deepEqual([...s.nativeMastery.entries()], [...s.mastery.entries()], `${id}: both folds agree`);
			assert.ok(s.toolNames.includes("plan_status"), `${id}: plan_status in the registry`);
			assert.match(s.systemPrompt, /Exam session — /, `${id}: the exam overlay`);
			assert.match(s.systemPrompt, /Norwegian/, `${id}: the language fragment`);
			const worked = count(s.popup, 'class="fill-background/50 stroke-foreground"');
			console.log(JSON.stringify({
				id,
				title: s.record.title,
				course: s.record.course ?? null,
				agent: `exam ${s.agentKind}`,
				tools: { plan_status: s.toolNames.includes("plan_status"), topic_status: s.toolNames.includes("topic_status") },
				emner: groups.length,
				nodes: tree.nodes.length,
				nodesInEmner: tree.nodes.filter((n) => n.group).length,
				colors: s.colors,
				uncoloredButWorkedOn: worked,
				planBlocksInTranscript: s.blocks.length,
				lastBlockColumns: s.columnsInBlock,
			}));
		}
	});
});
