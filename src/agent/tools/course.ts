/**
 * THE COURSE TOOL (exam mode): `topic_status` lets the conversation agent
 * record how well the learner masters one topic of the course the session
 * belongs to. Registered only when the session carries a course link, in
 * the prober, teacher and practice registries alike.
 *
 * SERVER-EXECUTED and synchronous: the write lands before the result returns,
 * so the learner's exam plan recolors while the agent keeps talking. The
 * agent layer never imports the store or server: the course is reached
 * through the injected CourseToolContext port (the ProbeDoneContext
 * idiom), wired at the composition root (src/server/chat-handler.ts).
 */

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { invalidInputResult } from "../tool-execute.ts";
import { slugifyTopicId } from "../../core/courses.ts";

/** What the topic_status tool closes over. */
export interface CourseToolContext {
	/** The course code the session is linked to (for messages only). */
	code: string;
	/** The course's current topics, read fresh per call; null when the
	 *  course no longer exists (deleted while the session lived on). */
	topics: () => ReadonlyArray<{ id: string; title: string }> | null;
	/** Persist the status and announce the change. Returns false when the
	 *  topic vanished between validation and write. */
	setStatus: (topicId: string, status: "red" | "yellow" | "green", note: string) => boolean;
}

export const topicStatusInputSchema = Type.Object({
	topicId: Type.String({
		description: "REQUIRED — the topic's id, copied exactly from the [id] in the session context's topic list.",
	}),
	status: Type.Union([Type.Literal("red"), Type.Literal("yellow"), Type.Literal("green")], {
		description:
			"REQUIRED — red = cannot do this yet, yellow = unsure or partly there, green = can do it at exam level (bare word, no quotes).",
	}),
	note: Type.String({
		description: "REQUIRED — one short sentence in Norwegian with the evidence for this status; the learner can read it.",
	}),
});

const MAX_NOTE_CHARS = 300;

/** Exact id first; then the forgiving reads a model wobble produces: the
 *  id in brackets, a slug of what was sent, or the topic's title. */
function resolveTopicId(raw: string, topics: ReadonlyArray<{ id: string; title: string }>): string | null {
	const text = raw.trim().replace(/^\[|\]$/g, "").trim();
	if (topics.some((t) => t.id === text)) return text;
	const slug = slugifyTopicId(text);
	const bySlug = topics.find((t) => t.id === slug);
	if (bySlug) return bySlug.id;
	const lower = text.toLowerCase();
	return topics.find((t) => t.title.trim().toLowerCase() === lower)?.id ?? null;
}

export function courseTools(ctx: CourseToolContext): Record<string, AgentTool<any>> {
	// A typed const (not an inline literal) keeps execute's precise input;
	// the heterogeneous record below takes AgentTool<any>.
	const topicStatus: AgentTool<typeof topicStatusInputSchema> = {
		name: "topic_status",
		label: "topic_status",
		description:
			"Record how well the learner masters ONE topic of this session's course. Updates the topic's color in the " +
			"learner's exam plan immediately. Call it when you have real evidence (several answers or worked steps on the " +
			"topic, never a single answer), once per topic whose picture changed; calling it again later overwrites the " +
			"earlier status. The turn continues after the result.",
		parameters: topicStatusInputSchema,
		executionMode: "sequential",
		// Synchronous and instant: no abort guard needed. Refusals are isError
		// results the model can correct (the invalidInputResult convention).
		execute: async (_toolCallId, input) => {
			const topics = ctx.topics();
			if (topics === null) {
				return invalidInputResult("topic_status", [
					`the course ${ctx.code} no longer exists in the app — do not call topic_status again in this session`,
				]);
			}
			if (topics.length === 0) {
				return invalidInputResult("topic_status", [
					`the course ${ctx.code} has no topic list yet — there is nothing to set a status on`,
				]);
			}
			const topicId = resolveTopicId(input.topicId, topics);
			if (!topicId) {
				return invalidInputResult("topic_status", [
					`topicId ${JSON.stringify(input.topicId)} is not a topic of ${ctx.code} — copy one of these ids exactly: ${topics.map((t) => t.id).join(", ")}`,
				]);
			}
			const note = input.note.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE_CHARS);
			if (!ctx.setStatus(topicId, input.status, note)) {
				return invalidInputResult("topic_status", [`the topic ${topicId} could not be updated — it was removed from the course`]);
			}
			// Context-slim ack: the call's arguments already carry the content.
			return {
				content: [{ type: "text", text: `Status recorded: ${topicId} is now ${input.status}.` }],
				// `title` is for the transcript's one-line card only (details never
				// reach the model).
				details: { ok: true, topicId, status: input.status, title: topics.find((t) => t.id === topicId)?.title },
			};
		},
	};
	return { topic_status: topicStatus };
}
