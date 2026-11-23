/**
 * Prøveeksamen in the UI (fase 6): the transcript registry, the exam card
 * (facts + the three actions), the result card (total, grade estimate only
 * with a scale, points per task, the released løsningsforslag), the steer
 * routing, the top-bar button and the «Svar i appen» view (tasks, answer
 * fields, options, no key). SSR renders — no browser.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { artifactRenderers } from "../components/artifacts/index.ts";
import {
	MAKE_MOCK_EXAM_TEXT,
	MakeMockExamButton,
	MockExamCard,
	MockExamDispatchCard,
	MockGradeCard,
	MockGradeDispatchCard,
	digitalHandInText,
	mockExamFacts,
	scanHandInText,
} from "../components/artifacts/mock-exam-card.tsx";
import { SubagentSteerCard } from "../components/artifacts/steer-card.tsx";
import { MockExamAnswerView, remainingLabel, remainingMs } from "../components/mock-exam-view.tsx";
import { toolActivityLabel } from "../src/core/pending.ts";
import { computeMockExamResult, publicMockExam, type MockExam, type MockExamJobResult } from "../src/core/mock-exam.ts";
import type { LhViewMessage } from "../src/core/index.ts";

const exam: MockExam = {
	id: "mx_ui_0001",
	code: "TMA4400",
	courseName: "Matematikk 1",
	title: "Prøveeksamen i TMA4400 Matematikk 1",
	createdAt: "2026-11-23T10:00:00.000Z",
	scoring: "points",
	cover: { date: "1. desember 2026", durationMinutes: 240, aids: "D" },
	tasks: [
		{ number: "1", parts: [{ label: "", text: "Hva er $2+2$?", points: 4, options: [{ id: "a", text: "3" }, { id: "b", text: "4" }], correctOption: "b", solution: "HEMMELIG-LF 4", rubric: "HEMMELIG-RV" }] },
		{ number: "2", intro: "La $f(x)=x^2$.", parts: [
			{ label: "a", text: "Deriver $f$.", points: 5, solution: "HEMMELIG-LF $2x$", rubric: "HEMMELIG-RV" },
			{ label: "b", text: "Integrer $f$.", points: 6, solution: "HEMMELIG-LF $x^3/3$", rubric: "HEMMELIG-RV" },
		] },
	],
	basedOn: [],
};

const card: MockExamJobResult = {
	examId: exam.id, code: "TMA4400", title: exam.title, taskCount: 2, durationMinutes: 240, scoring: "points", totalPoints: 15, multipleChoicePercent: 27, pageCount: 2, pdfPath: "/d/exam.pdf",
};

describe("prøveeksamen in the transcript", () => {
	it("registers the dispatch cards and Norwegian activity labels", () => {
		assert.equal(artifactRenderers.mock_exam, MockExamDispatchCard);
		assert.equal(artifactRenderers.grade_mock_exam, MockGradeDispatchCard);
		assert.equal(toolActivityLabel("mock_exam"), "Starter prøveeksamen…");
		assert.equal(toolActivityLabel("grade_mock_exam"), "Starter rettingen…");
	});

	it("the dispatch card reads «Prøveeksamen» while the job runs", () => {
		const html = renderToStaticMarkup(<MockExamDispatchCard part={{ type: "tool-mock_exam", state: "output-available", toolCallId: "t1", output: "Dispatched" }} />);
		assert.match(html, /Prøveeksamen/);
		assert.match(html, /data-testid="dispatch-card"/);
		assert.equal(renderToStaticMarkup(<MockExamDispatchCard part={{ type: "tool-mock_exam", state: "input-streaming", toolCallId: "t1" }} />), "");
	});

	it("the exam card shows fagkode, tasks, duration and points, and the three actions", () => {
		assert.equal(mockExamFacts(card), "TMA4400 · 2 oppgaver · 4 timer · 15 poeng");
		const html = renderToStaticMarkup(<MockExamCard result={card} />);
		assert.match(html, /Prøveeksamen i TMA4400 Matematikk 1/);
		for (const label of ["Åpne PDF", "Svar i appen", "Legg inn besvarelse"]) assert.ok(html.includes(label), label);
		assert.ok(!/data-testid="mock-exam-open-pdf"[^>]*disabled/.test(html), "the PDF opens when it exists");
		const noPdf = renderToStaticMarkup(<MockExamCard result={{ ...card, pdfPath: undefined, pdfError: "x" }} />);
		assert.match(noPdf, /PDF-en kunne ikke lages\. Du kan svare i appen\./);
		assert.match(renderToStaticMarkup(<MockExamCard result={{ ...card, examId: "", notes: "ingen tidligere eksamener" }} />), /kunne ikke lages: ingen tidligere eksamener/);
	});

	it("the hand-in messages name the exam id; a scan carries the file chips", () => {
		assert.equal(digitalHandInText("P", "mx_a_0001"), "Jeg har levert prøveeksamen «P» i appen (eksamen-id mx_a_0001). Rett den.");
		assert.equal(scanHandInText("P", "mx_a_0001", ["/a/side 1.jpg"]), 'Her er besvarelsen min på prøveeksamen «P» (eksamen-id mx_a_0001): `/a/side 1.jpg`');
	});

	it("the result card: total, grade only with a scale, points per task, comments and the løsningsforslag", () => {
		const result = computeMockExamResult(exam, [
			{ part: "1", points: 4, comment: "Riktig.", missing: "" },
			{ part: "2a", points: 2.5, comment: "Halvveis.", missing: "Kjerneregelen." },
			{ part: "2b", points: 6, comment: "Riktig.", missing: "" },
		], { id: "mr_ui_0001", gradedAt: "2026-11-24T00:00:00.000Z", source: "digital", summary: "Bra." });
		const html = renderToStaticMarkup(<MockGradeCard result={{ examId: exam.id, resultId: result.id, result }} />);
		assert.match(html, /12,5 \/ 15 poeng/);
		assert.match(html, /83 %/);
		assert.ok(!html.includes("Karakterestimat"), "no scale, no grade");
		assert.match(html, /Oppgave 2<\/td><td[^>]*>8,5 \/ 11/);
		assert.match(html, /Manglet: Kjerneregelen\./);
		assert.match(html, /riktig svar: b\)/);
		assert.ok(html.includes("HEMMELIG-LF"), "the løsningsforslag is released after grading");
		const graded = { ...result, grade: "B", gradeScaleSource: "LF" };
		assert.match(renderToStaticMarkup(<MockGradeCard result={{ examId: exam.id, resultId: "r", result: graded }} />), /Karakterestimat: <strong>B<\/strong>/);
		assert.match(renderToStaticMarkup(<MockGradeCard result={{ examId: exam.id, resultId: "", notes: "uleselig" }} />), /kunne ikke rettes: uleselig/);
	});

	it("the steer card routes both kinds to their cards", () => {
		const message = (kind: string, result: unknown) => ({ id: "m", role: "user", parts: [{ type: "data-subagent-artifact", id: "p", data: { kind, result } }] }) as unknown as LhViewMessage;
		assert.match(renderToStaticMarkup(<SubagentSteerCard message={message("mockExam", card)} />), /data-testid="mock-exam-card"/);
		assert.match(renderToStaticMarkup(<SubagentSteerCard message={message("mockGrade", { examId: "x", resultId: "", notes: "n" })} />), /data-testid="mock-grade-failed"/);
	});

	it("«Lag prøveeksamen» is a labelled top-bar button that sends a plain request", () => {
		const html = renderToStaticMarkup(<MakeMockExamButton onClick={() => {}} />);
		assert.match(html, /Lag prøveeksamen/);
		assert.match(html, /lh-no-drag/);
		assert.equal(MAKE_MOCK_EXAM_TEXT, "Lag en prøveeksamen for meg.");
	});
});

describe("«Svar i appen»", () => {
	it("shows every task with its points, options for multiple choice and a math-capable field for the rest — never the key", () => {
		const html = renderToStaticMarkup(
			<MockExamAnswerView
				code="TMA4400"
				examId={exam.id}
				onClose={() => {}}
				onSubmitted={() => {}}
				initial={{ exam: publicMockExam(exam), answers: { examId: exam.id, answers: { "2a": "$2x$" }, updatedAt: "t" } }}
			/>,
		);
		assert.equal(html.match(/data-testid="mock-exam-task"/g)?.length, 2);
		assert.match(html, /Oppgave 1 \(4 poeng\)/);
		assert.match(html, /a\) \(5 poeng\)/);
		assert.equal(html.match(/type="radio"/g)?.length, 2);
		assert.equal(html.match(/data-testid="mock-exam-answer-field"/g)?.length, 2);
		assert.match(html, /data-testid="mock-exam-preview"/, "a LaTeX answer gets a live preview");
		assert.match(html, /class="katex/);
		assert.match(html, /Start nedtelling \(4 timer\)/);
		assert.match(html, />Lever</);
		assert.ok(!html.includes("HEMMELIG"), "the view never holds the key");
	});

	it("is read-only once handed in", () => {
		const html = renderToStaticMarkup(
			<MockExamAnswerView code="TMA4400" examId={exam.id} onClose={() => {}} onSubmitted={() => {}}
				initial={{ exam: publicMockExam(exam), answers: { examId: exam.id, answers: {}, updatedAt: "t", submittedAt: "t" } }} />,
		);
		assert.match(html, /Levert\. Rettingen skjer i fag-chatten\./);
		assert.ok(!html.includes(">Lever<"));
		assert.ok(!html.includes("Start nedtelling"));
	});

	it("counts down from the exam's duration", () => {
		const start = "2026-11-23T10:00:00.000Z";
		assert.equal(remainingLabel(remainingMs(start, 240, Date.parse(start) + 55 * 60_000 + 30_000)), "3:04:30");
		assert.equal(remainingLabel(90_000), "1:30");
		assert.equal(remainingLabel(-5), "0:00");
	});
});
