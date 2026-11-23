/**
 * «Avslutt økt» → the course page follows (owner, 2026-11-23).
 *
 * When an økt in a course-linked chat ends (either way: with the quiz or
 * «Bare avslutt»), one background call on a cheap role (the extractor:
 * the cheap slot, or its override — the same role the course's topic list
 * is generated with) reads the økt and colors the topics it gave real
 * evidence on. The write goes through the topic_status port
 * (courseToolContextFor in courses.ts: status, statusSource "agent", the
 * note, and the commit that sends courses-changed), so the course page
 * updates exactly as when the teacher calls topic_status mid-økt.
 *
 * The evidence rules are topic_status's (src/agent/tools/course.ts):
 * several answers or worked steps, never one answer; green only with an
 * answered explain in the økt. Nothing happens when the chat has no course,
 * the course has no topic list, the økt has no learner work, or no model
 * is usable. Fire and forget: it never throws and never delays the end.
 */
import { Type } from "typebox";
import {
	explainAnsweredNodesLh,
	hasWrapContent,
	isSessionWrapMarker,
	serializeForSummary,
	wrapScope,
	type LhMarkerMessage,
	type LhMessage,
	type SessionWrapDetails,
	type WrapUsageStep,
} from "../core/index.ts";
import { resolveRoleSpec } from "../core/settings-resolution.ts";
import { ROLE_SLOT } from "../core/settings.ts";
import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { runSubmitAgent } from "../agent/subagents/submit-agent.ts";
import { connectionBackgroundAllowed } from "../agent/subscription-connections.ts";
import { courseStore } from "../store/courses.ts";
import { courseToolContextFor } from "./courses.ts";
import { stores } from "./stores.ts";
import { providerKeyPresent } from "./keys.ts";

export type TopicStatusUpdate = { topicId: string; status: "red" | "yellow" | "green"; note: string };

const TOPICS_TIMEOUT_MS = 120_000;
const TOPICS_TRANSCRIPT_CHARS = 120_000;
/** topic_status's own cap on the note. */
const MAX_NOTE_CHARS = 300;

const topicsSchema = Type.Object({
	updates: Type.Array(
		Type.Object({
			topicId: Type.String({ description: "The topic's id, copied exactly from the [id] in the topic list." }),
			status: Type.Union([Type.Literal("red"), Type.Literal("yellow"), Type.Literal("green")], {
				description: "red = cannot do this yet, yellow = unsure or partly there, green = can do it at exam level.",
			}),
			note: Type.String({ description: "One short sentence in Norwegian bokmål with the evidence for this status; the student reads it." }),
		}),
		{ description: "One entry per topic the økt gave real evidence on. Empty when it gave none." },
	),
});

function systemPrompt(greenAllowed: boolean): string {
	return [
		"You update a university student's exam plan after one study session (an \"økt\") with an AI tutor.",
		"You receive the course's topic list with each topic's current status, and the transcript of the økt that just ended. Decide, for each topic the økt gave real evidence on, how well the student masters it now.",
		"",
		"Rules:",
		"- Only topics the økt actually worked on. Leave every other topic out. An empty list is a good answer when the økt gave no real evidence.",
		"- Real evidence means several answers or worked steps on the topic, never a single answer. A topic with only one answer stays out.",
		"- red = cannot do this yet; yellow = unsure or partly there; green = can do it at exam level.",
		greenAllowed
			? "- green ONLY when the student solved a task on the topic in their own words with full working (an answered explain) and it was judged correct. Otherwise use yellow at most."
			: "- green is not allowed: this økt holds no answered explain (a task solved in the student's own words, full working). Use yellow at most.",
		"- A recall quiz at the end of the økt, if any, is supporting evidence, never enough on its own.",
		"- A question the student skipped, dismissed or that was closed when the økt ended is no evidence either way.",
		"- note: one short sentence in Norwegian bokmål with the evidence for the status. The student reads it.",
		"- Copy each topicId exactly from the [id] in the list. At most one entry per topic.",
		"",
		"Submit with the tool. Nothing else.",
	].join("\n");
}

/** Schema-valid can still break the rules; the problem goes back to the
 *  model for a retry. null = accept. */
export function topicUpdatesProblem(updates: readonly TopicStatusUpdate[], topicIds: readonly string[], greenAllowed: boolean): string | null {
	const known = new Set(topicIds);
	const seen = new Set<string>();
	for (const u of updates) {
		if (!known.has(u.topicId)) return `topicId ${JSON.stringify(u.topicId)} is not in the list — copy one of these ids exactly: ${topicIds.join(", ")}`;
		if (seen.has(u.topicId)) return `${u.topicId} appears twice — at most one entry per topic`;
		seen.add(u.topicId);
		if (u.status === "green" && !greenAllowed) return `${u.topicId} can't be green: this økt holds no answered explain. Use yellow at most`;
		if (!u.note.trim()) return `${u.topicId} needs a note with the evidence`;
	}
	return null;
}

// ─── Seams (tests swap these; production uses the defaults) ──────────────────

export const sessionTopicSeams: {
	/** The cheap background engine; undefined = no model, no key or no
	 *  background consent. */
	engine: () => { engine: PiEngine; modelId: string } | undefined;
	assess: (input: { prompt: string; engine: PiEngine; topicIds: string[]; greenAllowed: boolean }) => Promise<{ updates: TopicStatusUpdate[]; usage: WrapUsageStep[] }>;
} = {
	engine: resolveTopicsEngine,
	assess: submitTopicUpdates,
};

function resolveTopicsEngine(): { engine: PiEngine; modelId: string } | undefined {
	try {
		const settings = stores.settingsStore.readSettings();
		const spec = resolveRoleSpec("extractor", settings);
		if (!spec || !providerKeyPresent(spec.provider) || !connectionBackgroundAllowed(spec.provider)) return undefined;
		const engine = piEngineForSpec(spec, true, undefined, () => stores.settingsStore.readSettings()?.models?.[ROLE_SLOT.extractor]?.cacheRetention);
		return { engine, modelId: `${engine.model.provider}:${engine.model.id}` };
	} catch (err) {
		console.info("[wrap topics] no usable model:", err instanceof Error ? err.message : err);
		return undefined;
	}
}

async function submitTopicUpdates(input: { prompt: string; engine: PiEngine; topicIds: string[]; greenAllowed: boolean }): Promise<{ updates: TopicStatusUpdate[]; usage: WrapUsageStep[] }> {
	const usage: WrapUsageStep[] = [];
	const submission = await runSubmitAgent<{ updates: TopicStatusUpdate[] }>({
		role: "extractor",
		engine: input.engine,
		toolName: "submit_topic_status",
		toolDescription: "Submit the status of every topic the økt gave real evidence on (possibly none).",
		parameters: topicsSchema,
		fill: (raw: { updates?: TopicStatusUpdate[] }) => ({
			updates: (raw.updates ?? []).map((u) => ({ topicId: u.topicId.trim().replace(/^\[|\]$/g, "").trim(), status: u.status, note: u.note })),
		}),
		validate: (value) => topicUpdatesProblem(value.updates, input.topicIds, input.greenAllowed),
		systemPrompt: systemPrompt(input.greenAllowed),
		prompt: input.prompt,
		signal: AbortSignal.timeout(TOPICS_TIMEOUT_MS),
		onStep: (u) => {
			usage.push({
				inputTokens: u.input,
				outputTokens: u.output,
				cacheReadTokens: u.cacheRead,
				cacheWriteTokens: u.cacheWrite,
				cacheWrite1hTokens: (u as { cacheWrite1h?: number }).cacheWrite1h ?? 0,
				reasoningTokens: (u as { reasoning?: number }).reasoning ?? 0,
			});
		},
		neverSubmitted: "the model never submitted topic statuses",
	});
	return { updates: submission.updates, usage };
}

// ─── The update ──────────────────────────────────────────────────────────────

/** The økt a marker closed: from the previous marker's scope start up to
 *  the marker's covered message (later messages belong to the next økt). */
function endedOkt(messages: readonly LhMessage[], markerId: string): { scope: LhMessage[]; marker: LhMarkerMessage | null } {
	const at = messages.findIndex((m) => m.id === markerId);
	if (at < 0) return { scope: [], marker: null };
	const marker = messages[at]!;
	if (!isSessionWrapMarker(marker)) return { scope: [], marker: null };
	const through = (marker.details as Partial<SessionWrapDetails> | null)?.coversThroughId;
	const end = typeof through === "string" ? messages.findIndex((m) => m.id === through) : -1;
	return { scope: wrapScope(messages.slice(0, end >= 0 && end < at ? end + 1 : at)), marker };
}

/**
 * Color the course's topics from the økt the marker closed. Resolves when
 * done; never rejects (production callers fire and forget).
 */
export async function updateTopicsAfterWrap(chatId: string, markerId: string): Promise<void> {
	try {
		const record = stores.chatStore.getChat(chatId);
		if (!record?.course) return;
		const port = courseToolContextFor(record.course, chatId);
		const course = port ? courseStore.getCourse(port.code) : null;
		if (!port || !course || course.topics.length === 0) return;
		const { scope, marker } = endedOkt(record.messages, markerId);
		if (!marker || !hasWrapContent(scope)) return;
		const resolved = sessionTopicSeams.engine();
		if (!resolved) return;

		let transcript = serializeForSummary(scope);
		if (transcript.length > TOPICS_TRANSCRIPT_CHARS) transcript = `…[earlier part of the økt omitted]\n\n${transcript.slice(-TOPICS_TRANSCRIPT_CHARS)}`;
		const details = marker.details as Partial<SessionWrapDetails> | null;
		const quiz = Array.isArray(details?.questions) && details.questions.length > 0 && typeof marker.content === "string" ? marker.content : "";
		const prompt = [
			`Course: ${course.code}${course.name ? ` ${course.name}` : ""}`,
			"",
			"Topics (id, title, current status):",
			...course.topics.map((t) => `- [${t.id}] ${t.title}: ${t.status}${t.statusNote ? `. Note: ${t.statusNote.slice(0, 200)}` : ""}`),
			"",
			`Transcript of the økt that just ended:\n\n${transcript}`,
			...(quiz ? ["", `How the økt ended (with the recall quiz result):\n${quiz}`] : []),
			"",
			"Submit the topic statuses now.",
		].join("\n");
		const greenAllowed = explainAnsweredNodesLh(scope).size > 0;
		const { updates, usage } = await sessionTopicSeams.assess({ prompt, engine: resolved.engine, topicIds: course.topics.map((t) => t.id), greenAllowed });
		for (const u of updates) {
			if (u.status === "green" && !greenAllowed) continue;
			port.setStatus(u.topicId, u.status, u.note.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE_CHARS));
		}
		// The money channel: real spend, keyed to the marker like the wrap's.
		if (usage.length > 0 && stores.chatStore.getChat(chatId)) {
			stores.chatStore.appendTurnUsage(chatId, { id: `wrap_topics_${markerId}`, messageId: markerId, at: new Date().toISOString(), model: resolved.modelId, steps: usage });
		}
	} catch (err) {
		console.error(`[chat ${chatId}] topic update after the økt failed:`, err);
	}
}
