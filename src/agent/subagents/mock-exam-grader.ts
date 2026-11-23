import { Type, type Static } from "typebox";
import type { Usage } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { PiEngine } from "../models.ts";
import { createReadTool } from "../tools/read.ts";
import { runSubmitAgent } from "./submit-agent.ts";
import {
	answersText,
	gradeProblems,
	partKey,
	partName,
	pointsLabel,
	type MockExam,
	type MockExamPartGradeInput,
} from "../../core/mock-exam.ts";

/**
 * THE PRØVEEKSAMEN GRADER (fase 6): a background sub-agent that grades one
 * hand-in part by part against the exam's hidden key — the løsningsforslag
 * and the retteveiledning — the way a sensor does: points per part, a short
 * reason, and what was missing for full points. A digital hand-in arrives as
 * text in the prompt; a scan (PDF or photos) is read with `read`, which
 * returns page text plus page images. Its only deliverable is one
 * submit_grades call covering every part exactly once.
 */

export const gradeSubmitSchema = Type.Object({
	grades: Type.Array(
		Type.Object({
			part: Type.String({ description: 'The part key exactly as in [part …], e.g. "1a", "6", "1.3".' }),
			points: Type.Number({ description: "Points awarded, from 0 to the part's maximum (halves allowed)." }),
			comment: Type.String({ description: "One or two sentences in Norwegian: why these points (what was right, what was wrong)." }),
			missing: Type.String({ description: 'What was missing for full points, in Norwegian — "" when nothing was.' }),
		}),
	),
	summary: Type.String({ description: "Two or three sentences in Norwegian: the overall picture — what holds, what costs the most points." }),
});

type Submission = Static<typeof gradeSubmitSchema>;

export const MOCK_EXAM_GRADER_INSTRUCTIONS = `You are the sensor for one NTNU mock exam (prøveeksamen). You grade the student's hand-in part by part against the exam's key: the løsningsforslag and the retteveiledning below. You grade the way the course's own sensors do — strict, fair, consistent.

## How to grade

- Grade every part exactly once. A blank, missing or unreadable answer gets 0 points, with the comment saying so.
- Follow the retteveiledning: full points for a correct answer with the working the task asks for; partial credit as the guide allocates it; a correct final answer with wrong or missing reasoning earns only what the guide gives for it. Follow-up errors (a wrong number from an earlier part used correctly later) lose points only where they arise, unless the guide says otherwise.
- A different method than the løsningsforslag is fine when it is correct and complete.
- Multiple choice: full points for the correct option, 0 otherwise (unless the paper states negative points).
- Never award more than the part's maximum. Halves are allowed.
- comment: one or two sentences in Norwegian on why. missing: what was needed for full points ("" if nothing).

## Reading a scanned hand-in

The hand-in is a list of files (PDF pages or photos). Open every file with \`read\` (PDFs: all pages; use \`pages\` to continue) and read the handwriting carefully. Map each answer to its part by the student's own numbering. If a page is unreadable, say so in the comment of the parts it would have answered and give the points you can verify.

## Submit

Call submit_grades once with every part and a short overall summary in Norwegian. If the submission is refused, fix exactly what the message says and submit again.`;

export interface MockExamGraderInput {
	exam: MockExam;
	/** Digital hand-in: partKey → answer. */
	answers?: Record<string, string>;
	/** Scanned hand-in: file paths to read. */
	files?: string[];
}

export interface MockExamGraderOptions {
	engine?: PiEngine;
	abortSignal?: AbortSignal;
	chatId?: string;
	onUsage?: (usage: Usage) => void;
	onActivity?: (line: string) => void;
	maxTurns?: number;
}

/** The exam with its key, part by part, as the grader reads it. */
export function examWithKeyText(exam: MockExam): string {
	const lines: string[] = [`# ${exam.title} (${exam.code})`, ""];
	for (const task of exam.tasks) {
		lines.push(`## Oppgave ${task.number}${task.title ? ` ${task.title}` : ""}`);
		if (task.intro) lines.push(task.intro);
		if (task.figureSvg) lines.push("(The task has a figure; its SVG source follows.)", task.figureSvg);
		for (const part of task.parts) {
			lines.push("", `### ${partName(task, part)} [part ${partKey(task, part)}] — max ${pointsLabel(part.points, exam.scoring)}`, part.text);
			if (part.figureSvg) lines.push("(Figure SVG:)", part.figureSvg);
			if (part.options) {
				lines.push("Options:", ...part.options.map((o) => `${o.id}) ${o.text}`), `Correct option: ${part.correctOption ?? "(none)"}`);
			}
			lines.push("Løsningsforslag:", part.solution, "Retteveiledning:", part.rubric);
		}
		lines.push("");
	}
	return lines.join("\n");
}

export function mockExamGraderPrompt(input: MockExamGraderInput): string {
	const parts = [examWithKeyText(input.exam), "---", ""];
	if (input.files && input.files.length > 0) {
		parts.push("The student's hand-in is a scan. Read every one of these files with `read` before grading:", ...input.files.map((f) => `- ${f}`));
	} else {
		parts.push("The student's hand-in (answered in the app; LaTeX between $ signs):", "", answersText(input.exam, input.answers ?? {}));
	}
	parts.push("", "Grade every part, then call submit_grades.");
	return parts.join("\n");
}

export interface MockExamGrades {
	grades: MockExamPartGradeInput[];
	summary: string;
}

/** Run the grader; returns VALID grades (every part once, within bounds). */
export async function runMockExamGrader(input: MockExamGraderInput, opts: MockExamGraderOptions): Promise<MockExamGrades> {
	const scan = Boolean(input.files && input.files.length > 0);
	const extraTools: Record<string, AgentTool<any>> = scan ? { read: createReadTool(opts.engine?.model) } : {};
	return runSubmitAgent<MockExamGrades>({
		role: "teacher",
		engine: opts.engine,
		toolName: "submit_grades",
		toolDescription: "Submit the grade for every part of the mock exam (points, comment, what was missing) and a short summary. Validated on submit.",
		parameters: gradeSubmitSchema,
		fill: (raw: Submission) => ({
			grades: raw.grades.map((g) => ({
				part: g.part.trim().replace(/^\[?part\s+/i, "").replace(/\]$/, ""),
				points: Number(g.points),
				comment: g.comment ?? "",
				missing: g.missing ?? "",
			})),
			summary: raw.summary ?? "",
		}),
		validate: (value) => {
			const problems = gradeProblems(input.exam, value.grades);
			if (!value.summary.trim()) problems.push("summary is empty");
			return problems.length > 0 ? problems.join("; ") : null;
		},
		systemPrompt: MOCK_EXAM_GRADER_INSTRUCTIONS,
		prompt: mockExamGraderPrompt(input),
		extraTools,
		maxTurns: opts.maxTurns ?? (scan ? 40 : 6),
		signal: opts.abortSignal,
		chatId: opts.chatId,
		onStep: (usage) => opts.onUsage?.(usage),
		onToolStart: (toolName, args) => {
			const p = (args as { path?: unknown } | undefined)?.path;
			opts.onActivity?.(toolName === "read" && typeof p === "string" ? `leser ${p.split("/").pop()}` : "setter poeng");
		},
		neverSubmitted: "the grader never submitted a valid grading",
	});
}
