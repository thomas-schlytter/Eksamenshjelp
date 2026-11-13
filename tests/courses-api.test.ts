/**
 * /api/courses (exam mode): the route handlers driven directly under an
 * isolated LH_DATA_DIR, with NTNU and the topic model replaced through
 * courseSeams. Pins the HTTP contract the frontend codes against: paths,
 * bodies, response shapes, status codes and error codes.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { after, beforeEach, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, type FauxResponseStep, type ToolCall } from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";
import type { Course, CourseSummary, ExamPlan } from "../src/core/courses.ts";
import type { LhMarkerMessage } from "../src/core/native-messages.ts";

// ── the seam, BEFORE any config-loading import ──────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-courses-api-"));
process.env.LH_DATA_DIR = path.join(TMP, "data");
process.env.LH_AUTH_FILE = path.join(TMP, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");

const { courseSeams } = await import("../src/server/courses.ts");
const { NtnuUnreachableError, parseNtnuCoursePage } = await import("../src/server/ntnu.ts");
const { subscribe } = await import("../src/core/events.ts");
const { chatStore } = await import("../src/store/chats.ts");
const coursesRoute = await import("../app/api/courses/route.ts");
const searchRoute = await import("../app/api/courses/search/route.ts");
const courseRoute = await import("../app/api/courses/[code]/route.ts");
const refreshRoute = await import("../app/api/courses/[code]/refresh/route.ts");
const sourcesRoute = await import("../app/api/courses/[code]/sources/route.ts");
const sourceRoute = await import("../app/api/courses/[code]/sources/[id]/route.ts");
const topicsRoute = await import("../app/api/courses/[code]/topics/route.ts");
const generateRoute = await import("../app/api/courses/[code]/topics/generate/route.ts");
const topicRoute = await import("../app/api/courses/[code]/topics/[id]/route.ts");
const planDoneRoute = await import("../app/api/courses/[code]/plan/done/route.ts");
const chatsRoute = await import("../app/api/chats/route.ts");

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = fs.readFileSync(path.join(here, "fixtures", "ntnu", "TTK4100.html"), "utf8");
const TODAY = "2026-11-13";

type Body = { course: Course; plan: ExamPlan; generatedBy?: string; error?: string; code?: string };

/** The fake NTNU: one known course, switchable outage, a call log. */
const ntnu = { down: false, listDown: false, listDate: "2026-12-10" as string | undefined, pageCalls: 0 };
courseSeams.today = () => TODAY;
courseSeams.topicEngine = () => undefined;
courseSeams.ntnu = {
	coursePage: async (code, today) => {
		ntnu.pageCalls++;
		if (ntnu.down) throw new NtnuUnreachableError("down");
		return code === "TTK4100" ? parseNtnuCoursePage(PAGE, today) : null;
	},
	courseList: async () => {
		if (ntnu.down || ntnu.listDown) throw new NtnuUnreachableError("down");
		return [{ code: "TTK4100", name: "Kybernetikk, introduksjon", location: "Trondheim", examDates: ntnu.listDate ? [ntnu.listDate] : [] }];
	},
	search: async (q) => {
		if (ntnu.down || ntnu.listDown) throw new NtnuUnreachableError("down");
		return q.toLowerCase().startsWith("ttk") ? [{ code: "TTK4100", name: "Kybernetikk, introduksjon", examDates: ["2026-12-10"], location: "Trondheim" }] : [];
	},
	examDate: async (code) => {
		if (ntnu.down || ntnu.listDown) throw new NtnuUnreachableError("down");
		return code === "TTK4100" ? ntnu.listDate : undefined;
	},
};

const req = (method: string, body?: unknown, url = "http://test/api/x") =>
	new Request(url, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}) });
const at = (code: string) => ({ params: Promise.resolve({ code }) });
const atId = (code: string, id: string) => ({ params: Promise.resolve({ code, id }) });
async function read(res: Response): Promise<Body> {
	return (await res.json()) as Body;
}
async function addTtk(): Promise<Body> {
	return read(await coursesRoute.POST(req("POST", { code: "ttk4100" })));
}
function resetData(): void {
	fs.rmSync(path.join(TMP, "data", "courses"), { recursive: true, force: true });
	Object.assign(ntnu, { down: false, listDown: false, listDate: "2026-12-10", pageCalls: 0 });
	courseSeams.topicEngine = () => undefined;
}

function fauxEngine(steps: FauxResponseStep[]): PiEngine {
	const faux = createFauxCore({});
	faux.setResponses(steps);
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

beforeEach(resetData);

describe("POST /api/courses", () => {
	it("{ code } fetches the course from NTNU and creates it with the app's own sources", async () => {
		const events: unknown[] = [];
		const off = subscribe((e) => { if (e.type === "courses-changed") events.push(e); });
		const res = await coursesRoute.POST(req("POST", { code: "ttk4100" }));
		off();
		assert.equal(res.status, 200);
		const { course, plan } = await read(res);
		assert.equal(course.code, "TTK4100");
		assert.equal(course.name, "Kybernetikk, introduksjon");
		assert.equal(course.custom, false);
		assert.equal(course.credits, "7,5");
		assert.equal(course.minutesPerDay, 120);
		assert.ok(course.learningOutcome!.startsWith("Kunnskap:"));
		assert.equal(course.exam.date, "2026-12-10");
		assert.equal(course.exam.form, "Skriftlig skoleeksamen");
		assert.equal(course.exam.parts!.length, 2);
		assert.ok(course.ntnuFetchedAt);
		assert.deepEqual(course.topics, []);
		assert.deepEqual(course.planDone, []);
		assert.deepEqual(course.sources.map((s) => [s.kind, s.auto, s.title]), [["ntnu", true, "NTNU-emnesiden"], ["link", true, "Pensumliste (Leganto)"]]);
		assert.equal(course.sources[0]!.url, "https://www.ntnu.no/studier/emner/TTK4100");
		assert.match(course.sources[1]!.url!, /leganto/);
		assert.equal(plan.daysLeft, 27);
		assert.deepEqual(plan.days, [], "no topics yet, so nothing to plan");
		assert.deepEqual(events, [{ type: "courses-changed", code: "TTK4100" }]);
		assert.ok(fs.existsSync(path.join(TMP, "data", "courses", "TTK4100.json")));
	});

	it("the list's exam date wins over the page's, and the page's is the fallback", async () => {
		ntnu.listDate = "2026-12-15";
		assert.equal((await addTtk()).course.exam.date, "2026-12-15");
		resetData();
		ntnu.listDown = true;
		assert.equal((await addTtk()).course.exam.date, "2026-12-10", "the list being down never fails the course");
	});

	it("an existing course is returned as it is, without asking NTNU again", async () => {
		await addTtk();
		const res = await coursesRoute.POST(req("POST", { code: "TTK4100" }));
		assert.equal(res.status, 200);
		assert.equal((await read(res)).course.code, "TTK4100");
		assert.equal(ntnu.pageCalls, 1);
	});

	it("an unknown code is 404 course_not_found; an outage is 502 ntnu_unreachable; both in Norwegian", async () => {
		const missing = await coursesRoute.POST(req("POST", { code: "XYZ9999" }));
		assert.equal(missing.status, 404);
		const missingBody = await read(missing);
		assert.equal(missingBody.code, "course_not_found");
		assert.match(missingBody.error!, /Fant ikke XYZ9999 hos NTNU/);
		ntnu.down = true;
		const down = await coursesRoute.POST(req("POST", { code: "TTK4100" }));
		assert.equal(down.status, 502);
		const downBody = await read(down);
		assert.equal(downBody.code, "ntnu_unreachable");
		assert.match(downBody.error!, /legg inn faget manuelt/);
		assert.ok(!fs.existsSync(path.join(TMP, "data", "courses", "TTK4100.json")), "nothing is saved on failure");
	});

	it("{ code, name, custom: true } creates a course by hand, without NTNU", async () => {
		ntnu.down = true;
		const res = await coursesRoute.POST(req("POST", { code: "mitt-fag", name: "  Mitt eget fag ", custom: true }));
		assert.equal(res.status, 200);
		const { course, plan } = await read(res);
		assert.equal(course.code, "MITT-FAG");
		assert.equal(course.name, "Mitt eget fag");
		assert.equal(course.custom, true);
		assert.deepEqual(course.exam, {});
		assert.deepEqual(course.sources, []);
		assert.equal(plan.daysLeft, null);
		assert.equal(ntnu.pageCalls, 0);
		const noName = await coursesRoute.POST(req("POST", { code: "ANNET1", custom: true }));
		assert.equal(noName.status, 400);
	});

	it("a malformed code or body is 400 invalid_code", async () => {
		for (const body of [{ code: "x" }, { code: "../../etc" }, {}, null]) {
			const res = await coursesRoute.POST(req("POST", body));
			assert.equal(res.status, 400);
			assert.equal((await read(res)).code, "invalid_code");
		}
	});
});

describe("GET /api/courses, /search and /[code]", () => {
	it("lists summaries", async () => {
		await addTtk();
		await coursesRoute.POST(req("POST", { code: "AAA1000", name: "Annet", custom: true }));
		const { courses } = (await (await coursesRoute.GET()).json()) as { courses: CourseSummary[] };
		assert.deepEqual(courses.map((c) => c.code), ["AAA1000", "TTK4100"]);
		const ttk = courses[1]!;
		assert.equal(ttk.examDate, "2026-12-10");
		assert.equal(ttk.daysLeft, 27);
		assert.deepEqual(ttk.counts, { unknown: 0, red: 0, yellow: 0, green: 0 });
		assert.equal(ttk.topicCount, 0);
		assert.equal(ttk.sourceCount, 2);
		assert.equal(courses[0]!.daysLeft, null);
	});

	it("search returns hits; an empty query is no hits and no request", async () => {
		const res = await searchRoute.GET(req("GET", undefined, "http://test/api/courses/search?q=ttk"));
		assert.deepEqual(await res.json(), { hits: [{ code: "TTK4100", name: "Kybernetikk, introduksjon", examDates: ["2026-12-10"], location: "Trondheim" }] });
		ntnu.down = true;
		assert.deepEqual(await (await searchRoute.GET(req("GET", undefined, "http://test/api/courses/search"))).json(), { hits: [] });
	});

	it("search with the list down: a full course code is still answered from the course page; otherwise 502", async () => {
		ntnu.listDown = true;
		const byCode = await searchRoute.GET(req("GET", undefined, "http://test/api/courses/search?q=ttk4100"));
		assert.equal(byCode.status, 200);
		assert.deepEqual(await byCode.json(), { hits: [{ code: "TTK4100", name: "Kybernetikk, introduksjon", examDates: ["2026-12-10"] }] });
		const byName = await searchRoute.GET(req("GET", undefined, "http://test/api/courses/search?q=kybernetikk"));
		assert.equal(byName.status, 502);
		const body = (await byName.json()) as { hits: unknown[]; code: string; error: string };
		assert.equal(body.code, "ntnu_unreachable");
		assert.deepEqual(body.hits, []);
	});

	it("reads one course; unknown is 404, in any letter case", async () => {
		await addTtk();
		const res = await courseRoute.GET(req("GET"), at("ttk4100"));
		assert.equal(res.status, 200);
		const body = await read(res);
		assert.equal(body.course.code, "TTK4100");
		assert.equal(body.plan.daysLeft, 27);
		const missing = await courseRoute.GET(req("GET"), at("NOPE1000"));
		assert.equal(missing.status, 404);
		assert.equal((await read(missing)).code, "not_found");
	});
});

describe("PATCH, refresh and DELETE", () => {
	it("PATCH edits name, exam facts and minutes per day", async () => {
		await addTtk();
		const res = await courseRoute.PATCH(req("PATCH", { name: "Kyb intro", minutesPerDay: 90, exam: { date: "2026-12-12", duration: "3 timer" } }), at("TTK4100"));
		assert.equal(res.status, 200);
		const { course, plan } = await read(res);
		assert.equal(course.name, "Kyb intro");
		assert.equal(course.minutesPerDay, 90);
		assert.equal(course.exam.date, "2026-12-12");
		assert.equal(course.exam.duration, "3 timer");
		assert.equal(course.exam.form, "Skriftlig skoleeksamen", "untouched fields stay");
		assert.equal(plan.daysLeft, 29);
	});

	it("PATCH refuses bad values with 400", async () => {
		await addTtk();
		for (const body of [{ exam: { date: "12.12.2026" } }, { minutesPerDay: 5 }, { minutesPerDay: 601 }, { minutesPerDay: "mye" }, { name: " " }]) {
			assert.equal((await courseRoute.PATCH(req("PATCH", body), at("TTK4100"))).status, 400, JSON.stringify(body));
		}
		assert.equal((await courseRoute.PATCH(req("PATCH", { name: "X" }), at("NOPE1000"))).status, 404);
	});

	it("refresh re-fetches NTNU but keeps the learner's own exam date, sources, topics and plan marks", async () => {
		await addTtk();
		await courseRoute.PATCH(req("PATCH", { name: "Feil navn", exam: { date: "2026-12-12" } }), at("TTK4100"));
		await sourcesRoute.POST(req("POST", { kind: "note", text: "Mitt notat" }), at("TTK4100"));
		await topicsRoute.PUT(req("PUT", { topics: [{ title: "PID", status: "red" }] }), at("TTK4100"));
		ntnu.listDate = "2026-12-20";
		const res = await refreshRoute.POST(req("POST"), at("TTK4100"));
		assert.equal(res.status, 200);
		const { course } = await read(res);
		assert.equal(course.name, "Kybernetikk, introduksjon", "NTNU's facts are restored");
		assert.equal(course.exam.date, "2026-12-12", "the learner's date is not overwritten");
		assert.deepEqual(course.sources.map((s) => s.kind), ["ntnu", "link", "note"]);
		assert.equal(course.sources.filter((s) => s.kind === "ntnu").length, 1, "no duplicate of the app's own source");
		assert.equal(course.topics[0]!.status, "red");
	});

	it("refresh follows NTNU's date when the learner never set one, and again after clearing the override", async () => {
		await addTtk();
		ntnu.listDate = "2026-12-20";
		assert.equal((await read(await refreshRoute.POST(req("POST"), at("TTK4100")))).course.exam.date, "2026-12-20");
		await courseRoute.PATCH(req("PATCH", { exam: { date: "2026-12-01" } }), at("TTK4100"));
		const cleared = await read(await courseRoute.PATCH(req("PATCH", { exam: { date: null } }), at("TTK4100")));
		assert.equal(cleared.course.exam.date, undefined);
		assert.equal((await read(await refreshRoute.POST(req("POST"), at("TTK4100")))).course.exam.date, "2026-12-20");
	});

	it("refresh during an outage is 502 and leaves the course untouched", async () => {
		await addTtk();
		ntnu.down = true;
		const res = await refreshRoute.POST(req("POST"), at("TTK4100"));
		assert.equal(res.status, 502);
		assert.equal((await read(res)).code, "ntnu_unreachable");
		assert.equal((await read(await courseRoute.GET(req("GET"), at("TTK4100")))).course.name, "Kybernetikk, introduksjon");
	});

	it("DELETE removes the course and keeps its sessions", async () => {
		await addTtk();
		const chat = await (await chatsRoute.POST(req("POST", { title: "Lær PID", course: { code: "TTK4100" } }))).json() as { id: string };
		const res = await courseRoute.DELETE(req("DELETE"), at("TTK4100"));
		assert.deepEqual(await res.json(), { ok: true });
		assert.equal((await courseRoute.GET(req("GET"), at("TTK4100"))).status, 404);
		assert.equal((await courseRoute.DELETE(req("DELETE"), at("TTK4100"))).status, 404);
		assert.deepEqual(chatStore.getChat(chat.id)!.course, { code: "TTK4100" }, "the session and its link stay");
	});
});

describe("sources", () => {
	const dir = path.join(TMP, "material");
	fs.mkdirSync(path.join(dir, "eksamener", "losninger"), { recursive: true });
	fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
	fs.mkdirSync(path.join(dir, "node_modules", "x"), { recursive: true });
	fs.writeFileSync(path.join(dir, "notater.md"), "# Notater\nPID-regulator");
	fs.writeFileSync(path.join(dir, "eksamener", "eksamen-2023.pdf"), "%PDF-");
	fs.writeFileSync(path.join(dir, "eksamener", "losninger", "lf-2023.txt"), "svar");
	fs.writeFileSync(path.join(dir, "eksamener", "bilde.png"), "x");
	fs.writeFileSync(path.join(dir, "rapport.docx"), "x");
	fs.writeFileSync(path.join(dir, ".git", "config.txt"), "x");
	fs.writeFileSync(path.join(dir, "node_modules", "x", "readme.md"), "x");

	it("adds a folder (supported files counted recursively), a file, a link and a note", async () => {
		await addTtk();
		const folder = await read(await sourcesRoute.POST(req("POST", { kind: "folder", path: dir }), at("TTK4100")));
		const added = folder.course.sources.at(-1)!;
		assert.equal(added.kind, "folder");
		assert.equal(added.path, dir);
		assert.equal(added.title, "material");
		assert.equal(added.fileCount, 4, "md + pdf + txt + png; not docx, hidden folders or node_modules");
		assert.equal(added.auto, false);
		assert.ok(added.id && added.addedAt);

		const file = await read(await sourcesRoute.POST(req("POST", { kind: "file", path: path.join(dir, "notater.md"), title: "Mine notater" }), at("TTK4100")));
		assert.deepEqual([file.course.sources.at(-1)!.kind, file.course.sources.at(-1)!.title], ["file", "Mine notater"]);
		const link = await read(await sourcesRoute.POST(req("POST", { kind: "link", url: "https://www.example.org/ovinger" }), at("TTK4100")));
		assert.deepEqual([link.course.sources.at(-1)!.title, link.course.sources.at(-1)!.url], ["example.org", "https://www.example.org/ovinger"]);
		const note = await read(await sourcesRoute.POST(req("POST", { kind: "note", text: "Foreleser sa: PID kommer.\nMer tekst." }), at("TTK4100")));
		assert.deepEqual([note.course.sources.at(-1)!.title, note.course.sources.at(-1)!.text], ["Foreleser sa: PID kommer.", "Foreleser sa: PID kommer.\nMer tekst."]);
		assert.equal(note.course.sources.length, 6);
		assert.ok(note.plan, "every response carries the plan");
	});

	it("expands ~ and treats the same path twice as one source", async () => {
		await addTtk();
		const home = await read(await sourcesRoute.POST(req("POST", { kind: "folder", path: "~" }), at("TTK4100")));
		assert.equal(home.course.sources.at(-1)!.path, os.homedir());
		const again = await read(await sourcesRoute.POST(req("POST", { kind: "folder", path: "~/" }), at("TTK4100")));
		assert.equal(again.course.sources.length, home.course.sources.length);
	});

	it("refuses invalid or unavailable input with 400 and a Norwegian message", async () => {
		await addTtk();
		const cases: Array<[unknown, string]> = [
			[{ kind: "file", path: "relativ/sti.md" }, "path_not_absolute"],
			[{ kind: "file", path: path.join(dir, "finnes-ikke.md") }, "path_unavailable"],
			[{ kind: "file", path: dir }, "not_a_file"],
			[{ kind: "folder", path: path.join(dir, "notater.md") }, "not_a_folder"],
			[{ kind: "file", path: path.join(dir, "rapport.docx") }, "unsupported_file"],
			[{ kind: "folder" }, "path_required"],
			[{ kind: "link", url: "ftp://example.org/x" }, "invalid_url"],
			[{ kind: "link", url: "ikke en lenke" }, "invalid_url"],
			[{ kind: "note", text: "   " }, "note_empty"],
			[{ kind: "note", text: "x".repeat(20_001) }, "note_too_long"],
			[{ kind: "ntnu", url: "https://www.ntnu.no" }, "invalid_kind"],
			[null, "invalid_kind"],
		];
		for (const [body, code] of cases) {
			const res = await sourcesRoute.POST(req("POST", body), at("TTK4100"));
			assert.equal(res.status, 400, code);
			const json = await read(res);
			assert.equal(json.code, code);
			assert.ok(json.error && !/[—]/.test(json.error), "a readable message without em dashes");
		}
		assert.equal((await sourcesRoute.POST(req("POST", { kind: "note", text: "x" }), at("NOPE1000"))).status, 404);
	});

	it("DELETE removes one source; an unknown id is 404", async () => {
		const { course } = await addTtk();
		const res = await sourceRoute.DELETE(req("DELETE"), atId("TTK4100", course.sources[1]!.id));
		assert.equal(res.status, 200);
		assert.deepEqual((await read(res)).course.sources.map((s) => s.kind), ["ntnu"]);
		assert.equal((await sourceRoute.DELETE(req("DELETE"), atId("TTK4100", "src_nope"))).status, 404);
	});
});

describe("topics", () => {
	it("generate without a model: the deterministic reserve from the learning outcomes", async () => {
		await addTtk();
		const res = await generateRoute.POST(req("POST"), at("TTK4100"));
		assert.equal(res.status, 200);
		const body = await read(res);
		assert.equal(body.generatedBy, "fallback");
		assert.equal(body.course.topicsGeneratedBy, "fallback");
		assert.ok(body.course.topics.length >= 8, `got ${body.course.topics.length}`);
		assert.ok(body.course.topics.every((t) => t.status === "unknown" && [1, 2, 3].includes(t.weight) && t.id && t.title));
		assert.ok(body.course.topics.some((t) => /PID/.test(t.title)));
		assert.ok(!body.course.topics.some((t) => /Kommunisere|Generell kompetanse|^Kunnskap:/.test(t.title)));
		assert.ok(body.plan.days.length > 0, "topics give a plan");
	});

	it("generate with a model: the submitted list is used, and a regeneration keeps status by id", async () => {
		await addTtk();
		const submitted = (extra: object[] = []) => ({
			topics: [
				...["Reguleringssløyfa", "Blokkdiagram", "Differensialligninger", "Første ordens systemer", "Andre ordens systemer", "PID-regulator", "Foroverkobling", "Simulink"].map(
					(title, i) => ({ id: `t${i}`, title, description: `Kunne forklare ${title}.`, weight: (i % 3) + 1 }),
				),
				...extra,
			],
		});
		let prompt = "";
		const engineFor = (input: unknown) =>
			fauxEngine([
				(context) => {
					prompt = JSON.stringify(context.messages);
					return fauxAssistantMessage([fauxToolCall("submit_topics", input as ToolCall["arguments"], { id: "submit-1" })], { stopReason: "toolUse" });
				},
			]);
		courseSeams.topicEngine = () => engineFor(submitted());
		const first = await read(await generateRoute.POST(req("POST"), at("TTK4100")));
		assert.equal(first.generatedBy, "ai");
		assert.equal(first.course.topicsGeneratedBy, "ai");
		assert.deepEqual(first.course.topics.map((t) => t.id), ["t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7"]);
		assert.deepEqual(first.course.topics[5], { id: "t5", title: "PID-regulator", description: "Kunne forklare PID-regulator.", weight: 3, status: "unknown" });
		assert.ok(prompt.includes("TTK4100") && prompt.includes("Læringsutbytte".slice(0, 0)) && prompt.includes("Kunnskap om den generelle oppbygningen"), "the model sees the course description");

		await topicRoute.PATCH(req("PATCH", { status: "green" }), atId("TTK4100", "t5"));
		courseSeams.topicEngine = () => engineFor(submitted([{ id: "ny", title: "Ulineariteter", description: "Metning.", weight: 1 }]));
		const second = await read(await generateRoute.POST(req("POST"), at("TTK4100")));
		assert.equal(second.course.topics.length, 9);
		assert.equal(second.course.topics.find((t) => t.id === "t5")!.status, "green", "status survives regeneration");
		assert.ok(prompt.includes("[t5] PID-regulator"), "the model is told the existing ids");
	});

	it("generate falls back to the reserve when the model fails", async () => {
		await addTtk();
		courseSeams.topicEngine = () => fauxEngine([fauxAssistantMessage("Jeg bruker ikke verktøy."), fauxAssistantMessage("…"), fauxAssistantMessage("…"), fauxAssistantMessage("…")]);
		const body = await read(await generateRoute.POST(req("POST"), at("TTK4100")));
		assert.equal(body.generatedBy, "fallback");
		assert.ok(body.course.topics.length >= 8);
	});

	it("generate on a course with nothing to build from keeps the existing list", async () => {
		await coursesRoute.POST(req("POST", { code: "EGET1", name: "Eget fag", custom: true }));
		await topicsRoute.PUT(req("PUT", { topics: [{ title: "Mitt tema" }] }), at("EGET1"));
		const body = await read(await generateRoute.POST(req("POST"), at("EGET1")));
		assert.equal(body.generatedBy, "fallback");
		assert.deepEqual(body.course.topics.map((t) => t.title), ["Mitt tema"]);
		assert.equal(body.course.topicsGeneratedBy, "manual");
		assert.equal((await generateRoute.POST(req("POST"), at("NOPE1000"))).status, 404);
	});

	it("PUT replaces the list (manual): ids from titles, status kept by id", async () => {
		await addTtk();
		const first = await read(await topicsRoute.PUT(req("PUT", { topics: [{ title: "PID-regulator", weight: 3, status: "red" }, { title: "Blokkdiagram", description: "Tegne og lese." }] }), at("TTK4100")));
		assert.equal(first.course.topicsGeneratedBy, "manual");
		assert.deepEqual(first.course.topics.map((t) => [t.id, t.weight, t.status, t.statusSource ?? null]), [["pid-regulator", 3, "red", "self"], ["blokkdiagram", 2, "unknown", null]]);
		const second = await read(await topicsRoute.PUT(req("PUT", { topics: [{ id: "pid-regulator", title: "PID" }, { title: "Stabilitet" }] }), at("TTK4100")));
		assert.deepEqual(second.course.topics.map((t) => [t.id, t.title, t.status]), [["pid-regulator", "PID", "red"], ["stabilitet", "Stabilitet", "unknown"]]);
		assert.equal((await topicsRoute.PUT(req("PUT", { topics: "nei" }), at("TTK4100"))).status, 400);
		assert.equal((await topicsRoute.PUT(req("PUT", { topics: [{ title: "" }] }), at("TTK4100"))).status, 400);
	});

	it("PATCH one topic: a status set here is the learner's own", async () => {
		await addTtk();
		await topicsRoute.PUT(req("PUT", { topics: [{ title: "PID-regulator" }] }), at("TTK4100"));
		const res = await topicRoute.PATCH(req("PATCH", { status: "yellow", title: "PID", weight: 3, description: "Stille inn." }), atId("TTK4100", "pid-regulator"));
		assert.equal(res.status, 200);
		const topic = (await read(res)).course.topics[0]!;
		assert.deepEqual([topic.id, topic.title, topic.weight, topic.description, topic.status, topic.statusSource], ["pid-regulator", "PID", 3, "Stille inn.", "yellow", "self"]);
		assert.ok(topic.updatedAt);
		assert.equal((await topicRoute.PATCH(req("PATCH", { status: "blue" }), atId("TTK4100", "pid-regulator"))).status, 400);
		assert.equal((await topicRoute.PATCH(req("PATCH", { weight: 4 }), atId("TTK4100", "pid-regulator"))).status, 400);
		assert.equal((await topicRoute.PATCH(req("PATCH", { status: "red" }), atId("TTK4100", "nope"))).status, 404);
	});
});

describe("POST /api/courses/[code]/plan/done", () => {
	it("checks an item on and off; the plan reflects it", async () => {
		await addTtk();
		const { plan } = await read(await topicsRoute.PUT(req("PUT", { topics: [{ title: "PID-regulator", status: "red" }] }), at("TTK4100")));
		const key = plan.days[0]!.items[0]!.key;
		assert.equal(key, `${TODAY}|pid-regulator|learn`);
		const on = await read(await planDoneRoute.POST(req("POST", { key, done: true }), at("TTK4100")));
		assert.deepEqual(on.course.planDone, [key]);
		assert.equal(on.plan.days[0]!.items[0]!.done, true);
		await planDoneRoute.POST(req("POST", { key, done: true }), at("TTK4100"));
		const off = await read(await planDoneRoute.POST(req("POST", { key, done: false }), at("TTK4100")));
		assert.deepEqual(off.course.planDone, []);
		assert.equal(off.plan.days[0]!.items[0]!.done, false);
		for (const body of [{ key: "tull", done: true }, { key, done: "ja" }, {}]) {
			assert.equal((await planDoneRoute.POST(req("POST", body), at("TTK4100"))).status, 400);
		}
	});
});

describe("sessions started from a course (/api/chats)", () => {
	it("POST with course stores the link and writes the course-context marker as message[0]", async () => {
		await addTtk();
		await topicsRoute.PUT(req("PUT", { topics: [{ title: "PID-regulator" }] }), at("TTK4100"));
		const res = await chatsRoute.POST(req("POST", { title: "Lær PID", course: { code: "ttk4100", topicId: "pid-regulator", mode: "learn" } }));
		const { id, title } = (await res.json()) as { id: string; title: string };
		assert.equal(title, "Lær PID");
		const record = chatStore.getChat(id)!;
		assert.deepEqual(record.course, { code: "TTK4100", topicId: "pid-regulator", mode: "learn" });
		assert.equal(record.kind, undefined);
		assert.equal(record.messages.length, 1);
		const marker = record.messages[0] as LhMarkerMessage;
		assert.equal(marker.customType, "course-context");
		assert.ok(marker.content.includes("Course: TTK4100") && marker.content.includes("Mode: LEARN."));
		assert.deepEqual(marker.details, { code: "TTK4100", name: "Kybernetikk, introduksjon", topicId: "pid-regulator", topicTitle: "PID-regulator", mode: "learn", sourceCount: 2 });
	});

	it("works for practice sessions and combines with map picks: course context first", async () => {
		await addTtk();
		const res = await chatsRoute.POST(req("POST", {
			title: "Øv",
			kind: "practice",
			course: { code: "TTK4100", mode: "practice" },
			graphContext: { propositions: [{ id: "n_a", name: "A", statement: "S" }] },
		}));
		const record = chatStore.getChat(((await res.json()) as { id: string }).id)!;
		assert.equal(record.kind, "practice");
		assert.deepEqual(record.course, { code: "TTK4100", mode: "practice" });
		assert.deepEqual(record.messages.map((m) => (m as LhMarkerMessage).customType), ["course-context", "graph-context"]);
	});

	it("an unknown course, topic or mode is dropped instead of failing the session", async () => {
		await addTtk();
		const ghost = chatStore.getChat(((await (await chatsRoute.POST(req("POST", { title: "X", course: { code: "NOPE1000" } }))).json()) as { id: string }).id)!;
		assert.equal(ghost.course, undefined);
		assert.deepEqual(ghost.messages, []);
		const loose = chatStore.getChat(((await (await chatsRoute.POST(req("POST", { title: "Y", course: { code: "TTK4100", topicId: "nope", mode: "cram" } }))).json()) as { id: string }).id)!;
		assert.deepEqual(loose.course, { code: "TTK4100" });
		const plain = chatStore.getChat(((await (await chatsRoute.POST(req("POST", { title: "Z" }))).json()) as { id: string }).id)!;
		assert.equal("course" in plain, false, "ordinary sessions carry no course field");
	});

	it("GET lists the link per session", async () => {
		await addTtk();
		const { id } = (await (await chatsRoute.POST(req("POST", { title: "Kartlegging", course: { code: "TTK4100", mode: "mapping" } }))).json()) as { id: string };
		const { chats } = (await (await chatsRoute.GET()).json()) as { chats: Array<{ id: string; course?: unknown }> };
		assert.deepEqual(chats.find((c) => c.id === id)!.course, { code: "TTK4100", mode: "mapping" });
		assert.ok(chats.some((c) => c.course === undefined), "sessions without a course have no field");
	});
});

describe("the course store", () => {
	it("stamps the version, refuses a newer record, and skips corrupt files", async () => {
		await addTtk();
		const file = path.join(TMP, "data", "courses", "TTK4100.json");
		const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
		assert.equal(onDisk.version, 1);
		fs.writeFileSync(file, JSON.stringify({ ...onDisk, version: 99 }));
		assert.equal((await courseRoute.GET(req("GET"), at("TTK4100"))).status, 404, "a newer record is never misparsed");
		fs.writeFileSync(path.join(TMP, "data", "courses", "BAD1000.json"), "{ not json");
		assert.deepEqual(((await (await coursesRoute.GET()).json()) as { courses: unknown[] }).courses, []);
		assert.deepEqual(fs.readdirSync(path.join(TMP, "data", "courses")).filter((f) => f.endsWith(".tmp")), [], "no temp files left behind");
	});
});
