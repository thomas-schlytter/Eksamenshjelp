/**
 * THE KNOWLEDGE MAP'S GROUPING, server side (fase 8). Three jobs:
 *
 *   1. resolveMapGrouping — every node's (fag, tema): the course from
 *      provenance (a chat started from the course, or an imported file
 *      under one of its source folders), the topic from the cached
 *      background classification. Pure rules: core/knowledge-map.ts.
 *   2. ensureMapLayout — nodes whose group changed since they were laid
 *      out (new nodes, a finished classification, a course gaining a
 *      source) re-seed inside their new cluster, in one grouped settle.
 *   3. scheduleTopicClassification — a single-flight background job that
 *      sorts unclassified nodes into their course's topic list with the
 *      cheap model role (the extractor slot, the same engine the course
 *      topic generation uses) and caches the answer, so every node is
 *      classified once. It announces `map-changed` when a round lands.
 *
 * The cache lives in its own file (src/store/knowledge-map.ts); course
 * records are read through the course store, never written.
 */

import * as fs from "node:fs";
import { Type } from "typebox";
import { emit } from "../core/events.ts";
import type { Cluster, GraphNode } from "../core/contracts.ts";
import { deriveView, getGraph, type DerivedGraph } from "../core/graph.ts";
import {
	buildMapClusters,
	courseForSourcePath,
	courseOfNode,
	nodeGroup,
	topicSignature,
	type MapCluster,
	type MapCourse,
	type MapGroup,
} from "../core/knowledge-map.ts";
import { settleGraphLayout } from "../core/layout-settle.ts";
import type { PiEngine } from "../agent/models.ts";
import { runSubmitAgent } from "../agent/subagents/submit-agent.ts";
import { withBgLlmSlot } from "../agent/subagents/bg-llm-semaphore.ts";
import { resolveSettings } from "../core/settings-resolution.ts";
import { courseStore } from "../store/courses.ts";
import { settingsStore } from "../store/settings.ts";
import { knowledgeMapStore, type KnowledgeMapRecord } from "../store/knowledge-map.ts";
import { courseSeams } from "./courses.ts";
import { stores } from "./stores.ts";

/** Injection points (tests swap them). */
export const knowledgeMapSeams: {
	/** The cheap background engine; undefined = no model configured. */
	engine: () => PiEngine | undefined;
	/** Whether a path exists (the «sub-folder imported on its own» rule). */
	exists: (absolutePath: string) => boolean;
	store: { read(): KnowledgeMapRecord; write(record: KnowledgeMapRecord): void };
	/** Course records (read-only). */
	courses: () => ReturnType<typeof courseStore.listCourses>;
	/** Whether the map is on (extraction AND rendering): with either off,
	 *  nobody looks at topic clusters, so the job spends nothing. */
	mapShown: () => boolean;
} = {
	engine: () => courseSeams.topicEngine(),
	mapShown: () => {
		const graph = resolveSettings(settingsStore.readSettings()).graph;
		return graph.enabled && graph.rendering;
	},
	exists: (p) => {
		try {
			return fs.existsSync(p);
		} catch {
			return false;
		}
	},
	store: { read: () => knowledgeMapStore.read(), write: (record) => knowledgeMapStore.write(record) },
	courses: () => courseStore.listCourses(),
};

/** The courses the map groups by, sorted by code. */
export function mapCourses(): MapCourse[] {
	return knowledgeMapSeams
		.courses()
		.map((course) => ({
			code: course.code,
			name: course.name,
			topics: course.topics.map((t) => ({ id: t.id, title: t.title })),
			sourcePaths: course.sources
				.filter((s) => (s.kind === "folder" || s.kind === "file") && typeof s.path === "string" && s.path !== "")
				.map((s) => s.path!),
		}))
		.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

export interface MapGrouping {
	courses: MapCourse[];
	clusters: MapCluster[];
	/** Proposition id → its group. */
	groups: Map<string, MapGroup>;
	/** Propositions whose course has topics but no valid cached topic. */
	unclassified: Array<{ node: GraphNode; course: MapCourse }>;
}

/** Every proposition's (fag, tema) over the current graph + cache. */
export function resolveMapGrouping(graph: DerivedGraph, record: KnowledgeMapRecord): MapGrouping {
	const courses = mapCourses();
	const byCode = new Map(courses.map((c) => [c.code, c]));
	const sources = new Map(stores.graphStore.readSources().map((s) => [s.id, s.filePath]));
	const sourceCourse = new Map<string, string | null>();
	const courseOfSource = (id: string): string | null => {
		if (sourceCourse.has(id)) return sourceCourse.get(id)!;
		let code: string | null = null;
		const file = sources.get(id);
		if (file !== undefined) code = courseForSourcePath(file, courses, knowledgeMapSeams.exists);
		else {
			const linked = stores.chatStore.getChat(id)?.course?.code;
			code = linked !== undefined && byCode.has(linked) ? linked : null;
		}
		sourceCourse.set(id, code);
		return code;
	};
	const groups = new Map<string, MapGroup>();
	const unclassified: MapGrouping["unclassified"] = [];
	for (const node of graph.nodes) {
		const code = courseOfNode(node, courseOfSource);
		const course = code === null ? null : byCode.get(code) ?? null;
		const cached = record.topics[node.id];
		const valid = course !== null && cached !== undefined && cached.course === course.code && cached.sig === topicSignature(course);
		groups.set(node.id, nodeGroup(course, valid ? cached.topic : undefined));
		if (course !== null && course.topics.length > 0 && !valid) unclassified.push({ node, course });
	}
	const clusters = buildMapClusters(graph.nodes, graph.chains, (id) => groups.get(id) ?? { course: null, topic: null }, courses);
	return { courses, clusters, groups, unclassified };
}

/**
 * Re-seed the nodes whose cluster changed since the last layout, in one
 * grouped settle, and record the clusters they were laid out in. A no-op
 * when nothing moved groups (the common read). Returns whether it settled.
 */
export function ensureMapLayout(graph: DerivedGraph, clusters: ReadonlyArray<MapCluster>): boolean {
	const record = knowledgeMapSeams.store.read();
	const keyOf = new Map<string, string>();
	for (const cluster of clusters) for (const id of cluster.members) keyOf.set(id, cluster.id);
	const positions = stores.graphStore.readPositions();
	const reseed = new Set<string>();
	for (const node of deriveView(graph).nodes) {
		const key = keyOf.get(node.id);
		if (key === undefined) continue;
		if (record.layout[node.id] !== key || positions[node.id] === undefined) reseed.add(node.id);
	}
	if (reseed.size === 0) return false;
	settleGraphLayout(stores.graphStore, { clusters, reseed });
	// Prune to the live graph while writing (deleted nodes drop out).
	const live = new Set(graph.nodes.map((n) => n.id));
	const topics: KnowledgeMapRecord["topics"] = {};
	for (const [id, value] of Object.entries(record.topics)) if (live.has(id)) topics[id] = value;
	knowledgeMapSeams.store.write({ topics, layout: Object.fromEntries(keyOf) });
	return true;
}

/** The snapshot's view of the grouping: clusters + the course list. */
export function snapshotMap(grouping: MapGrouping): { clusters: Cluster[]; courses: Array<{ code: string; name: string }> } {
	const used = new Set(grouping.clusters.map((c) => c.course));
	return {
		clusters: grouping.clusters.map((c) => ({ id: c.id, label: c.label, members: c.members, course: c.course, topic: c.topic })),
		courses: grouping.courses.filter((c) => used.has(c.code)).map((c) => ({ code: c.code, name: c.name })),
	};
}

/** One read of the map: grouping, the layout check, and a nudge to the
 *  classification job. What GET /api/graph runs before the snapshot. */
export function prepareKnowledgeMap(): MapGrouping {
	const graph = getGraph(stores.graphStore);
	const grouping = resolveMapGrouping(graph, knowledgeMapSeams.store.read());
	if (graph.nodes.length > 0) ensureMapLayout(graph, grouping.clusters);
	if (grouping.unclassified.length > 0 && knowledgeMapSeams.mapShown()) scheduleTopicClassification(grouping.unclassified);
	return grouping;
}

// ─── Topic classification (background, single-flight) ───────────────────────

const BATCH_SIZE = 60;
const STATEMENT_CHARS = 240;
const CLASSIFY_TIMEOUT_MS = 120_000;
/** After a failed round, wait this long before trying again (a broken key
 *  must not turn every map read into a model call). */
const RETRY_AFTER_MS = 10 * 60_000;
/** The model's word for «no topic fits». */
const NO_TOPIC = "none";

interface ClassifyState {
	running: Promise<void> | null;
	failedUntil: number;
}

function classifyState(): ClassifyState {
	const g = globalThis as typeof globalThis & { __lhMapClassify?: ClassifyState };
	return (g.__lhMapClassify ??= { running: null, failedUntil: 0 });
}

const assignmentSchema = Type.Object({
	assignments: Type.Array(
		Type.Object({
			id: Type.String({ description: "The proposition id, exactly as given in brackets." }),
			topic: Type.String({ description: `The id of the ONE topic the proposition belongs to, or "${NO_TOPIC}" when no topic fits.` }),
		}),
	),
});

const CLASSIFY_SYSTEM_PROMPT = [
	"You sort the propositions of a student's knowledge map into the exam topics of one university course.",
	"",
	"Rules:",
	"- Give every proposition exactly one topic: the topic it is most clearly about.",
	`- Use "${NO_TOPIC}" only when the proposition fits none of the topics (general facts, another subject).`,
	"- Use the topic ids exactly as listed. Do not invent topics.",
	"",
	"Deliver the result with one call to the submit_topic_assignments tool. Do not write prose.",
].join("\n");

/** The classification prompt for one batch (exported for tests). */
export function classificationPrompt(course: MapCourse, nodes: ReadonlyArray<Pick<GraphNode, "id" | "name" | "statement">>): string {
	const clip = (s: string): string => (s.length > STATEMENT_CHARS ? `${s.slice(0, STATEMENT_CHARS - 1)}…` : s);
	return [
		`Course: ${course.code} ${course.name}`,
		"",
		"Topics:",
		...course.topics.map((t) => `- [${t.id}] ${t.title}`),
		"",
		"Propositions:",
		...nodes.map((n) => `- [${n.id}] ${n.name}: ${clip(n.statement)}`),
		"",
		"Submit the assignments now.",
	].join("\n");
}

/** Read one submitted round into id → topic (null = no topic). Unknown
 *  topic ids count as no topic; ids outside the batch are ignored. */
export function readAssignments(
	course: Pick<MapCourse, "topics">,
	batch: ReadonlyArray<{ id: string }>,
	submitted: ReadonlyArray<{ id: string; topic: string }>,
): Map<string, string | null> {
	const topics = new Set(course.topics.map((t) => t.id));
	const wanted = new Set(batch.map((n) => n.id));
	const out = new Map<string, string | null>();
	for (const a of submitted) {
		const id = a.id.trim();
		if (!wanted.has(id) || out.has(id)) continue;
		const topic = a.topic.trim();
		out.set(id, topics.has(topic) ? topic : null);
	}
	return out;
}

async function classifyBatch(engine: PiEngine, course: MapCourse, batch: GraphNode[]): Promise<Map<string, string | null>> {
	const signal = AbortSignal.timeout(CLASSIFY_TIMEOUT_MS);
	const submitted = await withBgLlmSlot(signal, () =>
		runSubmitAgent<{ assignments: Array<{ id: string; topic: string }> }>({
			role: "extractor",
			engine,
			toolName: "submit_topic_assignments",
			toolDescription: "Submit one topic per proposition.",
			parameters: assignmentSchema,
			fill: (input: { assignments: Array<{ id: string; topic: string }> }) => ({ assignments: input.assignments }),
			validate: (value) => {
				// A round that skips more than a tenth of the batch is sent back.
				const got = readAssignments(course, batch, value.assignments);
				return got.size < batch.length * 0.9 ? `Assign every proposition: ${batch.length - got.size} are missing.` : null;
			},
			systemPrompt: CLASSIFY_SYSTEM_PROMPT,
			prompt: classificationPrompt(course, batch),
			signal,
			onStep: () => undefined,
			neverSubmitted: "the model never submitted topic assignments",
		}),
	);
	return readAssignments(course, batch, submitted.assignments);
}

/** Start the classification job unless one is running or a recent round
 *  failed. Returns the job's promise (tests await it), or null. */
export function scheduleTopicClassification(pending: MapGrouping["unclassified"]): Promise<void> | null {
	const state = classifyState();
	if (state.running || Date.now() < state.failedUntil || pending.length === 0) return null;
	const engine = knowledgeMapSeams.engine();
	if (!engine) return null; // no model configured: the course groups alone
	const byCourse = new Map<string, { course: MapCourse; nodes: GraphNode[] }>();
	for (const { node, course } of pending) {
		const entry = byCourse.get(course.code) ?? { course, nodes: [] };
		entry.nodes.push(node);
		byCourse.set(course.code, entry);
	}
	const run = (async () => {
		let landed = 0;
		try {
			for (const { course, nodes } of byCourse.values()) {
				const sig = topicSignature(course);
				for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
					const batch = nodes.slice(i, i + BATCH_SIZE);
					const result = await classifyBatch(engine, course, batch);
					// Read-modify-write with no await in between: the layout
					// check's writes cannot interleave.
					const record = knowledgeMapSeams.store.read();
					for (const node of batch) record.topics[node.id] = { course: course.code, topic: result.get(node.id) ?? null, sig };
					knowledgeMapSeams.store.write(record);
					landed += batch.length;
				}
			}
		} catch (err) {
			state.failedUntil = Date.now() + RETRY_AFTER_MS;
			console.error("[knowledge-map] topic classification failed:", err instanceof Error ? err.message : err);
		} finally {
			state.running = null;
			if (landed > 0) emit("map-changed", {});
		}
	})();
	state.running = run;
	return run;
}
