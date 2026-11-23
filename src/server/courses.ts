/**
 * COURSES — the server-side service behind /api/courses (exam mode).
 *
 * Every operation is read → change → save → announce: the store adapter
 * (src/store/courses.ts) persists, this module validates input, talks to
 * NTNU (src/server/ntnu.ts), generates topic lists (a background model
 * when one is configured, the deterministic reserve otherwise) and emits
 * `courses-changed`. Routes are thin wrappers: each function returns a
 * CourseOutcome the route maps straight to HTTP.
 *
 * User-facing error text is Norwegian bokmål; `code` is the machine
 * discriminator the frontend switches on.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "typebox";
import { emit } from "../core/events.ts";
import {
	MAX_NOTE_CHARS,
	MIN_MINUTES_PER_DAY,
	MAX_MINUTES_PER_DAY,
	buildExamPlan,
	clampMinutesPerDay,
	courseSummary,
	DEFAULT_MINUTES_PER_DAY,
	fallbackTopicDrafts,
	isIsoDate,
	isTopicStatus,
	localIsoDate,
	mergeTopics,
	normalizeCourseCode,
	type ChatCourseLink,
	type Course,
	type CourseSearchHit,
	type CourseSource,
	type CourseSummary,
	type ExamPlan,
	type TopicDraft,
} from "../core/courses.ts";
import { newCourseContextMessage, type LhMarkerMessage } from "../core/native-messages.ts";
import { resolveRoleSpec } from "../core/settings-resolution.ts";
import { ROLE_SLOT } from "../core/settings.ts";
import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { runSubmitAgent } from "../agent/subagents/submit-agent.ts";
import { withBgLlmSlot } from "../agent/subagents/bg-llm-semaphore.ts";
import type { CourseToolContext } from "../agent/tools/course.ts";
import { courseStore } from "../store/courses.ts";
import { settingsStore } from "../store/settings.ts";
import { providerKeyPresent } from "./keys.ts";
import { createNtnuClient, NtnuUnreachableError, type NtnuClient, type NtnuCoursePage } from "./ntnu.ts";

// ─── Outcomes ────────────────────────────────────────────────────────────────

export interface CourseFailure {
	ok: false;
	status: 400 | 404 | 409 | 502;
	error: string;
	code: string;
}
export type CourseOutcome<Extra = object> = ({ ok: true; course: Course; plan: ExamPlan } & Extra) | CourseFailure;

const fail = (status: CourseFailure["status"], code: string, error: string): CourseFailure => ({ ok: false, status, code, error });
const notFound = (code: string): CourseFailure => fail(404, "not_found", `Fant ikke faget ${code}. Det kan ha blitt slettet.`);
const INVALID_CODE = fail(400, "invalid_code", "Fagkoden ser ikke riktig ut. Skriv den slik den står hos NTNU, for eksempel TTK4100.");
const NTNU_UNREACHABLE = fail(
	502,
	"ntnu_unreachable",
	"Fikk ikke kontakt med NTNU akkurat nå. Prøv igjen om litt, eller legg inn faget manuelt.",
);

/** The JSON body + status for a failure (routes: `Response.json(...failureResponse(outcome))`). */
export function courseFailureResponse(failure: CourseFailure): Response {
	return Response.json({ error: failure.error, code: failure.code }, { status: failure.status });
}

// ─── Seams (tests swap these; production uses the defaults) ──────────────────

type GeneratedTopics = { drafts: TopicDraft[]; by: "ai" | "fallback" };

export const courseSeams: {
	/** The NTNU client (tests inject one over a fake fetch). */
	ntnu: NtnuClient;
	/** The learner's local date, YYYY-MM-DD. */
	today: () => string;
	/** The background engine for topic generation; undefined = not configured. */
	topicEngine: () => PiEngine | undefined;
} = {
	ntnu: globalNtnuClient(),
	today: () => localIsoDate(),
	topicEngine: resolveTopicEngine,
};

/** One client per process, shared across Next's per-route module entries
 *  (the turn-liveness discipline): its in-memory list cache and single
 *  in-flight download must not be duplicated per route. */
function globalNtnuClient(): NtnuClient {
	const g = globalThis as typeof globalThis & { __lhNtnuClient?: NtnuClient };
	return (g.__lhNtnuClient ??= createNtnuClient({
		readCache: courseStore.readNtnuList,
		writeCache: courseStore.writeNtnuList,
	}));
}

/** Topic generation is short structured background work: the extractor
 *  role (cheap slot, or its override). No model or no key = undefined,
 *  and the caller falls back to the deterministic reserve. */
function resolveTopicEngine(): PiEngine | undefined {
	try {
		const spec = resolveRoleSpec("extractor", settingsStore.readSettings());
		if (!spec || !providerKeyPresent(spec.provider)) return undefined;
		return piEngineForSpec(spec, true, undefined, () => settingsStore.readSettings()?.models?.[ROLE_SLOT.extractor]?.cacheRetention);
	} catch (err) {
		console.info("[courses] no usable model for topic generation:", err instanceof Error ? err.message : err);
		return undefined;
	}
}

// ─── Shared steps ────────────────────────────────────────────────────────────

function planFor(course: Course): ExamPlan {
	return buildExamPlan(course, courseSeams.today(), new Date().toISOString());
}

function done(course: Course): { ok: true; course: Course; plan: ExamPlan } {
	return { ok: true, course, plan: planFor(course) };
}

/** Save and announce. `chatId` marks a change made by a session's agent. */
function commit(course: Course, chatId?: string): Course {
	course.updatedAt = new Date().toISOString();
	courseStore.saveCourse(course);
	emit("courses-changed", { code: course.code, ...(chatId ? { chatId } : {}) });
	return course;
}

function load(rawCode: string): Course | CourseFailure {
	const code = normalizeCourseCode(safeDecode(rawCode));
	if (!code) return INVALID_CODE;
	return courseStore.getCourse(code) ?? notFound(code);
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

const isFailure = (value: Course | CourseFailure): value is CourseFailure => (value as CourseFailure).ok === false;
const asObject = (body: unknown): Record<string, unknown> => (typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {});
const newId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;

// ─── List, search, read ──────────────────────────────────────────────────────

export function listCourseSummaries(): CourseSummary[] {
	const today = courseSeams.today();
	return courseStore.listCourses().map((course) => courseSummary(course, today));
}

export type CourseSearchOutcome = { ok: true; hits: CourseSearchHit[] } | CourseFailure;

export async function searchCourses(query: string): Promise<CourseSearchOutcome> {
	const q = query.trim().slice(0, 80);
	if (!q) return { ok: true, hits: [] };
	const today = courseSeams.today();
	try {
		return { ok: true, hits: await courseSeams.ntnu.search(q, today) };
	} catch (err) {
		// The list is down: a full course code can still be answered from
		// the course page itself, so adding a known course keeps working.
		const code = normalizeCourseCode(q.replace(/\s+/g, ""));
		if (code && /\d/.test(code)) {
			try {
				const page = await courseSeams.ntnu.coursePage(code, today);
				return { ok: true, hits: page ? [{ code: page.code, name: page.name, examDates: page.exam.date ? [page.exam.date] : [] }] : [] };
			} catch {
				// fall through to the honest refusal below
			}
		}
		console.error("[courses] NTNU search failed:", err);
		return NTNU_UNREACHABLE;
	}
}

/** Warm the NTNU list in the background so the first search is instant.
 *  Never throws and never runs in tests. */
export function warmCourseSearch(): void {
	if (process.env.NODE_ENV === "test") return;
	void courseSeams.ntnu.courseList().catch(() => undefined);
}

export function readCourse(rawCode: string): CourseOutcome {
	const course = load(rawCode);
	return isFailure(course) ? course : done(course);
}

// ─── Create, refresh, patch, delete ──────────────────────────────────────────

/** Fold a fetched NTNU page into a course. The learner's own exam date
 *  survives; everything NTNU owns is replaced. */
function applyNtnuPage(course: Course, page: NtnuCoursePage, listDate: string | undefined, nowIso: string): void {
	course.name = page.name;
	course.custom = false;
	course.url = page.url;
	for (const key of ["credits", "level", "content", "learningOutcome", "learningMethods", "materials"] as const) {
		if (page[key]) course[key] = page[key];
		else delete course[key];
	}
	const ownDate = course.examDateSetBy === "self" ? course.exam.date : undefined;
	const ntnuDate = listDate ?? page.exam.date;
	course.exam = { ...page.exam, ...(ownDate ?? ntnuDate ? { date: ownDate ?? ntnuDate } : {}) };
	if (!ownDate) {
		if (ntnuDate) course.examDateSetBy = "ntnu";
		else delete course.examDateSetBy;
	}
	course.ntnuFetchedAt = nowIso;

	// The app's own sources: the course page, and the reading list if any.
	const mine = (s: CourseSource) => s.auto && (s.kind === "ntnu" || (s.kind === "link" && /leganto/i.test(s.url ?? "")));
	const kept = course.sources.filter((s) => !mine(s));
	const previous = course.sources.filter(mine);
	const auto = (kind: "ntnu" | "link", title: string, url: string): CourseSource => {
		const old = previous.find((s) => s.kind === kind);
		return { id: old?.id ?? newId("src"), kind, title, url, auto: true, addedAt: old?.addedAt ?? nowIso };
	};
	course.sources = [
		auto("ntnu", "NTNU-emnesiden", page.url),
		...(page.readingListUrl ? [auto("link", "Pensumliste (Leganto)", page.readingListUrl)] : []),
		...kept,
	];
}

/** The course page plus the list's exam date (the list is the better
 *  source for dates, but never worth failing the whole fetch over). */
async function fetchFromNtnu(code: string): Promise<{ page: NtnuCoursePage; listDate: string | undefined } | CourseFailure> {
	const today = courseSeams.today();
	let page: NtnuCoursePage | null;
	try {
		page = await courseSeams.ntnu.coursePage(code, today);
	} catch (err) {
		if (!(err instanceof NtnuUnreachableError)) console.error(`[courses] unexpected NTNU failure for ${code}:`, err);
		return NTNU_UNREACHABLE;
	}
	if (!page) {
		return fail(404, "course_not_found", `Fant ikke ${code} hos NTNU. Sjekk fagkoden, eller legg inn faget manuelt.`);
	}
	let listDate: string | undefined;
	try {
		listDate = await courseSeams.ntnu.examDate(code, today);
	} catch {
		listDate = undefined;
	}
	return { page, listDate };
}

function blankCourse(code: string, name: string, custom: boolean, nowIso: string): Course {
	return {
		code,
		name,
		custom,
		exam: {},
		minutesPerDay: DEFAULT_MINUTES_PER_DAY,
		sources: [],
		topics: [],
		planDone: [],
		createdAt: nowIso,
		updatedAt: nowIso,
	};
}

export async function createCourse(body: unknown): Promise<CourseOutcome> {
	const input = asObject(body);
	const code = normalizeCourseCode(input.code);
	if (!code) return INVALID_CODE;
	const existing = courseStore.getCourse(code);
	if (existing) return done(existing);
	const nowIso = new Date().toISOString();

	if (input.custom === true) {
		const name = typeof input.name === "string" ? input.name.trim().slice(0, 160) : "";
		if (!name) return fail(400, "name_required", "Skriv inn et navn på faget.");
		return done(commit(blankCourse(code, name, true, nowIso)));
	}

	const fetched = await fetchFromNtnu(code);
	if ("ok" in fetched) return fetched;
	// Two requests for the same new course: the first one to finish wins.
	const raced = courseStore.getCourse(code);
	if (raced) return done(raced);
	const course = blankCourse(code, fetched.page.name, false, nowIso);
	applyNtnuPage(course, fetched.page, fetched.listDate, nowIso);
	return done(commit(course));
}

export async function refreshCourse(rawCode: string): Promise<CourseOutcome> {
	const loaded = load(rawCode);
	if (isFailure(loaded)) return loaded;
	const fetched = await fetchFromNtnu(loaded.code);
	if ("ok" in fetched) return fetched;
	// Re-read: the learner may have edited the course while NTNU answered.
	const course = courseStore.getCourse(loaded.code);
	if (!course) return notFound(loaded.code);
	applyNtnuPage(course, fetched.page, fetched.listDate, new Date().toISOString());
	return done(commit(course));
}

export function patchCourse(rawCode: string, body: unknown): CourseOutcome {
	const course = load(rawCode);
	if (isFailure(course)) return course;
	const input = asObject(body);

	if (input.name !== undefined) {
		const name = typeof input.name === "string" ? input.name.trim().slice(0, 160) : "";
		if (!name) return fail(400, "name_required", "Faget må ha et navn.");
		course.name = name;
	}
	if (input.minutesPerDay !== undefined) {
		const minutes = Number(input.minutesPerDay);
		if (!Number.isFinite(minutes) || minutes < MIN_MINUTES_PER_DAY || minutes > MAX_MINUTES_PER_DAY) {
			return fail(400, "invalid_minutes", `Velg mellom ${MIN_MINUTES_PER_DAY} og ${MAX_MINUTES_PER_DAY} minutter per dag.`);
		}
		course.minutesPerDay = clampMinutesPerDay(minutes);
	}
	if (input.exam !== undefined) {
		const exam = asObject(input.exam);
		if ("date" in exam) {
			if (exam.date === null || exam.date === "") {
				// Clearing hands the date back to NTNU (the next refresh fills it).
				delete course.exam.date;
				delete course.examDateSetBy;
			} else if (isIsoDate(exam.date)) {
				course.exam.date = exam.date;
				course.examDateSetBy = "self";
			} else {
				return fail(400, "invalid_date", "Eksamensdatoen må være en gyldig dato.");
			}
		}
		for (const key of ["form", "duration", "aids"] as const) {
			if (!(key in exam)) continue;
			const value = typeof exam[key] === "string" ? (exam[key] as string).trim().slice(0, 300) : "";
			if (value) course.exam[key] = value;
			else delete course.exam[key];
		}
	}
	return done(commit(course));
}

/** Sessions that were started from the course are kept; their course
 *  link simply points at nothing afterwards. */
export function removeCourse(rawCode: string): { ok: true } | CourseFailure {
	const course = load(rawCode);
	if (isFailure(course)) return course;
	if (!courseStore.deleteCourse(course.code)) return notFound(course.code);
	emit("courses-changed", { code: course.code });
	return { ok: true };
}

// ─── Sources ─────────────────────────────────────────────────────────────────

/** What the agent's read tools can open: text, images and PDFs via
 *  `read`. Office formats are not readable yet. */
const TEXT_EXTENSIONS = new Set([
	"md", "markdown", "txt", "tex", "rst", "org", "csv", "tsv", "json", "yaml", "yml", "html", "htm", "xml",
	"py", "m", "jl", "r", "c", "h", "cpp", "hpp", "java", "js", "ts", "ipynb",
]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);
const MAX_FOLDER_FILES = 500;
const MAX_FOLDER_DEPTH = 6;
const MAX_SOURCES = 60;

function extensionOf(name: string): string {
	const ext = path.extname(name).slice(1).toLowerCase();
	return ext;
}

export function isSupportedSourceFile(name: string): boolean {
	const ext = extensionOf(name);
	return ext === "pdf" || TEXT_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext);
}

/** Supported files under a folder, relative paths, breadth-first and
 *  name-sorted so the result is stable. Hidden folders and node_modules
 *  are skipped; the walk stops at the caps. */
export function listSupportedFiles(root: string, limit = MAX_FOLDER_FILES): string[] {
	const found: string[] = [];
	let level: string[] = [""];
	for (let depth = 0; depth <= MAX_FOLDER_DEPTH && level.length > 0 && found.length < limit; depth++) {
		const next: string[] = [];
		for (const relative of level) {
			let entries: fs.Dirent[];
			try {
				entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true });
			} catch {
				continue; // unreadable subfolder: skip it, keep the rest
			}
			entries.sort((a, b) => a.name.localeCompare(b.name));
			for (const entry of entries) {
				if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
				const child = relative ? path.join(relative, entry.name) : entry.name;
				if (entry.isDirectory()) next.push(child);
				else if (entry.isFile() && isSupportedSourceFile(entry.name)) {
					found.push(child);
					if (found.length >= limit) return found;
				}
			}
		}
		level = next;
	}
	return found;
}

function expandHome(input: string): string {
	if (input === "~") return os.homedir();
	if (input.startsWith("~/") || input.startsWith("~\\")) return path.join(os.homedir(), input.slice(2));
	return input;
}

function firstLine(text: string): string {
	const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
	return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}

function buildSource(input: Record<string, unknown>, nowIso: string): CourseSource | CourseFailure {
	const title = typeof input.title === "string" ? input.title.trim().slice(0, 120) : "";
	const base = { id: newId("src"), auto: false, addedAt: nowIso };
	switch (input.kind) {
		case "file":
		case "folder": {
			const raw = typeof input.path === "string" ? input.path.trim() : "";
			if (!raw) return fail(400, "path_required", "Velg en fil eller mappe først.");
			const resolved = path.normalize(expandHome(raw));
			if (!path.isAbsolute(resolved)) {
				return fail(400, "path_not_absolute", "Stien må være fullstendig, for eksempel /Users/deg/Dokumenter/TTK4100.");
			}
			let stat: fs.Stats;
			try {
				stat = fs.statSync(resolved);
				fs.accessSync(resolved, fs.constants.R_OK);
			} catch {
				return fail(400, "path_unavailable", "Fant ikke stien, eller appen har ikke tilgang til den. Sjekk at den finnes og prøv igjen.");
			}
			if (input.kind === "file") {
				if (!stat.isFile()) return fail(400, "not_a_file", "Dette er en mappe. Velg «Mappe» for å legge til hele mappen.");
				if (!isSupportedSourceFile(resolved)) {
					return fail(400, "unsupported_file", "Denne filtypen kan ikke leses ennå. Bruk PDF, tekst (for eksempel .md, .txt, .tex) eller bilde.");
				}
				return { ...base, kind: "file", title: title || path.basename(resolved), path: resolved };
			}
			if (!stat.isDirectory()) return fail(400, "not_a_folder", "Dette er en fil. Velg «Fil» for å legge til bare den.");
			return {
				...base,
				kind: "folder",
				title: title || path.basename(resolved) || resolved,
				path: resolved,
				fileCount: listSupportedFiles(resolved).length,
			};
		}
		case "link": {
			const raw = typeof input.url === "string" ? input.url.trim() : "";
			let url: URL;
			try {
				url = new URL(raw);
			} catch {
				return fail(400, "invalid_url", "Lenken må starte med http:// eller https://.");
			}
			if (url.protocol !== "http:" && url.protocol !== "https:") {
				return fail(400, "invalid_url", "Lenken må starte med http:// eller https://.");
			}
			return { ...base, kind: "link", title: title || url.hostname.replace(/^www\./, ""), url: url.toString() };
		}
		case "note": {
			const text = typeof input.text === "string" ? input.text.trim() : "";
			if (!text) return fail(400, "note_empty", "Notatet er tomt. Lim inn eller skriv noe først.");
			if (text.length > MAX_NOTE_CHARS) {
				return fail(400, "note_too_long", `Notatet er for langt (maks ${MAX_NOTE_CHARS.toLocaleString("nb-NO")} tegn). Del det opp, eller legg det til som fil.`);
			}
			return { ...base, kind: "note", title: title || firstLine(text) || "Notat", text };
		}
		default:
			return fail(400, "invalid_kind", "Ukjent type kilde. Velg fil, mappe, lenke eller notat.");
	}
}

export function addCourseSource(rawCode: string, body: unknown): CourseOutcome {
	const course = load(rawCode);
	if (isFailure(course)) return course;
	const source = buildSource(asObject(body), new Date().toISOString());
	if ("ok" in source) return source;
	// The same path or link twice is one source, not two.
	const duplicate = course.sources.some(
		(s) => (source.path && s.path === source.path) || (source.url && s.url === source.url) || (source.text && s.text === source.text),
	);
	if (duplicate) return done(course);
	if (course.sources.length >= MAX_SOURCES) {
		return fail(400, "too_many_sources", `Et fag kan ha opptil ${MAX_SOURCES} kilder. Fjern en kilde, eller legg filene i én mappe.`);
	}
	course.sources.push(source);
	return done(commit(course));
}

export function removeCourseSource(rawCode: string, sourceId: string): CourseOutcome {
	const course = load(rawCode);
	if (isFailure(course)) return course;
	const before = course.sources.length;
	course.sources = course.sources.filter((s) => s.id !== sourceId);
	if (course.sources.length === before) return fail(404, "source_not_found", "Fant ikke kilden. Den kan allerede være fjernet.");
	return done(commit(course));
}

// ─── Topics ──────────────────────────────────────────────────────────────────

const topicListSchema = Type.Object({
	topics: Type.Array(
		Type.Object({
			id: Type.String({ description: "Short stable slug: lower-case ascii letters, digits and hyphens (e.g. \"pid-regulator\")." }),
			title: Type.String({ description: "The topic's name in Norwegian (bokmål), 2-7 words, as a student would say it." }),
			description: Type.String({ description: "One or two sentences in Norwegian: what the student must be able to do on this topic at the exam." }),
			weight: Type.Number({ minimum: 1, maximum: 3, description: "Exam relevance: 3 = central, almost always examined; 2 = regular; 1 = peripheral." }),
		}),
		{ minItems: 8, maxItems: 20 },
	),
});

const TOPIC_SYSTEM_PROMPT = [
	"You prepare a university student for an exam. From the official course description and the student's own material,",
	"you divide the course into the topics the student must master for the exam.",
	"",
	"Rules:",
	"- 8 to 20 topics that together cover the examinable syllabus, with no overlap. Each topic is something one can be asked about and can practice on its own.",
	"- Order them the way the course builds: foundations first.",
	"- Titles and descriptions are written in Norwegian (bokmål), in the course's own terminology.",
	"- weight is exam relevance (3 central, 2 regular, 1 peripheral). Earlier exam papers among the material are the best evidence of what matters; use their file names and any excerpts.",
	"- Leave out generic skills (teamwork, communication, ethics) unless the exam really tests them.",
	"- When existing topics are listed, keep the exact id of every topic that still exists, so the student's progress on it is kept.",
	"",
	"Deliver the list with one call to the submit_topics tool. Do not write prose.",
].join("\n");

const EXCERPT_FILE_BYTES = 200_000;
const EXCERPT_CHARS = 2_500;
const MATERIAL_BUDGET_CHARS = 24_000;

/** What the model sees of the learner's own sources: folder listings
 *  (file names carry signal: "eksamen-2023.pdf"), pasted notes and the
 *  head of small text files. Bounded, read-only, best-effort. */
export function sourceDigest(course: Course): string {
	const parts: string[] = [];
	let budget = MATERIAL_BUDGET_CHARS;
	const add = (text: string) => {
		if (budget <= 0) return;
		const clipped = text.length > budget ? `${text.slice(0, budget)}\n[…truncated]` : text;
		budget -= clipped.length;
		parts.push(clipped);
	};
	const excerpt = (file: string): string | null => {
		try {
			if (!TEXT_EXTENSIONS.has(extensionOf(file)) || fs.statSync(file).size > EXCERPT_FILE_BYTES) return null;
			return fs.readFileSync(file, "utf-8").slice(0, EXCERPT_CHARS).trim() || null;
		} catch {
			return null;
		}
	};
	for (const source of course.sources) {
		if (source.kind === "note" && source.text) add(`Note "${source.title}":\n${source.text.slice(0, 6_000)}`);
		else if (source.kind === "link" && !source.auto) add(`Link "${source.title}": ${source.url}`);
		else if (source.kind === "file" && source.path) {
			const text = excerpt(source.path);
			add(`File: ${path.basename(source.path)}${text ? `\nBeginning of the file:\n${text}` : ""}`);
		} else if (source.kind === "folder" && source.path) {
			const files = listSupportedFiles(source.path, 120);
			add(`Folder "${source.title}" (${files.length}${files.length >= 120 ? "+" : ""} files):\n${files.map((f) => `- ${f}`).join("\n")}`);
			// A couple of small text files give the model the course's own words.
			for (const file of files.filter((f) => TEXT_EXTENSIONS.has(extensionOf(f))).slice(0, 3)) {
				const text = excerpt(path.join(source.path, file));
				if (text) add(`Beginning of ${file}:\n${text}`);
			}
		}
	}
	return parts.join("\n\n");
}

export function topicPrompt(course: Course): string {
	const exam = [course.exam.form, course.exam.duration, course.exam.aids ? `aids: ${course.exam.aids}` : ""].filter(Boolean).join("; ");
	const material = sourceDigest(course);
	return [
		`Course: ${course.code} ${course.name}${course.credits ? ` (${course.credits} credits)` : ""}`,
		exam ? `Exam: ${exam}` : "",
		course.exam.parts && course.exam.parts.length > 1
			? `Assessment parts: ${course.exam.parts.map((p) => `${p.form}${p.weighting ? ` ${p.weighting}` : ""}`).join(", ")}`
			: "",
		course.content ? `\nCourse content (official):\n${course.content}` : "",
		course.learningOutcome ? `\nLearning outcomes (official):\n${course.learningOutcome}` : "",
		course.materials ? `\nCourse materials: ${course.materials}` : "",
		material ? `\nThe student's own material:\n${material}` : "",
		course.topics.length > 0
			? `\nExisting topics (keep the id of each one that still exists):\n${course.topics.map((t) => `- [${t.id}] ${t.title}`).join("\n")}`
			: "",
		"\nSubmit the topic list now.",
	]
		.filter(Boolean)
		.join("\n");
}

const TOPIC_TIMEOUT_MS = 120_000;

async function generateDrafts(course: Course): Promise<GeneratedTopics> {
	const fallback = (): GeneratedTopics => ({ drafts: fallbackTopicDrafts(course), by: "fallback" });
	const hasMaterial = Boolean(course.content || course.learningOutcome || course.sources.some((s) => !s.auto));
	const engine = hasMaterial ? courseSeams.topicEngine() : undefined;
	if (!engine) return fallback();
	try {
		const signal = AbortSignal.timeout(TOPIC_TIMEOUT_MS);
		const submitted = await withBgLlmSlot(signal, () =>
			runSubmitAgent<{ topics: TopicDraft[] }>({
				role: "extractor",
				engine,
				toolName: "submit_topics",
				toolDescription: "Submit the course's exam topics: 8 to 20 topics in the order the course builds.",
				parameters: topicListSchema,
				fill: (input: { topics: Array<{ id: string; title: string; description?: string; weight?: number }> }) => ({
					topics: input.topics.map((t) => ({
						id: t.id,
						title: t.title,
						...(t.description ? { description: t.description } : {}),
						weight: Math.min(3, Math.max(1, Math.round(Number(t.weight) || 2))),
					})),
				}),
				validate: (value) => (value.topics.some((t) => !t.title.trim()) ? "every topic needs a non-empty title" : null),
				systemPrompt: TOPIC_SYSTEM_PROMPT,
				prompt: topicPrompt(course),
				signal,
				onStep: () => undefined,
				neverSubmitted: "the model never submitted a topic list",
			}),
		);
		if (submitted.topics.length === 0) return fallback();
		return { drafts: submitted.topics, by: "ai" };
	} catch (err) {
		// A missing key, a provider outage or a stubborn model must never
		// leave the learner without topics: the reserve is always there.
		console.error(`[courses] topic generation for ${course.code} fell back to the reserve:`, err instanceof Error ? err.message : err);
		return fallback();
	}
}

export async function generateCourseTopics(rawCode: string): Promise<CourseOutcome<{ generatedBy: "ai" | "fallback" }>> {
	const loaded = load(rawCode);
	if (isFailure(loaded)) return loaded;
	const generated = await generateDrafts(loaded);
	// Re-read: a status may have been set while the model was working.
	const course = courseStore.getCourse(loaded.code);
	if (!course) return notFound(loaded.code);
	// Nothing to build from (a manual course without description): keep
	// whatever list exists instead of wiping it.
	if (generated.drafts.length > 0) {
		course.topics = mergeTopics(course.topics, generated.drafts, new Date().toISOString());
		course.topicsGeneratedBy = generated.by;
		commit(course);
	}
	return { ...done(course), generatedBy: generated.by };
}

export function replaceCourseTopics(rawCode: string, body: unknown): CourseOutcome {
	const course = load(rawCode);
	if (isFailure(course)) return course;
	const raw = asObject(body).topics;
	if (!Array.isArray(raw)) return fail(400, "invalid_topics", "Temalista mangler. Prøv igjen.");
	const drafts: TopicDraft[] = [];
	for (const item of raw) {
		const t = asObject(item);
		if (typeof t.title !== "string" || !t.title.trim()) return fail(400, "topic_title_required", "Alle temaer må ha en tittel.");
		drafts.push({
			...(typeof t.id === "string" && t.id.trim() ? { id: t.id } : {}),
			title: t.title,
			...(typeof t.description === "string" ? { description: t.description } : {}),
			...(typeof t.weight === "number" ? { weight: t.weight } : {}),
			...(isTopicStatus(t.status) ? { status: t.status } : {}),
		});
	}
	course.topics = mergeTopics(course.topics, drafts, new Date().toISOString());
	course.topicsGeneratedBy = "manual";
	return done(commit(course));
}

export function patchCourseTopic(rawCode: string, topicId: string, body: unknown): CourseOutcome {
	const course = load(rawCode);
	if (isFailure(course)) return course;
	const topic = course.topics.find((t) => t.id === safeDecode(topicId));
	if (!topic) return fail(404, "topic_not_found", "Fant ikke temaet. Det kan ha blitt fjernet.");
	const input = asObject(body);
	if (input.title !== undefined) {
		const title = typeof input.title === "string" ? input.title.trim().slice(0, 160) : "";
		if (!title) return fail(400, "topic_title_required", "Temaet må ha en tittel.");
		topic.title = title;
	}
	if (input.description !== undefined) {
		const description = typeof input.description === "string" ? input.description.trim().slice(0, 600) : "";
		if (description) topic.description = description;
		else delete topic.description;
	}
	if (input.weight !== undefined) {
		if (input.weight !== 1 && input.weight !== 2 && input.weight !== 3) {
			return fail(400, "invalid_weight", "Viktighet må være 1, 2 eller 3.");
		}
		topic.weight = input.weight;
	}
	if (input.status !== undefined) {
		if (!isTopicStatus(input.status)) return fail(400, "invalid_status", "Ukjent status. Velg rød, gul, grønn eller ikke kartlagt.");
		topic.status = input.status;
		topic.statusSource = "self";
		delete topic.statusNote;
		topic.updatedAt = new Date().toISOString();
	}
	return done(commit(course));
}

// ─── Plan ────────────────────────────────────────────────────────────────────

const MAX_PLAN_DONE_KEYS = 2_000;

export function setPlanItemDone(rawCode: string, body: unknown): CourseOutcome {
	const course = load(rawCode);
	if (isFailure(course)) return course;
	const input = asObject(body);
	const key = typeof input.key === "string" ? input.key : "";
	if (!/^\d{4}-\d{2}-\d{2}\|[^|]*\|(learn|practice|review|mock)$/.test(key) || typeof input.done !== "boolean") {
		return fail(400, "invalid_plan_item", "Kunne ikke oppdatere punktet i planen. Last siden på nytt og prøv igjen.");
	}
	const keys = new Set(course.planDone);
	if (input.done) keys.add(key);
	else keys.delete(key);
	// Oldest first out: keys sort by date, and only recent ones matter.
	course.planDone = [...keys].sort().slice(-MAX_PLAN_DONE_KEYS);
	return done(commit(course));
}

// ─── Sessions: the course context and the agent's port ───────────────────────

/** Validate a session's course link from a request body. Null = no link
 *  (absent, malformed, or the course does not exist). */
export function parseChatCourseLink(raw: unknown): ChatCourseLink | null {
	const input = asObject(raw);
	const code = normalizeCourseCode(input.code);
	if (!code) return null;
	const course = courseStore.getCourse(code);
	if (!course) return null;
	const mode = input.mode === "learn" || input.mode === "practice" || input.mode === "mapping" || input.mode === "exam" || input.mode === "sub" ? input.mode : undefined;
	const topicId = typeof input.topicId === "string" && course.topics.some((t) => t.id === input.topicId) ? input.topicId : undefined;
	return { code, ...(topicId ? { topicId } : {}), ...(mode ? { mode } : {}) };
}

/** The course-context marker for a new session; null when the course is gone. */
export function courseContextMessageFor(link: ChatCourseLink, opts: { kind?: "teach" | "practice" | "exam" } = {}): LhMarkerMessage | null {
	const course = courseStore.getCourse(link.code);
	return course ? newCourseContextMessage(course, link, courseSeams.today(), opts) : null;
}

/** The topic_status tool's port for one session (the agent layer never
 *  imports this module: chat-handler injects the returned context). */
export function courseToolContextFor(link: ChatCourseLink | undefined, chatId: string): CourseToolContext | undefined {
	const code = normalizeCourseCode(link?.code);
	if (!code) return undefined;
	return {
		code,
		topics: () => courseStore.getCourse(code)?.topics.map((t) => ({ id: t.id, title: t.title })) ?? null,
		setStatus: (topicId, status, note) => {
			const course = courseStore.getCourse(code);
			const topic = course?.topics.find((t) => t.id === topicId);
			if (!course || !topic) return false;
			topic.status = status;
			topic.statusSource = "agent";
			if (note) topic.statusNote = note;
			else delete topic.statusNote;
			topic.updatedAt = new Date().toISOString();
			commit(course, chatId);
			return true;
		},
	};
}
