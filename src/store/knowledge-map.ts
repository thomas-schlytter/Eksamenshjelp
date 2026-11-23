/**
 * The knowledge map's grouping cache (fase 8): data/graph/knowledge-map.json.
 * Read-modify-write like render-settings.json, NOT a ledger, and fully
 * rebuildable (deleting it costs one round of topic classification and one
 * re-layout):
 *
 *   topics — nodeId → the topic the background model chose for it, plus
 *            the course and the course's topic-list signature it was
 *            chosen against (a changed list re-classifies the course).
 *            `topic: null` = the model found no topic («Annet»).
 *   layout — nodeId → the group key the node had when the layout last
 *            placed it. A node whose current key differs is re-seeded
 *            inside its new cluster on the next settle.
 *
 * Unknown or deleted node ids are harmless: readers ignore them and the
 * next write prunes them.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../../config.ts";

export const KNOWLEDGE_MAP_FILE = path.join(PATHS.graph, "knowledge-map.json");

export interface TopicAssignment {
	course: string;
	topic: string | null;
	sig: string;
}

export interface KnowledgeMapRecord {
	topics: Record<string, TopicAssignment>;
	layout: Record<string, string>;
}

const empty = (): KnowledgeMapRecord => ({ topics: {}, layout: {} });

function sanitize(raw: unknown): KnowledgeMapRecord {
	const out = empty();
	if (typeof raw !== "object" || raw === null) return out;
	const r = raw as Record<string, unknown>;
	if (typeof r.topics === "object" && r.topics !== null) {
		for (const [id, value] of Object.entries(r.topics as Record<string, unknown>)) {
			if (typeof value !== "object" || value === null) continue;
			const v = value as Record<string, unknown>;
			if (typeof v.course !== "string" || typeof v.sig !== "string") continue;
			if (v.topic !== null && typeof v.topic !== "string") continue;
			out.topics[id] = { course: v.course, topic: v.topic, sig: v.sig };
		}
	}
	if (typeof r.layout === "object" && r.layout !== null) {
		for (const [id, value] of Object.entries(r.layout as Record<string, unknown>)) {
			if (typeof value === "string") out.layout[id] = value;
		}
	}
	return out;
}

export const knowledgeMapStore = {
	read(file: string = KNOWLEDGE_MAP_FILE): KnowledgeMapRecord {
		try {
			return sanitize(JSON.parse(fs.readFileSync(file, "utf-8")));
		} catch {
			return empty(); // absent or corrupt: rebuildable, start over
		}
	},
	/** Atomic write (temp file + rename): a crash never leaves half a file. */
	write(record: KnowledgeMapRecord, file: string = KNOWLEDGE_MAP_FILE): void {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const tmp = `${file}.${randomUUID()}.tmp`;
		try {
			fs.writeFileSync(tmp, JSON.stringify(record) + "\n", "utf-8");
			fs.renameSync(tmp, file);
		} finally {
			fs.rmSync(tmp, { force: true });
		}
	},
};
