/**
 * The fag UI's pure helpers (components/courses/course-format.ts and
 * course-api.ts): labels, dates, sorting, the session each Start button
 * creates, and the error lines a student sees. No React, no network.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	countsSummary, daysBetween, daysLeftLabel, daysLeftShort, formatExamDate, formatMinutes, formatNumericDate, formatPlanDay,
	learnSession, mappingSession, mockExamSession, planItemSubject, practiceSession, sessionForPlanItem,
	sortCoursesByExam, sortTopicsForBoard,
} from "../components/courses/course-format.ts";
import { courseApi, CourseApiError, courseErrorMessage } from "../components/courses/course-api.ts";
import { minutesOptionFor } from "../components/courses/exam-plan.tsx";
import { pathKindOrder, sourceDetail } from "../components/courses/course-sources.tsx";
import { SessionStarter } from "../components/start-session.ts";
import { readOpeningPrompt } from "../components/opening-prompt.ts";

const course = { code: "TTK4100", name: "Kybernetikk introduksjon", topics: [{ id: "laplace", title: "Laplacetransformasjon" }] };

describe("course labels and dates", () => {
	it("the countdown says what to do when there is no date, and never counts negative days", () => {
		assert.equal(daysLeftLabel(null), "Sett eksamensdato");
		assert.equal(daysLeftLabel(-3), "Eksamen er over");
		assert.equal(daysLeftLabel(0), "Eksamen er i dag");
		assert.equal(daysLeftLabel(1), "1 dag til eksamen");
		assert.equal(daysLeftLabel(12), "12 dager til eksamen");
		assert.equal(daysLeftShort(null), "");
		assert.equal(daysLeftShort(-1), "");
		assert.equal(daysLeftShort(0), "i dag");
		assert.equal(daysLeftShort(12), "12 d");
	});

	it("dates read in Norwegian; a missing or broken date renders nothing", () => {
		assert.equal(formatExamDate("2026-12-07"), "7. desember 2026");
		assert.equal(formatExamDate("2026-05-17T10:00:00.000Z"), "17. mai 2026");
		assert.equal(formatExamDate(undefined), "");
		assert.equal(formatExamDate("2026-13-40"), "");
		assert.equal(formatNumericDate("2026-12-01"), "01/12/2026");
		assert.equal(formatNumericDate("2026-05-17T10:00:00.000Z"), "17/05/2026");
		assert.equal(formatNumericDate(undefined), "");
		assert.equal(formatNumericDate("2026-13-40"), "");
	});

	it("plan days: I dag, I morgen, then weekday and date", () => {
		assert.equal(formatPlanDay("2026-11-13", "2026-11-13"), "I dag");
		assert.equal(formatPlanDay("2026-11-14", "2026-11-13"), "I morgen");
		assert.equal(formatPlanDay("2026-11-17", "2026-11-13"), "tirsdag 17. november");
		assert.equal(daysBetween("2026-11-13", "2026-12-07"), 24);
		assert.equal(daysBetween("2026-11-13", "2026-11-10"), -3);
		assert.equal(daysBetween("nope", "2026-11-10"), null);
	});

	it("minutes read as time, not arithmetic", () => {
		assert.equal(formatMinutes(25), "25 min");
		assert.equal(formatMinutes(60), "1 t");
		assert.equal(formatMinutes(90), "1 t 30 min");
		assert.equal(minutesOptionFor(120), 120);
		assert.equal(minutesOptionFor(100), 120, "an odd stored value shows the nearest choice");
		assert.equal(minutesOptionFor(600), 240, "4 t+ covers everything above");
	});

	it("the progress line is described in words (status is never colour alone)", () => {
		assert.equal(countsSummary({ green: 0, yellow: 0, red: 0, unknown: 0 }), "Ingen temaer ennå");
		assert.equal(
			countsSummary({ green: 3, yellow: 2, red: 1, unknown: 4 }),
			"10 temaer: 3 kan du, 2 er du usikker på, 1 kan du ikke ennå, 4 er ikke kartlagt",
		);
		assert.equal(countsSummary({ green: 1, yellow: 0, red: 0, unknown: 0 }), "1 tema: 1 kan du");
	});
});

describe("course ordering", () => {
	it("home: nearest exam first, then no date, then passed exams", () => {
		const sorted = sortCoursesByExam([
			{ code: "PASSED", daysLeft: -4 },
			{ code: "NODATE", daysLeft: null },
			{ code: "FAR", daysLeft: 40 },
			{ code: "NEAR", daysLeft: 3 },
			{ code: "TODAY", daysLeft: 0 },
		]);
		assert.deepEqual(sorted.map((c) => c.code), ["TODAY", "NEAR", "FAR", "NODATE", "PASSED"]);
	});

	it("topic board: what needs work first, the most exam-relevant on top within a colour", () => {
		const sorted = sortTopicsForBoard([
			{ title: "Grønn", status: "green", weight: 3 },
			{ title: "Ukjent", status: "unknown", weight: 2 },
			{ title: "Rød liten", status: "red", weight: 1 },
			{ title: "Gul", status: "yellow", weight: 2 },
			{ title: "Rød stor", status: "red", weight: 3 },
		] as const);
		assert.deepEqual(sorted.map((t) => t.title), ["Rød stor", "Rød liten", "Gul", "Ukjent", "Grønn"]);
	});
});

describe("what a Start button creates", () => {
	it("Lær: a teaching session on the topic, opened in the student's voice", () => {
		assert.deepEqual(learnSession(course, course.topics[0]!), {
			title: "Lær: Laplacetransformasjon",
			course: { code: "TTK4100", topicId: "laplace", mode: "learn" },
			openingText: "Lær meg Laplacetransformasjon i TTK4100 fram mot eksamen.",
		});
	});

	it("Øv: a practice session (kind + mode) asking for exam problems", () => {
		assert.deepEqual(practiceSession(course, course.topics[0]!), {
			title: "Øv: Laplacetransformasjon",
			kind: "practice",
			course: { code: "TTK4100", topicId: "laplace", mode: "practice" },
			openingText: "Gi meg eksamensoppgaver om Laplacetransformasjon i TTK4100.",
		});
	});

	it("mock exam and mapping are course-wide; mapping is a teaching session", () => {
		assert.deepEqual(mockExamSession(course), {
			title: "Prøveeksamen TTK4100",
			kind: "practice",
			course: { code: "TTK4100", mode: "practice" },
			openingText: "Gi meg et prøveeksamenssett i TTK4100.",
		});
		const mapping = mappingSession(course);
		assert.equal(mapping.title, "Kartlegging TTK4100");
		assert.equal(mapping.kind, undefined);
		assert.deepEqual(mapping.course, { code: "TTK4100", mode: "mapping" });
		assert.equal(mapping.openingText, "Kartlegg hva jeg kan i TTK4100 Kybernetikk introduksjon.");
	});

	it("plan items map by activity: learn/review teach, practice/mock drill", () => {
		const item = (activity: "learn" | "practice" | "review" | "mock", topicId?: string) =>
			sessionForPlanItem(course, { activity, topicId, title: activity === "mock" ? "Prøveeksamen: løs et tidligere eksamenssett på tid" : "Lær: Laplacetransformasjon" });
		assert.equal(item("learn", "laplace").kind, undefined);
		assert.equal(item("learn", "laplace").course.mode, "learn");
		assert.equal(item("review", "laplace").kind, undefined);
		assert.equal(item("review", "laplace").title, "Repeter: Laplacetransformasjon");
		assert.equal(item("review", "laplace").course.topicId, "laplace");
		assert.equal(item("practice", "laplace").kind, "practice");
		assert.equal(item("mock").kind, "practice");
		assert.equal(item("mock").openingText, "Gi meg et prøveeksamenssett i TTK4100.");
	});

	it("a plan item whose topic was deleted still starts, about the item's own subject", () => {
		const start = sessionForPlanItem(course, { activity: "learn", topicId: "gone", title: "Lær: Bodediagram" });
		assert.equal(planItemSubject({ title: "Lær: Bodediagram" }), "Bodediagram");
		assert.deepEqual(start.course, { code: "TTK4100", mode: "learn" });
		assert.equal(start.openingText, "Lær meg Bodediagram i TTK4100 fram mot eksamen.");
	});

	it("the starter posts the fag link and hands over the OPENING TEXT, not the short title", async () => {
		const data = new Map<string, string>();
		const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
		Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
			getItem: (key: string) => data.get(key) ?? null,
			setItem: (key: string, value: string) => { data.set(key, value); },
			removeItem: (key: string) => { data.delete(key); },
		} });
		try {
			let body: unknown;
			const f = (async (_url: string, init?: RequestInit) => {
				body = JSON.parse(String(init?.body));
				return new Response(JSON.stringify({ id: "c_fag" }), { status: 200 });
			}) as unknown as typeof fetch;
			const { openingText, ...create } = practiceSession(course, course.topics[0]!);
			const target = await new SessionStarter().start(create, f, undefined, openingText);
			assert.equal(target, "/chat/c_fag");
			assert.deepEqual(body, {
				title: "Øv: Laplacetransformasjon",
				kind: "practice",
				course: { code: "TTK4100", topicId: "laplace", mode: "practice" },
			});
			assert.equal(readOpeningPrompt("c_fag"), "Gi meg eksamensoppgaver om Laplacetransformasjon i TTK4100.");
		} finally {
			if (original) Object.defineProperty(globalThis, "sessionStorage", original);
			else Reflect.deleteProperty(globalThis, "sessionStorage");
		}
	});
});

describe("sources", () => {
	it("a pasted path with an extension is tried as a file first, otherwise as a folder", () => {
		assert.deepEqual(pathKindOrder("/Users/x/eksamen-2023.pdf"), ["file", "folder"]);
		assert.deepEqual(pathKindOrder("/Users/x/TTK4100/eksamener/"), ["folder", "file"]);
		assert.deepEqual(pathKindOrder("C:\\fag\\TTK4100"), ["folder", "file"]);
	});

	it("each kind shows where it is: path, file count, link, or the note's first words", () => {
		const base = { id: "s", title: "t", auto: false, addedAt: "2026-11-13T00:00:00.000Z" };
		assert.equal(sourceDetail({ ...base, kind: "folder", path: "/x/eksamener", fileCount: 12 }), "/x/eksamener · 12 filer");
		assert.equal(sourceDetail({ ...base, kind: "folder", path: "/x/e", fileCount: 1 }), "/x/e · 1 fil");
		assert.equal(sourceDetail({ ...base, kind: "file", path: "/x/a.pdf" }), "/x/a.pdf");
		assert.equal(sourceDetail({ ...base, kind: "link", url: "https://example.org/a" }), "https://example.org/a");
		assert.equal(sourceDetail({ ...base, kind: "note", text: "linje én\n\nlinje to" }), "linje én linje to");
		assert.ok(sourceDetail({ ...base, kind: "note", text: "x".repeat(400) }).endsWith("…"));
	});
});

describe("the course API client", () => {
	const answer = (status: number, body: unknown) =>
		(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

	it("404 course_not_found and 502 ntnu_unreachable get specific, actionable lines", async () => {
		const notFound = await courseApi.create({ code: "XXX9999" }, answer(404, { error: "Fant ikke emnet.", code: "course_not_found" })).catch((e) => e);
		assert.ok(notFound instanceof CourseApiError);
		assert.equal(notFound.status, 404);
		assert.equal(courseErrorMessage(notFound, "XXX9999"), "Fant ikke «XXX9999» hos NTNU. Sjekk fagkoden, eller legg faget inn selv.");
		const down = await courseApi.search("ttk", answer(502, { error: "x", code: "ntnu_unreachable" })).catch((e) => e);
		assert.match(courseErrorMessage(down), /Fikk ikke kontakt med NTNU/);
		assert.match(courseErrorMessage(down), /legg faget inn selv/);
	});

	it("any other failure shows the server's own Norwegian line; no body falls back to a plain one", async () => {
		const bad = await courseApi.addSource("TTK4100", { kind: "file", path: "/nope" }, answer(400, { error: "Fant ikke filen.", code: "invalid_path" })).catch((e) => e);
		assert.equal(courseErrorMessage(bad), "Fant ikke filen.");
		const empty = await courseApi.get("TTK4100", (async () => new Response("oops", { status: 500 })) as unknown as typeof fetch).catch((e) => e);
		assert.equal(courseErrorMessage(empty), "Noe gikk galt. Prøv igjen.");
	});

	it("a network failure is told apart from a server answer", async () => {
		const offline = await courseApi.list((async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch).catch((e) => e);
		assert.ok(offline instanceof CourseApiError);
		assert.equal(offline.code, "network");
		assert.match(offline.message, /Fikk ikke kontakt med appen/);
	});

	it("routes and bodies follow the contract; fagkoder are escaped into the path", async () => {
		const calls: { url: string; method: string; body: unknown }[] = [];
		const f = (async (url: string, init?: RequestInit) => {
			calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
			return new Response(JSON.stringify({ course: {}, plan: {}, courses: [], hits: [], ok: true, generatedBy: "ai" }), { status: 200 });
		}) as unknown as typeof fetch;
		await courseApi.list(f);
		await courseApi.search("kyb intro", f);
		await courseApi.create({ code: "TTK4100" }, f);
		await courseApi.create({ code: "ÆØ1", name: "Eget fag", custom: true }, f);
		await courseApi.patch("TTK4100", { exam: { date: "2026-12-07" } }, f);
		await courseApi.patchTopic("TTK4100", "laplace", { status: "green" }, f);
		await courseApi.planDone("TTK4100", "2026-11-13|laplace|learn", true, f);
		await courseApi.putTopics("TTK4100", [{ title: "Nytt", weight: 2 }], f);
		await courseApi.generateTopics("TTK4100", f);
		await courseApi.removeSource("ÆØ1", "s 1", f);
		await courseApi.refresh("TTK4100", f);
		await courseApi.remove("TTK4100", f);
		assert.deepEqual(calls, [
			{ url: "/api/courses", method: "GET", body: undefined },
			{ url: "/api/courses/search?q=kyb%20intro", method: "GET", body: undefined },
			{ url: "/api/courses", method: "POST", body: { code: "TTK4100" } },
			{ url: "/api/courses", method: "POST", body: { code: "ÆØ1", name: "Eget fag", custom: true } },
			{ url: "/api/courses/TTK4100", method: "PATCH", body: { exam: { date: "2026-12-07" } } },
			{ url: "/api/courses/TTK4100/topics/laplace", method: "PATCH", body: { status: "green" } },
			{ url: "/api/courses/TTK4100/plan/done", method: "POST", body: { key: "2026-11-13|laplace|learn", done: true } },
			{ url: "/api/courses/TTK4100/topics", method: "PUT", body: { topics: [{ title: "Nytt", weight: 2 }] } },
			{ url: "/api/courses/TTK4100/topics/generate", method: "POST", body: undefined },
			{ url: "/api/courses/%C3%86%C3%981/sources/s%201", method: "DELETE", body: undefined },
			{ url: "/api/courses/TTK4100/refresh", method: "POST", body: undefined },
			{ url: "/api/courses/TTK4100", method: "DELETE", body: undefined },
		]);
	});
});
