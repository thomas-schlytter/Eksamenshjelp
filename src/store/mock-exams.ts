/**
 * MockExamStore — the fs adapter for prøveeksamener (fase 6), per course
 * under the LH_DATA_DIR seam:
 *
 *   data/mock-exams/<CODE>/<examId>/exam.json     the structured exam, key included
 *   data/mock-exams/<CODE>/<examId>/exam.pdf      the printed paper (no key)
 *   data/mock-exams/<CODE>/<examId>/answers.json  the digital answers (draft → submitted)
 *   data/mock-exams/<CODE>/results.json           every graded result, oldest first
 *
 * Same idioms as the course store: sync fs, guarded names (the course code
 * and the ids are pattern-checked before they touch a path), tab-indented
 * JSON written through a temp file + rename. Nothing here serves the key to
 * anyone: the HTTP layer reads through publicMockExam.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../../config.ts";
import { normalizeCourseCode } from "../core/courses.ts";
import {
	MOCK_RESULT_ID_PATTERN,
	isMockExamId,
	type MockExam,
	type MockExamAnswers,
	type MockExamResult,
} from "../core/mock-exam.ts";

const ROOT_DIR = () => path.join(PATHS.data, "mock-exams");

function courseDir(code: string): string {
	const normalized = normalizeCourseCode(code);
	if (!normalized) throw new Error(`Invalid course code: ${code}`);
	return path.join(ROOT_DIR(), normalized);
}

function examDir(code: string, examId: string): string {
	if (!isMockExamId(examId)) throw new Error(`Invalid mock exam id: ${examId}`);
	return path.join(courseDir(code), examId);
}

function writeAtomic(file: string, data: string | Uint8Array): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${randomUUID()}.tmp`;
	try {
		fs.writeFileSync(tmp, data);
		fs.renameSync(tmp, file);
	} finally {
		fs.rmSync(tmp, { force: true });
	}
}

const json = (value: unknown) => JSON.stringify(value, null, "\t") + "\n";

function readJson<T>(file: string): T | null {
	try {
		return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
	} catch {
		return null;
	}
}

/** A fresh exam id: time-sortable, filename-safe. */
export function newMockExamId(now: Date = new Date()): string {
	return `mx_${now.getTime().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 6)}`;
}

export function newMockResultId(now: Date = new Date()): string {
	return `mr_${now.getTime().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 6)}`;
}

export function mockExamPdfPath(code: string, examId: string): string {
	return path.join(examDir(code, examId), "exam.pdf");
}

export function saveMockExam(exam: MockExam): void {
	writeAtomic(path.join(examDir(exam.code, exam.id), "exam.json"), json(exam));
}

/** The stored exam, key included (server-side callers only). */
export function getMockExam(code: string, examId: string): MockExam | null {
	if (!normalizeCourseCode(code) || !isMockExamId(examId)) return null;
	const exam = readJson<MockExam>(path.join(examDir(code, examId), "exam.json"));
	return exam && exam.id === examId && Array.isArray(exam.tasks) ? exam : null;
}

/** Every exam of a course, newest first. */
export function listMockExams(code: string): MockExam[] {
	if (!normalizeCourseCode(code)) return [];
	let names: string[];
	try {
		names = fs.readdirSync(courseDir(code));
	} catch {
		return [];
	}
	return names
		.filter(isMockExamId)
		.map((id) => getMockExam(code, id))
		.filter((e): e is MockExam => e !== null)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function saveMockExamPdf(code: string, examId: string, pdf: Uint8Array): string {
	const file = mockExamPdfPath(code, examId);
	writeAtomic(file, pdf);
	return file;
}

export function getMockExamAnswers(code: string, examId: string): MockExamAnswers | null {
	if (!normalizeCourseCode(code) || !isMockExamId(examId)) return null;
	const answers = readJson<MockExamAnswers>(path.join(examDir(code, examId), "answers.json"));
	return answers && answers.examId === examId && typeof answers.answers === "object" && answers.answers !== null ? answers : null;
}

export function saveMockExamAnswers(code: string, answers: MockExamAnswers): void {
	writeAtomic(path.join(examDir(code, answers.examId), "answers.json"), json(answers));
}

function resultsFile(code: string): string {
	return path.join(courseDir(code), "results.json");
}

/**
 * THE READ API for the course page's score curve: every graded mock exam
 * of a course, oldest first (gradedAt order).
 */
export function listMockExamResults(code: string): MockExamResult[] {
	if (!normalizeCourseCode(code)) return [];
	const raw = readJson<unknown>(resultsFile(code));
	const list = Array.isArray(raw) ? raw : [];
	return list
		.filter((r): r is MockExamResult =>
			typeof r === "object" && r !== null &&
			typeof (r as MockExamResult).id === "string" && MOCK_RESULT_ID_PATTERN.test((r as MockExamResult).id) &&
			typeof (r as MockExamResult).examId === "string" &&
			typeof (r as MockExamResult).points === "number" && typeof (r as MockExamResult).max === "number")
		.sort((a, b) => a.gradedAt.localeCompare(b.gradedAt));
}

export function saveMockExamResult(result: MockExamResult): void {
	const list = listMockExamResults(result.code).filter((r) => r.id !== result.id);
	list.push(result);
	writeAtomic(resultsFile(result.code), json(list));
}
