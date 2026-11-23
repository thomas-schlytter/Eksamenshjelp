import { createRequire } from "node:module";
import { Type, type Static } from "typebox";
import type { Usage } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { PiEngine } from "../models.ts";
import { createReadTool } from "../tools/read.ts";
import { lsTool } from "../tools/ls.ts";
import { findTool } from "../tools/find.ts";
import { grepTool } from "../tools/grep.ts";
import { runSubmitAgent } from "./submit-agent.ts";
import { mockExamProblems, withSvgNamespace, type MockExamDraft } from "../../core/mock-exam.ts";
import type { Course } from "../../core/courses.ts";

/**
 * THE PRØVEEKSAMEN GENERATOR (fase 6): a background sub-agent that reads the
 * course's past exams and solutions with the learner-file tools, then
 * submits ONE structured mock exam of the same form — cover, numbering,
 * points, multiple-choice share, task types, bokmål — leaning on the
 * learner's red and yellow topics. The answer key (correct options, full
 * solutions, grading guide) is part of the submission; the app strips it
 * from everything the learner sees until the paper is graded.
 *
 * Figures are hand-authored SVG inside the submission (the brief's "write
 * SVG directly" path): a submit whose SVG does not parse (resvg, the same
 * rasterizer the visual-maker uses) is refused, so the model fixes it before
 * the paper exists.
 */

const optionSchema = Type.Object({
	id: Type.String({ description: 'Short lower-case id: "a", "b", "c", …' }),
	text: Type.String({ description: "The option, markdown + LaTeX ($…$)." }),
});

const partSchema = Type.Object({
	label: Type.String({ description: 'Part letter: "a", "b", … — "" only when the task has exactly one unlettered part.' }),
	text: Type.String({ description: "The part's task text exactly as on the paper: markdown + LaTeX ($…$ inline, $$…$$ display). No hints unless the past papers print a «Vink» like it." }),
	points: Type.Number({ description: 'Points for this part — or its percent of the exam when scoring is "percent".' }),
	figureSvg: Type.Optional(Type.String({ description: "Optional figure for this part: one complete <svg>…</svg> with a viewBox, black on white, labels in the figure." })),
	options: Type.Optional(Type.Array(optionSchema, { description: "Present only for a multiple-choice part: 2–8 options." })),
	correctOption: Type.Optional(Type.String({ description: "HIDDEN KEY — the correct option's id (multiple choice only)." })),
	solution: Type.String({ description: "HIDDEN KEY — the full løsningsforslag in Norwegian: the working and the final answer, as an NTNU solution sheet writes it." }),
	rubric: Type.String({ description: "HIDDEN KEY — the retteveiledning in Norwegian: what earns the points, partial credit, typical errors and what they cost." }),
});

const taskSchema = Type.Object({
	number: Type.String({ description: 'Task number as on the past papers: "1", "2", … (or "1.1" when they number that way).' }),
	title: Type.Optional(Type.String({ description: "Short task title, only if the past papers title their tasks." })),
	intro: Type.Optional(Type.String({ description: "The shared setup the parts build on (markdown + LaTeX)." })),
	figureSvg: Type.Optional(Type.String({ description: "Optional figure for the whole task: one complete <svg>…</svg>." })),
	topicIds: Type.Optional(Type.Array(Type.String(), { description: "The course topic ids this task examines, copied from the topic list." })),
	parts: Type.Array(partSchema),
});

export const mockExamSubmitSchema = Type.Object({
	title: Type.String({ description: 'E.g. "Prøveeksamen i TTK4100 Kybernetikk, introduksjon".' }),
	scoring: Type.Union([Type.Literal("points"), Type.Literal("percent")], {
		description: 'How the past papers state the weight: "points" (poeng per oppgave) or "percent" (% of the exam; then every part\'s points sum to exactly 100).',
	}),
	cover: Type.Object({
		date: Type.String({ description: 'Cover date in Norwegian, e.g. "1. desember 2026" — the course\'s exam date when known.' }),
		time: Type.Optional(Type.String({ description: 'Exam time as the cover writes it, e.g. "09.00–13.00".' })),
		durationMinutes: Type.Number({ description: "The real exam's duration in minutes." }),
		aids: Type.String({ description: "The aids line (hjelpemiddelkode and text) copied from the most recent paper." }),
		info: Type.Optional(Type.Array(Type.String(), { description: "«Annen informasjon» lines as the recent covers have them (only what applies to a paper exam)." })),
	}),
	tasks: Type.Array(taskSchema),
	basedOn: Type.Array(Type.String(), { description: "The paths of the past exams and solutions you read." }),
	focusTopicIds: Type.Optional(Type.Array(Type.String(), { description: "The topic ids you gave extra weight." })),
	gradeScale: Type.Optional(Type.Object({
		source: Type.String({ description: "Where the material states the scale (file path and page)." }),
		bands: Type.Array(Type.Object({ grade: Type.String(), minPercent: Type.Number() })),
	}, { description: "ONLY when the course material states a grade scale (percent limits per letter grade). Never assume one." })),
});

type Submission = Static<typeof mockExamSubmitSchema>;

export const MOCK_EXAM_MAKER_INSTRUCTIONS = `You are an exam author for one NTNU course. You write ONE mock exam (prøveeksamen) that a student cannot tell apart from the real exam's form: same cover, same numbering, same weighting style, same share of multiple choice, same kinds of tasks, same length for the same duration, in Norwegian bokmål. You never see the student's lessons; the course facts and the student's topic status below are everything you know about him.

## 1. Read the past exams first

Before you write anything, find and read the material with your tools:
- The course's sources are listed below. List the folders (\`ls\`, \`find\`), read any overview file (OVERSIKT.md, README) first, then the past exams and their solutions (løsningsforslag, LF).
- \`read\` opens PDFs page by page (page text plus page images for scans, figures and math; use \`pages\` for a range). Read at least the three most recent exams completely and their solutions, more if the format changed recently. The most recent papers decide the form.
- From them, write down for yourself: the cover facts (exact aids line, time, «Annen informasjon» that applies to a paper exam), the numbering and part lettering, how weight is stated (poeng or %), the points per task and per part, the share of points that is multiple choice (or true/false), the recurring task types per topic and how often each appears, and how many tasks fill the duration.
- If the sources say something about the format that the papers don't show (for example "30 % flervalg"), follow the sources.

## 2. Design the paper

- Same form as the recent papers. Keep every recurring core task type that almost every past exam has; a student who trained on the past exams must recognize the paper.
- Lean on his weak topics: topics marked red or yellow get more of the variable tasks and points — but never so much that the paper stops looking like the real exam. As a rule, at most a third of the points move away from the usual distribution. Topics he has not been assessed on are treated like yellow.
- If the learner's request (below) asks for something specific (a part of the exam, certain topics, a shorter paper), follow it and keep the rest of the form.
- NEW tasks: the same type and level as the past tasks, with new numbers, new systems, new setups. Never copy a past task.
- Exam form only: the task text as the paper prints it. No hints, method tips or "show this" lists — except a «Vink» where the past papers print one for that kind of task.
- Multiple choice exactly as on the papers (true/false as two options "Sant"/"Usant" when that is the form). Options uniform in length and style; the correct one must not stand out.
- Points: the same scale and granularity as the past papers. With scoring "percent", all parts sum to exactly 100.
- Cover date: the course's exam date when known, else today's date, written in Norwegian ("1. desember 2026"). Duration: the real exam's.

## 3. Figures

Where the corresponding past tasks have a figure (a block diagram, a circuit, a mechanical system, a graph), draw one as SVG in figureSvg: one complete <svg> with a viewBox, black strokes on white, readable labels (font-size ≥ 12 in viewBox units), nothing clipped, every label and arrow true to the task text. No script, no external images.

## 4. The key (hidden from the student until the paper is graded)

For every part: the full løsningsforslag (working and final answer, as an NTNU solution sheet writes it) and a retteveiledning (what earns full points, what earns partial credit, typical errors and their cost). For multiple choice, correctOption. Before you submit, solve every task yourself from the task text alone and check every number: a task with a wrong key or a missing given is worse than no task.

## 5. Submit

Call submit_mock_exam exactly once with the whole paper. List the files you read in basedOn. Set gradeScale only when the material states the percent limits per grade (cite where); otherwise leave it out. If the submission is refused, fix exactly what the message says and submit again.`;

export interface MockExamMakerInput {
	course: Pick<Course, "code" | "name" | "exam" | "sources" | "topics" | "content" | "learningOutcome">;
	/** What the learner asked for, if anything. */
	focus?: string;
	/** YYYY-MM-DD, the learner's today. */
	today: string;
}

export interface MockExamMakerOptions {
	engine?: PiEngine;
	abortSignal?: AbortSignal;
	chatId?: string;
	onUsage?: (usage: Usage) => void;
	onActivity?: (line: string) => void;
	/** Max model calls (reading many PDFs takes many). Default 80. */
	maxTurns?: number;
	/** Test seam: replaces the SVG parse check (resvg). */
	svgProblem?: (svg: string) => string | null;
}

/** The model-facing prompt: course facts, sources, topic status, request. */
export function mockExamMakerPrompt(input: MockExamMakerInput): string {
	const { course } = input;
	const exam = course.exam;
	const lines: string[] = [
		`Course: ${course.code} ${course.name}`,
		`Today: ${input.today}`,
		`Exam facts on record: ${[
			exam.date ? `date ${exam.date}` : "date not set",
			exam.form,
			exam.duration ? `duration ${exam.duration}` : undefined,
			exam.aids ? `aids: ${exam.aids}` : undefined,
		].filter(Boolean).join("; ")}`,
	];
	if (exam.parts && exam.parts.length > 1) {
		lines.push("Assessment parts: " + exam.parts.map((p) => `${p.form}${p.weighting ? ` (${p.weighting})` : ""}`).join("; "));
	}
	if (course.content) lines.push("", "Course content:", course.content.slice(0, 2_000));
	lines.push("", "Sources (paths are on the student's machine):");
	if (course.sources.length === 0) lines.push("- (none)");
	for (const s of course.sources) {
		if (s.kind === "file" || s.kind === "folder") lines.push(`- ${s.kind === "folder" ? "Folder" : "File"}, ${s.title}: ${s.path}`);
		else if (s.kind === "note") lines.push(`- Note, ${s.title}: ${(s.text ?? "").slice(0, 2_000)}`);
		else if (s.url) lines.push(`- ${s.kind === "ntnu" ? "NTNU course page" : `Link, ${s.title}`}: ${s.url}`);
	}
	lines.push("", "Topics (id — title — exam relevance 1-3 — the student's status):");
	if (course.topics.length === 0) lines.push("- (no topic list; leave topicIds out)");
	for (const t of course.topics) lines.push(`- [${t.id}] ${t.title} — relevance ${t.weight} — ${t.status === "unknown" ? "not assessed" : t.status}${t.statusNote ? ` (${t.statusNote})` : ""}`);
	lines.push("", `The student's request: ${input.focus?.trim() ? input.focus.trim() : "(none — a full mock exam like the real one)"}`);
	lines.push("", "Read the past exams and solutions first, then submit the paper with submit_mock_exam.");
	return lines.join("\n");
}

let resvgModule: typeof import("@resvg/resvg-js") | null = null;

/** resvg parse check, synchronous (the submit seam is): the figure must
 *  render, or the paper would print an empty box. */
export function svgParseProblem(svg: string): string | null {
	try {
		resvgModule ??= createRequire(import.meta.url)("@resvg/resvg-js") as typeof import("@resvg/resvg-js");
		new resvgModule.Resvg(svg, { fitTo: { mode: "width", value: 400 } }).render();
		return null;
	} catch (err) {
		return `the SVG does not parse (${err instanceof Error ? err.message : String(err)})`;
	}
}

function activity(toolName: string, args: unknown): string {
	const a = (args ?? {}) as { path?: unknown; pattern?: unknown };
	const arg = typeof a.path === "string" ? a.path.split("/").pop() : typeof a.pattern === "string" ? a.pattern : "";
	const verb: Record<string, string> = { read: "leser", ls: "lister", find: "finner", grep: "søker" };
	if (toolName === "submit_mock_exam") return "setter sammen eksamen";
	return `${verb[toolName] ?? toolName}${arg ? ` ${arg}` : ""}`;
}

/** Run the generator; returns a VALID draft or throws with the reason. */
export async function runMockExamMaker(input: MockExamMakerInput, opts: MockExamMakerOptions): Promise<MockExamDraft> {
	const topicIds = input.course.topics.map((t) => t.id);
	const read = createReadTool(opts.engine?.model);
	const extraTools: Record<string, AgentTool<any>> = { read, ls: lsTool, find: findTool, grep: grepTool };
	const svgProblem = opts.svgProblem ?? svgParseProblem;
	return runSubmitAgent<MockExamDraft>({
		role: "teacher",
		engine: opts.engine,
		toolName: "submit_mock_exam",
		toolDescription:
			"Submit the whole mock exam: cover, tasks with lettered parts and points, multiple-choice options, figures as SVG, " +
			"and the hidden key (correctOption, solution and rubric for every part). Validated on submit; a refusal names what to fix.",
		parameters: mockExamSubmitSchema,
		fill: (raw: Submission) => {
			const draft: MockExamDraft = {
				title: raw.title.trim(),
				scoring: raw.scoring,
				cover: {
					date: raw.cover.date.trim(),
					...(raw.cover.time?.trim() ? { time: raw.cover.time.trim() } : {}),
					durationMinutes: Math.round(Number(raw.cover.durationMinutes)),
					aids: raw.cover.aids.trim(),
					...(raw.cover.info && raw.cover.info.length > 0 ? { info: raw.cover.info.map((l) => l.trim()).filter(Boolean) } : {}),
				},
				tasks: raw.tasks.map((t) => ({
					number: t.number.trim(),
					...(t.title?.trim() ? { title: t.title.trim() } : {}),
					...(t.intro?.trim() ? { intro: t.intro } : {}),
					...(t.figureSvg?.trim() ? { figureSvg: withSvgNamespace(t.figureSvg.trim()) } : {}),
					...(t.topicIds && t.topicIds.length > 0 ? { topicIds: t.topicIds } : {}),
					parts: t.parts.map((p) => ({
						label: p.label.trim().replace(/\)$/, "").toLowerCase(),
						text: p.text,
						points: Number(p.points),
						...(p.figureSvg?.trim() ? { figureSvg: withSvgNamespace(p.figureSvg.trim()) } : {}),
						...(p.options && p.options.length > 0 ? { options: p.options.map((o) => ({ id: o.id.trim().toLowerCase(), text: o.text })) } : {}),
						...(p.correctOption?.trim() ? { correctOption: p.correctOption.trim().toLowerCase() } : {}),
						solution: p.solution,
						rubric: p.rubric,
					})),
				})),
				basedOn: raw.basedOn ?? [],
				...(raw.focusTopicIds && raw.focusTopicIds.length > 0 ? { focusTopicIds: raw.focusTopicIds } : {}),
				...(raw.gradeScale ? { gradeScale: raw.gradeScale } : {}),
			};
			return draft;
		},
		validate: (draft) => {
			const problems = mockExamProblems(draft, { topicIds });
			for (const task of draft.tasks) {
				const figures: Array<[string, string | undefined]> = [
					[`task ${task.number}`, task.figureSvg],
					...task.parts.map((p): [string, string | undefined] => [`task ${task.number} part "${p.label}"`, p.figureSvg]),
				];
				for (const [where, svg] of figures) {
					const problem = svg ? svgProblem(svg) : null;
					if (problem) problems.push(`${where}: ${problem}`);
				}
			}
			return problems.length > 0 ? problems.join("; ") : null;
		},
		systemPrompt: MOCK_EXAM_MAKER_INSTRUCTIONS,
		prompt: mockExamMakerPrompt(input),
		extraTools,
		maxTurns: opts.maxTurns ?? 80,
		signal: opts.abortSignal,
		chatId: opts.chatId,
		onStep: (usage) => opts.onUsage?.(usage),
		onToolStart: (toolName, args) => opts.onActivity?.(activity(toolName, args)),
		neverSubmitted: "the generator never submitted a valid mock exam",
	});
}
