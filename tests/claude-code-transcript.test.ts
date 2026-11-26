/**
 * Claude Code transcript replay (src/agent/claude-code/transcript.ts).
 *
 * The CLI makes one model call per input user message, so earlier turns are
 * rendered as labelled text inside the single user message it receives.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { AssistantMessage, Message, SystemMessage, Tool, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";

import { rememberReplaySegment, replaySegmentsFor, toClaudeInput, toStreamJsonLine } from "../src/agent/claude-code/transcript.ts";

const READ_TOOL: Tool = { name: "read", description: "Read a file", parameters: { type: "object", properties: {} } };
const WRITE_TOOL: Tool = { name: "write", description: "Write a file", parameters: { type: "object", properties: {} } };

function system(fields: Partial<SystemMessage>): SystemMessage {
	return { role: "system", content: "", timestamp: 0, ...fields };
}

function user(content: UserMessage["content"]): UserMessage {
	return { role: "user", content, timestamp: 0 };
}

function assistant(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "claude-code-cli",
		provider: "claude-code",
		model: "opus",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 0,
	};
}

function toolResult(toolName: string, content: ToolResultMessage["content"], isError = false): ToolResultMessage {
	return { role: "toolResult", toolCallId: `${toolName}-1`, toolName, content, isError, timestamp: 0 };
}

test("system prompt joins all system content, then the live sections", () => {
	const messages: Message[] = [
		system({ content: "You are a tutor.", sections: { goals: "Teach TCP.", style: "Be brief." } }),
		user("hi"),
		system({ content: "The learner switched topics.", sections: { goals: "Teach TLS.", style: null } }),
		user("next"),
	];
	assert.equal(toClaudeInput(messages).systemPrompt, "You are a tutor.\n\nThe learner switched topics.\n\nTeach TLS.");
});

test("tools reflect toolsAdded minus toolsRemoved", () => {
	const messages: Message[] = [
		system({ content: "p", toolsAdded: [READ_TOOL, WRITE_TOOL] }),
		user("hi"),
		system({ toolsRemoved: [{ name: "read" }] }),
		user("next"),
	];
	assert.deepEqual(
		toClaudeInput(messages).tools.map((t) => t.name),
		["write"],
	);
});

test("single user message passes through as text", () => {
	const input = toClaudeInput([system({ content: "p" }), user("what is a socket?")]);
	assert.deepEqual(input.userContent, [{ type: "text", text: "what is a socket?" }]);
});

test("history renders user, assistant text, tool call name+JSON args and tool result text in order before the latest user message", () => {
	const messages: Message[] = [
		user([{ type: "text", text: "open notes.md" }]),
		assistant([
			{ type: "text", text: "Reading it." },
			{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "notes.md" } },
		]),
		toolResult("read", [{ type: "text", text: "# Notes" }]),
		assistant([{ type: "text", text: "It has a heading." }]),
		user("summarise it"),
	];
	const expected = [
		"[user]\nopen notes.md",
		"[assistant]\nReading it.",
		'[tool call read] {"path":"notes.md"}',
		"[tool result read]\n# Notes",
		"[assistant]\nIt has a heading.",
		"[user]\nsummarise it",
	].join("\n\n");
	assert.deepEqual(toClaudeInput(messages).userContent, [{ type: "text", text: expected }]);
});

test("error tool results are marked as errors in the replay", () => {
	const messages: Message[] = [
		user("open missing.md"),
		assistant([{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "missing.md" } }]),
		toolResult("read", [{ type: "text", text: "ENOENT" }], true),
		user("why?"),
	];
	const expected = [
		"[user]\nopen missing.md",
		'[tool call read] {"path":"missing.md"}',
		"[tool result read error]\nENOENT",
		"[user]\nwhy?",
	].join("\n\n");
	assert.deepEqual(toClaudeInput(messages).userContent, [{ type: "text", text: expected }]);
});

test("images in user and tool-result content become base64 image blocks", () => {
	const messages: Message[] = [
		user([
			{ type: "text", text: "look" },
			{ type: "image", data: "AAAA", mimeType: "image/png" },
		]),
		assistant([{ type: "toolCall", id: "shot-1", name: "screenshot", arguments: {} }]),
		toolResult("screenshot", [{ type: "image", data: "BBBB", mimeType: "image/jpeg" }]),
		user("compare"),
	];
	assert.deepEqual(toClaudeInput(messages).userContent, [
		{ type: "text", text: "[user]\nlook" },
		{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
		{ type: "text", text: "[tool call screenshot] {}\n\n[tool result screenshot]" },
		{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "BBBB" } },
		{ type: "text", text: "[user]\ncompare" },
	]);
});

test("transcript ending on a tool result renders as history with no trailing user turn", () => {
	const messages: Message[] = [
		user("open notes.md"),
		assistant([{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "notes.md" } }]),
		toolResult("read", [{ type: "text", text: "# Notes" }]),
	];
	const expected = ["[user]\nopen notes.md", '[tool call read] {"path":"notes.md"}', "[tool result read]\n# Notes"].join("\n\n");
	assert.deepEqual(toClaudeInput(messages).userContent, [{ type: "text", text: expected }]);
});

test("thinking blocks are omitted from replay", () => {
	const messages: Message[] = [
		user("hi"),
		assistant([
			{ type: "thinking", thinking: "secret plan" },
			{ type: "text", text: "Hello." },
		]),
		user("bye"),
	];
	assert.deepEqual(toClaudeInput(messages).userContent, [{ type: "text", text: "[user]\nhi\n\n[assistant]\nHello.\n\n[user]\nbye" }]);
});

test('toStreamJsonLine emits {"type":"user","message":{"role":"user","content":[...]}}', () => {
	assert.deepEqual(JSON.parse(toStreamJsonLine([{ type: "text", text: "hi" }])), {
		type: "user",
		message: { role: "user", content: [{ type: "text", text: "hi" }] },
	});
});

test("a tool's per-image captions stay right before their images (tiled PDF pages)", () => {
	const messages: Message[] = [
		user("read my answer"),
		assistant([{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "svar.pdf" } }]),
		toolResult("read", [
			{ type: "text", text: "PDF: svar.pdf (1 page)." },
			{ type: "text", text: "[Page 1, part 1 of 2 (top → bottom)]" },
			{ type: "image", data: "AAAA", mimeType: "image/png" },
			{ type: "text", text: "[Page 1, part 2 of 2 (top → bottom)]" },
			{ type: "image", data: "BBBB", mimeType: "image/png" },
		]),
		user("what do you see?"),
	];
	assert.deepEqual(toClaudeInput(messages).userContent, [
		{ type: "text", text: '[user]\nread my answer\n\n[tool call read] {"path":"svar.pdf"}\n\n[tool result read]\nPDF: svar.pdf (1 page).\n[Page 1, part 1 of 2 (top → bottom)]' },
		{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
		{ type: "text", text: "[Page 1, part 2 of 2 (top → bottom)]" },
		{ type: "image", source: { type: "base64", media_type: "image/png", data: "BBBB" } },
		{ type: "text", text: "[user]\nwhat do you see?" },
	]);
});

test("cache-stable replay: an earlier replay's blocks come back unchanged as the prefix of the next one", () => {
	const turn1: Message[] = [
		user("explain TCP"),
		assistant([{ type: "text", text: "TCP is a byte stream." }]),
		user("and the handshake?"),
	];
	const turn2: Message[] = [
		...turn1,
		assistant([{ type: "text", text: "SYN, SYN-ACK, ACK." }]),
		user("why three?"),
	];
	const first = toClaudeInput(turn1);
	assert.equal(first.conversationLength, 3);
	const merged = toClaudeInput(turn2).userContent;
	assert.equal(merged.length, 1, "without segments the old shape: one merged block");
	const next = toClaudeInput(turn2, [first.conversationLength]).userContent;
	assert.deepEqual(next.slice(0, first.userContent.length), first.userContent, "byte-identical prefix");
	assert.deepEqual(next.slice(first.userContent.length), [{ type: "text", text: "[assistant]\nSYN, SYN-ACK, ACK.\n\n[user]\nwhy three?" }]);
});

test("replay segments are remembered per session and dropped past a shorter history", () => {
	rememberReplaySegment("chat-seg", 3);
	rememberReplaySegment("chat-seg", 7);
	assert.deepEqual(replaySegmentsFor("chat-seg"), [3, 7]);
	rememberReplaySegment("chat-seg", 5);
	assert.deepEqual(replaySegmentsFor("chat-seg"), [3, 5], "a compacted history keeps only boundaries inside it");
	assert.deepEqual(replaySegmentsFor(undefined), []);
	rememberReplaySegment(undefined, 4);
	assert.deepEqual(replaySegmentsFor("other-chat"), []);
});
