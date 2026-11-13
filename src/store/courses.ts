/**
 * CourseStore — the fs JSON adapter for courses ("fag"): one file per
 * course in data/courses/<CODE>.json, under the LH_DATA_DIR seam, plus the
 * NTNU course-list cache in data/ntnu/courses.json.
 *
 * Same idioms as the chat adapter (sync fs, tiny records, guarded
 * filenames, tab-indented JSON, a lazy version stamp with newer-version
 * refusal). Writes go through a temp file + rename so a crash mid-write
 * never leaves a half-written course. The adapter is silent on the event
 * bus: src/server/courses.ts announces `courses-changed` after a write,
 * because only it knows which session (if any) caused the change.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../../config.ts";
import {
	clampMinutesPerDay,
	isTopicStatus,
	normalizeCourseCode,
	type Course,
	type CourseSource,
	type CourseTopic,
} from "../core/courses.ts";

/** The course record format this build writes and understands. */
export const CURRENT_COURSE_VERSION = 1;

const COURSES_DIR = path.join(PATHS.data, "courses");
const NTNU_DIR = path.join(PATHS.data, "ntnu");
const NTNU_LIST_FILE = path.join(NTNU_DIR, "courses.json");

function courseFile(code: string): string {
	const normalized = normalizeCourseCode(code);
	if (!normalized) throw new Error(`Invalid course code: ${code}`);
	return path.join(COURSES_DIR, `${normalized}.json`);
}

function writeAtomic(file: string, value: unknown): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${randomUUID()}.tmp`;
	try {
		fs.writeFileSync(tmp, JSON.stringify(value, null, "\t") + "\n", "utf-8");
		fs.renameSync(tmp, file);
	} finally {
		fs.rmSync(tmp, { force: true });
	}
}

const str = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/** Shape floor for a record off disk (hand edits, older builds): every
 *  required field present and typed, unknown extras dropped from lists. */
function sanitizeCourse(raw: unknown): Course | null {
	if (typeof raw !== "object" || raw === null) return null;
	const r = raw as Record<string, unknown>;
	const code = normalizeCourseCode(r.code);
	if (!code || typeof r.name !== "string") return null;
	const exam = (typeof r.exam === "object" && r.exam !== null ? r.exam : {}) as Course["exam"];
	const topics = (Array.isArray(r.topics) ? r.topics : []).filter(
		(t): t is CourseTopic =>
			typeof t === "object" && t !== null && typeof (t as CourseTopic).id === "string" && typeof (t as CourseTopic).title === "string",
	).map((t) => ({ ...t, weight: t.weight === 1 || t.weight === 3 ? t.weight : 2, status: isTopicStatus(t.status) ? t.status : "unknown" }) satisfies CourseTopic);
	const sources = (Array.isArray(r.sources) ? r.sources : []).filter(
		(s): s is CourseSource =>
			typeof s === "object" && s !== null && typeof (s as CourseSource).id === "string" && typeof (s as CourseSource).kind === "string",
	);
	const now = new Date().toISOString();
	const { version: _version, ...rest } = r;
	return {
		...(rest as unknown as Course),
		code,
		name: r.name,
		custom: r.custom === true,
		exam,
		minutesPerDay: clampMinutesPerDay(r.minutesPerDay),
		sources,
		topics,
		planDone: (Array.isArray(r.planDone) ? r.planDone : []).filter((k): k is string => typeof k === "string"),
		createdAt: str(r.createdAt) ?? now,
		updatedAt: str(r.updatedAt) ?? str(r.createdAt) ?? now,
	};
}

function getCourse(code: string): Course | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(courseFile(code), "utf-8"));
	} catch {
		return null; // unknown code, invalid code or unreadable file
	}
	// A record stamped NEWER than this build is refused, never misparsed:
	// a read-modify-write store must not rewrite what it does not understand.
	const version = (parsed as { version?: unknown } | null)?.version;
	if (typeof version === "number" && version > CURRENT_COURSE_VERSION) {
		console.error(`[course ${code}] record has schema version ${version} > ${CURRENT_COURSE_VERSION}; refusing to read it`);
		return null;
	}
	return sanitizeCourse(parsed);
}

function listCourses(): Course[] {
	let names: string[];
	try {
		names = fs.readdirSync(COURSES_DIR);
	} catch {
		return [];
	}
	return names
		.filter((name) => name.endsWith(".json"))
		.map((name) => getCourse(name.slice(0, -5)))
		.filter((course): course is Course => course !== null)
		// Plain code order (the "nb" collation would sort "AA…" as "Å…", last).
		.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

function saveCourse(course: Course): void {
	writeAtomic(courseFile(course.code), { ...course, version: CURRENT_COURSE_VERSION });
}

function deleteCourse(code: string): boolean {
	try {
		fs.unlinkSync(courseFile(code));
		return true;
	} catch {
		return false;
	}
}

/** One course in the cached NTNU list (short keys: ~4000 rows on disk). */
export interface NtnuListEntry {
	code: string;
	name: string;
	location?: string;
	/** Ordinary (non re-sit) exam dates, YYYY-MM-DD, ascending. */
	examDates: string[];
}
export interface NtnuListCache {
	fetchedAt: string;
	semester: number;
	courses: NtnuListEntry[];
}

function readNtnuList(): NtnuListCache | null {
	try {
		const parsed = JSON.parse(fs.readFileSync(NTNU_LIST_FILE, "utf-8")) as Partial<NtnuListCache> | null;
		if (!parsed || typeof parsed.fetchedAt !== "string" || !Array.isArray(parsed.courses)) return null;
		return { fetchedAt: parsed.fetchedAt, semester: Number(parsed.semester) || 0, courses: parsed.courses };
	} catch {
		return null;
	}
}

function writeNtnuList(cache: NtnuListCache): void {
	writeAtomic(NTNU_LIST_FILE, cache);
}

export const courseStore = {
	getCourse,
	listCourses,
	saveCourse,
	deleteCourse,
	readNtnuList,
	writeNtnuList,
};

export type CourseStore = typeof courseStore;
