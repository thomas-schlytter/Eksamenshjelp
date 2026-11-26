import { Type, type Static } from "typebox";
import type { Usage } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { PiEngine } from "../models.ts";
import { createReadTool } from "../tools/read.ts";
import { lsTool } from "../tools/ls.ts";
import { findTool } from "../tools/find.ts";
import { grepTool } from "../tools/grep.ts";
import { runSubmitAgent } from "./submit-agent.ts";
import {
	FLASHCARD_DECK_MAX,
	FLASHCARD_DECK_MIN,
	FLASHCARD_MORE_COUNT,
	FLASHCARD_MULTI_MAX_OPTIONS,
	FLASHCARD_MULTI_MIN_OPTIONS,
	FLASHCARD_SINGLE_OPTIONS,
	flashcardDraftProblems,
	type FlashcardDraft,
} from "../../core/flashcards.ts";
import type { Course } from "../../core/courses.ts";

/**
 * THE SPØRSMÅLSKORT GENERATOR (2026-11-26): a background sub-agent with the
 * prøveeksamen generator's role and set-up (the teacher slot, the
 * learner-file tools) that reads the course description, the past exams
 * and solutions and any formula sheet in the fag folder, then submits ONE
 * batch of recall cards: a new deck (30–40, after the size of the pensum)
 * or «Legg til flere» (15 that repeat none of the old questions).
 *
 * The submission is validated strictly (core/flashcards.ts
 * flashcardDraftProblems, the LaTeX double-check included); a refusal
 * names what to fix and the model submits again.
 */

const cardSchema = Type.Object({
	type: Type.Union([Type.Literal("single"), Type.Literal("multi")], {
		description: `"single" = «Ett valg»: exactly ${FLASHCARD_SINGLE_OPTIONS} options, exactly one right. "multi" = «Flere valg» («Velg alle som stemmer»): ${FLASHCARD_MULTI_MIN_OPTIONS} or ${FLASHCARD_MULTI_MAX_OPTIONS} options, at least one right.`,
	}),
	question: Type.String({ description: "The question in Norwegian bokmål: text and inline math $…$ (KaTeX). No figures." }),
	options: Type.Array(Type.String(), { description: "The options, text and inline math $…$. Similar in length and style; the right ones must not stand out." }),
	correct: Type.Array(Type.Integer(), { description: "0-based indices of the right options (single: exactly one)." }),
	explanation: Type.String({ description: "One or two short sentences in Norwegian on why the right answer is right." }),
	topicId: Type.Optional(Type.String({ description: "The course topic id this card belongs to, copied from the topic list. Leave out when none fits." })),
	topic: Type.String({ description: "The topic's title as the student reads it (the course topic's title when topicId is set)." }),
	source: Type.String({ description: 'Where the card comes from, short: "2024h eksamen, oppg. 3", "LF 2023v, oppg. 2b", "Formelark", "Emnebeskrivelsen".' }),
});

export const flashcardSubmitSchema = Type.Object({
	cards: Type.Array(cardSchema),
});

type Submission = Static<typeof flashcardSubmitSchema>;

export const FLASHCARD_MAKER_INSTRUCTIONS = `You write recall cards (spørsmålskort) for one NTNU course. A student practises them alone, card by card, without a teacher, to check that the course's core facts sit before the exam.

## 1. Read the material first

Before you write anything, find and read the material with your tools:
- The course's sources are listed below. List the folders (\`ls\`, \`find\`), read any overview file (OVERSIKT.md, README) first, then the past exams and their solutions (løsningsforslag, LF), and any formula sheet (formelark, formelsamling).
- \`read\` opens PDFs page by page (use \`pages\` for a range). Read at least the most recent exams and their solutions, enough to know what the exam asks about again and again.
- The course description (content and learning outcomes, below) tells you the pensum.

## 2. What a card asks

- Formulas, laws, definitions, the conditions of theorems and proofs, «what happens when …» (a parameter changes, a condition fails), and thematic pensum checks.
- NO calculation that needs paper: the student must be able to answer in his head in under a minute.
- Spread the cards over the whole pensum, weighted by how much the exams ask about each topic. Each card tests one thing.
- Two types, mixed (roughly two thirds "single", one third "multi"):
  - "single" («Ett valg»): exactly ${FLASHCARD_SINGLE_OPTIONS} options, exactly one right.
  - "multi" («Flere valg», «Velg alle som stemmer»): ${FLASHCARD_MULTI_MIN_OPTIONS} or ${FLASHCARD_MULTI_MAX_OPTIONS} options, at least one right. Vary how many are right. The question must make clear that several can be right.
- Wrong options are plausible mistakes a student actually makes (a sign, a missing condition, a swapped definition), never jokes. All options similar in length and style.
- Norwegian bokmål, short and exact. Text and math only: no figures, no images, no tables.

## 3. Math

- Inline math only, as $…$, in plain KaTeX-compatible TeX. Never \\tag, never environments like align or equation, no $$ display blocks.
- Every formula must render with KaTeX: balanced braces, standard commands only.

## 4. Check before you submit

Answer every card yourself from the question alone. Every right option must be right and every wrong option wrong, with no room for a reading where it flips. The explanation says in one or two sentences why the right answer is right.

## 5. Submit

Call submit_flashcards exactly once with every card. Set topicId when a card belongs to one of the course's topics (copy the id from the list), and topic to that topic's title (or a short topic name of your own when none fits). Set source to where the card comes from. If the submission is refused, fix exactly what the message says and submit again.`;

export interface FlashcardMakerInput {
	course: Pick<Course, "code" | "name" | "exam" | "sources" | "topics" | "content" | "learningOutcome">;
	/** "new" = a whole deck; "more" = «Legg til flere». */
	mode: "new" | "more";
	/** «Legg til flere»: the deck's questions, never to be repeated. */
	avoid?: string[];
}

export interface FlashcardMakerOptions {
	engine?: PiEngine;
	abortSignal?: AbortSignal;
	onUsage?: (usage: Usage) => void;
	onActivity?: (line: string) => void;
	/** Max model calls (reading PDFs takes many). Default 60. */
	maxTurns?: number;
}

/** How many cards the batch must hold. */
export function flashcardBatchSize(mode: FlashcardMakerInput["mode"]): { min: number; max: number } {
	return mode === "more" ? { min: FLASHCARD_MORE_COUNT, max: FLASHCARD_MORE_COUNT } : { min: FLASHCARD_DECK_MIN, max: FLASHCARD_DECK_MAX };
}

/** The model-facing prompt: course facts, sources, topics, the batch. */
export function flashcardMakerPrompt(input: FlashcardMakerInput): string {
	const { course } = input;
	const exam = course.exam;
	const lines: string[] = [
		`Course: ${course.code} ${course.name}`,
		`Exam facts on record: ${[exam.form, exam.duration ? `duration ${exam.duration}` : undefined, exam.aids ? `aids: ${exam.aids}` : undefined].filter(Boolean).join("; ") || "(none)"}`,
	];
	if (course.content) lines.push("", "Course content (official):", course.content.slice(0, 3_000));
	if (course.learningOutcome) lines.push("", "Learning outcomes (official):", course.learningOutcome.slice(0, 3_000));
	lines.push("", "Sources (paths are on the student's machine):");
	if (course.sources.length === 0) lines.push("- (none)");
	for (const s of course.sources) {
		if (s.kind === "file" || s.kind === "folder") lines.push(`- ${s.kind === "folder" ? "Folder" : "File"}, ${s.title}: ${s.path}`);
		else if (s.kind === "note") lines.push(`- Note, ${s.title}: ${(s.text ?? "").slice(0, 2_000)}`);
		else if (s.url) lines.push(`- ${s.kind === "ntnu" ? "NTNU course page" : `Link, ${s.title}`}: ${s.url}`);
	}
	lines.push("", "Topics (id — title — exam relevance 1-3):");
	if (course.topics.length === 0) lines.push("- (no topic list; leave topicId out)");
	for (const t of course.topics) lines.push(`- [${t.id}] ${t.title} — relevance ${t.weight}`);
	const size = flashcardBatchSize(input.mode);
	lines.push("");
	if (input.mode === "more") {
		lines.push(`Write exactly ${size.min} NEW cards. The deck already has the questions below: repeat none of them, not even reworded — cover other facts, or the same topics from another side.`);
		lines.push("Existing questions (do not repeat):");
		for (const q of input.avoid ?? []) lines.push(`- ${q.replace(/\s*\n+\s*/g, " ")}`);
	} else {
		lines.push(
			`Write a whole deck of ${size.min} to ${size.max} cards: about ${size.min} for a small pensum, up to ${size.max} for a large one (many topics, many recurring exam themes).`,
		);
	}
	lines.push("", "Read the material first, then submit the cards with submit_flashcards.");
	return lines.join("\n");
}

function activity(toolName: string, args: unknown): string {
	const a = (args ?? {}) as { path?: unknown; pattern?: unknown };
	const arg = typeof a.path === "string" ? a.path.split("/").pop() : typeof a.pattern === "string" ? a.pattern : "";
	const verb: Record<string, string> = { read: "leser", ls: "lister", find: "finner", grep: "søker" };
	if (toolName === "submit_flashcards") return "setter sammen kortene";
	return `${verb[toolName] ?? toolName}${arg ? ` ${arg}` : ""}`;
}

/** Run the generator; returns VALID drafts or throws with the reason. */
export async function runFlashcardMaker(input: FlashcardMakerInput, opts: FlashcardMakerOptions): Promise<FlashcardDraft[]> {
	const topicIds = input.course.topics.map((t) => t.id);
	const size = flashcardBatchSize(input.mode);
	const read = createReadTool(opts.engine?.model);
	const extraTools: Record<string, AgentTool<any>> = { read, ls: lsTool, find: findTool, grep: grepTool };
	const submitted = await runSubmitAgent<{ cards: FlashcardDraft[] }>({
		role: "teacher",
		engine: opts.engine,
		toolName: "submit_flashcards",
		toolDescription:
			`Submit the cards: ${size.min === size.max ? `exactly ${size.min}` : `${size.min} to ${size.max}`}, each with type, question, options, ` +
			"the right option indices, a short explanation, the topic and the source. Validated on submit; a refusal names what to fix.",
		parameters: flashcardSubmitSchema,
		fill: (raw: Submission) => ({
			cards: raw.cards.map((c) => ({
				type: c.type,
				question: c.question,
				options: c.options,
				correct: c.correct.map(Number),
				explanation: c.explanation,
				...(c.topicId?.trim() ? { topicId: c.topicId.trim() } : {}),
				topic: c.topic,
				source: c.source,
			})),
		}),
		validate: (value) => {
			const problems = flashcardDraftProblems(value.cards, { ...size, topicIds, avoid: input.avoid });
			return problems.length > 0 ? problems.join("; ") : null;
		},
		systemPrompt: FLASHCARD_MAKER_INSTRUCTIONS,
		prompt: flashcardMakerPrompt(input),
		extraTools,
		maxTurns: opts.maxTurns ?? 60,
		signal: opts.abortSignal,
		onStep: (usage) => opts.onUsage?.(usage),
		onToolStart: (toolName, args) => opts.onActivity?.(activity(toolName, args)),
		neverSubmitted: "the generator never submitted valid flashcards",
	});
	return submitted.cards;
}
