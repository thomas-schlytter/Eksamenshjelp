/**
 * Prøveeksamen service (fase 6): the job runner's port, the fag-chat tools'
 * context, and the HTTP surface under /api/mock-exams/<CODE>/<examId>.
 *
 * The key never leaves through here: every read for the browser goes
 * through publicMockExam; the løsningsforslag reaches the learner only
 * inside a graded result.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { localIsoDate, normalizeCourseCode, type ChatCourseLink } from "../core/courses.ts";
import {
	isMockExamId,
	publicMockExam,
	sanitizeAnswers,
	type MockExamAnswers,
	type MockExamResult,
	type PublicMockExam,
} from "../core/mock-exam.ts";
import type { JobRecord, MockExamToolInput, MockGradeToolInput } from "../core/contracts.ts";
import type { MockExamPort } from "../agent/subagents/runner.ts";
import type { MockExamToolContext } from "../agent/tools/mock-exam.ts";
import { courseStore } from "../store/courses.ts";
import {
	getMockExam,
	getMockExamAnswers,
	listMockExamResults,
	listMockExams,
	mockExamPdfPath,
	newMockExamId,
	newMockResultId,
	saveMockExam,
	saveMockExamAnswers,
	saveMockExamResult,
} from "../store/mock-exams.ts";
import { renderMockExamPdf } from "./mock-exam-pdf.ts";
import { stores } from "./stores.ts";

export { listMockExamResults } from "../store/mock-exams.ts";

/** The runner's port: course snapshot, storage, the printer. */
export const mockExamPort: MockExamPort = {
	course: (code) => courseStore.getCourse(code),
	today: () => localIsoDate(),
	newExamId: () => newMockExamId(),
	newResultId: () => newMockResultId(),
	saveExam: saveMockExam,
	renderPdf: renderMockExamPdf,
	getExam: getMockExam,
	answers: getMockExamAnswers,
	saveResult: saveMockExamResult,
};

/** The fag-chat tools' context; undefined without a course link. */
export function mockExamToolContextFor(
	link: ChatCourseLink | undefined,
	chatId: string,
	spawnJob: (job: JobRecord, input: MockExamToolInput | MockGradeToolInput) => void,
): MockExamToolContext | undefined {
	const code = normalizeCourseCode(link?.code);
	if (!code) return undefined;
	return {
		chatId,
		code,
		jobStore: stores.jobStore,
		spawn: spawnJob,
		examTitle: (examId) => getMockExam(code, examId)?.title ?? null,
		submittedInApp: (examId) => Boolean(getMockExamAnswers(code, examId)?.submittedAt),
	};
}

// ─── HTTP service ────────────────────────────────────────────────────────────

export interface MockExamFailure {
	ok: false;
	status: 400 | 404 | 409 | 500;
	code: string;
	error: string;
}
export type MockExamOutcome<T> = ({ ok: true } & T) | MockExamFailure;

const fail = (status: MockExamFailure["status"], code: string, error: string): MockExamFailure => ({ ok: false, status, code, error });

export function mockExamFailureResponse(failure: MockExamFailure): Response {
	return Response.json({ error: failure.error, code: failure.code }, { status: failure.status });
}

function locate(rawCode: string, rawId: string) {
	const code = normalizeCourseCode(rawCode);
	if (!code || !isMockExamId(rawId)) return null;
	const exam = getMockExam(code, rawId);
	return exam ? { code, exam } : null;
}

/** What the answer view needs: the public paper, his answers, the latest result. */
export function getMockExamView(rawCode: string, rawId: string): MockExamOutcome<{
	exam: PublicMockExam;
	answers: MockExamAnswers | null;
	result: MockExamResult | null;
	hasPdf: boolean;
}> {
	const found = locate(rawCode, rawId);
	if (!found) return fail(404, "not_found", "Fant ikke prøveeksamenen.");
	const { code, exam } = found;
	const results = listMockExamResults(code).filter((r) => r.examId === exam.id);
	return {
		ok: true,
		exam: publicMockExam(exam),
		answers: getMockExamAnswers(code, exam.id),
		result: results.at(-1) ?? null,
		hasPdf: fs.existsSync(mockExamPdfPath(code, exam.id)),
	};
}

/** Save the draft (answers + timer start). Refused once handed in. */
export function saveMockExamDraft(rawCode: string, rawId: string, body: unknown): MockExamOutcome<{ answers: MockExamAnswers }> {
	const found = locate(rawCode, rawId);
	if (!found) return fail(404, "not_found", "Fant ikke prøveeksamenen.");
	const { code, exam } = found;
	const previous = getMockExamAnswers(code, exam.id);
	if (previous?.submittedAt) return fail(409, "submitted", "Besvarelsen er allerede levert.");
	const b = (typeof body === "object" && body !== null ? body : {}) as { answers?: unknown; timerStartedAt?: unknown };
	const timer = typeof b.timerStartedAt === "string" && !Number.isNaN(Date.parse(b.timerStartedAt))
		? b.timerStartedAt
		: b.timerStartedAt === null ? undefined : previous?.timerStartedAt;
	const answers: MockExamAnswers = {
		examId: exam.id,
		answers: sanitizeAnswers(exam, b.answers ?? previous?.answers ?? {}),
		...(timer ? { timerStartedAt: timer } : {}),
		updatedAt: new Date().toISOString(),
	};
	saveMockExamAnswers(code, answers);
	return { ok: true, answers };
}

/** «Lever»: save the final answers and freeze them. */
export function submitMockExam(rawCode: string, rawId: string, body: unknown): MockExamOutcome<{ answers: MockExamAnswers }> {
	const saved = saveMockExamDraft(rawCode, rawId, body);
	if (!saved.ok) return saved;
	const answers: MockExamAnswers = { ...saved.answers, submittedAt: new Date().toISOString() };
	saveMockExamAnswers(normalizeCourseCode(rawCode)!, answers);
	return { ok: true, answers };
}

/** The OS command that opens a file in its default app (pure; exported for tests). */
export function openCommand(platform: NodeJS.Platform, file: string): { command: string; args: string[] } {
	if (platform === "darwin") return { command: "open", args: [file] };
	if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", file] };
	return { command: "xdg-open", args: [file] };
}

/** Test seam: replaces the OS opener. */
export const mockExamSeams: { open?: (file: string) => void } = {};

/** «Åpne PDF»: the paper in the system's PDF viewer. */
export function openMockExamPdf(rawCode: string, rawId: string): MockExamOutcome<{ path: string }> {
	const found = locate(rawCode, rawId);
	if (!found) return fail(404, "not_found", "Fant ikke prøveeksamenen.");
	const file = mockExamPdfPath(found.code, found.exam.id);
	if (!fs.existsSync(file)) return fail(404, "no_pdf", "PDF-en finnes ikke for denne prøveeksamenen.");
	try {
		if (mockExamSeams.open) mockExamSeams.open(file);
		else {
			const { command, args } = openCommand(process.platform, file);
			const child = spawn(command, args, { detached: true, stdio: "ignore" });
			child.on("error", (err) => console.error("[mock-exam] open PDF:", err));
			child.unref();
		}
	} catch (err) {
		return fail(500, "open_failed", `Klarte ikke å åpne PDF-en: ${err instanceof Error ? err.message : String(err)}`);
	}
	return { ok: true, path: file };
}

/** The course's mock exams (public facts) and every graded result. */
export function listCourseMockExams(rawCode: string): MockExamOutcome<{
	exams: Array<{ id: string; title: string; createdAt: string }>;
	results: MockExamResult[];
}> {
	const code = normalizeCourseCode(rawCode);
	if (!code) return fail(400, "invalid_code", "Ugyldig emnekode.");
	return {
		ok: true,
		exams: listMockExams(code).map((e) => ({ id: e.id, title: e.title, createdAt: e.createdAt })),
		results: listMockExamResults(code),
	};
}
