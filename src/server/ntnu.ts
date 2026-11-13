/**
 * NTNU — the app's own fetch of public course facts (exam mode).
 *
 * Two public sources, no login:
 *  - the course page  https://www.ntnu.no/studier/emner/<CODE>  (HTML):
 *    name, credits, content, learning outcomes, materials and the exam tab;
 *  - the course list  (JSON, 500 per page): code, name, location and exam
 *    dates for every course in the current study year. The list endpoint
 *    does not filter by query, so it is fetched whole once, cached on disk
 *    for a week (data/ntnu/courses.json) and searched locally.
 *
 * `parseNtnuCoursePage` is pure. Network access goes through an injected
 * fetch (tests never touch the network); every failure surfaces as
 * NtnuUnreachableError so callers can offer manual entry instead.
 */

import { parseHTML } from "linkedom";
import { fuzzyScore } from "../core/fuzzy.ts";
import { isIsoDate, normalizeCourseCode, type CourseExam, type CourseExamPart, type CourseSearchHit } from "../core/courses.ts";
import type { NtnuListCache, NtnuListEntry } from "../store/courses.ts";

const COURSE_PAGE_URL = "https://www.ntnu.no/studier/emner/";
const COURSE_LIST_URL =
	"https://www.ntnu.no/web/studier/emnesok?p_p_id=courselistportlet_WAR_courselistportlet&p_p_lifecycle=2&p_p_state=normal" +
	"&p_p_mode=view&p_p_resource_id=fetch-courselist-as-json&p_p_cacheability=cacheLevelPage";
const USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 15_000;
const LIST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A hard stop on list paging (the list is ~9 pages; a broken
 *  hasMoreResults must never loop forever). */
const MAX_LIST_PAGES = 40;
const MAX_SEARCH_HITS = 20;

export class NtnuUnreachableError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "NtnuUnreachableError";
	}
}

// ─── The course page ─────────────────────────────────────────────────────────

/** One assessment part as the exam tab lists it. */
export interface NtnuExamBlock extends CourseExamPart {
	/** "Ordinær eksamen - Høst 2026" / "Utsatt eksamen - Sommer 2027". */
	heading: string;
	/** false for re-sit ("utsatt") exams. */
	ordinary: boolean;
}

export interface NtnuCoursePage {
	code: string;
	name: string;
	url: string;
	credits?: string;
	level?: string;
	content?: string;
	learningOutcome?: string;
	learningMethods?: string;
	materials?: string;
	/** The reading list link (Leganto), when the page has one. */
	readingListUrl?: string;
	exam: CourseExam;
	examBlocks: NtnuExamBlock[];
}

interface TextNode {
	textContent: string | null;
}

function textOf(node: TextNode | null | undefined): string {
	return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** "10.12.2026" → "2026-12-10"; anything else → undefined. */
function norwegianDate(text: string): string | undefined {
	const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(text);
	if (!m) return undefined;
	const iso = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
	return isIsoDate(iso) ? iso : undefined;
}

/** "70/100" → 0.7 (for picking the main part); unknown → 0. */
function weightingShare(weighting: string | undefined): number {
	const m = /(\d+)\s*\/\s*(\d+)/.exec(weighting ?? "");
	return m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : 0;
}

function parseExamBlocks(document: Document): NtnuExamBlock[] {
	const scoped = document.querySelectorAll("#omEksamen .exam-element");
	const elements = scoped.length > 0 ? scoped : document.querySelectorAll(".exam-element");
	const blocks: NtnuExamBlock[] = [];
	// Only the first part of each exam carries the heading; later parts
	// belong to the heading above them.
	let heading = "";
	for (const element of elements) {
		const own = textOf(element.querySelector(".course-exam-heading2"));
		if (own) heading = own;
		const form = textOf(element.querySelector(".exam-form"));
		if (!form) continue;
		const block: NtnuExamBlock = { heading, ordinary: !/utsatt|kontinuasjon|re-?sit|postponed/i.test(heading), form };
		let label = "";
		for (const item of element.querySelectorAll("span.exam-item")) {
			if (item.classList.contains("exam-fact-label")) {
				label = textOf(item).toLowerCase();
				continue;
			}
			const value = textOf(item);
			if (!label || !value) continue;
			if (label.startsWith("vekting")) block.weighting = value;
			else if (label.startsWith("varighet")) block.duration = value;
			else if (label.startsWith("hjelpemid")) {
				// The link text is only a code ("Kode D"); its title spells it out.
				const title = item.querySelector("a")?.getAttribute("title")?.replace(/\s+/g, " ").trim();
				block.aids = title || value;
			} else if (label.startsWith("dato") || label.startsWith("innlevering")) {
				const date = norwegianDate(value);
				if (date) block.date = date;
			}
			label = "";
		}
		blocks.push(block);
	}
	return blocks;
}

/** The main exam: the ordinary exam whose date is the nearest one ahead
 *  (or the first ordinary one), and within it the heaviest part. */
function mainExamOf(blocks: readonly NtnuExamBlock[], todayIso: string | undefined): CourseExam {
	const ordinary = blocks.filter((b) => b.ordinary);
	const pool = ordinary.length > 0 ? ordinary : blocks;
	if (pool.length === 0) return {};
	const headings = [...new Set(pool.map((b) => b.heading))];
	const nextDate = (heading: string): string | undefined =>
		pool
			.filter((b) => b.heading === heading && b.date && (!todayIso || b.date >= todayIso))
			.map((b) => b.date!)
			.sort()[0];
	const upcoming = headings.filter((h) => nextDate(h)).sort((a, b) => nextDate(a)!.localeCompare(nextDate(b)!));
	const heading = upcoming[0] ?? headings[0]!;
	const parts = pool.filter((b) => b.heading === heading);
	// Heaviest part first; a dated part breaks a tie (sort is stable, so
	// page order decides the rest).
	const main =
		[...parts].sort(
			(a, b) => weightingShare(b.weighting) - weightingShare(a.weighting) || Number(Boolean(b.date)) - Number(Boolean(a.date)),
		)[0] ?? parts[0]!;
	return {
		...(main.date ? { date: main.date } : {}),
		form: main.form,
		...(main.duration ? { duration: main.duration } : {}),
		...(main.aids ? { aids: main.aids } : {}),
		parts: parts.map(({ heading: _heading, ordinary: _ordinary, ...part }) => part),
	};
}

/**
 * Parse a course page. Null when the page is not a course (an unknown
 * code renders a page without the course code and name). `todayIso` picks
 * the upcoming exam when a course lists several; absent = the first one.
 */
export function parseNtnuCoursePage(html: string, todayIso?: string): NtnuCoursePage | null {
	const { document } = parseHTML(html);
	const code = normalizeCourseCode(textOf(document.querySelector(".course-code")));
	const name = textOf(document.querySelector("h1.course-name") ?? document.querySelector(".course-name"));
	if (!code || !name) return null;

	const facts = new Map<string, string>();
	for (const fact of document.querySelectorAll(".course-facts .course-fact")) {
		const label = textOf(fact.querySelector(".course-fact-label"));
		let value = textOf(fact.querySelector(".course-fact-value"));
		// Some facts nest the label inside the value element.
		if (label && value.startsWith(label)) value = value.slice(label.length).trim();
		if (label && value && !facts.has(label.toLowerCase())) facts.set(label.toLowerCase(), value);
	}
	const section = (selector: string): string | undefined => textOf(document.querySelector(selector)) || undefined;
	const readingList = [...document.querySelectorAll(".content-course-pensum a, a[href*='leganto']")]
		.map((a) => a.getAttribute("href") ?? "")
		.find((href) => /^https?:\/\//.test(href));
	const examBlocks = parseExamBlocks(document as unknown as Document);

	const credits = facts.get("studiepoeng");
	const level = facts.get("nivå");
	const content = section(".content-course-content");
	const learningOutcome = section(".content-learning-goal");
	const learningMethods = section(".content-learning-method");
	const materials = section(".content-course-materials");
	return {
		code,
		name,
		url: `${COURSE_PAGE_URL}${encodeURIComponent(code)}`,
		...(credits ? { credits } : {}),
		...(level ? { level } : {}),
		...(content ? { content } : {}),
		...(learningOutcome ? { learningOutcome } : {}),
		...(learningMethods ? { learningMethods } : {}),
		...(materials ? { materials } : {}),
		...(readingList ? { readingListUrl: readingList } : {}),
		exam: mainExamOf(examBlocks, todayIso),
		examBlocks,
	};
}

// ─── The course list ─────────────────────────────────────────────────────────

/** The study year NTNU's list is keyed by: autumn belongs to its own
 *  year, spring to the year before (spring 2027 is study year 2026). */
export function ntnuStudyYear(now: Date): number {
	return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

interface RawListCourse {
	courseCode?: unknown;
	courseName?: unknown;
	location?: unknown;
	exam?: unknown;
}

/** One list page → cache rows (pure; exported for the tests). */
export function parseNtnuListPage(json: unknown): { courses: NtnuListEntry[]; hasMore: boolean } {
	const body = (typeof json === "object" && json !== null ? json : {}) as { courses?: unknown; hasMoreResults?: unknown };
	const courses: NtnuListEntry[] = [];
	for (const raw of Array.isArray(body.courses) ? (body.courses as RawListCourse[]) : []) {
		const code = normalizeCourseCode(raw?.courseCode);
		if (!code || typeof raw.courseName !== "string") continue;
		const examDates = (Array.isArray(raw.exam) ? raw.exam : [])
			.filter((e): e is { date: string; continuation?: unknown } => typeof e === "object" && e !== null && isIsoDate((e as { date?: unknown }).date))
			.filter((e) => e.continuation !== true)
			.map((e) => e.date);
		courses.push({
			code,
			name: raw.courseName.trim(),
			...(typeof raw.location === "string" && raw.location ? { location: raw.location } : {}),
			examDates: [...new Set(examDates)].sort(),
		});
	}
	return { courses, hasMore: body.hasMoreResults === true };
}

/** Local search over the cached list: a code prefix wins, then fuzzy
 *  match on code and name. Pure; exported for the tests. */
export function searchNtnuList(courses: readonly NtnuListEntry[], query: string, todayIso?: string): CourseSearchHit[] {
	const q = query.trim();
	if (!q) return [];
	const compact = q.toUpperCase().replace(/\s+/g, "");
	const scored: Array<{ entry: NtnuListEntry; score: number }> = [];
	for (const entry of courses) {
		let score: number | null = null;
		if (entry.code === compact) score = 2_000;
		else if (entry.code.startsWith(compact)) score = 1_000 - (entry.code.length - compact.length);
		else score = fuzzyScore(q, entry.code, entry.name);
		if (score !== null && score > 0) scored.push({ entry, score });
	}
	scored.sort((a, b) => b.score - a.score || a.entry.code.localeCompare(b.entry.code));
	return scored.slice(0, MAX_SEARCH_HITS).map(({ entry }) => ({
		code: entry.code,
		name: entry.name,
		examDates: todayIso ? entry.examDates.filter((d) => d >= todayIso) : entry.examDates,
		...(entry.location ? { location: entry.location } : {}),
	}));
}

// ─── The client ──────────────────────────────────────────────────────────────

export interface NtnuClientDeps {
	fetch?: typeof fetch;
	now?: () => Date;
	/** The disk cache (src/store/courses.ts); absent = memory only. */
	readCache?: () => NtnuListCache | null;
	writeCache?: (cache: NtnuListCache) => void;
	timeoutMs?: number;
}

export interface NtnuClient {
	/** The parsed course page; null = NTNU has no such course. */
	coursePage(code: string, todayIso?: string): Promise<NtnuCoursePage | null>;
	/** The whole course list (cached a week; a stale cache beats a failure). */
	courseList(): Promise<NtnuListEntry[]>;
	search(query: string, todayIso?: string): Promise<CourseSearchHit[]>;
	/** The nearest ordinary exam date from today, from the list. */
	examDate(code: string, todayIso: string): Promise<string | undefined>;
}

export function createNtnuClient(deps: NtnuClientDeps = {}): NtnuClient {
	const now = deps.now ?? (() => new Date());
	const timeoutMs = deps.timeoutMs ?? FETCH_TIMEOUT_MS;
	let memory: NtnuListCache | null = null;
	let inFlight: Promise<NtnuListCache> | null = null;

	async function request(url: string, init: RequestInit): Promise<Response> {
		const doFetch = deps.fetch ?? globalThis.fetch;
		try {
			return await doFetch(url, {
				...init,
				headers: { "User-Agent": USER_AGENT, "Accept-Language": "nb-NO,nb;q=0.9", ...(init.headers ?? {}) },
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch (cause) {
			throw new NtnuUnreachableError(`NTNU request failed: ${url}`, { cause });
		}
	}

	async function coursePage(rawCode: string, todayIso?: string): Promise<NtnuCoursePage | null> {
		const code = normalizeCourseCode(rawCode);
		if (!code) return null;
		const res = await request(`${COURSE_PAGE_URL}${encodeURIComponent(code)}`, { method: "GET", headers: { Accept: "text/html" } });
		if (res.status === 404) return null;
		if (!res.ok) throw new NtnuUnreachableError(`NTNU answered ${res.status} for ${code}`);
		let html: string;
		try {
			html = await res.text();
		} catch (cause) {
			throw new NtnuUnreachableError(`NTNU response for ${code} could not be read`, { cause });
		}
		const page = parseNtnuCoursePage(html, todayIso);
		// A redirect to another course must never be saved under this code.
		return page && page.code === code ? page : null;
	}

	async function fetchList(): Promise<NtnuListCache> {
		const semester = ntnuStudyYear(now());
		const byCode = new Map<string, NtnuListEntry>();
		for (let pageNo = 1; pageNo <= MAX_LIST_PAGES; pageNo++) {
			const res = await request(COURSE_LIST_URL, {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/json" },
				body: `semester=${semester}&courseAutumn=1&courseSpring=1&pageNo=${pageNo}&sortOrder=%2Btitle`,
			});
			if (!res.ok) throw new NtnuUnreachableError(`NTNU course list answered ${res.status}`);
			let json: unknown;
			try {
				json = await res.json();
			} catch (cause) {
				throw new NtnuUnreachableError("NTNU course list was not JSON", { cause });
			}
			const page = parseNtnuListPage(json);
			for (const course of page.courses) {
				const known = byCode.get(course.code);
				// The same code can appear once per location: keep one row, all dates.
				if (known) known.examDates = [...new Set([...known.examDates, ...course.examDates])].sort();
				else byCode.set(course.code, course);
			}
			if (!page.hasMore || page.courses.length === 0) break;
		}
		if (byCode.size === 0) throw new NtnuUnreachableError("NTNU course list came back empty");
		return { fetchedAt: now().toISOString(), semester, courses: [...byCode.values()] };
	}

	const fresh = (cache: NtnuListCache | null): cache is NtnuListCache =>
		cache !== null &&
		cache.courses.length > 0 &&
		cache.semester === ntnuStudyYear(now()) &&
		now().getTime() - Date.parse(cache.fetchedAt) < LIST_TTL_MS;

	async function courseList(): Promise<NtnuListEntry[]> {
		if (fresh(memory)) return memory.courses;
		const disk = deps.readCache?.() ?? null;
		if (fresh(disk)) {
			memory = disk;
			return disk.courses;
		}
		// One download at a time, however many searches are waiting on it.
		inFlight ??= fetchList().finally(() => {
			inFlight = null;
		});
		try {
			const list = await inFlight;
			memory = list;
			try {
				deps.writeCache?.(list);
			} catch (err) {
				console.error("[ntnu] could not write the course-list cache:", err);
			}
			return list.courses;
		} catch (err) {
			const stale = memory ?? disk;
			if (stale && stale.courses.length > 0) return stale.courses;
			throw err;
		}
	}

	return {
		coursePage,
		courseList,
		search: async (query, todayIso) => searchNtnuList(await courseList(), query, todayIso),
		examDate: async (rawCode, todayIso) => {
			const code = normalizeCourseCode(rawCode);
			const entry = code ? (await courseList()).find((c) => c.code === code) : undefined;
			return entry?.examDates.find((d) => d >= todayIso);
		},
	};
}
