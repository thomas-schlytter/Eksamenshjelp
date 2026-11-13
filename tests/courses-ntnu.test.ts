/**
 * NTNU FETCH (exam mode): the course-page parser against a shortened copy
 * of the real TTK4100 page, the course-list page parser, the local search,
 * and the client's caching and failure behavior. No network: every
 * request goes through an injected fetch.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
	createNtnuClient,
	NtnuUnreachableError,
	ntnuStudyYear,
	parseNtnuCoursePage,
	parseNtnuListPage,
	searchNtnuList,
} from "../src/server/ntnu.ts";
import type { NtnuListCache, NtnuListEntry } from "../src/store/courses.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = fs.readFileSync(path.join(here, "fixtures", "ntnu", "TTK4100.html"), "utf8");
const TODAY = "2026-11-13";
const NOW = new Date("2026-11-13T10:00:00.000Z");

function listPage(courses: unknown[], hasMoreResults = false) {
	return { courses, hasMoreResults, numFound: courses.length, pageNr: 1, pageSize: 500 };
}
const RAW = {
	ttk4100: {
		courseCode: "TTK4100",
		courseName: "Kybernetikk, introduksjon",
		courseUrl: "https://www.ntnu.no/studier/emner/TTK4100/2026",
		exam: [
			{ date: "2026-12-10", continuation: false, season: "AUTUMN", submissionDate: null, withdrawalDate: null },
			{ date: "2027-08-12", continuation: true, season: "SUMMER", submissionDate: null, withdrawalDate: null },
		],
		location: "Trondheim",
	},
	ttk4215: { courseCode: "TTK4215", courseName: "Adaptiv regulering", exam: [{ date: "2026-12-19", continuation: false }], location: "Trondheim" },
	tba4256: { courseCode: "TBA4256", courseName: "3D Digital modellering", exam: [{ date: null, continuation: false, submissionDate: "2026-12-11" }], location: "Trondheim" },
	tma4100: { courseCode: "TMA4100", courseName: "Matematikk 1", exam: [{ date: "2026-12-03", continuation: false }, { date: "2026-11-01", continuation: false }], location: "Trondheim" },
};

/** A fake fetch: a queue of handlers, one per request, plus a call log. */
function fakeFetch(handlers: Array<(url: string, init?: RequestInit) => Response | Promise<Response>>) {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, init });
		const handler = handlers.shift();
		if (!handler) throw new Error(`unexpected request: ${url}`);
		return handler(url, init);
	}) as typeof fetch;
	return { fetch: fetchImpl, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const html = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/html" } });

describe("parseNtnuCoursePage", () => {
	const page = parseNtnuCoursePage(PAGE, TODAY)!;

	it("reads the course header and facts", () => {
		assert.equal(page.code, "TTK4100");
		assert.equal(page.name, "Kybernetikk, introduksjon");
		assert.equal(page.credits, "7,5");
		assert.equal(page.level, "Grunnleggende emner, nivå I");
		assert.equal(page.url, "https://www.ntnu.no/studier/emner/TTK4100");
	});

	it("reads the description sections as clean text", () => {
		assert.ok(page.content!.startsWith("Reguleringsteknisk terminologi og sentrale elementære begreper."));
		assert.ok(page.learningOutcome!.startsWith("Kunnskap: Kunnskap om den generelle oppbygningen til et reguleringssystem."));
		assert.ok(page.learningOutcome!.includes("Generell kompetanse:"));
		assert.ok(page.learningMethods!.startsWith("Forelesninger, dataøvinger"));
		assert.ok(page.materials!.includes("Gravdahl"));
		assert.ok(!/\s{2,}|\n/.test(page.content!), "whitespace is collapsed");
	});

	it("finds the reading-list link (Leganto)", () => {
		assert.ok(page.readingListUrl!.startsWith("https://bibsys-ntnu-ub.alma.exlibrisgroup.com/leganto/"));
	});

	it("reads every exam block; later parts inherit the heading above them", () => {
		assert.deepEqual(
			page.examBlocks.map((b) => [b.heading, b.ordinary, b.form, b.weighting, b.date ?? null, b.duration ?? null]),
			[
				["Ordinær eksamen - Høst 2026", true, "Skriftlig skoleeksamen", "70/100", "2026-12-10", "4 timer"],
				["Ordinær eksamen - Høst 2026", true, "Prosjektfremføring", "30/100", "2026-10-27", "20 minutter"],
				["Utsatt eksamen - Sommer 2027", false, "Skriftlig skoleeksamen", "70/100", null, "4 timer"],
				["Utsatt eksamen - Sommer 2027", false, "Prosjektfremføring", "30/100", null, "20 minutter"],
			],
		);
	});

	it("the main exam is the heaviest part of the ordinary exam; aids come from the link's title", () => {
		assert.equal(page.exam.date, "2026-12-10");
		assert.equal(page.exam.form, "Skriftlig skoleeksamen");
		assert.equal(page.exam.duration, "4 timer");
		assert.equal(page.exam.aids, "D: Ingen trykte eller håndskrevne hjelpemidler tillatt. Bestemt, enkel kalkulator tillatt.");
		assert.deepEqual(page.exam.parts!.map((p) => p.form), ["Skriftlig skoleeksamen", "Prosjektfremføring"]);
		assert.ok(page.exam.parts!.every((p) => !("heading" in p) && !("ordinary" in p)), "parts carry only the contract's fields");
	});

	it("an unknown course renders a page without code and name: null", () => {
		assert.equal(parseNtnuCoursePage("<html><body><h1>Emner</h1><p>Fant ikke emnet.</p></body></html>"), null);
		assert.equal(parseNtnuCoursePage(""), null);
		assert.equal(parseNtnuCoursePage('<span class="course-code">TTK4100</span>'), null, "a code without a name is not a course");
	});

	it("a page without an exam tab still parses, with an empty exam", () => {
		const bare = parseNtnuCoursePage('<div><span class="course-code">abc1000</span><h1 class="display-custom course-name ">Et fag</h1></div>');
		assert.deepEqual(bare, { code: "ABC1000", name: "Et fag", url: "https://www.ntnu.no/studier/emner/ABC1000", exam: {}, examBlocks: [] });
	});
});

describe("the course list", () => {
	it("study year: autumn is its own year, spring belongs to the year before", () => {
		assert.equal(ntnuStudyYear(new Date(2026, 10, 13)), 2026);
		assert.equal(ntnuStudyYear(new Date(2026, 7, 1)), 2026);
		assert.equal(ntnuStudyYear(new Date(2027, 2, 1)), 2026);
		assert.equal(ntnuStudyYear(new Date(2027, 6, 31)), 2026);
	});

	it("parses a page: codes, names, location and ordinary exam dates only", () => {
		const parsed = parseNtnuListPage(listPage([RAW.ttk4100, RAW.tba4256, RAW.tma4100, { courseCode: "??", courseName: "Bad" }, null], true));
		assert.equal(parsed.hasMore, true);
		assert.deepEqual(parsed.courses, [
			{ code: "TTK4100", name: "Kybernetikk, introduksjon", location: "Trondheim", examDates: ["2026-12-10"] },
			{ code: "TBA4256", name: "3D Digital modellering", location: "Trondheim", examDates: [] },
			{ code: "TMA4100", name: "Matematikk 1", location: "Trondheim", examDates: ["2026-11-01", "2026-12-03"] },
		]);
		assert.deepEqual(parseNtnuListPage(null), { courses: [], hasMore: false });
	});

	const LIST: NtnuListEntry[] = parseNtnuListPage(listPage(Object.values(RAW))).courses;

	it("search: an exact code first, then code prefixes, then names; at most 20", () => {
		assert.deepEqual(searchNtnuList(LIST, "ttk4100").map((h) => h.code), ["TTK4100"]);
		assert.deepEqual(searchNtnuList(LIST, "TTK").map((h) => h.code), ["TTK4100", "TTK4215"]);
		assert.deepEqual(searchNtnuList(LIST, "ttk 42").map((h) => h.code), ["TTK4215"]);
		assert.deepEqual(searchNtnuList(LIST, "regulering").map((h) => h.code), ["TTK4215"]);
		assert.deepEqual(searchNtnuList(LIST, "matematikk").map((h) => h.name), ["Matematikk 1"]);
		assert.deepEqual(searchNtnuList(LIST, "  "), []);
		assert.deepEqual(searchNtnuList(LIST, "finnes ikke"), []);
		const many = Array.from({ length: 50 }, (_, i) => ({ code: `ABC${1000 + i}`, name: `Fag ${i}`, examDates: [] }));
		assert.equal(searchNtnuList(many, "abc").length, 20);
	});

	it("search hits carry the upcoming exam dates and the location", () => {
		assert.deepEqual(searchNtnuList(LIST, "TMA4100", TODAY), [{ code: "TMA4100", name: "Matematikk 1", examDates: ["2026-12-03"], location: "Trondheim" }]);
	});
});

describe("createNtnuClient", () => {
	it("fetches a course page with a browser user agent and parses it", async () => {
		const { fetch, calls } = fakeFetch([() => html(PAGE)]);
		const client = createNtnuClient({ fetch, now: () => NOW });
		const page = await client.coursePage("ttk4100", TODAY);
		assert.equal(page!.name, "Kybernetikk, introduksjon");
		assert.equal(calls[0]!.url, "https://www.ntnu.no/studier/emner/TTK4100");
		assert.match(String((calls[0]!.init!.headers as Record<string, string>)["User-Agent"]), /Mozilla\/5\.0/);
		assert.ok(calls[0]!.init!.signal, "every request carries a timeout signal");
	});

	it("an unknown course is null: a 404, a page without a course, or another course's page", async () => {
		const { fetch } = fakeFetch([() => html("nope", 404), () => html("<html><body>Emnesøk</body></html>"), () => html(PAGE)]);
		const client = createNtnuClient({ fetch, now: () => NOW });
		assert.equal(await client.coursePage("XYZ9999"), null);
		assert.equal(await client.coursePage("XYZ9999"), null);
		assert.equal(await client.coursePage("TTK4105"), null, "never saved under the wrong code");
		assert.equal(await client.coursePage("not a code"), null);
	});

	it("network errors, timeouts and server errors are NtnuUnreachableError", async () => {
		const { fetch } = fakeFetch([
			() => { throw new TypeError("fetch failed"); },
			() => html("down", 503),
			(_url, init) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason))),
		]);
		const client = createNtnuClient({ fetch, now: () => NOW, timeoutMs: 20 });
		await assert.rejects(client.coursePage("TTK4100"), NtnuUnreachableError);
		await assert.rejects(client.coursePage("TTK4100"), NtnuUnreachableError);
		await assert.rejects(client.coursePage("TTK4100"), NtnuUnreachableError, "a hung request times out");
	});

	it("downloads the whole list page by page once, then serves memory and disk", async () => {
		const { fetch, calls } = fakeFetch([
			() => json(listPage([RAW.ttk4100, RAW.ttk4215], true)),
			() => json(listPage([RAW.tma4100, { ...RAW.ttk4100, exam: [{ date: "2027-05-20", continuation: false }], location: "Gjøvik" }])),
		]);
		let disk: NtnuListCache | null = null;
		const deps = { fetch, now: () => NOW, readCache: () => disk, writeCache: (c: NtnuListCache) => { disk = c; } };
		const client = createNtnuClient(deps);
		const [a, b] = await Promise.all([client.search("TTK", TODAY), client.courseList()]);
		assert.equal(calls.length, 2, "two pages, one download for two concurrent callers");
		assert.match(calls[0]!.url, /fetch-courselist-as-json/);
		assert.equal(calls[0]!.init!.method, "POST");
		assert.equal(calls[0]!.init!.body, "semester=2026&courseAutumn=1&courseSpring=1&pageNo=1&sortOrder=%2Btitle");
		assert.match(String(calls[1]!.init!.body), /pageNo=2/);
		assert.deepEqual(a.map((h) => h.code), ["TTK4100", "TTK4215"]);
		assert.equal(b.length, 3, "a code listed twice is one row");
		assert.deepEqual(b.find((c) => c.code === "TTK4100")!.examDates, ["2026-12-10", "2027-05-20"], "with all its dates");
		assert.equal(disk!.semester, 2026);
		assert.equal(disk!.courses.length, 3);

		assert.equal(await client.examDate("ttk4100", TODAY), "2026-12-10");
		assert.equal(await client.examDate("TTK4100", "2026-12-11"), "2027-05-20", "the nearest date still ahead");
		assert.equal(await client.examDate("NOPE1000", TODAY), undefined);
		assert.equal(calls.length, 2, "memory cache: no new request");

		const second = createNtnuClient({ ...deps, fetch: fakeFetch([]).fetch });
		assert.equal((await second.courseList()).length, 3, "a fresh process reads the disk cache without a request");
	});

	it("a cache older than a week, or from another study year, is fetched again", async () => {
		const stale: NtnuListCache = { fetchedAt: "2026-11-01T00:00:00.000Z", semester: 2026, courses: [{ code: "OLD1000", name: "Gammelt", examDates: [] }] };
		const a = fakeFetch([() => json(listPage([RAW.ttk4100]))]);
		assert.deepEqual((await createNtnuClient({ fetch: a.fetch, now: () => NOW, readCache: () => stale }).courseList()).map((c) => c.code), ["TTK4100"]);
		const lastYear: NtnuListCache = { fetchedAt: "2026-11-12T00:00:00.000Z", semester: 2025, courses: stale.courses };
		const b = fakeFetch([() => json(listPage([RAW.ttk4215]))]);
		assert.deepEqual((await createNtnuClient({ fetch: b.fetch, now: () => NOW, readCache: () => lastYear }).courseList()).map((c) => c.code), ["TTK4215"]);
	});

	it("NTNU down: a stale cache beats a failure; with no cache the error surfaces", async () => {
		const stale: NtnuListCache = { fetchedAt: "2026-10-01T00:00:00.000Z", semester: 2026, courses: [{ code: "OLD1000", name: "Gammelt", examDates: [] }] };
		const down = () => fakeFetch([() => { throw new TypeError("fetch failed"); }]).fetch;
		assert.deepEqual((await createNtnuClient({ fetch: down(), now: () => NOW, readCache: () => stale }).search("old")).map((h) => h.code), ["OLD1000"]);
		await assert.rejects(createNtnuClient({ fetch: down(), now: () => NOW }).search("old"), NtnuUnreachableError);
		const garbage = fakeFetch([() => html("<html>login</html>")]);
		await assert.rejects(createNtnuClient({ fetch: garbage.fetch, now: () => NOW }).courseList(), NtnuUnreachableError, "a non-JSON answer is a failure, not an empty list");
		const empty = fakeFetch([() => json(listPage([]))]);
		await assert.rejects(createNtnuClient({ fetch: empty.fetch, now: () => NOW }).courseList(), NtnuUnreachableError);
	});
});
