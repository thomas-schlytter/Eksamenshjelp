/**
 * WHAT THE CHAT VIEW IS SENT (2026-11-26, the 4-second fag-chat): the
 * record verbatim, minus the image bytes inside tool results.
 *
 * Measured on the learner's own data: the TMA4400 fag-chat file is 14.5 MB
 * with 805 messages, and 12.8 MB of that is base64 images in toolResult
 * content (the page images the agent read: 23 of them, about 550 KB each).
 * The view never shows them: a tool part shows the result's `details` or,
 * on failure, its text (core/view.ts applyResult), and the context meter
 * counts an image block by its type, not its bytes (core/compaction.ts).
 * Yet the chat page put every byte into the page payload, on every visit.
 *
 * The block stays (type and mimeType), so every count and every check that
 * looks for an image still sees one; only `data` is emptied. The server's
 * record, which is what the agent reads, is never touched: the client only
 * sends input events, never history back (components/session-core.ts).
 * Learner images in user messages stay as they are.
 */

import type { LhMessage } from "./native-messages.ts";

type Block = { type?: unknown; data?: unknown };

/** The messages as the chat view gets them. Pure; untouched messages are
 *  returned as the same objects. */
export function messagesForClient<M extends LhMessage>(messages: readonly M[]): M[] {
	return messages.map((message) => {
		if ((message as { role?: unknown }).role !== "toolResult") return message;
		const content = (message as { content?: unknown }).content;
		if (!Array.isArray(content) || !content.some(isImageWithData)) return message;
		return {
			...message,
			content: content.map((block: Block) => (isImageWithData(block) ? { ...block, data: "" } : block)),
		};
	});
}

function isImageWithData(block: Block | null | undefined): boolean {
	return !!block && block.type === "image" && typeof block.data === "string" && block.data.length > 0;
}
