/**
 * Session → markdown — the ONE formatting engine (owner ruling 2026-09-27).
 *
 * The extractor's view of a teaching session and the future user-facing
 * session export share this engine: a session is rendered as clean,
 * readable markdown — speaker headers, quiz/check-in blocks, tool notes —
 * with optional message-id anchors. Since the submit-schema slim
 * (2026-09-28) propositions no longer report message ids — the extractor
 * renders anchorless and provenance is chat-level — so the anchors today
 * serve only the future user-facing export; `anchors: false` mints the
 * same document without them.
 *
 * Pure core: native messages in (LhMessage), string out. Content parity
 * with the coverage line builder (core/coverage.ts messageViewLines) is
 * deliberate — every message that produces view lines produces a markdown
 * block, in the same order — but the formats are SEPARATE by design
 * (2026-09-27): coverage fingerprints hash the line format and stay stable
 * (no mass re-extraction when presentation changes); markdown is
 * presentation. A failed tool call renders nothing (retry context, not
 * learning evidence); custom markers are invisible, same as the view.
 */

import type { LhMessage } from "./native-messages.ts";
import {
	failedOutputCallIds,
	PRACTICE_CONCLUDE_TOOL,
	PRACTICE_PROBLEM_TOOL,
	problemInputForConclude,
	SEND_TO_USER_TOOL,
	userFacingTextOf,
} from "./native-messages.ts";
import type { ToolResultMessage } from "@earendil-works/pi-ai";

/** The practice join context (owner-approved, 2026-10-06 export round):
 *  practice tool RESULTS are acks — the statement, outcome, and verdict
 *  all live in the assistant's call arguments, and the model solution
 *  commits at POSE time. The markdown blocks join them the same way the
 *  view seam folds cards (clean-only: a refused pose's result is errored
 *  and renders nothing before this join is ever reached). */
export interface MarkdownContext {
	messages: ReadonlyArray<LhMessage>;
	/** toolCallId → the call part's name + arguments. */
	calls: Map<string, { name: string; args: Record<string, unknown> | undefined }>;
	failedOutputCalls?: ReadonlySet<string>;
}

function markdownContext(messages: ReadonlyArray<LhMessage>): MarkdownContext {
	const calls: MarkdownContext["calls"] = new Map();
	for (const message of messages) {
		if ((message as { role?: string }).role !== "assistant") continue;
		const content = (message as { content?: unknown }).content;
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			const block = part as { type?: string; id?: string; name?: string; arguments?: unknown };
			if (block.type === "toolCall" && typeof block.id === "string") {
				calls.set(block.id, {
					name: typeof block.name === "string" ? block.name : "",
					args: (block.arguments ?? undefined) as Record<string, unknown> | undefined,
				});
			}
		}
	}
	return { messages, calls, failedOutputCalls: failedOutputCallIds(messages) };
}

/** solvedWithHints → "Solved with hints" — the outcome enum reads as prose. */
function outcomeLabel(outcome: string): string {
	const spaced = outcome.replace(/([a-z])([A-Z])/g, (_, lo: string, hi: string) => `${lo} ${hi.toLowerCase()}`);
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** How a question was left without an answer: "Hopp over", "Spør
 *  agenten", or the plain Esc dismissal. */
export type MarkdownNonAnswer = "skipped" | "onHold" | "dismissed";

/**
 * The document's WORDS, separate from its structure (2026-11): the engine
 * default stays the original English, byte for byte (tests and any
 * machine reader pin it), and the learner's export passes the Norwegian
 * table. Only presentation lives here; block order and what renders are
 * the engine's and identical for every table.
 */
export interface MarkdownLabels {
	learner: string;
	teacher: string;
	headings: { quiz: string; probe: string; recall: string; explain: string; problem: string; concluded: string; question: string; tool: string };
	question: string;
	noQuestionText: string;
	noStatement: string;
	checkLeft: (how: MarkdownNonAnswer) => string;
	questionLeft: (how: MarkdownNonAnswer) => string;
	didNotKnow: string;
	answeredCorrectly: string;
	answeredIncorrectly: string;
	answeredInOwnWords: (text: string) => string;
	answered: (text: string) => string;
	chose: (choices: string) => string;
	thinking: (note: string) => string;
	problemSkipped: string;
	outcome: (outcome: string) => string;
	concluded: string;
	modelSolution: string;
	toolResult: (tool: string) => string;
}

export const MARKDOWN_LABELS_EN: MarkdownLabels = {
	learner: "Learner",
	teacher: "Teacher",
	headings: { quiz: "Quiz", probe: "Probe", recall: "Recall", explain: "Recall check", problem: "Problem", concluded: "Concluded", question: "Question", tool: "Tool" },
	question: "Q:",
	noQuestionText: "(no question text)",
	noStatement: "(no statement)",
	checkLeft: () => "The learner skipped this check.",
	questionLeft: () => "The learner skipped this question.",
	didNotKnow: "The learner did not know.",
	answeredCorrectly: "The learner answered correctly.",
	answeredIncorrectly: "The learner answered incorrectly.",
	answeredInOwnWords: (text) => `The learner answered in his own words: ${text}`,
	answered: (text) => `The learner answered: ${text}`,
	chose: (choices) => `The learner chose: ${choices}`,
	thinking: (note) => `*(his thinking: ${note})*`,
	problemSkipped: "The learner skipped this problem.",
	outcome: outcomeLabel,
	concluded: "Concluded.",
	modelSolution: "Model solution",
	toolResult: (tool) => `*${tool} result delivered*`,
};

const OUTCOME_NB: Record<string, string> = {
	solved: "Løst",
	solvedWithHints: "Løst med hint",
	movedOn: "Gikk videre",
	surrendered: "Ga opp",
};
const NON_ANSWER_NB: Record<MarkdownNonAnswer, string> = {
	skipped: "Hoppet over.",
	onHold: "Satt på vent.",
	dismissed: "Lukket uten svar.",
};

/** The learner's export (GET /api/chats/:id/markdown): norsk bokmål. */
export const MARKDOWN_LABELS_NB: MarkdownLabels = {
	learner: "Student",
	teacher: "Lærer",
	headings: { quiz: "Sjekk", probe: "Kartlegging", recall: "Gjenkalling", explain: "Forklar", problem: "Oppgave", concluded: "Avsluttet", question: "Spørsmål", tool: "Verktøy" },
	question: "Spørsmål:",
	noQuestionText: "(ingen spørsmålstekst)",
	noStatement: "(ingen oppgavetekst)",
	checkLeft: (how) => NON_ANSWER_NB[how],
	questionLeft: (how) => NON_ANSWER_NB[how],
	didNotKnow: "Studenten visste ikke.",
	answeredCorrectly: "Studenten svarte riktig.",
	answeredIncorrectly: "Studenten svarte feil.",
	answeredInOwnWords: (text) => `Studenten svarte med egne ord: ${text}`,
	answered: (text) => `Studenten svarte: ${text}`,
	chose: (choices) => `Studenten valgte: ${choices}`,
	thinking: (note) => `*(tankegang: ${note})*`,
	problemSkipped: "Studenten hoppet over denne oppgaven.",
	outcome: (outcome) => OUTCOME_NB[outcome] ?? outcomeLabel(outcome),
	concluded: "Avsluttet.",
	modelSolution: "Løsningsforslag",
	toolResult: (tool) => `*resultat fra ${tool} levert*`,
};

/** One tool result's learner-visible outcome, rendered as body lines. */
function toolResultBody(result: ToolResultMessage, ctx: MarkdownContext | undefined, L: MarkdownLabels): { heading: string; body: string[] } {
	const out = result.details as
		| Partial<{
				questionText: string;
				correct: boolean;
				dontKnow: boolean;
				note: string;
				text: string;
				answers: string[];
				other: string;
				dismissed: boolean;
				skipped: boolean;
				onHold: boolean;
		  }>
		| undefined;
	const left: MarkdownNonAnswer = out?.skipped === true ? "skipped" : out?.onHold === true ? "onHold" : "dismissed";

	if (
		result.toolName === "quiz" ||
		result.toolName === "probe" ||
		result.toolName === "explain" ||
		result.toolName === "recall"
	) {
		// explain is the teach free-recall name ("Recall check" in English).
		const heading = L.headings[result.toolName as "quiz" | "probe" | "recall" | "explain"];
		const question = typeof out?.questionText === "string" && out.questionText ? out.questionText : L.noQuestionText;
		const body = [`**${L.question}** ${question}`];
		if (out?.dismissed === true) body.push(L.checkLeft(left));
		else if (out?.dontKnow === true) body.push(L.didNotKnow);
		else if (out?.correct === true) body.push(L.answeredCorrectly);
		else if (out?.correct === false) body.push(L.answeredIncorrectly);
		else if (typeof out?.text === "string" && out.text.trim()) body.push(L.answeredInOwnWords(out.text.trim()));
		if (typeof out?.note === "string" && out.note) body.push(L.thinking(out.note));
		return { heading, body };
	}

	if (ctx !== undefined && result.toolName === PRACTICE_PROBLEM_TOOL) {
		const statement = ctx.calls.get(result.toolCallId)?.args?.statement;
		return {
			heading: L.headings.problem,
			body: [typeof statement === "string" && statement.trim() ? statement.trim() : L.noStatement],
		};
	}

	if (ctx !== undefined && result.toolName === PRACTICE_CONCLUDE_TOOL) {
		const args = ctx.calls.get(result.toolCallId)?.args;
		const outcome = typeof args?.outcome === "string" && args.outcome.trim() ? args.outcome.trim() : "";
		const verdict = typeof args?.verdict === "string" && args.verdict.trim() ? args.verdict.trim() : undefined;
		if (outcome === "dismissed") return { heading: L.headings.concluded, body: [L.problemSkipped] };
		const label = outcome !== "" ? `**${L.outcome(outcome)}.**` : `**${L.concluded}**`;
		const body = [verdict !== undefined ? `${label} ${verdict}` : label];
		// The reveal (owner round, 2026-10-05): the solution committed at
		// pose time — the newest cleanly-posed problem before this conclude.
		const input = problemInputForConclude(ctx.messages, result.toolCallId);
		const solution = typeof input?.modelSolution === "string" && input.modelSolution.trim() ? input.modelSolution.trim() : undefined;
		if (solution !== undefined) body.push(`> **${L.modelSolution}**\n>\n> ${solution.replace(/\n/g, "\n> ")}`);
		return { heading: L.headings.concluded, body };
	}

	if (result.toolName === "ask_user_question") {
		const question = typeof out?.questionText === "string" && out.questionText ? out.questionText : L.noQuestionText;
		const body = [`**${L.question}** ${question}`];
		const chosen = [
			...(Array.isArray(out?.answers) ? out!.answers! : []),
			...(typeof out?.other === "string" && out.other.trim() ? [out.other.trim()] : []),
		];
		if (typeof out?.text === "string" && out.text.trim()) body.push(L.answered(out.text.trim()));
		else if (chosen.length > 0) body.push(L.chose(chosen.join(", ")));
		else if (out?.dismissed === true) body.push(L.questionLeft(left));
		if (typeof out?.note === "string" && out.note) body.push(L.thinking(out.note));
		return { heading: L.headings.question, body };
	}

	// Parity with the line builder: other clean tool results are one line.
	return { heading: L.headings.tool, body: [L.toolResult(result.toolName)] };
}

/**
 * ONE message as a markdown block — `null` when the message renders
 * nothing (a failed tool call, a bare marker, an empty text part set).
 * `mid` is the provenance anchor shown when `anchors` is on.
 */
export function messageMarkdown(
	message: LhMessage,
	mid: string,
	anchors = true,
	ctx?: MarkdownContext,
	labels: MarkdownLabels = MARKDOWN_LABELS_EN,
): string | null {
	const role = (message as { role?: string }).role;
	const anchor = anchors ? ` · ${mid}` : "";
	const parts: string[] = [];

	if (role === "user") {
		for (const text of userFacingTextOf((message as { content: unknown }).content)) {
			parts.push(`### ${labels.learner}${anchor}\n\n${text.trim()}`);
		}
	} else if (role === "assistant") {
		for (const text of userFacingTextOf((message as { content: unknown }).content, ctx?.failedOutputCalls ?? failedOutputCallIds([message]))) {
			parts.push(`### ${labels.teacher}${anchor}\n\n${text.trim()}`);
		}
	} else if (role === "toolResult") {
		const result = message as ToolResultMessage;
		if (result.isError || result.toolName === SEND_TO_USER_TOOL) return null; // retry context or output ack, not learning evidence
		const { heading, body } = toolResultBody(result, ctx, labels);
		parts.push(`### ${heading}${anchor}\n\n${body.join("\n\n")}`);
	}

	// custom markers are invisible, same as the extraction view.
	return parts.length > 0 ? parts.join("\n\n") : null;
}

/**
 * A whole session (or one extraction BATCH — same engine, subset of
 * messages) as one markdown document. Blocks render in message order;
 * messages that render nothing are skipped silently. The optional title
 * mints the document header (`# <title>`).
 */
export function sessionMarkdown(
	messages: ReadonlyArray<LhMessage>,
	opts: { title?: string; anchors?: boolean; labels?: MarkdownLabels } = {},
): string {
	const blocks: string[] = [];
	if (opts.title !== undefined && opts.title.length > 0) blocks.push(`# ${opts.title}`);
	const ctx = markdownContext(messages);
	for (const message of messages) {
		const block = messageMarkdown(message, (message as { id?: string }).id ?? "", opts.anchors ?? true, ctx, opts.labels);
		if (block !== null) blocks.push(block);
	}
	return blocks.join("\n\n");
}
