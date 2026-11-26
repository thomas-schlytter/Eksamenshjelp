import type { ImageContent, Message, TextContent, Tool } from "@earendil-works/pi-ai";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";

export type ClaudeContentBlock =
	| { type: "text"; text: string }
	| { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export type ClaudeInput = {
	systemPrompt: string;
	tools: Tool[];
	userContent: ClaudeContentBlock[];
	/** Non-system messages replayed (the next replay's segment end). */
	conversationLength: number;
};

type ReplayPart = string | ImageContent;

/** Forces a new content block (a cache-stable segment end, below). */
const SEGMENT_END = Symbol("segment end");
type ReplayItem = ReplayPart | typeof SEGMENT_END;

function toImageBlock(image: ImageContent): ClaudeContentBlock {
	return { type: "image", source: { type: "base64", media_type: image.mimeType, data: image.data } };
}

/** The label leads; text and images then keep their own order, so a tool's
 *  per-image caption (the read tool's "[Page 1, part 2 of 5 …]") stays
 *  right before its image in replay too. */
function getLabelledParts(label: string, content: string | (TextContent | ImageContent)[]): ReplayPart[] {
	if (typeof content === "string") return [`${label}\n${content}`];

	const parts: ReplayPart[] = [];
	let text: string[] = [];
	let labelled = false;
	const flush = () => {
		if (!labelled) parts.push(text.length > 0 ? `${label}\n${text.join("\n")}` : label);
		else if (text.length > 0) parts.push(text.join("\n"));
		labelled = true;
		text = [];
	};
	for (const block of content) {
		if (block.type === "text") text.push(block.text);
		else {
			flush();
			parts.push(block);
		}
	}
	if (!labelled || text.length > 0) flush();
	return parts;
}

function getReplayParts(message: Message): ReplayPart[] {
	switch (message.role) {
		case "system":
			return [];

		case "user":
			return getLabelledParts("[user]", message.content);

		case "assistant":
			return message.content.flatMap((block) => {
				if (block.type === "text") return [`[assistant]\n${block.text}`];
				if (block.type === "toolCall") return [`[tool call ${block.name}] ${JSON.stringify(block.arguments)}`];
				return [];
			});

		case "toolResult": {
			const label = message.isError ? `[tool result ${message.toolName} error]` : `[tool result ${message.toolName}]`;
			return getLabelledParts(label, message.content);
		}
	}
}

function toContentBlocks(parts: ReplayItem[]): ClaudeContentBlock[] {
	const blocks: ClaudeContentBlock[] = [];
	let pendingText: string[] = [];

	const flushText = () => {
		if (pendingText.length > 0) blocks.push({ type: "text", text: pendingText.join("\n\n") });
		pendingText = [];
	};

	for (const part of parts) {
		if (part === SEGMENT_END) {
			flushText();
		} else if (typeof part === "string") {
			pendingText.push(part);
		} else {
			flushText();
			blocks.push(toImageBlock(part));
		}
	}

	flushText();

	return blocks;
}

function toUnlabelledBlocks(content: string | (TextContent | ImageContent)[]): ClaudeContentBlock[] {
	if (typeof content === "string") return [{ type: "text", text: content }];

	return content.map((block) => (block.type === "text" ? { type: "text", text: block.text } : toImageBlock(block)));
}

/**
 * CACHE-STABLE REPLAY (2026-11, token saving): a fresh CLI process gets the
 * whole history as ONE user message, and the API caches it at that
 * message's last block. Text used to be merged into as few blocks as
 * possible, so the next fresh process — the same history plus a turn —
 * grew the last block and missed the cache: every learner turn re-wrote
 * the full history (~95 % of all cache writes in real records).
 *
 * `segments` are the conversation lengths at which earlier fresh
 * processes of this session replayed. A block always ends there, so the
 * blocks of an earlier replay come back byte-identical as a prefix of the
 * next one, and the provider's prefix cache (with its lookback of about 20
 * blocks) reads them instead of writing them again. Without segments the
 * output is exactly the old shape.
 */
function toUserContent(conversation: Message[], segments: readonly number[] = []): ClaudeContentBlock[] {
	const [first] = conversation;
	if (conversation.length === 1 && first?.role === "user") return toUnlabelledBlocks(first.content);

	const ends = new Set(segments.filter((n) => n > 0 && n < conversation.length));
	const items: ReplayItem[] = [];
	conversation.forEach((message, i) => {
		if (ends.has(i)) items.push(SEGMENT_END);
		items.push(...getReplayParts(message));
	});
	return toContentBlocks(items);
}

/** The replay. `segments`: see toUserContent — the caller remembers each
 *  fresh replay's `conversationLength` per session and passes them back. */
export function toClaudeInput(messages: Message[], segments: readonly number[] = []): ClaudeInput {
	const conversation = messages.filter((message) => message.role !== "system");

	return {
		systemPrompt: getCurrentSystemPrompt(messages),
		tools: getCurrentTools(messages),
		userContent: toUserContent(conversation, segments),
		conversationLength: conversation.length,
	};
}

export function toStreamJsonLine(content: ClaudeContentBlock[]): string {
	return JSON.stringify({ type: "user", message: { role: "user", content } });
}

/** Where each session's fresh replays ended (in-memory: after a restart the
 *  provider cache has usually expired anyway, and a miss is only a miss). */
const MAX_SESSIONS = 200;
const replaySegments = new Map<string, number[]>();

export function replaySegmentsFor(sessionId: string | undefined): readonly number[] {
	return sessionId ? replaySegments.get(sessionId) ?? [] : [];
}

/** Record a fresh replay's end. A shorter history (compaction, an edit)
 *  drops the boundaries past it. */
export function rememberReplaySegment(sessionId: string | undefined, conversationLength: number): void {
	if (!sessionId) return;
	const kept = (replaySegments.get(sessionId) ?? []).filter((n) => n < conversationLength);
	replaySegments.delete(sessionId);
	replaySegments.set(sessionId, [...kept, conversationLength]);
	while (replaySegments.size > MAX_SESSIONS) replaySegments.delete(replaySegments.keys().next().value!);
}
