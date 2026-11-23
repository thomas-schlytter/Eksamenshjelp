/**
 * THE KNOWLEDGE MAP'S GROUPING (fase 8): fag from provenance, tema from the
 * cached background classification, clusters = (fag, tema), and the layout
 * that keeps a topic tight and a course together.
 *
 *   - pure rules (core/knowledge-map.ts): course from a source path, course
 *     of a node, the node's group, cluster building + imp attachment,
 *     grouped seeds;
 *   - forces (core/layout.ts): the course pull and the cross-cluster link
 *     damping;
 *   - the server flow (src/server/knowledge-map.ts) under an isolated
 *     LH_DATA_DIR: grouping over real ledgers, the one-time re-layout, and
 *     the classification job with a faux model.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, type FauxResponseStep, type ToolCall } from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";
import type { Course } from "../src/core/courses.ts";
import type { GraphChain, GraphNode } from "../src/core/contracts.ts";
import {
	OTHER_TOPIC,
	buildMapClusters,
	courseForSourcePath,
	courseOfNode,
	groupedSeeds,
	mapClusterId,
	mapClusterLabel,
	nodeGroup,
	topicSignature,
	type MapCourse,
	type MapGroup,
} from "../src/core/knowledge-map.ts";
import { createGraphSimulation } from "../src/core/layout.ts";

// ── the seam, BEFORE any config-loading import ──────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-knowledge-map-"));
process.env.LH_DATA_DIR = path.join(TMP, "data");
process.env.LH_AUTH_FILE = path.join(TMP, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");

const km = await import("../src/server/knowledge-map.ts");
const { graphStore } = await import("../src/store/graph.ts");
const { subscribe } = await import("../src/core/events.ts");
const { getGraph } = await import("../src/core/graph.ts");
const { LEDGER_FILES, POSITIONS_FILE, SOURCES_FILE } = await import("../config.ts");
const { KNOWLEDGE_MAP_FILE } = await import("../src/store/knowledge-map.ts");

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const COURSES: MapCourse[] = [
	{
		code: "TMA4400",
		name: "Matematikk 1",
		topics: [],
		sourcePaths: ["/home/student/TMA4400-eksamener"],
	},
	{
		code: "TTK4100",
		name: "Kybernetikk, introduksjon",
		topics: [
			{ id: "pid", title: "PID-regulator" },
			{ id: "modell", title: "Modellering" },
		],
		sourcePaths: ["/home/student/TTK4100-eksamener"],
	},
];

describe("courseForSourcePath", () => {
	it("matches an absolute path under a course folder", () => {
		assert.equal(courseForSourcePath("/home/student/TTK4100-eksamener/2021/eksamen.pdf", COURSES), "TTK4100");
	});
	it("matches an import-relative path whose first segment is the course folder's name", () => {
		assert.equal(courseForSourcePath("TTK4100-eksamener/2019_LF_TTK4100.pdf", COURSES), "TTK4100");
		assert.equal(courseForSourcePath("TMA4400-eksamener", COURSES), "TMA4400");
	});
	it("matches a sub-folder imported on its own when it exists inside the course folder", () => {
		const exists = (p: string) => p === "/home/student/TTK4100-eksamener/Kyb-intro";
		assert.equal(courseForSourcePath("Kyb-intro/øvinger/Øving 3.pdf", COURSES, exists), "TTK4100");
		// A top folder the course does not have is no match.
		assert.equal(courseForSourcePath("Annet-fag/øving.pdf", COURSES, exists), null);
	});
	it("falls back to the course code inside a path segment, case-insensitively", () => {
		assert.equal(courseForSourcePath("EKSAMENER/tma4400_2025h.pdf", COURSES), "TMA4400");
		// A longer code containing the code is not a match.
		assert.equal(courseForSourcePath("TMA44001/notater.md", COURSES), null);
	});
	it("returns null for a path with no course hint", () => {
		assert.equal(courseForSourcePath("bokm.pdf", COURSES), null);
		assert.equal(courseForSourcePath("", COURSES), null);
	});
});

describe("courseOfNode / nodeGroup / labels", () => {
	const course = (code: string | null) => (id: string) => (id === "chat_course" ? code : id === "src_ttk" ? "TTK4100" : null);
	it("takes the first provenance point that resolves to a course", () => {
		const node = { provenance: [{ chatId: "chat_free", messageId: "" }, { chatId: "src_ttk", messageId: "" }] };
		assert.equal(courseOfNode(node, course(null)), "TTK4100", "the birth session is course-less, a later import is not");
		assert.equal(courseOfNode({ provenance: [{ chatId: "chat_course", messageId: "m" }] }, course("TMA4400")), "TMA4400");
		assert.equal(courseOfNode({ provenance: [] }, course(null)), null);
	});
	it("maps a course and a cached topic to a group", () => {
		const ttk = COURSES[1]!;
		assert.deepEqual(nodeGroup(null, "pid"), { course: null, topic: null }, "«Uten fag» never has a topic");
		assert.deepEqual(nodeGroup(COURSES[0]!, "pid"), { course: "TMA4400", topic: null }, "a course without topics groups on the course");
		assert.deepEqual(nodeGroup(ttk, undefined), { course: "TTK4100", topic: null }, "not classified yet → the course alone");
		assert.deepEqual(nodeGroup(ttk, null), { course: "TTK4100", topic: OTHER_TOPIC }, "classified as no topic → «Annet»");
		assert.deepEqual(nodeGroup(ttk, "gone"), { course: "TTK4100", topic: OTHER_TOPIC }, "a removed topic → «Annet»");
		assert.deepEqual(nodeGroup(ttk, "pid"), { course: "TTK4100", topic: "pid" });
	});
	it("labels: topic title, «Annet», course name, «Uten fag»", () => {
		assert.equal(mapClusterLabel({ course: "TTK4100", topic: "pid" }, COURSES), "PID-regulator");
		assert.equal(mapClusterLabel({ course: "TTK4100", topic: OTHER_TOPIC }, COURSES), "Annet");
		assert.equal(mapClusterLabel({ course: "TMA4400", topic: null }, COURSES), "Matematikk 1");
		assert.equal(mapClusterLabel({ course: null, topic: null }, COURSES), "Uten fag");
	});
	it("the topic signature ignores order but not membership", () => {
		assert.equal(topicSignature({ topics: [{ id: "b", title: "" }, { id: "a", title: "" }] }), "a|b");
		assert.notEqual(topicSignature(COURSES[1]!), topicSignature({ topics: [{ id: "pid", title: "" }] }));
	});
});

describe("buildMapClusters", () => {
	const groups: Record<string, MapGroup> = {
		a: { course: "TTK4100", topic: "pid" },
		b: { course: "TTK4100", topic: "pid" },
		c: { course: "TTK4100", topic: "modell" },
		d: { course: null, topic: null },
		e: { course: "TMA4400", topic: null },
		f: { course: "TTK4100", topic: OTHER_TOPIC },
	};
	const nodes = Object.keys(groups).map((id) => ({ id }));
	const chain = (id: string, premises: string[], conclusion: string) => ({ id, premises, conclusion });

	it("one cluster per (fag, tema), course order then topic order, «Uten fag» last", () => {
		const clusters = buildMapClusters(nodes, [], (id) => groups[id]!, COURSES);
		assert.deepEqual(
			clusters.map((c) => [c.id, c.label, c.members]),
			[
				["fag:TMA4400/*", "Matematikk 1", ["e"]],
				["fag:TTK4100/pid", "PID-regulator", ["a", "b"]],
				["fag:TTK4100/modell", "Modellering", ["c"]],
				["fag:TTK4100/annet", "Annet", ["f"]],
				["fag:-/*", "Uten fag", ["d"]],
			],
		);
		assert.equal(mapClusterId({ course: "TTK4100", topic: "pid" }), "fag:TTK4100/pid");
	});

	it("an implication node joins its premises' majority cluster; ties go to the conclusion's", () => {
		const clusters = buildMapClusters(
			nodes,
			[
				chain("arg_major", ["a", "b", "c"], "d"), // 2× pid vs 1× modell → pid
				chain("arg_tie", ["a", "c"], "c"), // pid vs modell tie, conclusion in modell → modell
				chain("arg_single", ["a"], "b"), // single premise: a direct arrow, no imp node
				chain("arg_dangling", ["a", "zzz"], "b"), // a missing member: no imp node
			],
			(id) => groups[id]!,
			COURSES,
		);
		const of = (id: string) => clusters.find((c) => c.members.includes(id))?.id;
		assert.equal(of("arg_major"), "fag:TTK4100/pid");
		assert.equal(of("arg_tie"), "fag:TTK4100/modell");
		assert.equal(of("arg_single"), undefined);
		assert.equal(of("arg_dangling"), undefined);
	});

	it("a repeated node line counts once", () => {
		const clusters = buildMapClusters([{ id: "a" }, { id: "a" }], [], (id) => groups[id]!, COURSES);
		assert.deepEqual(clusters[0]!.members, ["a"]);
	});
});

describe("groupedSeeds", () => {
	const clusters = [
		{ id: "fag:A/1", course: "A", members: ["a1", "a2", "a3"] },
		{ id: "fag:A/2", course: "A", members: ["b1", "b2"] },
		{ id: "fag:B/*", course: "B", members: ["c1", "c2", "c3"] },
	];
	const all = new Set(clusters.flatMap((c) => c.members));
	const centroid = (seeds: Map<string, { x: number; y: number }>, ids: string[]) => ({
		x: ids.reduce((s, id) => s + seeds.get(id)!.x, 0) / ids.length,
		y: ids.reduce((s, id) => s + seeds.get(id)!.y, 0) / ids.length,
	});
	const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

	it("a fresh map seeds every node, topics apart and each course's topics nearer each other than other courses", () => {
		const seeds = groupedSeeds(clusters, new Map(), all, 40);
		assert.equal(seeds.size, all.size);
		const a1 = centroid(seeds, clusters[0]!.members);
		const a2 = centroid(seeds, clusters[1]!.members);
		const b = centroid(seeds, clusters[2]!.members);
		assert.ok(dist(a1, a2) > 20, "two topics of one course do not share a spot");
		assert.ok(dist(a1, a2) < dist(a1, b) && dist(a1, a2) < dist(a2, b), "a course's topics sit together");
		assert.deepEqual(groupedSeeds(clusters, new Map(), all, 40), seeds, "deterministic");
	});

	it("a re-seeded node lands inside its cluster's anchored members; anchored nodes get no seed", () => {
		const previous = new Map([
			["a1", { x: 1000, y: 1000 }],
			["a2", { x: 1010, y: 1000 }],
			["a3", { x: 0, y: 0 }],
			["b1", { x: 1200, y: 900 }],
			["b2", { x: 1210, y: 900 }],
			["c1", { x: -500, y: 0 }],
			["c2", { x: -510, y: 0 }],
			["c3", { x: -520, y: 0 }],
		]);
		const seeds = groupedSeeds(clusters, previous, new Set(["a3"]), 40);
		assert.deepEqual([...seeds.keys()], ["a3"]);
		assert.ok(dist(seeds.get("a3")!, { x: 1005, y: 1000 }) < 40, "next to a1/a2, not at its stale spot");
	});

	it("a cluster with no anchored member seeds around its course's previous footprint", () => {
		const previous = new Map([
			["a1", { x: 1000, y: 0 }],
			["a2", { x: 1000, y: 0 }],
			["a3", { x: 1000, y: 0 }],
			["c1", { x: -1000, y: 0 }],
			["c2", { x: -1000, y: 0 }],
			["c3", { x: -1000, y: 0 }],
		]);
		const seeds = groupedSeeds(clusters, previous, new Set(["b1", "b2"]), 40);
		const b = centroid(seeds, ["b1", "b2"]);
		assert.ok(dist(b, { x: 1000, y: 0 }) < dist(b, { x: -1000, y: 0 }), "the new topic seeds by its course, not across the map");
	});
});

describe("layout forces (fase 8)", () => {
	const spreadOf = (nodes: Array<{ x?: number; y?: number }>) => {
		const cx = nodes.reduce((s, n) => s + (n.x ?? 0), 0) / nodes.length;
		const cy = nodes.reduce((s, n) => s + (n.y ?? 0), 0) / nodes.length;
		return nodes.reduce((s, n) => s + Math.hypot((n.x ?? 0) - cx, (n.y ?? 0) - cy), 0) / nodes.length;
	};

	it("the course pull draws a course's members together", () => {
		const run = (strength: number) => {
			const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, x: (i % 2 === 0 ? -1 : 1) * (300 + i * 10), y: i * 7 }));
			const sim = createGraphSimulation(nodes, [], { coursePull: { groups: [{ members: nodes.map((n) => n.id) }], strength } });
			for (let i = 0; i < 200; i++) sim.tick();
			return spreadOf(sim.nodes());
		};
		assert.ok(run(0.2) < run(0) * 0.8, "pulled spread well under the free one");
	});

	it("cross-cluster springs are damped by the scale; springs inside a cluster are not", () => {
		const distance = (scale: number, sameCluster: boolean) => {
			const nodes = [{ id: "a", x: 0, y: 0 }, { id: "b", x: 400, y: 0 }];
			const clusters = sameCluster ? [{ members: ["a", "b"] }] : [{ members: ["a"] }, { members: ["b"] }];
			const sim = createGraphSimulation(nodes, [{ from: "a", to: "b" }], {
				chargeStrength: 0,
				clusterPull: { clusters, strength: 1e-9 },
				interClusterLinkScale: scale,
				alphaDecay: 0.2,
			});
			for (let i = 0; i < 6; i++) sim.tick();
			const [a, b] = sim.nodes();
			return Math.abs((b!.x ?? 0) - (a!.x ?? 0));
		};
		assert.ok(distance(0.1, false) > distance(1, false) + 50, "a damped cross-cluster spring closes the gap more slowly");
		assert.ok(Math.abs(distance(0.1, true) - distance(1, true)) < 1e-6, "inside one cluster the scale does nothing");
	});
});

// ── the server flow ──────────────────────────────────────────────────────────

const node = (id: string, name: string, source: string): GraphNode => ({
	id,
	name,
	statement: `${name} er en påstand.`,
	aliases: [],
	createdAt: "2026-11-01T00:00:00.000Z",
	provenance: [{ chatId: source, messageId: "" }],
});
const chainLine = (id: string, premises: string[], conclusion: string, source: string): GraphChain => ({
	id,
	premises,
	conclusion,
	provenance: [{ chatId: source, messageId: "" }],
	createdAt: "2026-11-01T00:00:00.000Z",
});

/** Course records as the seam returns them (only the fields mapCourses reads). */
const courseRecords = (ttkTopics: Array<{ id: string; title: string }>): Course[] =>
	[
		{ code: "TTK4100", name: "Kybernetikk, introduksjon", topics: ttkTopics, sources: [{ id: "s1", kind: "folder", title: "Eksamener", path: "/home/student/TTK4100-eksamener", auto: false, addedAt: "" }] },
		{ code: "TMA4400", name: "Matematikk 1", topics: [], sources: [{ id: "s2", kind: "folder", title: "Eksamener", path: "/home/student/TMA4400-eksamener", auto: false, addedAt: "" }] },
	] as unknown as Course[];

function fauxEngine(steps: FauxResponseStep[]): PiEngine {
	const faux = createFauxCore({});
	faux.setResponses(steps);
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

function resetLedgers(): void {
	for (const file of [LEDGER_FILES.nodes, LEDGER_FILES.chains, POSITIONS_FILE, SOURCES_FILE, KNOWLEDGE_MAP_FILE]) fs.rmSync(file, { force: true });
	graphStore.upsertSource({ id: "src_ttk", filePath: "TTK4100-eksamener/2021_Eksamen.pdf", importedAt: "2026-11-01T00:00:00.000Z" });
	graphStore.upsertSource({ id: "src_tma", filePath: "TMA4400-eksamener/2024h.pdf", importedAt: "2026-11-01T00:00:00.000Z" });
	graphStore.upsertSource({ id: "src_free", filePath: "bokm.pdf", importedAt: "2026-11-01T00:00:00.000Z" });
	for (const n of [
		node("n_p1", "P-ledd", "src_ttk"),
		node("n_p2", "I-ledd", "src_ttk"),
		node("n_p3", "Overføringsfunksjon", "src_ttk"),
		node("n_m1", "Derivert", "src_tma"),
		node("n_m2", "Integral", "src_tma"),
		node("n_f1", "Ohms lov", "src_free"),
	])
		graphStore.appendNode(n);
	graphStore.appendChain(chainLine("arg_1", ["n_p1", "n_p2"], "n_p3", "src_ttk"));
	graphStore.appendChain(chainLine("arg_2", ["n_m1"], "n_m2", "src_tma"));
}

describe("the knowledge map on the server", () => {
	beforeEach(() => {
		km.knowledgeMapSeams.engine = () => undefined;
		km.knowledgeMapSeams.exists = () => false;
		km.knowledgeMapSeams.mapShown = () => true;
		km.knowledgeMapSeams.courses = () => courseRecords([{ id: "pid", title: "PID-regulator" }, { id: "modell", title: "Modellering" }]);
		// The job's single-flight state lives on globalThis (one per process).
		(globalThis as { __lhMapClassify?: unknown }).__lhMapClassify = undefined;
		resetLedgers();
	});

	it("groups by course from provenance; unclassified topic courses group on the course", () => {
		const grouping = km.resolveMapGrouping(getGraph(graphStore), { topics: {}, layout: {} });
		assert.deepEqual(
			grouping.clusters.map((c) => [c.id, c.members]),
			[
				["fag:TMA4400/*", ["n_m1", "n_m2"]],
				["fag:TTK4100/*", ["arg_1", "n_p1", "n_p2", "n_p3"]],
				["fag:-/*", ["n_f1"]],
			],
		);
		assert.deepEqual(grouping.unclassified.map((u) => u.node.id).sort(), ["n_p1", "n_p2", "n_p3"], "only the course with topics waits for the model");
		assert.deepEqual(km.snapshotMap(grouping).courses, [
			{ code: "TMA4400", name: "Matematikk 1" },
			{ code: "TTK4100", name: "Kybernetikk, introduksjon" },
		]);
	});

	it("lays the map out once, then reads without settling until a group changes", () => {
		km.prepareKnowledgeMap();
		const positions = graphStore.readPositions();
		assert.deepEqual(Object.keys(positions).sort(), ["arg_1", "n_f1", "n_m1", "n_m2", "n_p1", "n_p2", "n_p3"]);
		const record = km.knowledgeMapSeams.store.read();
		assert.equal(record.layout.n_p1, "fag:TTK4100/*", "the group each node was laid out in is recorded");
		const mtime = fs.statSync(POSITIONS_FILE).mtimeMs;
		const graph = getGraph(graphStore);
		assert.equal(km.ensureMapLayout(graph, km.resolveMapGrouping(graph, record).clusters), false, "nothing moved groups → no settle");
		assert.equal(fs.statSync(POSITIONS_FILE).mtimeMs, mtime);
	});

	it("classifies a course's nodes once with the cheap model, caches it, announces map-changed, and regroups", async () => {
		let prompt = "";
		km.knowledgeMapSeams.engine = () =>
			fauxEngine([
				(context) => {
					prompt = JSON.stringify(context.messages);
					return fauxAssistantMessage(
						[
							fauxToolCall(
								"submit_topic_assignments",
								{
									assignments: [
										{ id: "n_p1", topic: "pid" },
										{ id: "n_p2", topic: "pid" },
										{ id: "n_p3", topic: "none" },
									],
								} as ToolCall["arguments"],
								{ id: "submit-1" },
							),
						],
						{ stopReason: "toolUse" },
					);
				},
			]);
		const events: string[] = [];
		const off = subscribe((e) => {
			if (e.type === "map-changed") events.push(e.type);
		});
		const grouping = km.resolveMapGrouping(getGraph(graphStore), km.knowledgeMapSeams.store.read());
		const job = km.scheduleTopicClassification(grouping.unclassified);
		assert.ok(job, "the job starts");
		assert.equal(km.scheduleTopicClassification(grouping.unclassified), null, "single-flight: a second call while running is a no-op");
		await job;
		off();
		assert.ok(prompt.includes("[pid] PID-regulator") && prompt.includes("[n_p1] P-ledd"), "the prompt lists the topics and the propositions");
		assert.deepEqual(events, ["map-changed"]);
		const record = km.knowledgeMapSeams.store.read();
		assert.equal(record.topics.n_p1!.topic, "pid");
		assert.equal(record.topics.n_p3!.topic, null, "«none» is cached as no topic");

		const regrouped = km.resolveMapGrouping(getGraph(graphStore), record);
		assert.deepEqual(regrouped.unclassified, [], "classified once: nothing waits any more");
		const of = (id: string) => regrouped.clusters.find((c) => c.members.includes(id))?.label;
		assert.equal(of("n_p1"), "PID-regulator");
		assert.equal(of("n_p3"), "Annet");
		assert.equal(of("arg_1"), "PID-regulator", "the junction follows its premises");
	});

	it("a changed topic list re-classifies the course (the cached signature no longer matches)", () => {
		const record = { topics: { n_p1: { course: "TTK4100", topic: "pid", sig: "modell|pid" } }, layout: {} };
		let grouping = km.resolveMapGrouping(getGraph(graphStore), record);
		assert.ok(!grouping.unclassified.some((u) => u.node.id === "n_p1"));
		km.knowledgeMapSeams.courses = () => courseRecords([{ id: "pid", title: "PID-regulator" }]);
		grouping = km.resolveMapGrouping(getGraph(graphStore), record);
		assert.ok(grouping.unclassified.some((u) => u.node.id === "n_p1"));
	});

	it("a map that is switched off (extraction or rendering) never starts the job", () => {
		let asked = 0;
		km.knowledgeMapSeams.engine = () => {
			asked++;
			return undefined;
		};
		km.knowledgeMapSeams.mapShown = () => false;
		km.prepareKnowledgeMap();
		assert.equal(asked, 0, "the engine is not even resolved");
		km.knowledgeMapSeams.mapShown = () => true;
		km.prepareKnowledgeMap();
		assert.equal(asked, 1, "switched on, the job looks for a model");
	});

	it("no model configured: no job, the course grouping stands", () => {
		const grouping = km.resolveMapGrouping(getGraph(graphStore), { topics: {}, layout: {} });
		assert.equal(km.scheduleTopicClassification(grouping.unclassified), null);
	});

	it("readAssignments keeps batch ids only, first answer wins, unknown topics read as none", () => {
		const got = km.readAssignments(COURSES[1]!, [{ id: "a" }, { id: "b" }], [
			{ id: " a ", topic: "pid" },
			{ id: "a", topic: "modell" },
			{ id: "b", topic: "made-up" },
			{ id: "zzz", topic: "pid" },
		]);
		assert.deepEqual([...got], [["a", "pid"], ["b", null]]);
	});
});
