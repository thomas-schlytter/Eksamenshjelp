/**
 * Prøveeksamen (fase 6): the exam contract (validation, the public
 * projection, scoring), the store (exam, answers, results — and the
 * listMockExamResults read API), the paper (HTML without the key, the PDF
 * pipeline with a fake printer), the generation and grading jobs through the
 * real runner with a faux model, the two tools, and the HTTP routes.
 *
 * No browser and no Electron run here: the printer itself is replaced
 * (pdfPrinterOverride). What the real printer does is not covered.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, type FauxResponseStep, type ToolCall } from "@earendil-works/pi-ai";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-mock-exam-"));
process.env.LH_DATA_DIR = path.join(TMP, "data");
process.env.LH_AUTH_FILE = path.join(TMP, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");

const core = await import("../src/core/mock-exam.ts");
const { mockExamHtml, markdownToHtml } = await import("../src/core/mock-exam-html.ts");
const store = await import("../src/store/mock-exams.ts");
const { pdfPrinterOverride } = await import("../src/agent/subagents/pdf-print.ts");
const { renderMockExamPdf, katexCssForPrint } = await import("../src/server/mock-exam-pdf.ts");
const { createJobRunner, mockExamModelOverride, mockGradeModelOverride } = await import("../src/agent/subagents/runner.ts");
const { mockExamTools } = await import("../src/agent/tools/mock-exam.ts");
const { buildSubagentSteer, isSubagentFailure } = await import("../src/core/contracts.ts");
const { tinyPdf } = await import("./helpers/tiny-pdf.ts");
const viewRoute = await import("../app/api/mock-exams/[code]/[id]/route.ts");
const submitRoute = await import("../app/api/mock-exams/[code]/[id]/submit/route.ts");
const openRoute = await import("../app/api/mock-exams/[code]/[id]/open/route.ts");
const listRoute = await import("../app/api/mock-exams/[code]/route.ts");
const { mockExamSeams, openCommand } = await import("../src/server/mock-exams.ts");

import type { MockExam, MockExamDraft } from "../src/core/mock-exam.ts";
import type { JobRecord, SteerMessage } from "../src/core/contracts.ts";
import type { ChatStore, JobStore } from "../src/core/ports.ts";
import type { PiEngine } from "../src/agent/models.ts";

after(() => fs.rmSync(TMP, { recursive: true, force: true }));
beforeEach(() => {
	fs.rmSync(process.env.LH_DATA_DIR!, { recursive: true, force: true });
	pdfPrinterOverride.current = undefined;
	mockExamModelOverride.current = undefined;
	mockGradeModelOverride.current = undefined;
	mockExamSeams.open = undefined;
});

const SECRET_SOLUTION = "LOESNINGSFORSLAG-HEMMELIG";
const SECRET_RUBRIC = "RETTEVEILEDNING-HEMMELIG";

function draft(): MockExamDraft {
	return {
		title: "Prøveeksamen i TTK4100 Kybernetikk, introduksjon",
		scoring: "percent",
		cover: { date: "19. desember 2026", time: "09.00–13.00", durationMinutes: 240, aids: "D: Ingen trykte eller håndskrevne hjelpemidler tillatt.", info: ["Les oppgavene nøye."] },
		tasks: [
			{
				number: "1",
				title: "Eulers metode",
				topicIds: ["numerikk"],
				parts: [{
					label: "",
					text: "Eulers metode er stabil for alle steglengder.",
					points: 10,
					options: [{ id: "a", text: "Sant" }, { id: "b", text: "Usant" }],
					correctOption: "b",
					solution: `${SECRET_SOLUTION} Usant.`,
					rubric: `${SECRET_RUBRIC} 10 for b.`,
				}],
			},
			{
				number: "2",
				intro: "Gitt systemet $\\dot x = -2x + u$.",
				figureSvg: '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
				topicIds: ["stabilitet"],
				parts: [
					{ label: "a", text: "Finn $\\frac{X(s)}{U(s)}$.", points: 60, solution: `${SECRET_SOLUTION} 1/(s+2)`, rubric: `${SECRET_RUBRIC} 30 for form` },
					{ label: "b", text: "Er systemet stabilt?", points: 30, solution: `${SECRET_SOLUTION} ja`, rubric: `${SECRET_RUBRIC} begrunnelse` },
				],
			},
		],
		basedOn: ["/x/2024_Eksamen_TTK4100.pdf"],
		gradeScale: { source: "LF 2024 s. 1", bands: [{ grade: "A", minPercent: 89 }, { grade: "B", minPercent: 77 }, { grade: "C", minPercent: 65 }, { grade: "D", minPercent: 53 }, { grade: "E", minPercent: 41 }, { grade: "F", minPercent: 0 }] },
	};
}

function exam(id = "mx_test_0001"): MockExam {
	return { ...draft(), id, code: "TTK4100", courseName: "Kybernetikk, introduksjon", createdAt: "2026-11-23T10:00:00.000Z" };
}

const TOPICS = ["numerikk", "stabilitet"];

describe("the exam contract", () => {
	it("accepts a well-formed exam and computes its facts", () => {
		assert.deepEqual(core.mockExamProblems(draft(), { topicIds: TOPICS }), []);
		assert.equal(core.totalPoints(draft()), 100);
		assert.equal(core.multipleChoicePercent(draft()), 10);
		assert.deepEqual(core.allParts(draft()).map((p) => p.key), ["1", "2a", "2b"]);
		assert.equal(core.pointsLabel(2.5, "points"), "2,5 poeng");
		assert.equal(core.durationLabel(240), "4 timer");
		assert.equal(core.durationLabel(210), "3 timer 30 min");
	});

	it("refuses the cross-field breaks with model-readable problems", () => {
		const d = draft();
		d.tasks[1]!.number = "1";
		d.tasks[0]!.parts[0]!.correctOption = "c";
		d.tasks[1]!.parts[1]!.solution = " ";
		d.tasks[1]!.parts[0]!.points = 50;
		d.tasks[0]!.topicIds = ["ukjent"];
		const problems = core.mockExamProblems(d, { topicIds: TOPICS }).join("\n");
		assert.match(problems, /duplicate task number/);
		assert.match(problems, /correctOption must be one of the option ids/);
		assert.match(problems, /solution is empty/);
		assert.match(problems, /sum to 90 %/);
		assert.match(problems, /"ukjent" is not a topic/);
	});

	it("letters every part of a multi-part task and wants a whole svg", () => {
		const d = draft();
		d.tasks[1]!.parts[0]!.label = "";
		d.tasks[1]!.figureSvg = "<g/>";
		const problems = core.mockExamProblems(d).join("\n");
		assert.match(problems, /letters every part/);
		assert.match(problems, /complete <svg>/);
	});

	it("the public projection carries no key", () => {
		const pub = JSON.stringify(core.publicMockExam(exam()));
		assert.ok(!pub.includes(SECRET_SOLUTION) && !pub.includes(SECRET_RUBRIC) && !pub.includes("correctOption"));
		assert.ok(pub.includes("Eulers metode"));
	});

	it("validates grades: every part once, within its maximum", () => {
		const e = exam();
		assert.deepEqual(core.gradeProblems(e, [
			{ part: "1", points: 10, comment: "Riktig.", missing: "" },
			{ part: "2a", points: 45, comment: "Delvis.", missing: "Fortegn." },
			{ part: "2b", points: 30, comment: "Riktig.", missing: "" },
		]), []);
		const problems = core.gradeProblems(e, [
			{ part: "1", points: 11, comment: "x", missing: "" },
			{ part: "1", points: 1, comment: "x", missing: "" },
			{ part: "9z", points: 1, comment: "x", missing: "" },
		]).join("\n");
		assert.match(problems, /between 0 and 10/);
		assert.match(problems, /graded twice/);
		assert.match(problems, /not a part of this exam/);
		assert.match(problems, /not graded yet: 2a, 2b/);
	});

	it("computes the result: per task, total, percent, grade on a known scale, topics, released solutions", () => {
		const r = core.computeMockExamResult(exam(), [
			{ part: "1", points: 10, comment: "Riktig.", missing: "" },
			{ part: "2a", points: 45, comment: "Delvis.", missing: "Fortegn." },
			{ part: "2b", points: 20, comment: "Mangler begrunnelse.", missing: "Polens plassering." },
		], { id: "mr_test_0001", gradedAt: "2026-11-24T10:00:00.000Z", source: "digital", summary: "Godt." });
		assert.equal(r.points, 75);
		assert.equal(r.max, 100);
		assert.equal(r.percent, 75);
		assert.equal(r.grade, "C");
		assert.deepEqual(r.tasks, [{ number: "1", points: 10, max: 10 }, { number: "2", points: 65, max: 90 }]);
		assert.deepEqual(r.topics, [{ topicId: "numerikk", points: 10, max: 10 }, { topicId: "stabilitet", points: 65, max: 90 }]);
		assert.equal(r.parts[0]!.correctOption, "b");
		assert.ok(r.parts[1]!.solution.includes(SECRET_SOLUTION), "the løsningsforslag is released with the result");
	});

	it("estimates no grade without a known scale (percent only)", () => {
		const e = { ...exam(), gradeScale: undefined };
		const r = core.computeMockExamResult(e, core.allParts(e).map(({ key, part }) => ({ part: key, points: part.points, comment: "ok", missing: "" })), { id: "mr_test_0002", gradedAt: "2026-11-24T10:00:00.000Z", source: "scan", files: ["/a.pdf"], summary: "s" });
		assert.equal(r.percent, 100);
		assert.equal(r.grade, undefined);
		assert.match(core.mockGradeSteerText({ examId: e.id, resultId: r.id, result: r }), /no known grade scale \(percent only\)/);
	});

	it("keeps only real parts when sanitizing answers, and formats them for the grader", () => {
		const e = exam();
		const answers = core.sanitizeAnswers(e, { "1": "b", "2a": "$\\frac{1}{s+2}$", zz: "x", "2b": 5 });
		assert.deepEqual(answers, { "1": "b", "2a": "$\\frac{1}{s+2}$" });
		const text = core.answersText(e, answers);
		assert.match(text, /\[part 1\]\nChosen option: b\) Usant/);
		assert.match(text, /\[part 2b\]\n\(blank\)/);
	});
});

describe("the store", () => {
	it("saves and reads the exam, the answers and the results (oldest first)", () => {
		const e = exam(store.newMockExamId());
		assert.ok(core.isMockExamId(e.id));
		store.saveMockExam(e);
		assert.deepEqual(store.getMockExam("ttk4100", e.id), e);
		assert.equal(store.getMockExam("TTK4100", "../etc"), null);
		assert.deepEqual(store.listMockExams("TTK4100").map((x) => x.id), [e.id]);
		store.saveMockExamAnswers("TTK4100", { examId: e.id, answers: { "1": "a" }, updatedAt: "now" });
		assert.equal(store.getMockExamAnswers("TTK4100", e.id)?.answers["1"], "a");
		const base = core.computeMockExamResult(e, [], { id: "mr_x_0001", gradedAt: "2026-11-25T00:00:00.000Z", source: "digital", summary: "" });
		store.saveMockExamResult(base);
		store.saveMockExamResult({ ...base, id: "mr_x_0000", gradedAt: "2026-11-24T00:00:00.000Z" });
		assert.deepEqual(store.listMockExamResults("TTK4100").map((r) => r.id), ["mr_x_0000", "mr_x_0001"]);
		assert.deepEqual(store.listMockExamResults("TMA4400"), []);
	});
});

describe("the paper", () => {
	it("prints the cover facts, tasks, points, options and math — and never the key", () => {
		const html = mockExamHtml(core.publicMockExam(exam()), { katexCss: "", pageCount: 3 });
		for (const fact of ["Eksamensoppgave i TTK4100 Kybernetikk, introduksjon", "19. desember 2026", "09.00–13.00", "4 timer", "D: Ingen trykte", "Bokmål", "Antall sider (uten forside):</dt><dd>3", "Les oppgavene nøye."]) {
			assert.ok(html.includes(fact), fact);
		}
		assert.match(html, /Oppgave 1 Eulers metode \(10 %\)/);
		assert.match(html, /<span class="lead">a\)<\/span> \(60 %\)/);
		assert.match(html, /Velg ett alternativ:/);
		assert.match(html, /class="katex"/);
		assert.match(html, /data:image\/svg\+xml/);
		assert.ok(!html.includes(SECRET_SOLUTION) && !html.includes(SECRET_RUBRIC));
		assert.ok(!/<script/i.test(html), "no script on the paper");
	});

	it("refuses a figure resvg cannot parse, and adds a missing SVG namespace", async () => {
		const { svgParseProblem } = await import("../src/agent/subagents/mock-exam-maker.ts");
		assert.equal(svgParseProblem(core.withSvgNamespace('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>')), null);
		assert.match(svgParseProblem('<svg xmlns="http://www.w3.org/2000/svg"><rect') ?? "", /does not parse/);
		assert.match(core.withSvgNamespace("<svg viewBox='0 0 1 1'></svg>"), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox/);
	});

	it("escapes markup in task text", () => {
		assert.equal(markdownToHtml("a <b> & **c**"), "<p>a &lt;b&gt; &amp; <strong>c</strong></p>");
	});

	it("resolves the KaTeX fonts to absolute file URLs", () => {
		const css = katexCssForPrint();
		assert.match(css, /url\("file:\/\/[^"]+KaTeX_Main-Regular\.woff2"\)/);
		assert.ok(!/url\(fonts\//.test(css));
	});

	it("renders a valid PDF beside the exam, counts its pages and gives the printer no key", async () => {
		const e = exam(store.newMockExamId());
		store.saveMockExam(e);
		const printed: string[] = [];
		pdfPrinterOverride.current = async (html) => {
			printed.push(html);
			return Buffer.from(tinyPdf([{ runs: [{ text: "Forside", x: 72, y: 700 }] }, { runs: [{ text: "Oppgave 1", x: 72, y: 700 }] }, { runs: [{ text: "Oppgave 2", x: 72, y: 700 }] }]));
		};
		const out = await renderMockExamPdf(e);
		assert.equal(out.pageCount, 2);
		assert.equal(printed.length, 2, "two passes: the cover learns the page count");
		assert.match(printed[1]!, /Antall sider \(uten forside\):<\/dt><dd>2/);
		for (const html of printed) assert.ok(!html.includes(SECRET_SOLUTION) && !html.includes(SECRET_RUBRIC));
		assert.equal(fs.readFileSync(out.pdfPath).subarray(0, 5).toString("latin1"), "%PDF-");
		assert.equal(store.getMockExam("TTK4100", e.id)?.pageCount, 2);
	});

	it("refuses a printer that returns something other than a PDF", async () => {
		const e = exam(store.newMockExamId());
		store.saveMockExam(e);
		pdfPrinterOverride.current = async () => Buffer.from("<html>");
		await assert.rejects(renderMockExamPdf(e), /not a PDF/);
	});
});

// ─── the jobs, through the real runner ──────────────────────────────────────

function fakeJobStore(): JobStore {
	const jobs = new Map<string, JobRecord>();
	return {
		createJob(init) {
			const job = { id: `job_${jobs.size + 1}`, kind: init.kind, chatId: init.chatId, toolCallId: init.toolCallId, input: init.input, status: "running", createdAt: "t", updatedAt: "t", activity: "" } as JobRecord;
			jobs.set(job.id, job);
			return job;
		},
		getJob: (id) => jobs.get(id) ?? null,
		updateJob: (id, patch) => {
			const job = jobs.get(id);
			return job ? Object.assign(job, patch) : null;
		},
		listJobs: () => [...jobs.values()],
		findJobByToolCallId: (_c, callId) => [...jobs.values()].find((j) => j.toolCallId === callId) ?? null,
		deleteJobsForChat: () => 0,
	};
}

const chatStore = { getChat: () => ({ messages: [] }) } as unknown as ChatStore;

function fauxEngine(steps: FauxResponseStep[]): PiEngine {
	const faux = createFauxCore({});
	faux.setResponses(steps);
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

const course = {
	code: "TTK4100",
	name: "Kybernetikk, introduksjon",
	exam: { date: "2026-12-19", duration: "4 timer" },
	sources: [{ id: "s1", kind: "folder" as const, title: "Eksamener", path: "/x/eksamener", auto: false, addedAt: "t" }],
	topics: [
		{ id: "numerikk", title: "Numerikk", weight: 2 as const, status: "red" as const },
		{ id: "stabilitet", title: "Stabilitet", weight: 3 as const, status: "yellow" as const },
	],
};

function port(over: Partial<import("../src/agent/subagents/runner.ts").MockExamPort> = {}) {
	return {
		course: (code: string) => (code === "TTK4100" ? course : null),
		today: () => "2026-11-23",
		newExamId: () => "mx_job_0001",
		newResultId: () => "mr_job_0001",
		saveExam: store.saveMockExam,
		renderPdf: renderMockExamPdf,
		getExam: store.getMockExam,
		answers: store.getMockExamAnswers,
		saveResult: store.saveMockExamResult,
		...over,
	};
}

describe("generation as a job (faux model)", () => {
	it("reads the brief, submits the exam, stores it with its PDF and delivers the card without the key", async () => {
		let prompt = "";
		mockExamModelOverride.current = fauxEngine([
			(context) => {
				prompt = JSON.stringify(context.messages);
				return fauxAssistantMessage([fauxToolCall("submit_mock_exam", draft() as unknown as ToolCall["arguments"], { id: "s1" })], { stopReason: "toolUse" });
			},
		]);
		pdfPrinterOverride.current = async () => Buffer.from(tinyPdf([{}, {}]));
		const jobStore = fakeJobStore();
		const delivered: SteerMessage[] = [];
		const runner = createJobRunner({ chatStore, jobStore, deliver: async (s) => void delivered.push(s), mockExams: port() });
		const job = jobStore.createJob({ kind: "mockExam", chatId: "c1", toolCallId: "t1", input: { code: "TTK4100", focus: "mer om stabilitet" } });
		await runner.runJob(job.id);
		assert.match(prompt, /\/x\/eksamener/);
		assert.match(prompt, /\[numerikk\] Numerikk — relevance 2 — red/);
		assert.match(prompt, /mer om stabilitet/);
		const stored = store.getMockExam("TTK4100", "mx_job_0001");
		assert.equal(stored?.tasks[0]?.parts[0]?.correctOption, "b", "the key is stored server-side");
		assert.equal(jobStore.getJob(job.id)?.status, "done");
		assert.equal(delivered.length, 1);
		const steer = delivered[0]!;
		const details = steer.details as { kind: string; result: import("../src/core/mock-exam.ts").MockExamJobResult };
		assert.equal(details.kind, "mockExam");
		assert.equal(details.result.examId, "mx_job_0001");
		assert.equal(details.result.taskCount, 2);
		assert.equal(details.result.pageCount, 1);
		assert.ok(details.result.pdfPath?.endsWith("exam.pdf"));
		assert.ok(!JSON.stringify(steer).includes(SECRET_SOLUTION), "neither the card nor the agent's text carries the key");
		assert.match(String(steer.content), /exam id "mx_job_0001"/);
	});

	it("keeps the exam when the PDF cannot be printed, and says so", async () => {
		mockExamModelOverride.current = fauxEngine([fauxAssistantMessage([fauxToolCall("submit_mock_exam", draft() as unknown as ToolCall["arguments"], { id: "s1" })], { stopReason: "toolUse" })]);
		pdfPrinterOverride.current = async () => {
			throw new Error("no printer");
		};
		const jobStore = fakeJobStore();
		const delivered: SteerMessage[] = [];
		const runner = createJobRunner({ chatStore, jobStore, deliver: async (s) => void delivered.push(s), mockExams: port() });
		const job = jobStore.createJob({ kind: "mockExam", chatId: "c1", toolCallId: "t1", input: { code: "TTK4100" } });
		await runner.runJob(job.id);
		const result = (delivered[0]!.details as { result: import("../src/core/mock-exam.ts").MockExamJobResult }).result;
		assert.equal(result.examId, "mx_job_0001");
		assert.equal(result.pdfPath, undefined);
		assert.match(result.pdfError ?? "", /no printer/);
		assert.ok(store.getMockExam("TTK4100", "mx_job_0001"));
	});

	it("fails honestly for a course that is gone", async () => {
		const jobStore = fakeJobStore();
		const delivered: SteerMessage[] = [];
		mockExamModelOverride.current = fauxEngine([]);
		const runner = createJobRunner({ chatStore, jobStore, deliver: async (s) => void delivered.push(s), mockExams: port() });
		const job = jobStore.createJob({ kind: "mockExam", chatId: "c1", toolCallId: "t1", input: { code: "TMA4400" } });
		await runner.runJob(job.id);
		const result = (delivered[0]!.details as { result: import("../src/core/mock-exam.ts").MockExamJobResult }).result;
		assert.equal(result.examId, "");
		assert.ok(isSubagentFailure("mockExam", result));
		assert.match(String(delivered[0]!.content), /could not be made/);
	});
});

describe("grading as a job (faux model)", () => {
	it("grades the digital hand-in against the key, stores the result and delivers it", async () => {
		const e = exam("mx_job_0001");
		store.saveMockExam(e);
		store.saveMockExamAnswers("TTK4100", { examId: e.id, answers: { "1": "b", "2a": "$1/(s+2)$" }, updatedAt: "t", submittedAt: "t" });
		let prompt = "";
		mockGradeModelOverride.current = fauxEngine([
			(context) => {
				prompt = JSON.stringify(context.messages);
				return fauxAssistantMessage([fauxToolCall("submit_grades", {
					grades: [
						{ part: "1", points: 10, comment: "Riktig.", missing: "" },
						{ part: "2a", points: 60, comment: "Riktig.", missing: "" },
						{ part: "2b", points: 0, comment: "Blank.", missing: "Hele svaret." },
					],
					summary: "Sterk på 1 og 2a, 2b mangler.",
				}, { id: "g1" })], { stopReason: "toolUse" });
			},
		]);
		const jobStore = fakeJobStore();
		const delivered: SteerMessage[] = [];
		const runner = createJobRunner({ chatStore, jobStore, deliver: async (s) => void delivered.push(s), mockExams: port() });
		const job = jobStore.createJob({ kind: "mockGrade", chatId: "c1", toolCallId: "t2", input: { code: "TTK4100", examId: e.id } });
		await runner.runJob(job.id);
		assert.ok(prompt.includes(SECRET_RUBRIC), "the grader sees the retteveiledning");
		assert.match(prompt, /Chosen option: b\)/);
		const results = store.listMockExamResults("TTK4100");
		assert.equal(results.length, 1);
		assert.equal(results[0]!.points, 70);
		assert.equal(results[0]!.grade, "C");
		assert.equal(results[0]!.source, "digital");
		const text = String(delivered[0]!.content);
		assert.match(text, /70\/100 % \(70 %\), grade estimate C/);
		assert.match(text, /- 2b: 0\/30 — Blank\. — missing: Hele svaret\./);
		assert.match(text, /topic_status/);
	});

	it("reads a scan with `read` and refuses a hand-in that is neither files nor «Lever»", async () => {
		const e = exam("mx_job_0001");
		store.saveMockExam(e);
		const jobStore = fakeJobStore();
		const delivered: SteerMessage[] = [];
		mockGradeModelOverride.current = fauxEngine([]);
		const runner = createJobRunner({ chatStore, jobStore, deliver: async (s) => void delivered.push(s), mockExams: port() });
		const job = jobStore.createJob({ kind: "mockGrade", chatId: "c1", toolCallId: "t3", input: { code: "TTK4100", examId: e.id } });
		await runner.runJob(job.id);
		assert.match(String(delivered[0]!.content), /could not be graded: no hand-in/);

		// The "scan" is a text file here: the point is that the grader holds a
		// working read tool and reads the hand-in before it grades.
		const scanFile = path.join(TMP, "besvarelse.txt");
		fs.writeFileSync(scanFile, "Oppgave 1: b\nOppgave 2a: 1/(s+2)");
		let prompt = "";
		let readBack = "";
		mockGradeModelOverride.current = fauxEngine([
			(context) => {
				prompt = JSON.stringify(context.messages);
				return fauxAssistantMessage([fauxToolCall("read", { path: scanFile }, { id: "r1" })], { stopReason: "toolUse" });
			},
			(context) => {
				readBack = JSON.stringify(context.messages.at(-1));
				return fauxAssistantMessage([fauxToolCall("submit_grades", { grades: core.allParts(e).map(({ key }) => ({ part: key, points: 0, comment: "Uleselig.", missing: "" })), summary: "Uleselig skann." }, { id: "g2" })], { stopReason: "toolUse" });
			},
		]);
		const scan = jobStore.createJob({ kind: "mockGrade", chatId: "c1", toolCallId: "t4", input: { code: "TTK4100", examId: e.id, files: [scanFile] } });
		await runner.runJob(scan.id);
		assert.ok(prompt.includes(scanFile), "the prompt names the files to read");
		assert.match(readBack, /Oppgave 2a: 1\/\(s\+2\)/, "read returned the hand-in to the grader");
		const last = store.listMockExamResults("TTK4100").at(-1);
		assert.equal(last?.source, "scan");
		assert.deepEqual(last?.files, [scanFile]);
	});
});

describe("the tools", () => {
	function ctx(over: Partial<import("../src/agent/tools/mock-exam.ts").MockExamToolContext> = {}) {
		const spawned: Array<{ job: JobRecord; input: unknown }> = [];
		const jobStore = fakeJobStore();
		return {
			spawned,
			jobStore,
			tools: mockExamTools({
				chatId: "c1",
				code: "TTK4100",
				jobStore,
				spawn: (job, input) => void spawned.push({ job, input }),
				examTitle: (id) => (id === "mx_job_0001" ? "P" : null),
				submittedInApp: () => false,
				...over,
			}),
		};
	}
	const text = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0]!.text);

	it("mock_exam dispatches a job for the session's own course", async () => {
		const c = ctx();
		const r = await c.tools.mock_exam!.execute("call1", { focus: " bare del 2 " }, undefined);
		assert.match(text(r), /^Dispatched \(job job_1\)/);
		assert.deepEqual(c.spawned[0]!.input, { code: "TTK4100", focus: "bare del 2" });
		assert.equal(c.spawned[0]!.job.kind, "mockExam");
	});

	it("grade_mock_exam refuses an unknown exam and a hand-in that does not exist, and dispatches with files", async () => {
		const c = ctx();
		assert.match(text(await c.tools.grade_mock_exam!.execute("g1", { examId: "mx_nope_0001" }, undefined)), /no mock exam/);
		assert.match(text(await c.tools.grade_mock_exam!.execute("g2", { examId: "mx_job_0001" }, undefined)), /nothing to grade/);
		const ok = await c.tools.grade_mock_exam!.execute("g3", { examId: "mx_job_0001", files: ["/a.jpg"] }, undefined);
		assert.match(text(ok), /^Dispatched/);
		assert.deepEqual(c.spawned[0]!.input, { code: "TTK4100", examId: "mx_job_0001", files: ["/a.jpg"] });
	});

	it("the steer for a delivered exam names the exam id and forbids hints", () => {
		const steer = buildSubagentSteer({ id: "job_9", kind: "mockExam", toolCallId: "t" }, core.mockExamJobResult(exam(), { pdfPath: "/p.pdf" }));
		assert.match(String(steer.content), /no hints, method tips or solutions/);
		assert.match(String(steer.content), /grade_mock_exam/);
	});
});

describe("the HTTP routes", () => {
	const at = (id: string) => ({ params: Promise.resolve({ code: "ttk4100", id }) });
	const req = (method: string, body?: unknown) => new Request("http://x", { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });

	it("serves the paper without the key, saves the draft, freezes it at «Lever», lists results", async () => {
		const e = exam("mx_route_0001");
		store.saveMockExam(e);
		const view = await viewRoute.GET(req("GET"), at(e.id));
		assert.equal(view.status, 200);
		const body = await view.text();
		assert.ok(!body.includes(SECRET_SOLUTION) && !body.includes("correctOption"));
		assert.equal(JSON.parse(body).hasPdf, false);

		const put = await viewRoute.PUT(req("PUT", { answers: { "2a": "svar", bogus: "x" }, timerStartedAt: "2026-11-23T10:00:00.000Z" }), at(e.id));
		assert.deepEqual((await put.json()).answers.answers, { "2a": "svar" });
		const sub = await submitRoute.POST(req("POST", { answers: { "2a": "endelig" } }), at(e.id));
		const submitted = (await sub.json()).answers;
		assert.ok(submitted.submittedAt);
		assert.equal(submitted.answers["2a"], "endelig");
		assert.equal(submitted.timerStartedAt, "2026-11-23T10:00:00.000Z");
		assert.equal((await viewRoute.PUT(req("PUT", { answers: {} }), at(e.id))).status, 409);

		assert.equal((await viewRoute.GET(req("GET"), at("mx_none_0001"))).status, 404);
		const list = await listRoute.GET(req("GET"), { params: Promise.resolve({ code: "TTK4100" }) });
		assert.deepEqual((await list.json()).exams.map((x: { id: string }) => x.id), [e.id]);
	});

	it("«Åpne PDF» opens the stored paper with the OS viewer", async () => {
		const e = exam("mx_route_0002");
		store.saveMockExam(e);
		assert.equal((await openRoute.POST(req("POST"), at(e.id))).status, 404, "no PDF yet");
		store.saveMockExamPdf("TTK4100", e.id, tinyPdf([{}]));
		const opened: string[] = [];
		mockExamSeams.open = (file) => void opened.push(file);
		assert.equal((await openRoute.POST(req("POST"), at(e.id))).status, 200);
		assert.ok(opened[0]!.endsWith(path.join(e.id, "exam.pdf")));
		assert.deepEqual(openCommand("darwin", "/a.pdf"), { command: "open", args: ["/a.pdf"] });
		assert.deepEqual(openCommand("linux", "/a.pdf"), { command: "xdg-open", args: ["/a.pdf"] });
	});
});
