/**
 * THE KNOWLEDGE MAP'S GROUPING (fase 8, «Kunnskapskartet»): the map groups
 * propositions by FAG (course) and TEMA (one of the course's exam topics)
 * instead of by the session or file that happened to create them. The
 * birth-session partition (core/session-clusters.ts) spread one theme over
 * many clusters (one per imported exam), and the arrows between them
 * crossed the whole map.
 *
 *   fag  — derived from provenance: the first provenance point whose
 *          source belongs to a course (a chat started from the course, or
 *          an imported file under one of the course's source folders).
 *          No match anywhere → «Uten fag».
 *   tema — the course's topic list, assigned per node by a cheap
 *          background model (src/server/knowledge-map.ts) and cached.
 *          A node the model could not place → «Annet». A course without
 *          topics (or a node not classified yet) groups on the course only.
 *
 * A cluster is one (fag, tema) pair. Implication nodes (arg_) follow the
 * majority of their premises, like the birth-session rule did.
 *
 * Browser-safe pure logic: no fs, no node builtins. The server layer
 * supplies course records, source paths and the cached topic assignment.
 */

import type { GraphChain, GraphNode, Position } from "./contracts.ts";

/** The topic key for a node the model placed outside every topic. */
export const OTHER_TOPIC = "annet";

/** What the grouping needs to know about one course. */
export interface MapCourse {
	code: string;
	name: string;
	/** The exam topics, in the course's own order. */
	topics: ReadonlyArray<{ id: string; title: string }>;
	/** Absolute paths of the course's folder and file sources. */
	sourcePaths: ReadonlyArray<string>;
}

/** One node's place on the map. `topic` is a topic id, OTHER_TOPIC, or
 *  null (the course has no topics, or the node is not classified yet). */
export interface MapGroup {
	course: string | null;
	topic: string | null;
}

/** One (fag, tema) cluster as the snapshot serves it. */
export interface MapCluster {
	id: string;
	label: string;
	course: string | null;
	topic: string | null;
	/** Node ids, sorted: propositions plus attached implication nodes. */
	members: string[];
}

/** The stable cluster id for a group. */
export function mapClusterId(group: MapGroup): string {
	return `fag:${group.course ?? "-"}/${group.topic ?? "*"}`;
}

const normalizePath = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "");
const basename = (p: string): string => {
	const parts = normalizePath(p).split("/");
	return parts[parts.length - 1] ?? "";
};
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The course an imported file belongs to. Imports store the path relative
 * to the folder the learner dropped («TTK4100-eksamener/2021/…»), the
 * course stores its folder as an absolute path, so the rules are, in order:
 *   1. the file lies under a course source path (absolute match);
 *   2. its first segment is the course folder's own name;
 *   3. it, or its top folder, exists inside the course folder (`exists`,
 *      server-side only: a sub-folder dropped on its own, «Kyb-intro/…»);
 *   4. a path segment carries the course code («EKSAMENER/tma4400_2025h.pdf»).
 * Courses are tried in the given order; the first match wins.
 */
export function courseForSourcePath(
	filePath: string,
	courses: ReadonlyArray<MapCourse>,
	exists?: (absolutePath: string) => boolean,
): string | null {
	const file = normalizePath(filePath);
	if (!file) return null;
	for (const course of courses) {
		for (const raw of course.sourcePaths) {
			const source = normalizePath(raw);
			if (!source) continue;
			if (file === source || file.startsWith(`${source}/`)) return course.code;
			const name = basename(source);
			if (name && (file === name || file.startsWith(`${name}/`))) return course.code;
		}
	}
	if (exists && !file.startsWith("/")) {
		const top = file.split("/")[0]!;
		for (const course of courses) {
			for (const raw of course.sourcePaths) {
				const source = normalizePath(raw);
				if (!source) continue;
				if (exists(`${source}/${file}`)) return course.code;
				// The file's top folder is a folder of the course («ADE/…»
				// imported from a copy of the course's own ADE folder).
				if (top !== file && exists(`${source}/${top}`)) return course.code;
			}
		}
	}
	const segments = file.split("/");
	for (const course of courses) {
		const code = new RegExp(`(^|[^a-z0-9])${escapeRegExp(course.code.toLowerCase())}([^a-z0-9]|$)`);
		if (segments.some((segment) => code.test(segment.toLowerCase()))) return course.code;
	}
	return null;
}

/** A node's course: the first provenance point whose source resolves to
 *  one (the birth point first, then later re-encounters in order). */
export function courseOfNode(
	node: Pick<GraphNode, "provenance">,
	courseOfSource: (sourceId: string) => string | null,
): string | null {
	for (const point of node.provenance) {
		const course = courseOfSource(point.chatId);
		if (course !== null) return course;
	}
	return null;
}

/** A node's group from its course and its cached topic assignment
 *  (`undefined` = not classified yet; `null` = classified as no topic). */
export function nodeGroup(course: MapCourse | null, assigned: string | null | undefined): MapGroup {
	if (!course) return { course: null, topic: null };
	if (course.topics.length === 0 || assigned === undefined) return { course: course.code, topic: null };
	if (assigned === null || !course.topics.some((t) => t.id === assigned)) return { course: course.code, topic: OTHER_TOPIC };
	return { course: course.code, topic: assigned };
}

/** The topic-list signature a cached assignment was made against: a new,
 *  renamed-away or removed topic id invalidates the course's assignments. */
export function topicSignature(course: Pick<MapCourse, "topics">): string {
	return course.topics.map((t) => t.id).sort().join("|");
}

/** The label a cluster shows: the topic title, «Annet», the course name,
 *  or «Uten fag». */
export function mapClusterLabel(group: MapGroup, courses: ReadonlyArray<MapCourse>): string {
	if (group.course === null) return "Uten fag";
	const course = courses.find((c) => c.code === group.course);
	if (group.topic === OTHER_TOPIC) return "Annet";
	if (group.topic !== null) return course?.topics.find((t) => t.id === group.topic)?.title ?? group.topic;
	return course?.name || group.course;
}

/**
 * The (fag, tema) clusters over the stored propositions. Implication
 * nodes (one per MULTI-premise live chain, deriveView's mint rule) join
 * the cluster most of their premises sit in; a tie goes to the
 * conclusion's cluster when it is among the winners, else the first id.
 * Ordered by course (the given order, «Uten fag» last), then topic
 * (course-only first, the topic list's order, «Annet» last).
 */
export function buildMapClusters(
	propositions: ReadonlyArray<Pick<GraphNode, "id">>,
	chains: ReadonlyArray<Pick<GraphChain, "id" | "premises" | "conclusion">>,
	groupOf: (nodeId: string) => MapGroup,
	courses: ReadonlyArray<MapCourse>,
): MapCluster[] {
	const byId = new Map<string, MapCluster>();
	const clusterOf = new Map<string, string>();
	const ensure = (group: MapGroup): MapCluster => {
		const id = mapClusterId(group);
		let cluster = byId.get(id);
		if (!cluster) {
			cluster = { id, label: mapClusterLabel(group, courses), course: group.course, topic: group.topic, members: [] };
			byId.set(id, cluster);
		}
		return cluster;
	};
	const seen = new Set<string>();
	for (const node of propositions) {
		if (seen.has(node.id)) continue;
		seen.add(node.id);
		const cluster = ensure(groupOf(node.id));
		cluster.members.push(node.id);
		clusterOf.set(node.id, cluster.id);
	}
	for (const chain of chains) {
		if (chain.premises.length < 2) continue;
		if (!seen.has(chain.conclusion) || !chain.premises.every((p) => seen.has(p))) continue;
		const counts = new Map<string, number>();
		for (const premise of chain.premises) {
			const id = clusterOf.get(premise)!;
			counts.set(id, (counts.get(id) ?? 0) + 1);
		}
		let max = 0;
		for (const n of counts.values()) if (n > max) max = n;
		const winners = [...counts].filter(([, n]) => n === max).map(([id]) => id).sort();
		const conclusion = clusterOf.get(chain.conclusion)!;
		const home = winners.includes(conclusion) ? conclusion : winners[0]!;
		byId.get(home)!.members.push(chain.id);
	}
	const courseRank = (code: string | null): number => {
		if (code === null) return courses.length + 1;
		const i = courses.findIndex((c) => c.code === code);
		return i < 0 ? courses.length : i;
	};
	const topicRank = (cluster: MapCluster): number => {
		if (cluster.topic === null) return -1;
		if (cluster.topic === OTHER_TOPIC) return Number.MAX_SAFE_INTEGER;
		const course = courses.find((c) => c.code === cluster.course);
		const i = course?.topics.findIndex((t) => t.id === cluster.topic) ?? -1;
		return i < 0 ? Number.MAX_SAFE_INTEGER - 1 : i;
	};
	const clusters = [...byId.values()];
	for (const cluster of clusters) cluster.members.sort();
	return clusters.sort(
		(a, b) => courseRank(a.course) - courseRank(b.course) || topicRank(a) - topicRank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
	);
}

// ─── Grouped seeding (the layout's starting point) ──────────────────────────

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Deterministic disc placement (phyllotaxis): point i of n inside a disc. */
function sunflower(i: number, n: number, radius: number, center: Position): Position {
	const r = radius * Math.sqrt((i + 0.5) / Math.max(n, 1));
	const a = i * GOLDEN_ANGLE;
	return { x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) };
}

/** Points around a center for k groups of the given radii: one group sits
 *  on the center, more share a ring wide enough to keep them apart. */
function ringCenters(radii: readonly number[], center: Position, gap: number): Position[] {
	if (radii.length === 0) return [];
	if (radii.length === 1) return [{ ...center }];
	const total = radii.reduce((s, r) => s + 2 * r + gap, 0);
	const ring = Math.max(total / (2 * Math.PI), Math.max(...radii) + gap);
	const out: Position[] = [];
	let acc = 0;
	for (const r of radii) {
		const span = (2 * r + gap) / total;
		const angle = (acc + span / 2) * 2 * Math.PI;
		acc += span;
		out.push({ x: center.x + ring * Math.cos(angle), y: center.y + ring * Math.sin(angle) });
	}
	return out;
}

const centroidOf = (points: readonly Position[]): Position | null => {
	if (points.length === 0) return null;
	let x = 0;
	let y = 0;
	for (const p of points) {
		x += p.x;
		y += p.y;
	}
	return { x: x / points.length, y: y / points.length };
};

/** Disc radius for a group of n nodes at the given spacing. */
const discRadius = (n: number, spacing: number): number => spacing * 0.55 * Math.sqrt(Math.max(n, 1));

/**
 * Starting positions for the nodes that must be (re)placed: `reseed`
 * (their group changed, or they are new), or every member when nothing
 * has a previous position. A node seeds
 *   - inside its cluster, when the cluster still has anchored members;
 *   - else on a ring around its course's previous centroid;
 *   - else (a new course, or a fresh map) in a hierarchical arrangement:
 *     courses on a ring, their topics on a ring around each course.
 * Pure and deterministic; the force sim relaxes from here.
 */
export function groupedSeeds(
	clusters: ReadonlyArray<Pick<MapCluster, "id" | "course" | "members">>,
	previous: ReadonlyMap<string, Position>,
	reseed: ReadonlySet<string>,
	spacing: number,
): Map<string, Position> {
	const seeds = new Map<string, Position>();
	const anchored = (id: string): boolean => previous.has(id) && !reseed.has(id);
	const needs = (id: string): boolean => !anchored(id);

	// Courses in first-appearance order (clusters arrive course-sorted).
	const courseKeys: Array<string | null> = [];
	const byCourse = new Map<string | null, Array<Pick<MapCluster, "id" | "course" | "members">>>();
	for (const cluster of clusters) {
		let list = byCourse.get(cluster.course);
		if (!list) {
			list = [];
			byCourse.set(cluster.course, list);
			courseKeys.push(cluster.course);
		}
		list.push(cluster);
	}

	// Extent of everything already placed (for new courses on the rim).
	const placed = [...previous.entries()].filter(([id]) => !reseed.has(id)).map(([, p]) => p);
	const core = centroidOf(placed);
	let coreRadius = 0;
	if (core) for (const p of placed) coreRadius = Math.max(coreRadius, Math.hypot(p.x - core.x, p.y - core.y));

	const placeCourse = (key: string | null, center: Position): void => {
		const list = byCourse.get(key) ?? [];
		const open = list.filter((c) => c.members.some(needs));
		// Clusters with anchored members seed inside themselves.
		const fresh: typeof open = [];
		for (const cluster of open) {
			const home = centroidOf(cluster.members.filter(anchored).map((id) => previous.get(id)!));
			if (!home) {
				fresh.push(cluster);
				continue;
			}
			const pending = cluster.members.filter(needs);
			pending.forEach((id, i) => seeds.set(id, sunflower(i, pending.length, discRadius(pending.length, spacing) * 0.6, home)));
		}
		const radii = fresh.map((c) => discRadius(c.members.length, spacing));
		const centers = ringCenters(radii, center, spacing * 1.5);
		fresh.forEach((cluster, ci) => {
			const pending = cluster.members.filter(needs);
			pending.forEach((id, i) => seeds.set(id, sunflower(i, pending.length, radii[ci]!, centers[ci]!)));
		});
	};

	const courseRadius = (key: string | null): number => {
		const list = byCourse.get(key) ?? [];
		const radii = list.map((c) => discRadius(c.members.length, spacing));
		const total = radii.reduce((s, r) => s + 2 * r + spacing * 1.5, 0);
		return list.length <= 1 ? (radii[0] ?? spacing) : total / (2 * Math.PI) + Math.max(...radii);
	};

	// Courses with a previous footprint keep their place.
	const homeless: Array<string | null> = [];
	for (const key of courseKeys) {
		const members = (byCourse.get(key) ?? []).flatMap((c) => c.members);
		if (!members.some(needs)) continue;
		const home = centroidOf(members.filter((id) => previous.has(id)).map((id) => previous.get(id)!));
		if (home) placeCourse(key, home);
		else homeless.push(key);
	}
	if (homeless.length === 0) return seeds;

	if (!core) {
		// A fresh map: every course on one ring around the origin.
		const radii = homeless.map(courseRadius);
		const centers = ringCenters(radii, { x: 0, y: 0 }, spacing * 3);
		homeless.forEach((key, i) => placeCourse(key, centers[i]!));
		return seeds;
	}
	// New courses next to an existing map: on the rim, spread by index.
	homeless.forEach((key, i) => {
		const r = courseRadius(key);
		const angle = (i / homeless.length) * 2 * Math.PI + Math.PI / 4;
		const distance = coreRadius + r + spacing * 3;
		placeCourse(key, { x: core.x + distance * Math.cos(angle), y: core.y + distance * Math.sin(angle) });
	});
	return seeds;
}
