/**
 * «Importer fra LearnHarness» (src/server/data-import.ts + /api/import/legacy).
 *
 * Every test builds its SOURCE folder from the golden fixtures in a temp
 * dir and imports into an isolated TARGET (the LH_DATA_DIR / LH_AUTH_FILE
 * seams, set before any config-loading import). Nothing here touches the
 * repo's data/ or a real LearnHarness folder.
 *
 * Pinned: the preview's numbers, additive merging, idempotence, never
 * overwriting a session/setting/key, refusal of newer formats, corrupt
 * lines, stale running jobs, key values never leaving, the busy gate, path
 * validation, symlink containment and the HTTP shapes.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { after, beforeEach, describe, it } from "node:test";
import type { ImportPreview, ImportResult } from "../src/core/data-import.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(HERE, "fixtures", "golden-data");

// ── the seams, BEFORE any config-loading import ─────────────────────────────
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lh-legacy-import-")));
const TARGET_USER_DATA = path.join(TMP, "target");
const TARGET = path.join(TARGET_USER_DATA, "data");
const TARGET_AUTH = path.join(TARGET_USER_DATA, "auth.json");
process.env.LH_DATA_DIR = TARGET;
process.env.LH_AUTH_FILE = TARGET_AUTH;
fs.mkdirSync(TARGET_USER_DATA, { recursive: true });

const { DataImportError, importSeams, legacyDataCandidates, previewImport, runImport } = await import("../src/server/data-import.ts");
const { stores } = await import("../src/server/stores.ts");
const { graphView } = await import("../src/server/graph.ts");
const { recoverStaleJobs } = await import("../src/server/jobs.ts");
const { beginTurn, endTurn } = await import("../src/server/turn-liveness.ts");
const { registerJobAbort, unregisterJobAbort } = await import("../src/agent/subagents/aborts.ts");
const { subscribe } = await import("../src/core/events.ts");
const { getGraph } = await import("../src/core/graph.ts");
const { promptOverrides } = await import("../src/store/prompt-overrides.ts");
const legacyRoute = await import("../app/api/import/legacy/route.ts");
const previewRoute = await import("../app/api/import/legacy/preview/route.ts");

const ALL = { chats: true, graph: true, settings: true, keys: true, prompts: true };
const DATA_ONLY = { chats: true, graph: true, settings: false, keys: false, prompts: false };
const TEACH = "chat_mv27rrra_feff23b6";
const SECRET = "sk-source-SECRET-value-0123456789";
const TAVILY_SECRET = "tvly-source-SECRET-0123456789abcdef";

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

beforeEach(() => {
	fs.rmSync(TARGET, { recursive: true, force: true });
	fs.rmSync(TARGET_AUTH, { force: true });
	importSeams.userDataRoots = [];
});

let counter = 0;
/** A fresh source laid out like the desktop app's userData: <dir>/data + auth.json. */
function makeSource(): { userData: string; data: string } {
	const userData = path.join(TMP, `source-${++counter}`, "LearnHarness");
	const data = path.join(userData, "data");
	fs.mkdirSync(userData, { recursive: true });
	fs.cpSync(GOLDEN, data, { recursive: true });
	fs.rmSync(path.join(data, "README.md"), { force: true });
	return { userData, data };
}

function treeHash(dir: string): string {
	const hash = createHash("sha256");
	const walk = (current: string) => {
		for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const full = path.join(current, entry.name);
			hash.update(path.relative(dir, full));
			if (entry.isDirectory()) walk(full);
			else if (entry.isFile()) hash.update(fs.readFileSync(full));
		}
	};
	walk(dir);
	return hash.digest("hex");
}

const jsonLines = (file: string): Record<string, unknown>[] =>
	fs.readFileSync(file, "utf-8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as Record<string, unknown>);
const goldenNodeIds = new Set(jsonLines(path.join(GOLDEN, "graph", "nodes.jsonl")).map((node) => node.id as string));
const goldenChainKeys = new Set(
	jsonLines(path.join(GOLDEN, "graph", "chains.jsonl")).map((chain) => `${[...(chain.premises as string[])].sort().join("+")}>${chain.conclusion as string}`),
);

function refusal(fn: () => unknown): InstanceType<typeof DataImportError> {
	try {
		fn();
	} catch (error) {
		assert.ok(error instanceof DataImportError, `expected a DataImportError, got ${String(error)}`);
		return error;
	}
	assert.fail("expected a refusal");
}

const post = (url: string, body: unknown) =>
	new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("finding and validating the source folder", () => {
	it("lists standard locations that hold data, flags the app's own folder, drops the rest", () => {
		const source = makeSource();
		fs.mkdirSync(path.join(TARGET, "chats"), { recursive: true });
		const emptyDir = path.join(TMP, "not-learnharness");
		fs.mkdirSync(emptyDir, { recursive: true });
		importSeams.userDataRoots = [source.userData, TARGET_USER_DATA, emptyDir, path.join(TMP, "missing")];
		const candidates = legacyDataCandidates();
		assert.deepEqual(candidates.map((c) => [c.path, c.current]), [[source.userData, false], [TARGET_USER_DATA, true]]);
		assert.equal(candidates[0]!.preview?.chats.new, 2);
		assert.equal(candidates[1]!.preview, undefined, "the app's own folder offers no import");
		assert.equal(candidates[0]!.label, "LearnHarness (skrivebordsappen)");
	});

	it("accepts the userData folder and the data folder itself", () => {
		const source = makeSource();
		assert.equal(previewImport(source.userData).dataDir, source.data);
		assert.equal(previewImport(source.data).dataDir, source.data);
		assert.equal(previewImport(`  "${source.data}"  `).dataDir, source.data, "pasted quotes and spaces are tolerated");
	});

	it("expands ~ and refuses anything that is not an absolute folder path", () => {
		const source = makeSource();
		const home = process.env.HOME;
		process.env.HOME = path.dirname(source.userData);
		try {
			assert.equal(previewImport("~/LearnHarness").dataDir, source.data);
		} finally {
			process.env.HOME = home;
		}
		for (const bad of ["", "   ", "relative/path", "./data", 42, null, undefined, "/tmp/\0evil"]) {
			const error = refusal(() => previewImport(bad));
			assert.equal(error.status, 400, String(bad));
			assert.equal(error.code, "invalid_path");
		}
	});

	it("refuses a missing folder, a file, a folder without LearnHarness data, and the app's own folder", () => {
		const source = makeSource();
		assert.deepEqual([refusal(() => previewImport(path.join(TMP, "nope"))).status, refusal(() => previewImport(path.join(TMP, "nope"))).code], [404, "not_found"]);
		assert.equal(refusal(() => previewImport(path.join(source.data, "settings.json"))).code, "not_directory");
		assert.equal(refusal(() => previewImport(os.tmpdir())).code, "not_learnharness");
		fs.mkdirSync(path.join(TARGET, "graph"), { recursive: true });
		for (const own of [TARGET, TARGET_USER_DATA]) {
			const error = refusal(() => runImport(own, ALL));
			assert.deepEqual([error.status, error.code], [409, "same_directory"]);
		}
	});

	it("never follows a symlink out of the chosen folder", () => {
		const source = makeSource();
		const outside = path.join(TMP, `outside-${counter}`);
		fs.mkdirSync(outside, { recursive: true });
		const stray = { id: "chat_outside", title: "Utenfor", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", messages: [] };
		fs.writeFileSync(path.join(outside, "chat_outside.json"), JSON.stringify(stray));
		fs.symlinkSync(path.join(outside, "chat_outside.json"), path.join(source.data, "chats", "chat_outside.json"));
		assert.equal(previewImport(source.userData).chats.total, 2, "the linked file is not read");
		runImport(source.userData, DATA_ONLY);
		assert.equal(fs.existsSync(path.join(TARGET, "chats", "chat_outside.json")), false);

		// A userData folder whose data/ is a link to somewhere else is not accepted.
		const shell = path.join(TMP, `shell-${counter}`);
		fs.mkdirSync(shell, { recursive: true });
		fs.symlinkSync(source.data, path.join(shell, "data"));
		assert.equal(refusal(() => previewImport(shell)).code, "not_learnharness");
	});
});

describe("preview", () => {
	it("counts what an import into an empty app would add", () => {
		const source = makeSource();
		const preview = previewImport(source.userData);
		assert.deepEqual(preview.chats, { total: 2, new: 2, existing: 0, unsupported: 0, newTitles: preview.chats.newTitles });
		assert.equal(preview.chats.newTitles.length, 2);
		assert.deepEqual(preview.jobs, { total: 5, new: 3 }, "two fixture jobs belong to sessions that are not in the folder");
		assert.equal(preview.graph.present, true);
		assert.equal(preview.graph.blocked, null);
		assert.deepEqual(preview.graph.propositions, { total: goldenNodeIds.size, new: goldenNodeIds.size });
		assert.deepEqual(preview.graph.chains, { total: goldenChainKeys.size, new: goldenChainKeys.size });
		assert.deepEqual(preview.graph.sources, { total: 4, new: 4 });
		assert.deepEqual(preview.settings, { present: true, targetHasSettings: false });
		assert.deepEqual(preview.keys, { present: false, variables: [], newVariables: [] });
		assert.deepEqual(preview.prompts, { total: 0, new: 0 });
		assert.deepEqual(preview.defaults, { chats: true, graph: true, settings: true, keys: false, prompts: false });
		assert.equal(fs.existsSync(TARGET), false, "a preview writes nothing");
	});

	it("names key variables but never their values, and keeps keys off by default", () => {
		const source = makeSource();
		fs.writeFileSync(path.join(source.userData, "auth.json"), JSON.stringify({
			OPENAI_API_KEY: SECRET, TAVILY_API_KEY: TAVILY_SECRET, CUSTOM_OPENAI_API_KEY: "custom-SECRET-1", SOMETHING_ELSE: "other-SECRET-2",
		}));
		const preview = previewImport(source.userData);
		assert.deepEqual(preview.keys, { present: true, variables: ["OPENAI_API_KEY", "TAVILY_API_KEY"], newVariables: ["OPENAI_API_KEY", "TAVILY_API_KEY"] });
		assert.equal(preview.defaults.keys, false);
		assert.ok(!JSON.stringify(preview).includes("SECRET"));
	});
});

describe("the import", () => {
	it("brings sessions, jobs and the graph into an empty app, verbatim and readable", () => {
		const source = makeSource();
		const before = treeHash(source.userData);
		const events: string[] = [];
		const off = subscribe((event) => events.push(event.type));
		let result: ImportResult;
		try {
			result = runImport(source.userData, ALL);
		} finally {
			off();
		}
		assert.deepEqual(result.chats, { imported: 2, existing: 0, unsupported: 0 });
		assert.deepEqual(result.jobs, { imported: 3, settled: 0 });
		assert.ok(result.skipped.some((item) => item.what === "2 bakgrunnsjobber"), "jobs without their session stay behind, and the receipt says so");
		assert.equal(result.graph.propositions, goldenNodeIds.size);
		assert.equal(result.graph.chains, goldenChainKeys.size);
		assert.equal(result.graph.nodeLines, 298);
		assert.equal(result.graph.chainLines, 173);
		assert.equal(result.graph.sources, 4);
		assert.equal(result.graph.corruptLines, 0);
		assert.equal(result.graph.renderSettings, true);
		assert.equal(result.settings.outcome, "copied");
		assert.equal(result.backupDir, null, "an empty app has nothing to back up");

		for (const id of [TEACH, "chat_mv293wv5_10656952"]) {
			assert.deepEqual(fs.readFileSync(path.join(TARGET, "chats", `${id}.json`)), fs.readFileSync(path.join(source.data, "chats", `${id}.json`)), "sessions are copied byte for byte");
		}
		assert.equal(stores.chatStore.listChats().length, 2);
		assert.equal(stores.jobStore.listJobs(TEACH).length, 3);
		const graph = getGraph(stores.graphStore);
		assert.equal(graph.nodes.length, goldenNodeIds.size);
		assert.equal(graph.chains.length, goldenChainKeys.size);
		const snapshot = graphView();
		assert.ok(snapshot.nodes.every((node) => snapshot.positions?.[node.id] !== undefined), "every node on the canvas has a position");
		assert.deepEqual(fs.readdirSync(TARGET).filter((name) => name.includes(".tmp-")), []);
		assert.deepEqual(fs.readdirSync(path.join(TARGET, "graph")).filter((name) => name.includes(".tmp-")), []);

		assert.ok(events.includes("chats-changed") && events.includes("jobs-changed") && events.includes("sources-changed") && events.includes("activity-changed"));
		assert.equal(treeHash(source.userData), before, "the source folder is never modified");
	});

	it("is idempotent: a second import from the same folder adds nothing", () => {
		const source = makeSource();
		runImport(source.userData, ALL);
		const after = treeHash(TARGET);
		const again = runImport(source.userData, ALL);
		assert.deepEqual(again.chats, { imported: 0, existing: 2, unsupported: 0 });
		assert.deepEqual(again.jobs, { imported: 0, settled: 0 });
		assert.deepEqual(
			[again.graph.propositions, again.graph.nodeLines, again.graph.chains, again.graph.chainLines, again.graph.coverage, again.graph.checkpoints, again.graph.sources, again.graph.positions],
			[0, 0, 0, 0, 0, 0, 0, 0],
		);
		assert.equal(again.settings.outcome, "unchanged");
		assert.equal(again.backupDir, null, "nothing written, so no backup folder");
		assert.equal(treeHash(TARGET), after, "the app's data is byte-identical after the second run");
		const preview = previewImport(source.userData);
		assert.deepEqual([preview.chats.new, preview.jobs.new, preview.graph.propositions.new, preview.graph.chains.new, preview.graph.sources.new], [0, 0, 0, 0, 0]);
	});

	it("never overwrites an existing session, setting or key, and backs up first", () => {
		const source = makeSource();
		fs.writeFileSync(path.join(source.userData, "auth.json"), JSON.stringify({ OPENAI_API_KEY: SECRET, TAVILY_API_KEY: TAVILY_SECRET, CUSTOM_OPENAI_API_KEY: "custom-SECRET-1" }));
		// The target already has: a session with the same id, its own settings, its own OpenAI key, a graph.
		fs.mkdirSync(path.join(TARGET, "chats"), { recursive: true });
		const own = { id: TEACH, title: "Min egen versjon", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", messages: [] };
		fs.writeFileSync(path.join(TARGET, "chats", `${TEACH}.json`), JSON.stringify(own));
		stores.settingsStore.writeSettings({ version: 1, appearance: { mode: "dark" } });
		const ownSettings = fs.readFileSync(path.join(TARGET, "settings.json"), "utf-8");
		fs.writeFileSync(TARGET_AUTH, JSON.stringify({ OPENAI_API_KEY: "sk-target-own-key-000000000000" }), { mode: 0o600 });
		stores.graphStore.appendNode({ id: "prop_mine", name: "Min", statement: "Min egen påstand.", aliases: [], createdAt: "2026-01-01T00:00:00.000Z", provenance: [] });
		const ownNodes = fs.readFileSync(path.join(TARGET, "graph", "nodes.jsonl"), "utf-8");

		const result = runImport(source.userData, ALL);

		assert.deepEqual(result.chats, { imported: 1, existing: 1, unsupported: 0 });
		assert.equal(stores.chatStore.getChat(TEACH)!.title, "Min egen versjon");
		assert.equal(stores.chatStore.getChat(TEACH)!.messages.length, 0);

		const settings = stores.settingsStore.readSettings()!;
		assert.equal(settings.appearance?.mode, "dark", "the learner's own choice stands");
		assert.equal(result.settings.outcome, "merged");
		assert.ok(result.settings.sections.includes("models") && !result.settings.sections.includes("appearance"));
		assert.ok(settings.models, "sections the app lacked are filled in");

		const auth = JSON.parse(fs.readFileSync(TARGET_AUTH, "utf-8")) as Record<string, string>;
		assert.equal(auth.OPENAI_API_KEY, "sk-target-own-key-000000000000");
		assert.equal(auth.TAVILY_API_KEY, TAVILY_SECRET);
		assert.equal(auth.CUSTOM_OPENAI_API_KEY, undefined, "the custom endpoint's credential is not importable");
		assert.equal(fs.statSync(TARGET_AUTH).mode & 0o777, 0o600);
		assert.deepEqual(result.keys, { imported: 1, variables: ["TAVILY_API_KEY"] });
		assert.ok(!JSON.stringify(result).includes("SECRET"), "key values never appear in the result");

		assert.ok(fs.readFileSync(path.join(TARGET, "graph", "nodes.jsonl"), "utf-8").startsWith(ownNodes), "existing ledger lines keep their place");
		assert.equal(getGraph(stores.graphStore).nodes.length, goldenNodeIds.size + 1);

		assert.ok(result.backupDir?.startsWith(path.join(TARGET, "backups", "import-")));
		assert.equal(fs.readFileSync(path.join(result.backupDir!, "settings.json"), "utf-8"), ownSettings);
		assert.equal(fs.readFileSync(path.join(result.backupDir!, "graph", "nodes.jsonl"), "utf-8"), ownNodes);
		assert.ok(result.skipped.some((item) => item.reason.includes("ikke overskrevet")));
	});

	it("merges ledgers additively and skips corrupt lines", () => {
		const first = makeSource();
		runImport(first.userData, DATA_ONLY);
		const second = makeSource();
		const extra = { id: "prop_extra", name: "Ekstra", statement: "En ny påstand.", aliases: [], createdAt: "2026-02-02T00:00:00.000Z", provenance: [{ chatId: TEACH, messageId: "m1" }] };
		fs.appendFileSync(
			path.join(second.data, "graph", "nodes.jsonl"),
			`{"id":"torn line\n${JSON.stringify({ id: "prop_bad_shape", name: 7 })}\n${JSON.stringify(extra)}\n${JSON.stringify(extra)}\n`,
		);
		const preview = previewImport(second.userData);
		assert.deepEqual(preview.graph.propositions, { total: goldenNodeIds.size + 1, new: 1 });
		assert.ok(preview.notes.some((note) => note.includes("2 skadde linjer")));
		const result = runImport(second.userData, DATA_ONLY);
		assert.equal(result.graph.propositions, 1);
		assert.equal(result.graph.nodeLines, 1, "the repeated line lands once");
		assert.equal(result.graph.chainLines, 0);
		assert.equal(result.graph.corruptLines, 2);
		const nodes = stores.graphStore.readNodes();
		assert.equal(nodes.length, 299);
		assert.equal(nodes.at(-1)!.id, "prop_extra");
		assert.ok(graphView().positions?.prop_extra, "the new node settled into the layout");
	});

	it("imports the graph without sessions safely, and coverage only together with its session", () => {
		const source = makeSource();
		// The fixture's coverage rows belong to sessions that are not in it; give the teach session one.
		fs.appendFileSync(path.join(source.data, "graph", "coverage.jsonl"), `${JSON.stringify({ chatId: TEACH, fp: "f".repeat(64), tokens: 12, foldedAt: "2026-10-10T10:00:00.000Z" })}\n`);
		const graphOnly = runImport(source.userData, { ...DATA_ONLY, chats: false });
		assert.equal(graphOnly.chats.imported, 0);
		assert.equal(graphOnly.graph.propositions, goldenNodeIds.size);
		assert.equal(graphOnly.graph.coverage, 0, "no session here, so no coverage claims about it");
		assert.ok(stores.graphStore.readCheckpoints().every((checkpoint) => checkpoint.chatId.startsWith("src_")), "only notes checkpoints came along");
		assert.ok(graphOnly.skipped.some((item) => item.what.startsWith("Øktnavn")));
		const snapshot = graphView();
		assert.ok(snapshot.nodes.length > 0);
		assert.deepEqual(Object.keys(snapshot.sessions), [], "missing sessions are simply unnamed");

		const withChats = runImport(source.userData, DATA_ONLY);
		assert.equal(withChats.chats.imported, 2);
		assert.equal(withChats.graph.propositions, 0);
		assert.equal(withChats.graph.coverage, 1, "coverage follows once its session exists; rows for absent sessions never do");
		assert.deepEqual(stores.graphStore.readCoverage().map((entry) => entry.chatId), [TEACH]);
	});

	it("refuses a newer graph format and skips sessions it cannot read", () => {
		const source = makeSource();
		fs.writeFileSync(path.join(source.data, "graph", "format.json"), JSON.stringify({ version: 99 }));
		const chats = path.join(source.data, "chats");
		const base = { title: "x", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
		fs.writeFileSync(path.join(chats, "chat_newer.json"), JSON.stringify({ ...base, id: "chat_newer", version: 99, messages: [] }));
		fs.writeFileSync(path.join(chats, "chat_parts.json"), JSON.stringify({ ...base, id: "chat_parts", messages: [{ id: "m", role: "user", parts: [{ type: "text", text: "hei" }] }] }));
		fs.writeFileSync(path.join(chats, "chat_corrupt.json"), "{ not json");

		const preview = previewImport(source.userData);
		assert.match(preview.graph.blocked ?? "", /nyere format \(versjon 99\)/);
		assert.equal(preview.defaults.graph, false);
		assert.deepEqual([preview.chats.total, preview.chats.new, preview.chats.unsupported], [5, 2, 3]);
		assert.equal(preview.notes.length, 4);

		const error = refusal(() => runImport(source.userData, DATA_ONLY));
		assert.deepEqual([error.status, error.code], [422, "source_format_newer"]);
		assert.equal(fs.existsSync(TARGET), false, "a refused import writes nothing");

		const result = runImport(source.userData, { ...DATA_ONLY, graph: false });
		assert.deepEqual(result.chats, { imported: 2, existing: 0, unsupported: 3 });
		assert.deepEqual(fs.readdirSync(path.join(TARGET, "chats")).sort(), [`${TEACH}.json`, "chat_mv293wv5_10656952.json"].sort());
		assert.equal(fs.existsSync(path.join(TARGET, "graph")), false);
		assert.equal(result.skipped.filter((item) => /økt/.test(item.what)).length, 3);
	});

	it("closes stale running jobs instead of resuming them", () => {
		const source = makeSource();
		const base = { kind: "research", chatId: TEACH, activity: "web_search", createdAt: "2026-10-10T10:00:00.000Z", updatedAt: "2026-10-10T10:00:00.000Z" };
		const jobs = path.join(source.data, "jobs");
		fs.writeFileSync(path.join(jobs, "job_running.json"), JSON.stringify({ ...base, id: "job_running", toolCallId: "call_a", status: "running", input: { question: "q" } }));
		fs.writeFileSync(path.join(jobs, "job_legacy.json"), JSON.stringify({ ...base, id: "job_legacy", toolCallId: "call_b", status: "running", result: { brief: "Funn", sources: [{ title: "t", url: "https://example.com" }] } }));
		fs.writeFileSync(path.join(jobs, "job_pending.json"), JSON.stringify({ ...base, id: "job_pending", toolCallId: "call_c", status: "done", result: { brief: "Funn", sources: [] }, delivery: { kind: "result", status: "pending" } }));
		fs.writeFileSync(path.join(jobs, "job_orphan.json"), JSON.stringify({ ...base, id: "job_orphan", chatId: "chat_gone", toolCallId: "call_d", status: "running" }));

		const result = runImport(source.userData, DATA_ONLY);
		assert.deepEqual(result.jobs, { imported: 6, settled: 3 });
		assert.equal(stores.jobStore.getJob("job_orphan"), null, "a job without its session stays behind");

		const check = () => {
			const running = stores.jobStore.getJob("job_running")!;
			assert.equal(running.status, "error");
			assert.match(running.error ?? "", /ikke ferdig/);
			assert.equal(running.delivery, undefined);
			const legacy = stores.jobStore.getJob("job_legacy")!;
			assert.deepEqual([legacy.status, legacy.delivery], ["done", undefined]);
			assert.ok(legacy.result, "the saved result stays on the record");
			const pending = stores.jobStore.getJob("job_pending")!;
			assert.deepEqual([pending.status, pending.delivery], ["done", undefined]);
			assert.ok(stores.jobStore.listJobs(TEACH).every((job) => job.status !== "running"));
		};
		check();
		// The app's own recovery sweep finds nothing to resume or deliver.
		const pipeline = (globalThis as { __lhWakePipeline?: { lastSweepAt: number } }).__lhWakePipeline;
		if (pipeline) pipeline.lastSweepAt = 0;
		const messagesBefore = stores.chatStore.getChat(TEACH)!.messages.length;
		recoverStaleJobs();
		check();
		assert.equal(stores.chatStore.getChat(TEACH)!.messages.length, messagesBefore);
	});

	it("copies only prompt overrides the app lacks", () => {
		const source = makeSource();
		const prompts = path.join(source.data, "prompts");
		fs.mkdirSync(path.join(prompts, "teacher"), { recursive: true });
		fs.writeFileSync(path.join(prompts, "system-prompt.md"), "kildens base");
		fs.writeFileSync(path.join(prompts, "teacher", "10-style.md"), "kildens stil");
		fs.writeFileSync(path.join(prompts, "teacher", "notes.txt"), "ikke en instruks");
		fs.writeFileSync(path.join(prompts, "evil.md"), "utenfor speilet");
		promptOverrides.writeOverride("system-prompt.md", "min egen base");

		assert.deepEqual(previewImport(source.userData).prompts, { total: 2, new: 1 });
		const result = runImport(source.userData, { chats: false, graph: false, settings: false, keys: false, prompts: true });
		assert.equal(result.prompts.imported, 1);
		assert.equal(promptOverrides.readOverride("system-prompt.md"), "min egen base");
		assert.equal(promptOverrides.readOverride("teacher/10-style.md"), "kildens stil");
		assert.deepEqual(promptOverrides.listOverrides(), ["system-prompt.md", "teacher/10-style.md"]);
		assert.ok(result.skipped.some((item) => item.what === "Aktivering av systeminstruksene"));
	});

	it("merges source organization without touching the app's own folders and placements", () => {
		const source = makeSource();
		const incoming = {
			version: 1,
			folders: [{ id: "folder_theirs", name: "Fra den andre", parentId: null, createdAt: "2026-01-01T00:00:00.000Z" }],
			placements: { src_shared: { folderId: "folder_theirs", name: "Deres navn" }, src_new: { folderId: "folder_theirs" } },
		};
		fs.writeFileSync(path.join(source.data, "graph", "source-organization.json"), JSON.stringify(incoming));
		stores.sourceOrganizationStore.write({
			version: 1,
			folders: [{ id: "folder_mine", name: "Mine", parentId: null, createdAt: "2026-01-01T00:00:00.000Z" }],
			placements: { src_shared: { folderId: "folder_mine", name: "Mitt navn" } },
		});
		const result = runImport(source.userData, { ...DATA_ONLY, chats: false });
		assert.equal(result.graph.organization, "merged");
		const merged = stores.sourceOrganizationStore.read();
		assert.deepEqual(merged.folders.map((folder) => folder.id), ["folder_mine", "folder_theirs"]);
		assert.deepEqual(merged.placements.src_shared, { folderId: "folder_mine", name: "Mitt navn" });
		assert.deepEqual(merged.placements.src_new, { folderId: "folder_theirs" });
		assert.equal(runImport(source.userData, { ...DATA_ONLY, chats: false }).graph.organization, "unchanged");

		// An unreadable source file is reported, never written.
		const broken = makeSource();
		fs.writeFileSync(path.join(broken.data, "graph", "source-organization.json"), JSON.stringify({ version: 7 }));
		const skipped = runImport(broken.userData, { ...DATA_ONLY, chats: false });
		assert.equal(skipped.graph.organization, "skipped");
		assert.deepEqual(stores.sourceOrganizationStore.read(), merged);
	});

	it("refuses while a turn or a background worker is running, and when nothing is selected", () => {
		const source = makeSource();
		runImport(source.userData, DATA_ONLY);
		const more = makeSource();
		fs.appendFileSync(path.join(more.data, "graph", "nodes.jsonl"), `${JSON.stringify({ id: "prop_later", name: "Senere", statement: "Senere.", aliases: [], createdAt: "2026-03-03T00:00:00.000Z", provenance: [] })}\n`);
		const snapshot = treeHash(TARGET);

		assert.ok(beginTurn(TEACH));
		try {
			const error = refusal(() => runImport(more.userData, DATA_ONLY));
			assert.deepEqual([error.status, error.code], [409, "work_running"]);
			assert.match(error.message, /Prøv igjen/);
		} finally {
			endTurn(TEACH);
		}
		const liveJob = stores.jobStore.listJobs(TEACH)[0]!.id;
		registerJobAbort(liveJob, new AbortController());
		try {
			assert.equal(refusal(() => runImport(more.userData, DATA_ONLY)).code, "work_running");
		} finally {
			unregisterJobAbort(liveJob);
		}
		assert.equal(treeHash(TARGET), snapshot, "a refused import changes nothing");

		const nothing = refusal(() => runImport(more.userData, { chats: false }));
		assert.deepEqual([nothing.status, nothing.code], [400, "nothing_selected"]);
		assert.equal(runImport(more.userData, DATA_ONLY).graph.propositions, 1, "and it goes through once the work is done");
	});
});

describe("/api/import/legacy", () => {
	it("GET lists candidates with their previews", async () => {
		const source = makeSource();
		importSeams.userDataRoots = [source.userData];
		const res = await legacyRoute.GET();
		assert.equal(res.status, 200);
		const body = (await res.json()) as { candidates: { path: string; label: string; current: boolean; preview?: ImportPreview }[] };
		assert.equal(body.candidates.length, 1);
		assert.deepEqual(Object.keys(body.candidates[0]!).sort(), ["current", "label", "path", "preview"]);
		assert.equal(body.candidates[0]!.preview?.graph.propositions.total, goldenNodeIds.size);
	});

	it("POST preview returns the preview, or a Norwegian error with a code", async () => {
		const source = makeSource();
		const ok = await previewRoute.POST(post("http://lh/api/import/legacy/preview", { path: source.userData }));
		assert.equal(ok.status, 200);
		const preview = (await ok.json()) as ImportPreview;
		assert.equal(preview.dataDir, source.data);
		assert.equal(preview.chats.new, 2);

		const missing = await previewRoute.POST(post("http://lh/api/import/legacy/preview", { path: path.join(TMP, "finnes-ikke") }));
		assert.equal(missing.status, 404);
		assert.deepEqual(Object.keys((await missing.json()) as object).sort(), ["code", "error"]);

		const garbage = await previewRoute.POST(post("http://lh/api/import/legacy/preview", "{ not json"));
		assert.equal(garbage.status, 400);
		const body = (await garbage.json()) as { error: string; code: string };
		assert.equal(body.code, "invalid_path");
		assert.match(body.error, /stien/i);
	});

	it("POST runs the import; a missing include imports nothing and says so", async () => {
		const source = makeSource();
		fs.writeFileSync(path.join(source.userData, "auth.json"), JSON.stringify({ OPENAI_API_KEY: SECRET }));
		const none = await legacyRoute.POST(post("http://lh/api/import/legacy", { path: source.userData }));
		assert.equal(none.status, 400);
		assert.equal(((await none.json()) as { code: string }).code, "nothing_selected");
		assert.equal(fs.existsSync(TARGET), false);

		const res = await legacyRoute.POST(post("http://lh/api/import/legacy", { path: source.userData, include: { chats: true, graph: true, keys: "yes" } }));
		assert.equal(res.status, 200);
		const text = await res.text();
		assert.ok(!text.includes("SECRET"));
		const result = JSON.parse(text) as ImportResult;
		assert.equal(result.chats.imported, 2);
		assert.equal(result.graph.propositions, goldenNodeIds.size);
		assert.equal(result.keys.imported, 0, "a non-boolean flag never widens the import");
		assert.equal(fs.existsSync(TARGET_AUTH), false);
		assert.equal(typeof result.graphRevision, "number");
		assert.ok(Array.isArray(result.skipped));

		const same = await legacyRoute.POST(post("http://lh/api/import/legacy", { path: TARGET, include: ALL }));
		assert.equal(same.status, 409);
		assert.equal(((await same.json()) as { code: string }).code, "same_directory");
	});
});
