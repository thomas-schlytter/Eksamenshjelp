import type {
	Course, CourseExam, CourseSearchHit, CourseSummary, CourseTopic, ExamPlan, TopicStatus,
} from "./course-types";

/**
 * The browser's client for the course HTTP API (the contract's table).
 * Every call takes an injectable fetch so tests run without a server, and
 * every failure becomes a CourseApiError carrying the server's own
 * Norwegian `error` line plus its machine `code`.
 */

export class CourseApiError extends Error {
	constructor(message: string, readonly status: number, readonly code?: string) {
		super(message);
		this.name = "CourseApiError";
	}
}

export interface CourseAndPlan { course: Course; plan: ExamPlan }

const FALLBACK = "Noe gikk galt. Prøv igjen.";
const OFFLINE = "Fikk ikke kontakt med appen. Sjekk at den kjører, og prøv igjen.";

/** The message a student sees. Known codes get specific, actionable help;
 *  everything else shows the server's own (Norwegian) line. */
export function courseErrorMessage(err: unknown, code?: string): string {
	if (err instanceof CourseApiError) {
		if (err.code === "course_not_found") {
			return `Fant ikke ${code ? `«${code}»` : "faget"} hos NTNU. Sjekk fagkoden, eller legg faget inn selv.`;
		}
		if (err.code === "ntnu_unreachable") {
			return "Fikk ikke kontakt med NTNU akkurat nå. Sjekk nettet og prøv igjen, eller legg faget inn selv.";
		}
		return err.message || FALLBACK;
	}
	return OFFLINE;
}

async function call<T>(fetchLike: typeof fetch, url: string, init?: RequestInit): Promise<T> {
	let res: Response;
	try {
		res = await fetchLike(url, { cache: "no-store", ...init });
	} catch {
		throw new CourseApiError(OFFLINE, 0, "network");
	}
	let body: unknown = null;
	try {
		body = await res.json();
	} catch { /* a non-JSON body is reported through the status below */ }
	if (!res.ok) {
		const failure = (body ?? {}) as { error?: unknown; code?: unknown };
		throw new CourseApiError(
			typeof failure.error === "string" && failure.error ? failure.error : FALLBACK,
			res.status,
			typeof failure.code === "string" ? failure.code : undefined,
		);
	}
	if (body === null || typeof body !== "object") throw new CourseApiError(FALLBACK, res.status);
	return body as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
	method,
	...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
});

const path = (code: string, rest = "") => `/api/courses/${encodeURIComponent(code)}${rest}`;

export type NewSource =
	| { kind: "file" | "folder"; path: string; title?: string }
	| { kind: "link"; url: string; title?: string }
	| { kind: "note"; text: string; title?: string };

export type TopicDraft = { id?: string; title: string; description?: string; weight?: 1 | 2 | 3; status?: TopicStatus };

export const courseApi = {
	list: (f: typeof fetch = fetch) =>
		call<{ courses: CourseSummary[] }>(f, "/api/courses").then((r) => r.courses),
	search: (q: string, f: typeof fetch = fetch, signal?: AbortSignal) =>
		call<{ hits: CourseSearchHit[] }>(f, `/api/courses/search?q=${encodeURIComponent(q)}`, { signal }).then((r) => r.hits),
	create: (body: { code: string } | { code: string; name: string; custom: true }, f: typeof fetch = fetch) =>
		call<CourseAndPlan>(f, "/api/courses", json("POST", body)),
	get: (code: string, f: typeof fetch = fetch) => call<CourseAndPlan>(f, path(code)),
	patch: (code: string, body: { name?: string; exam?: Partial<CourseExam>; minutesPerDay?: number }, f: typeof fetch = fetch) =>
		call<CourseAndPlan>(f, path(code), json("PATCH", body)),
	remove: (code: string, f: typeof fetch = fetch) => call<{ ok: true }>(f, path(code), json("DELETE")),
	refresh: (code: string, f: typeof fetch = fetch) => call<CourseAndPlan>(f, path(code, "/refresh"), json("POST")),
	addSource: (code: string, source: NewSource, f: typeof fetch = fetch) =>
		call<CourseAndPlan>(f, path(code, "/sources"), json("POST", source)),
	removeSource: (code: string, id: string, f: typeof fetch = fetch) =>
		call<CourseAndPlan>(f, path(code, `/sources/${encodeURIComponent(id)}`), json("DELETE")),
	generateTopics: (code: string, f: typeof fetch = fetch) =>
		call<CourseAndPlan & { generatedBy: "ai" | "fallback" }>(f, path(code, "/topics/generate"), json("POST")),
	putTopics: (code: string, topics: TopicDraft[], f: typeof fetch = fetch) =>
		call<CourseAndPlan>(f, path(code, "/topics"), json("PUT", { topics })),
	patchTopic: (code: string, id: string, body: Partial<Pick<CourseTopic, "status" | "title" | "weight" | "description">>, f: typeof fetch = fetch) =>
		call<CourseAndPlan>(f, path(code, `/topics/${encodeURIComponent(id)}`), json("PATCH", body)),
	planDone: (code: string, key: string, done: boolean, f: typeof fetch = fetch) =>
		call<CourseAndPlan>(f, path(code, "/plan/done"), json("POST", { key, done })),
};
