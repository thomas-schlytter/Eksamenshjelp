/**
 * PRØVEEKSAMEN (fase 6, 2026-11) — the mock-exam contract and its pure rules.
 *
 * A mock exam is generated per course by a background sub-agent that reads
 * the course's past exams and solutions, so the paper has the same form as
 * the real ones: the cover (code, name, date, duration, aids, page count),
 * numbered tasks with lettered parts, points or percent per part, the same
 * share of multiple choice, Norwegian bokmål. The structured exam carries the
 * answer key (correct option, solution, grading guide) next to the tasks;
 * `publicMockExam` strips it, and only the public shape ever leaves the
 * server before the paper is graded.
 *
 * Grading turns one grade per part (the grader sub-agent's submission) into
 * a stored MockExamResult: points per part, per task and in total, the
 * percent, and a letter grade only when the exam carries a known grade scale
 * (found in the course material; never assumed). The solution text is
 * released with the result — after sensur, as NTNU publishes its
 * løsningsforslag.
 *
 * Pure and browser-safe: no IO here. Persistence is src/store/mock-exams.ts.
 */

/** What «Lag prøveeksamen» sends: the request the agent answers with mock_exam.
 *  Lives here (not in the card) so the course page needn't pull in the chat. */
export const MAKE_MOCK_EXAM_TEXT = "Lag en prøveeksamen for meg.";

// ─── Types ───────────────────────────────────────────────────────────────────

export type MockExamScoring = "points" | "percent";

export interface MockExamOption {
	/** "a", "b", … — what the learner picks and the key names. */
	id: string;
	/** Markdown + LaTeX. */
	text: string;
}

export interface MockExamPart {
	/** "a", "b", … — "" when the task has a single unlettered part. */
	label: string;
	/** The part's task text, markdown + LaTeX ($…$, $$…$$). */
	text: string;
	/** Points, or percent of the exam when scoring is "percent". */
	points: number;
	/** Optional figure for this part (complete <svg> markup). */
	figureSvg?: string;
	/** Present = multiple choice (2–8 options). */
	options?: MockExamOption[];
	/** HIDDEN — the correct option's id (multiple choice only). */
	correctOption?: string;
	/** HIDDEN — the full løsningsforslag for this part. */
	solution: string;
	/** HIDDEN — the retteveiledning: what earns the points, partial credit. */
	rubric: string;
}

export interface MockExamTask {
	/** "1", "2", … or "1.1" — unique within the exam. */
	number: string;
	/** Short title as on the past papers ("Eulers metode"); optional. */
	title?: string;
	/** Shared setup for the parts, markdown + LaTeX. */
	intro?: string;
	/** Optional figure for the whole task (complete <svg> markup). */
	figureSvg?: string;
	/** Course topic ids this task examines (from the course's topic list). */
	topicIds?: string[];
	parts: MockExamPart[];
}

export interface MockExamCover {
	/** As written on the cover, e.g. "1. desember 2026". */
	date: string;
	/** "09.00–13.00" when the past papers state a time. */
	time?: string;
	durationMinutes: number;
	/** The aids line, e.g. "D: Ingen trykte eller håndskrevne hjelpemidler tillatt. Bestemt, enkel kalkulator tillatt." */
	aids: string;
	/** "Annen informasjon" lines, as on the past papers. */
	info?: string[];
}

export interface MockExamGradeBand {
	grade: string;
	/** Lowest percent that earns this grade. */
	minPercent: number;
}

export interface MockExamGradeScale {
	/** Where the scale is stated (a file path and page, or the course page). */
	source: string;
	bands: MockExamGradeBand[];
}

export interface MockExam {
	/** "mx_…" — filename-safe, unique. */
	id: string;
	code: string;
	courseName: string;
	title: string;
	createdAt: string;
	scoring: MockExamScoring;
	cover: MockExamCover;
	tasks: MockExamTask[];
	/** The past exams and solutions the form was taken from (paths). */
	basedOn: string[];
	/** The topics the paper leans on (red and yellow ones). */
	focusTopicIds?: string[];
	/** Present only when the course material states a grade scale. */
	gradeScale?: MockExamGradeScale;
	/** Pages without the cover, set after the PDF render. */
	pageCount?: number;
}

/** What the generator submits: everything but the app-assigned fields. */
export type MockExamDraft = Omit<MockExam, "id" | "code" | "courseName" | "createdAt" | "pageCount">;

export type PublicMockExamPart = Omit<MockExamPart, "correctOption" | "solution" | "rubric">;
export type PublicMockExamTask = Omit<MockExamTask, "parts"> & { parts: PublicMockExamPart[] };
export type PublicMockExam = Omit<MockExam, "tasks"> & { tasks: PublicMockExamTask[] };

/** The learner's digital answers (the draft, saved while he writes). */
export interface MockExamAnswers {
	examId: string;
	/** partKey → answer (free text with LaTeX, or a chosen option id). */
	answers: Record<string, string>;
	/** When he started the countdown (ISO); absent = no timer. */
	timerStartedAt?: string;
	/** «Hard mode» (owner, 2026-11-23): chosen when the countdown starts —
	 *  like the real exam, the answers are handed in automatically when the
	 *  time runs out. Without it the view only says «Tiden er ute». */
	hardMode?: boolean;
	updatedAt: string;
	/** Set once at «Lever»: the answers are frozen from then on. */
	submittedAt?: string;
}

/** One graded part, as the grader submits it. */
export interface MockExamPartGradeInput {
	/** partKey, e.g. "1a", "6", "1.3". */
	part: string;
	points: number;
	/** Short reason for the points, in Norwegian. */
	comment: string;
	/** What was missing for full points ("" when nothing). */
	missing: string;
}

export interface MockExamPartGrade {
	key: string;
	task: string;
	label: string;
	points: number;
	max: number;
	comment: string;
	missing: string;
	/** Released with the result: the part's løsningsforslag. */
	solution: string;
	/** Multiple choice: the correct option id, released with the result. */
	correctOption?: string;
}

export interface MockExamTaskScore {
	number: string;
	points: number;
	max: number;
}

export interface MockExamResult {
	/** "mr_…" */
	id: string;
	examId: string;
	code: string;
	title: string;
	gradedAt: string;
	/** digital = answered in the app; scan = handed in as files. */
	source: "digital" | "scan";
	files?: string[];
	scoring: MockExamScoring;
	points: number;
	max: number;
	/** 0–100, rounded to a whole percent. */
	percent: number;
	/** Letter grade estimate — only with a known grade scale. */
	grade?: string;
	gradeScaleSource?: string;
	tasks: MockExamTaskScore[];
	parts: MockExamPartGrade[];
	/** Per course topic: the points the tasks on it earned. */
	topics: Array<{ topicId: string; points: number; max: number }>;
	/** The grader's overall summary, in Norwegian. */
	summary: string;
}

/** The card payload the generation job delivers (public facts only). */
export interface MockExamJobResult {
	/** "" = the generation failed (see notes). */
	examId: string;
	code: string;
	title: string;
	taskCount: number;
	durationMinutes: number;
	scoring: MockExamScoring;
	totalPoints: number;
	/** 0–100: the multiple-choice share of the points. */
	multipleChoicePercent: number;
	pageCount?: number;
	/** Absent when the PDF could not be made (the exam still exists). */
	pdfPath?: string;
	pdfError?: string;
	notes?: string;
}

/** The card payload the grading job delivers. "" examId = failed. */
export interface MockGradeJobResult {
	examId: string;
	resultId: string;
	result?: MockExamResult;
	notes?: string;
}

// ─── Small rules ─────────────────────────────────────────────────────────────

export const MOCK_EXAM_ID_PATTERN = /^mx_[a-z0-9_]{4,40}$/;
export const MOCK_RESULT_ID_PATTERN = /^mr_[a-z0-9_]{4,40}$/;
const TASK_NUMBER_PATTERN = /^\d{1,2}(\.\d{1,2})?$/;
const PART_LABEL_PATTERN = /^[a-z]{0,4}$/;
const OPTION_ID_PATTERN = /^[a-z0-9]{1,3}$/;
export const MAX_ANSWER_CHARS = 20_000;
const MAX_TASKS = 40;
const MAX_PARTS = 12;

export function isMockExamId(value: unknown): value is string {
	return typeof value === "string" && MOCK_EXAM_ID_PATTERN.test(value);
}

/** The id the answers, grades and results key a part by. */
export function partKey(task: Pick<MockExamTask, "number">, part: Pick<MockExamPart, "label">): string {
	return `${task.number}${part.label}`;
}

/** "Oppgave 1a" / "Oppgave 6" — what the learner reads. */
export function partName(task: Pick<MockExamTask, "number">, part: Pick<MockExamPart, "label">): string {
	return `Oppgave ${task.number}${part.label ? ` ${part.label})` : ""}`;
}

export function allParts<T extends { number: string; parts: Array<{ label: string }> }>(exam: { tasks: T[] }): Array<{ task: T; part: T["parts"][number]; key: string }> {
	return exam.tasks.flatMap((task) => task.parts.map((part) => ({ task, part, key: partKey(task, part) })));
}

/** One decimal at most: grading in halves stays exact, float noise goes. */
export function roundPoints(value: number): number {
	return Math.round(value * 10) / 10;
}

export function totalPoints(exam: { tasks: Array<{ parts: Array<{ points: number }> }> }): number {
	return roundPoints(exam.tasks.reduce((sum, t) => sum + t.parts.reduce((s, p) => s + p.points, 0), 0));
}

export function taskPoints(task: { parts: Array<{ points: number }> }): number {
	return roundPoints(task.parts.reduce((s, p) => s + p.points, 0));
}

/** The multiple-choice share of the points, 0–100 (whole percent). */
export function multipleChoicePercent(exam: { tasks: Array<{ parts: Array<{ points: number; options?: unknown[] }> }> }): number {
	const total = totalPoints(exam);
	if (total <= 0) return 0;
	const mc = exam.tasks.reduce((sum, t) => sum + t.parts.reduce((s, p) => s + (p.options && p.options.length > 0 ? p.points : 0), 0), 0);
	return Math.round((mc / total) * 100);
}

/** "(4 poeng)" / "(2 %)" — the points label as on the paper. */
export function pointsLabel(points: number, scoring: MockExamScoring): string {
	const n = String(roundPoints(points)).replace(".", ",");
	return scoring === "percent" ? `${n} %` : `${n} poeng`;
}

/** "4 timer", "3 timer 30 min", "90 min". */
export function durationLabel(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h === 0) return `${m} min`;
	const hours = `${h} ${h === 1 ? "time" : "timer"}`;
	return m ? `${hours} ${m} min` : hours;
}

/** The answer key never leaves the server before grading. */
export function publicMockExam(exam: MockExam): PublicMockExam {
	return {
		...exam,
		tasks: exam.tasks.map((task) => ({
			...task,
			parts: task.parts.map(({ correctOption: _c, solution: _s, rubric: _r, ...part }) => part),
		})),
	};
}

/** The card facts for a stored exam. */
export function mockExamJobResult(exam: MockExam, pdf: { pdfPath?: string; pdfError?: string }): MockExamJobResult {
	return {
		examId: exam.id,
		code: exam.code,
		title: exam.title,
		taskCount: exam.tasks.length,
		durationMinutes: exam.cover.durationMinutes,
		scoring: exam.scoring,
		totalPoints: totalPoints(exam),
		multipleChoicePercent: multipleChoicePercent(exam),
		...(exam.pageCount !== undefined ? { pageCount: exam.pageCount } : {}),
		...(pdf.pdfPath ? { pdfPath: pdf.pdfPath } : {}),
		...(pdf.pdfError ? { pdfError: pdf.pdfError } : {}),
	};
}

/** The SVG namespace on the root when the author left it out — renderers
 *  (resvg, an <img> data URI) refuse a namespace-less SVG. */
export function withSvgNamespace(svg: string): string {
	const root = svg.slice(0, svg.indexOf(">") + 1);
	return /\sxmlns\s*=/.test(root) ? svg : svg.replace(/^\s*<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
}

// ─── Validation (the generator's submit seam) ────────────────────────────────

const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function svgProblem(svg: unknown, where: string): string | null {
	if (svg === undefined) return null;
	if (typeof svg !== "string" || !/^\s*<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) {
		return `${where}: figureSvg must be one complete <svg>…</svg> document (or be left out)`;
	}
	if (svg.length > 200_000) return `${where}: figureSvg is too large (keep it under 200 000 characters)`;
	return null;
}

/**
 * Every rule the structured exam must satisfy, as model-facing problems
 * (empty = valid). The schema gives the shape; these are the cross-field
 * laws: unique numbering, a key for every part, sane points, a 100 % sum in
 * percent mode, a known topic for every topic id.
 */
export function mockExamProblems(draft: MockExamDraft, opts: { topicIds?: readonly string[] } = {}): string[] {
	const problems: string[] = [];
	if (!isText(draft.title)) problems.push("title is empty");
	if (draft.scoring !== "points" && draft.scoring !== "percent") problems.push('scoring must be "points" or "percent"');
	const cover = draft.cover;
	if (!cover || !isText(cover.date)) problems.push("cover.date is empty");
	if (!cover || !Number.isFinite(cover.durationMinutes) || cover.durationMinutes < 15 || cover.durationMinutes > 600) {
		problems.push("cover.durationMinutes must be between 15 and 600");
	}
	if (!cover || !isText(cover.aids)) problems.push("cover.aids is empty — copy the aids line the past papers use");
	if (!Array.isArray(draft.tasks) || draft.tasks.length === 0) {
		problems.push("tasks is empty");
		return problems;
	}
	if (draft.tasks.length > MAX_TASKS) problems.push(`at most ${MAX_TASKS} tasks`);
	const knownTopics = opts.topicIds ? new Set(opts.topicIds) : null;
	const numbers = new Set<string>();
	for (const task of draft.tasks) {
		const where = `task ${JSON.stringify(task.number)}`;
		if (!TASK_NUMBER_PATTERN.test(task.number ?? "")) problems.push(`${where}: number must look like "1", "12" or "1.3"`);
		if (numbers.has(task.number)) problems.push(`${where}: duplicate task number`);
		numbers.add(task.number);
		const figure = svgProblem(task.figureSvg, where);
		if (figure) problems.push(figure);
		for (const id of task.topicIds ?? []) {
			if (knownTopics && !knownTopics.has(id)) problems.push(`${where}: topicId ${JSON.stringify(id)} is not a topic of this course — copy an id from the topic list or leave it out`);
		}
		if (!Array.isArray(task.parts) || task.parts.length === 0) {
			problems.push(`${where}: parts is empty`);
			continue;
		}
		if (task.parts.length > MAX_PARTS) problems.push(`${where}: at most ${MAX_PARTS} parts`);
		const labels = new Set<string>();
		for (const part of task.parts) {
			const at = `${where} part ${JSON.stringify(part.label)}`;
			if (!PART_LABEL_PATTERN.test(part.label ?? "")) problems.push(`${at}: label must be "" or lower-case letters like "a", "b"`);
			if (labels.has(part.label)) problems.push(`${at}: duplicate part label`);
			labels.add(part.label);
			if (task.parts.length > 1 && part.label === "") problems.push(`${at}: a task with several parts letters every part ("a", "b", …)`);
			if (!isText(part.text)) problems.push(`${at}: text is empty`);
			if (!Number.isFinite(part.points) || part.points <= 0 || part.points > 100) problems.push(`${at}: points must be a positive number`);
			if (!isText(part.solution)) problems.push(`${at}: solution is empty — every part needs its full løsningsforslag`);
			if (!isText(part.rubric)) problems.push(`${at}: rubric is empty — every part needs a retteveiledning`);
			const figure = svgProblem(part.figureSvg, at);
			if (figure) problems.push(figure);
			if (part.options !== undefined) {
				const ids = part.options.map((o) => o.id);
				if (part.options.length < 2 || part.options.length > 8) problems.push(`${at}: a multiple-choice part has 2–8 options`);
				if (ids.some((id) => !OPTION_ID_PATTERN.test(id))) problems.push(`${at}: option ids are short lower-case ids like "a", "b"`);
				if (new Set(ids).size !== ids.length) problems.push(`${at}: duplicate option id`);
				if (part.options.some((o) => !isText(o.text))) problems.push(`${at}: an option text is empty`);
				if (!part.correctOption || !ids.includes(part.correctOption)) problems.push(`${at}: correctOption must be one of the option ids (${ids.join(", ")})`);
			} else if (part.correctOption !== undefined) {
				problems.push(`${at}: correctOption is set but the part has no options`);
			}
		}
	}
	if (draft.scoring === "percent") {
		const sum = totalPoints(draft);
		if (Math.abs(sum - 100) > 0.01) problems.push(`scoring is "percent" but the parts sum to ${sum} % — they must sum to exactly 100`);
	}
	if (draft.gradeScale) {
		const bands = draft.gradeScale.bands ?? [];
		if (!isText(draft.gradeScale.source)) problems.push("gradeScale.source is empty — leave gradeScale out unless the material states the scale");
		if (bands.length < 2) problems.push("gradeScale.bands needs every grade of the scale");
		if (bands.some((b) => !isText(b.grade) || !Number.isFinite(b.minPercent) || b.minPercent < 0 || b.minPercent > 100)) {
			problems.push("gradeScale.bands: each band is a grade and a minPercent from 0 to 100");
		}
	}
	return problems;
}

// ─── Answers ─────────────────────────────────────────────────────────────────

/** Keep only answers to real parts, as strings within the size bound. */
export function sanitizeAnswers(exam: { tasks: Array<{ number: string; parts: Array<{ label: string }> }> }, raw: unknown): Record<string, string> {
	const keys = new Set(allParts(exam).map((p) => p.key));
	const out: Record<string, string> = {};
	if (typeof raw !== "object" || raw === null) return out;
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (keys.has(key) && typeof value === "string") out[key] = value.slice(0, MAX_ANSWER_CHARS);
	}
	return out;
}

/** The digital answers as the grader reads them: one block per part. */
export function answersText(exam: MockExam | PublicMockExam, answers: Record<string, string>): string {
	return allParts(exam)
		.map(({ task, part, key }) => {
			const raw = answers[key]?.trim() ?? "";
			const options = part.options;
			let body: string;
			if (options && options.length > 0) {
				const picked = options.find((o) => o.id === raw);
				body = picked ? `Chosen option: ${picked.id}) ${picked.text}` : "(no option chosen)";
			} else {
				body = raw || "(blank)";
			}
			return `### ${partName(task, part)} [part ${key}]\n${body}`;
		})
		.join("\n\n");
}

// ─── Grading (the grader's submit seam → the stored result) ─────────────────

/** Problems with a grade submission (empty = valid): every part exactly once,
 *  points between 0 and the part's maximum. */
export function gradeProblems(exam: MockExam, grades: readonly MockExamPartGradeInput[]): string[] {
	const problems: string[] = [];
	const maxByKey = new Map(allParts(exam).map(({ part, key }) => [key, part.points]));
	const seen = new Set<string>();
	for (const g of grades) {
		const max = maxByKey.get(g.part);
		if (max === undefined) {
			problems.push(`part ${JSON.stringify(g.part)} is not a part of this exam — use the [part …] keys exactly`);
			continue;
		}
		if (seen.has(g.part)) problems.push(`part ${g.part} is graded twice`);
		seen.add(g.part);
		if (!Number.isFinite(g.points) || g.points < 0 || g.points > max + 1e-9) problems.push(`part ${g.part}: points must be between 0 and ${max}`);
		if (!isText(g.comment)) problems.push(`part ${g.part}: comment is empty`);
	}
	const missing = [...maxByKey.keys()].filter((k) => !seen.has(k));
	if (missing.length > 0) problems.push(`not graded yet: ${missing.join(", ")} — grade every part, 0 points for blank or missing answers`);
	return problems;
}

/** NTNU's recommended percent scale (owner, 2026-11-23: the default when the
 *  course material states no scale of its own). */
export const NTNU_DEFAULT_GRADE_SCALE: MockExamGradeScale = {
	source: "NTNUs anbefalte karakterskala",
	bands: [
		{ grade: "A", minPercent: 89 },
		{ grade: "B", minPercent: 77 },
		{ grade: "C", minPercent: 65 },
		{ grade: "D", minPercent: 53 },
		{ grade: "E", minPercent: 41 },
		{ grade: "F", minPercent: 0 },
	],
};

/** The scale a result is graded on: the exam's own, else NTNU's default. */
export function effectiveGradeScale(exam: Pick<MockExam, "gradeScale">): MockExamGradeScale {
	return exam.gradeScale && exam.gradeScale.bands.length > 0 ? exam.gradeScale : NTNU_DEFAULT_GRADE_SCALE;
}

/** The letter grade for a percent on a scale (highest band first). */
export function gradeFor(percent: number, scale: MockExamGradeScale | undefined): string | undefined {
	if (!scale || scale.bands.length === 0) return undefined;
	const bands = [...scale.bands].sort((a, b) => b.minPercent - a.minPercent);
	return bands.find((b) => percent >= b.minPercent)?.grade;
}

/** Build the stored result from a VALID grade submission (gradeProblems empty). */
export function computeMockExamResult(
	exam: MockExam,
	grades: readonly MockExamPartGradeInput[],
	meta: { id: string; gradedAt: string; source: "digital" | "scan"; files?: string[]; summary: string },
): MockExamResult {
	const byKey = new Map(grades.map((g) => [g.part, g]));
	const parts: MockExamPartGrade[] = allParts(exam).map(({ task, part, key }) => {
		const g = byKey.get(key);
		return {
			key,
			task: task.number,
			label: part.label,
			points: roundPoints(Math.min(part.points, Math.max(0, g?.points ?? 0))),
			max: part.points,
			comment: g?.comment.trim() ?? "",
			missing: g?.missing.trim() ?? "",
			solution: part.solution,
			...(part.correctOption ? { correctOption: part.correctOption } : {}),
		};
	});
	const tasks: MockExamTaskScore[] = exam.tasks.map((task) => {
		const own = parts.filter((p) => p.task === task.number);
		return { number: task.number, points: roundPoints(own.reduce((s, p) => s + p.points, 0)), max: taskPoints(task) };
	});
	const points = roundPoints(parts.reduce((s, p) => s + p.points, 0));
	const max = totalPoints(exam);
	const percent = max > 0 ? Math.round((points / max) * 100) : 0;
	const topicTotals = new Map<string, { points: number; max: number }>();
	for (const task of exam.tasks) {
		const score = tasks.find((t) => t.number === task.number)!;
		for (const topicId of task.topicIds ?? []) {
			const acc = topicTotals.get(topicId) ?? { points: 0, max: 0 };
			acc.points += score.points;
			acc.max += score.max;
			topicTotals.set(topicId, acc);
		}
	}
	const scale = effectiveGradeScale(exam);
	const grade = gradeFor(percent, scale);
	return {
		id: meta.id,
		examId: exam.id,
		code: exam.code,
		title: exam.title,
		gradedAt: meta.gradedAt,
		source: meta.source,
		...(meta.files && meta.files.length > 0 ? { files: meta.files } : {}),
		scoring: exam.scoring,
		points,
		max,
		percent,
		...(grade ? { grade, gradeScaleSource: scale.source } : {}),
		tasks,
		parts,
		topics: [...topicTotals].map(([topicId, t]) => ({ topicId, points: roundPoints(t.points), max: roundPoints(t.max) })),
		summary: meta.summary.trim(),
	};
}

// ─── What the conversation agent reads when a job lands ─────────────────────

/** The generation steer (model-facing): public facts only — the key stays
 *  with the grader until the paper is graded. */
export function mockExamSteerText(r: MockExamJobResult): string {
	if (!r.examId) {
		return `The mock exam could not be made: ${r.notes ?? "unknown reason"}. Tell the learner in one line, and offer to try again (a new mock_exam call, with a narrower focus if the material was the problem).`;
	}
	const pdf = r.pdfPath
		? `The PDF (${r.pageCount !== undefined ? `${r.pageCount} pages after the cover` : "page count unknown"}) is saved at ${r.pdfPath}.`
		: `The PDF could not be made (${r.pdfError ?? "unknown reason"}); he can still answer in the app.`;
	return (
		`The mock exam is ready: "${r.title}" (exam id "${r.examId}") — ${r.taskCount} tasks, ${durationLabel(r.durationMinutes)}, ` +
		`${r.scoring === "percent" ? "weighted in percent (100 % in total)" : `${r.totalPoints} points in total`}, ${r.multipleChoicePercent} % multiple choice. ` +
		`${pdf} Its card is shown right here, with «Åpne PDF», «Svar i appen» and «Legg inn besvarelse». ` +
		"Tell him in two or three sentences what the paper covers and how to take it: under exam conditions, with the time limit and only the permitted aids, " +
		"on paper (then hand in a scan or photos) or in the app. You have NOT seen the answer key, and you give no hints, method tips or solutions to its tasks " +
		"while he is taking it. When he hands it in (a message naming this exam id, digitally or with files), call grade_mock_exam."
	);
}

/** The grading steer (model-facing): the full result, released key
 *  included, and what to do with it. */
export function mockGradeSteerText(r: MockGradeJobResult): string {
	const res = r.result;
	if (!res) {
		return `The mock exam (exam id "${r.examId}") could not be graded: ${r.notes ?? "unknown reason"}. Tell the learner in one line what went wrong; grade_mock_exam can be called again (for example with readable files).`;
	}
	const unit = res.scoring === "percent" ? "%" : "p";
	const lines = [
		`The mock exam "${res.title}" (exam id "${res.examId}") is graded: ${res.points}/${res.max} ${unit} (${res.percent} %)` +
			(res.grade ? `, grade estimate ${res.grade} (scale: ${res.gradeScaleSource})` : ", no known grade scale (percent only)") +
			`. The result card with points per task and the løsningsforslag is shown right here. Grader summary: ${res.summary}`,
		"",
		"Per part (points / max — comment — what was missing):",
		...res.parts.map((p) => `- ${p.key}: ${p.points}/${p.max} — ${p.comment}${p.missing ? ` — missing: ${p.missing}` : ""}`),
	];
	if (res.topics.length > 0) {
		lines.push("", "Per course topic (points / max on the tasks that examine it):", ...res.topics.map((t) => `- [${t.topicId}] ${t.points}/${t.max}`));
	}
	lines.push(
		"",
		"Now, in this turn: (1) give him the result in a few sentences — the total, the strongest and the weakest tasks; do not repeat the card line by line. " +
			"(2) Say concretely what he should work on next, ordered by how many points it costs him on the exam. " +
			"(3) Update the evidence with the usual rules: topic_status for each course topic the result says something about (red or yellow from weak tasks; " +
			"a strong task supports green only where the approval rule allows it), and, once the plan map exists, plan_status on the nodes it touches, each reason naming the task. " +
			"(4) Adapt the plan: tell him what you take first, then start on it.",
	);
	return lines.join("\n");
}
