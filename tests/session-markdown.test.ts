/**
 * The shared session-markdown engine (core/session-markdown.ts, owner ruling
 * 2026-09-27): ONE renderer for the extractor's source view and the future
 * user-facing session export — id-anchored speaker blocks, readable
 * quiz/recall/question blocks, one-line notes for other tools. Pinned here:
 * block shapes, anchor handling (on/off), title header, empty-message
 * skipping, and content parity with the coverage line builder.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LhMessage } from "../src/core/native-messages.ts";
import { MARKDOWN_LABELS_EN, MARKDOWN_LABELS_NB, messageMarkdown, sessionMarkdown } from "../src/core/session-markdown.ts";
import { messageViewLines } from "../src/core/coverage.ts";
import { coverageSlots } from "../src/core/coverage.ts";

function user(id: string, text: string): LhMessage {
	return { id, role: "user", content: text, timestamp: Date.now() } as never;
}

function teacher(id: string, text: string): LhMessage {
	return {
		id,
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-completions",
		provider: "openrouter",
		model: "test",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		stopReason: "stop",
		timestamp: Date.now(),
	} as never;
}

function result(
	id: string,
	toolCallId: string,
	toolName: string,
	details: unknown,
	isError = false,
): LhMessage {
	return {
		id,
		role: "toolResult",
		toolCallId,
		toolName,
		content: [{ type: "text", text: "ok" }],
		details,
		isError,
		timestamp: Date.now(),
	} as never;
}

/** An assistant message carrying one toolCall part (the practice join's
 *  call side — args live HERE, the results are bare acks). */
function callMsg(id: string, callId: string, name: string, args: unknown): LhMessage {
	return {
		id,
		role: "assistant",
		content: [{ type: "toolCall", id: callId, name, arguments: args }],
		api: "openai-completions",
		provider: "openrouter",
		model: "test",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		stopReason: "stop",
		timestamp: Date.now(),
	} as never;
}

describe("messageMarkdown", () => {
	it("renders speaker blocks with the id anchor", () => {
		const md = messageMarkdown(user("u1", "teach me the chain rule"), "u1");
		assert.equal(md, "### Learner · u1\n\nteach me the chain rule");
		const md2 = messageMarkdown(teacher("a1", "The derivative measures change."), "a1");
		assert.equal(md2, "### Teacher · a1\n\nThe derivative measures change.");
	});

	it("anchors off — the same document without the ids (the user export)", () => {
		const md = messageMarkdown(user("u1", "hello"), "u1", false);
		assert.equal(md, "### Learner\n\nhello");
	});

	it("quiz blocks: question + outcome + the learner's note", () => {
		const md = messageMarkdown(
			result("r1", "q1", "quiz", { questionText: "What is a derivative?", correct: false, dontKnow: false, note: "mixed up signs" }),
			"r1",
		)!;
		assert.match(md, /^### Quiz · r1$/m);
		assert.match(md, /\*\*Q:\*\* What is a derivative\?/);
		assert.match(md, /The learner answered incorrectly\./);
		assert.match(md, /\*\(his thinking: mixed up signs\)\*/);
	});

	it("explain results: the learner's own words are shown", () => {
		const md = messageMarkdown(
			result("r1", "e1", "explain", { questionText: "Why does Mercury stay near the Sun?", text: "it never strays far" }),
			"r1",
		)!;
		assert.match(md, /^### Recall check · r1$/m);
		assert.match(md, /The learner answered in his own words: it never strays far/);
	});

	it("probe-phase questions export under their own names (owner, 2026-10-09)", () => {
		const probe = messageMarkdown(
			result("r1", "p1", "probe", { questionText: "What is a derivative?", correct: true, dontKnow: false }),
			"r1",
		)!;
		assert.match(probe, /^### Probe · r1$/m);
		const recall = messageMarkdown(
			result("r2", "rr1", "recall", { questionText: "Why does Mercury stay near the Sun?", text: "it never strays far" }),
			"r2",
		)!;
		assert.match(recall, /^### Recall · r2$/m);
	});

	it("ask blocks: question + chosen options + free text", () => {
		const chosen = messageMarkdown(
			result("r1", "a1", "ask_user_question", { questionText: "Which way?", answers: ["second"], other: "also the third" }),
			"r1",
		)!;
		assert.match(chosen, /^### Question · r1$/m);
		assert.match(chosen, /The learner chose: second, also the third/);
		const free = messageMarkdown(
			result("r2", "a2", "ask_user_question", { questionText: "Why?", text: "because" }),
			"r2",
		)!;
		assert.match(free, /The learner answered: because/);
	});

	it("other clean tool results: one line; failed calls and markers: nothing", () => {
		assert.equal(messageMarkdown(result("r1", "j1", "research", { brief: "long" }), "r1"), "### Tool · r1\n\n*research result delivered*");
		assert.equal(messageMarkdown(result("r2", "j2", "research", {}, true), "r2"), null, "a failed call is retry context");
		assert.equal(messageMarkdown(user("u3", "   "), "u3"), null, "empty text renders nothing");
	});
});

describe("sessionMarkdown — the practice join (owner-approved, 2026-10-06)", () => {
	it("a problem result renders the POSE's statement, joined off the call id", () => {
		const messages = [
			callMsg("a1", "call-p1", "problem", {
				statement: "Push the prior through the learning transition.",
				mode: "recall",
				target: [],
				modelSolution: "Two phases, in forced order.",
			}),
			result("r1", "call-p1", "problem", null),
		];
		const md = sessionMarkdown(messages);
		assert.ok(md.includes("### Problem"), "the Problem heading renders");
		assert.ok(md.includes("Push the prior through the learning transition."), "the statement renders");
		assert.ok(!md.includes("Two phases"), "the solution does NOT leak at pose time");
	});

	it("a conclude result renders outcome + verdict + the pose's model solution as the reveal", () => {
		const messages = [
			callMsg("a1", "call-p1", "problem", {
				statement: "Compute P(knows | correct).",
				modelSolution: "Bayes, twice over.",
			}),
			result("r1", "call-p1", "problem", null),
			callMsg("a2", "call-c1", "conclude", { outcome: "solvedWithHints", verdict: "Right answer, one nudge." }),
			result("r2", "call-c1", "conclude", null),
		];
		const md = sessionMarkdown(messages);
		assert.ok(md.includes("### Concluded"), "the Concluded heading renders");
		assert.ok(md.includes("**Solved with hints.** Right answer, one nudge."), "outcome reads as prose, then the verdict");
		assert.ok(md.includes("> **Model solution**"), "the reveal block quotes the committed solution");
		assert.ok(md.includes("> Bayes, twice over."), "the solution text carries the blockquote prefix");
	});

	it("a dismissed problem concludes without leaking the model solution", () => {
		const messages = [
			callMsg("a1", "call-p1", "problem", { statement: "Derive the posterior.", modelSolution: "The answer." }),
			result("r1", "call-p1", "problem", null),
			callMsg("a2", "call-c1", "conclude", { outcome: "dismissed" }),
			result("r2", "call-c1", "conclude", null),
		];
		const md = sessionMarkdown(messages);
		assert.ok(md.includes("The learner skipped this problem."), "the dismissal reads as a skip");
		assert.ok(!md.includes("The answer."), "no reveal on a skipped problem — the card's refusal law");
		assert.ok(md.includes("### Problem"), "the statement still renders (it was on screen)");
	});

	it("an errored pose renders nothing — the failed-tool law holds for practice", () => {
		const messages = [
			callMsg("a1", "call-p1", "problem", { statement: "Never acked." }),
			result("r1", "call-p1", "problem", null, true),
		];
		const md = sessionMarkdown(messages);
		assert.ok(!md.includes("### Problem"), "no problem block");
		assert.ok(!md.includes("Never acked."), "no statement either — the pose never happened");
	});
});

describe("sessionMarkdown", () => {
	it("assembles blocks in order under the title header, skipping nothings", () => {
		const md = sessionMarkdown([user("u1", "go"), teacher("a1", "First."), user("u2", "  ")], { title: "My session" });
		assert.equal(md, "# My session\n\n### Learner · u1\n\ngo\n\n### Teacher · a1\n\nFirst.");
	});

	it("no title → no header; anchors default on", () => {
		const md = sessionMarkdown([user("u1", "go")]);
		assert.equal(md, "### Learner · u1\n\ngo");
	});

	it("the seam split (owner, 2026-09-28): teacher prose renders in BOTH; the rest renders ONLY here", () => {
		// The extraction view became TEACHER-PROSE-ONLY: its line builder
		// yields lines for teacher text alone. This engine keeps the FULL
		// session format for the future user-facing export — so parity now
		// holds exactly for teacher prose, and everything else (learner,
		// quiz, tool results) is markdown-only.
		const messages: LhMessage[] = [
			user("u1", "teach me"),
			teacher("a1", "The chain rule multiplies local rates."),
			result("r1", "q1", "quiz", { questionText: "Q?", correct: true, dontKnow: false }),
			result("r2", "j1", "research", { brief: "b" }),
			result("r3", "j2", "research", {}, true),
		];
		for (const message of messages) {
			const isTeacher = (message as { role?: string }).role === "assistant";
			const hasLines = messageViewLines(message, message.id).length > 0;
			const hasMarkdown = messageMarkdown(message, message.id) !== null;
			assert.equal(hasLines, isTeacher && hasMarkdown, `view lines follow teacher prose for ${message.id}`);
		}
	});
});

describe("sessionMarkdown — label tables (2026-11: the learner's export is Norwegian)", () => {
	const messages = [
		user("u1", "Lær meg derivasjon"),
		teacher("a1", "Den deriverte er stigningstallet."),
		result("r1", "q1", "quiz", { questionText: "Hva er f'(x)?", correct: true, dontKnow: false, note: "regnet ut" }),
		result("r2", "q2", "probe", { questionText: "Skipped?", dismissed: true, skipped: true }),
		result("r3", "q3", "explain", { questionText: "Held?", dismissed: true, onHold: true }),
		result("r4", "q4", "recall", { questionText: "Closed?", dismissed: true }),
		result("r5", "q5", "ask_user_question", { questionText: "Mål?", answers: ["Bestå"], other: "" }),
		callMsg("a2", "p1", "problem", { statement: "Deriver x^2.", modelSolution: "2x" }),
		result("r6", "p1", "problem", null),
		callMsg("a3", "c1", "conclude", { outcome: "solvedWithHints", verdict: "Bra." }),
		result("r7", "c1", "conclude", null),
		result("r8", "g1", "grep", null),
	];

	it("the default table is the original English, byte for byte", () => {
		const implicit = sessionMarkdown(messages, { title: "T" });
		assert.equal(sessionMarkdown(messages, { title: "T", labels: MARKDOWN_LABELS_EN }), implicit);
		for (const pin of [
			"### Learner · u1", "### Teacher · a1", "### Quiz · r1", "**Q:** Hva er f'(x)?", "The learner answered correctly.",
			"*(his thinking: regnet ut)*", "### Probe · r2", "### Recall check · r3", "### Recall · r4", "The learner skipped this check.",
			"### Question · r5", "The learner chose: Bestå", "### Problem · r6", "### Concluded · r7", "**Solved with hints.** Bra.",
			"> **Model solution**", "### Tool · r8", "*grep result delivered*",
		]) assert.ok(implicit.includes(pin), pin);
		assert.equal(implicit.split("The learner skipped this check.").length - 1, 3, "English never distinguishes the three non-answers");
		assert.equal(messageMarkdown(messages[0]!, "u1"), "### Learner · u1\n\nLær meg derivasjon");
	});

	it("the Norwegian table translates every label and tells the three non-answers apart", () => {
		const md = sessionMarkdown(messages, { title: "T", anchors: false, labels: MARKDOWN_LABELS_NB });
		for (const pin of [
			"### Student\n\nLær meg derivasjon", "### Lærer\n\nDen deriverte er stigningstallet.", "### Sjekk\n\n**Spørsmål:** Hva er f'(x)?",
			"Studenten svarte riktig.", "*(tankegang: regnet ut)*", "### Kartlegging\n\n**Spørsmål:** Skipped?\n\nHoppet over.",
			"### Forklar\n\n**Spørsmål:** Held?\n\nSatt på vent.", "### Gjenkalling\n\n**Spørsmål:** Closed?\n\nLukket uten svar.",
			"### Spørsmål\n\n**Spørsmål:** Mål?\n\nStudenten valgte: Bestå", "### Oppgave\n\nDeriver x^2.",
			"### Avsluttet\n\n**Løst med hint.** Bra.", "> **Løsningsforslag**\n>\n> 2x", "### Verktøy\n\n*resultat fra grep levert*",
		]) assert.ok(md.includes(pin), pin);
		for (const english of ["Learner", "Teacher", "The learner", "Quiz", "Probe", "Recall", "Concluded", "Model solution", "his thinking", "result delivered"]) {
			assert.ok(!md.includes(english), `no English label: ${english}`);
		}
	});

	it("both tables render the same blocks in the same order", () => {
		const count = (md: string) => md.split("\n### ").length;
		assert.equal(count(sessionMarkdown(messages, { labels: MARKDOWN_LABELS_NB })), count(sessionMarkdown(messages)));
	});
});
