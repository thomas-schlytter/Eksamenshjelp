/**
 * THE DOORS TO AN EKSAMENSØKT (2026-11-14): the fag page's «Start
 * eksamensøkt» card (and «Fortsett eksamensøkta» when the fag already has
 * one), the wizard's alternative, `/chat/new?mode=exam` (+ `&fag=KODE`),
 * the create route taking `kind: "exam"` together with `course`, the
 * course-context marker that names the fag's sources as the pensum basis,
 * and the sidebar's marker and filter. Runs under an isolated LH_DATA_DIR.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import type { Course } from "../src/core/courses.ts";
import type { ChatListItem } from "../src/core/index.ts";
import type { LhMessage } from "../src/core/native-messages.ts";

// ── the seam, BEFORE any config-loading import: never the repo's data/ ──────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-exam-entries-"));
process.env.LH_DATA_DIR = path.join(TMP, "data");
process.env.LH_AUTH_FILE = path.join(TMP, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const { courseStore } = await import("../src/store/courses.ts");
const { chatStore } = await import("../src/store/chats.ts");
const chatsRoute = await import("../app/api/chats/route.ts");
const { default: NewSessionPage } = await import("../app/chat/new/page.tsx");
const { courseContextText, buildExamPlan } = await import("../src/core/courses.ts");
const { projectView } = await import("../src/core/view.ts");
const { examSession, mappingSession } = await import("../components/courses/course-format.ts");
const { EXAM_SESSION_BLURB, ExamSessionCard, findExamSession } = await import("../components/courses/exam-session.tsx");
const { ExamPlanView } = await import("../components/courses/exam-plan.tsx");
const { CourseWizard } = await import("../components/courses/course-wizard.tsx");
const { DraftShell, startDraftSession } = await import("../components/new-session.tsx");
const { SessionRow, matchesKindFilter } = await import("../components/sidebar.tsx");
const { parseCourseContext } = await import("../components/course-context-card.tsx");
const { FEATURES } = await import("../components/help/features.ts");
const { findArticle } = await import("../components/help/content.ts");

const TODAY = "2026-11-13";

function course(overrides: Partial<Course> = {}): Course {
	return {
		code: "TTK4100",
		name: "Kybernetikk introduksjon",
		custom: false,
		exam: { date: "2026-12-10", form: "Skriftlig skoleeksamen" },
		minutesPerDay: 120,
		sources: [
			{ id: "s1", kind: "folder", title: "Tidligere eksamener", path: "/Users/student/TTK4100/eksamener", fileCount: 12, auto: false, addedAt: "2026-11-01T00:00:00.000Z" },
		],
		topics: [
			{ id: "pid-regulator", title: "PID-regulator", weight: 3, status: "red" },
			{ id: "blokkdiagram", title: "Blokkdiagram", weight: 2, status: "unknown" },
		],
		planDone: [],
		createdAt: "2026-11-01T00:00:00.000Z",
		updatedAt: "2026-11-01T00:00:00.000Z",
		...overrides,
	};
}
courseStore.saveCourse(course());

function dom(node: React.ReactNode) {
	return parseHTML(`<html><body>${renderToStaticMarkup(node)}</body></html>`).document;
}
const req = (body: unknown) => new Request("http://localhost/api/chats", { method: "POST", body: JSON.stringify(body) });

describe("the session a «Start eksamensøkt» button creates", () => {
	it("kind exam + the fag link, with an opening that asks for the map", () => {
		assert.deepEqual(examSession({ code: "TTK4100", name: "Kybernetikk introduksjon" }), {
			title: "Eksamensøkt TTK4100",
			kind: "exam",
			course: { code: "TTK4100", mode: "exam" },
			openingText: "Jeg skal ha eksamen i TTK4100 Kybernetikk introduksjon. Kartlegg pensum og lag et eksamenskart.",
		});
		// The kartlegging is a different thing and stays a plain teach session.
		assert.equal(mappingSession({ code: "TTK4100", name: "x" }).kind, undefined);
	});
});

describe("POST /api/chats: kind exam together with a fag", () => {
	it("stores both, and message[0] is the course context in exam mode", async () => {
		const res = await chatsRoute.POST(req({ title: "Eksamensøkt TTK4100", kind: "exam", course: { code: "ttk4100", mode: "exam" } }));
		const { id } = (await res.json()) as { id: string };
		const record = chatStore.getChat(id)!;
		assert.equal(record.kind, "exam");
		assert.deepEqual(record.course, { code: "TTK4100", mode: "exam" });
		const first = record.messages[0] as unknown as { role: string; customType: string; content: string; details: unknown };
		assert.equal(first.role, "custom");
		assert.equal(first.customType, "course-context");
		assert.match(first.content, /Mode: EXAM SESSION\./);
		assert.match(first.content, /sources listed below are the pensum basis/);
		assert.match(first.content, /Folder, Tidligere eksamener \(12 readable files\): \/Users\/student\/TTK4100\/eksamener/);
		assert.deepEqual(first.details, { code: "TTK4100", name: "Kybernetikk introduksjon", mode: "exam", sourceCount: 1 });
		// The transcript line reads «Eksamensøkt».
		const part = projectView(record.messages as LhMessage[]).flatMap((m) => m.parts).find((p) => p.type === "data-course-context");
		assert.equal(parseCourseContext((part as { data?: unknown }).data)?.mode, "exam");
	});

	it("the list item carries kind and course: what the fag page looks for", async () => {
		const res = await chatsRoute.GET();
		const { chats } = (await res.json()) as { chats: ChatListItem[] };
		const found = findExamSession(chats, "TTK4100");
		assert.ok(found);
		assert.equal(found.title, "Eksamensøkt TTK4100");
		assert.equal(chats.find((c) => c.id === found.id)?.kind, "exam");
	});

	it("an exam link is always the whole fag: a tema or another mode from the client is dropped", async () => {
		const res = await chatsRoute.POST(req({ title: "x", kind: "exam", course: { code: "TTK4100", topicId: "pid-regulator", mode: "learn" } }));
		const { id } = (await res.json()) as { id: string };
		assert.deepEqual(chatStore.getChat(id)!.course, { code: "TTK4100", mode: "exam" });
	});

	it("kind exam without a fag still works (the free door), and an unknown fag is dropped", async () => {
		const free = (await (await chatsRoute.POST(req({ title: "Matte 1 eksamen", kind: "exam" }))).json()) as { id: string };
		const record = chatStore.getChat(free.id)!;
		assert.equal(record.kind, "exam");
		assert.equal(record.course, undefined);
		assert.equal(record.messages.length, 0);
		const ghost = (await (await chatsRoute.POST(req({ title: "x", kind: "exam", course: { code: "XYZ9999" } }))).json()) as { id: string };
		assert.equal(chatStore.getChat(ghost.id)!.course, undefined);
	});

	it("ordinary sessions are untouched: no kind, the link as sent, any other kind ignored", async () => {
		const plain = (await (await chatsRoute.POST(req({ title: "Lær PID", course: { code: "TTK4100", topicId: "pid-regulator", mode: "learn" } }))).json()) as { id: string };
		const record = chatStore.getChat(plain.id)!;
		assert.equal("kind" in record, false);
		assert.deepEqual(record.course, { code: "TTK4100", topicId: "pid-regulator", mode: "learn" });
		const odd = (await (await chatsRoute.POST(req({ title: "x", kind: "cram" }))).json()) as { id: string };
		assert.equal("kind" in chatStore.getChat(odd.id)!, false);
	});
});

describe("the course context in exam mode (model-facing)", () => {
	it("names the sources as the pensum basis and tells the two status tools apart", () => {
		const text = courseContextText(course(), { code: "TTK4100", mode: "exam" }, TODAY);
		assert.match(text, /Mode: EXAM SESSION\./);
		assert.match(text, /Read them yourself/);
		assert.match(text, /do not ask for them again/);
		assert.match(text, /`plan_status` colors the nodes of THIS session's plan map/);
		assert.match(text, /`topic_status` colors the\s+course's topics/);
		// The mode sits before the source list it points at.
		assert.ok(text.indexOf("Mode: EXAM SESSION.") < text.indexOf("\nSources:"));
		// Other modes never get it.
		assert.doesNotMatch(courseContextText(course(), { code: "TTK4100", mode: "learn" }, TODAY), /EXAM SESSION/);
		assert.doesNotMatch(courseContextText(course(), { code: "TTK4100" }, TODAY), /EXAM SESSION/);
	});
});

describe("/chat/new?mode=exam", () => {
	const page = async (params: { mode?: string; fag?: string; tema?: string }) =>
		(await NewSessionPage({ searchParams: Promise.resolve(params) })) as React.ReactElement<{ mode: string; course?: unknown }>;

	it("the page passes the exam mode on, alone and with a fag", async () => {
		assert.equal((await page({ mode: "exam" })).props.mode, "exam");
		assert.equal((await page({ mode: "exam" })).props.course, undefined);
		const linked = await page({ mode: "exam", fag: "ttk4100", tema: "pid-regulator" });
		assert.equal(linked.props.mode, "exam");
		assert.deepEqual(linked.props.course, { code: "TTK4100", mode: "exam" }, "the whole fag: no tema on an eksamensøkt");
		// The other doors are as before.
		assert.equal((await page({})).props.mode, "teach");
		assert.equal((await page({ mode: "practice" })).props.mode, "practice");
		assert.deepEqual((await page({ fag: "TTK4100", tema: "pid-regulator" })).props.course, { code: "TTK4100", topicId: "pid-regulator", mode: "learn" });
	});

	it("the draft speaks Norwegian about the exam, with and without a fag", () => {
		const free = renderToStaticMarkup(<DraftShell busy={false} text="" onChange={() => {}} onSend={() => {}} mode="exam" />);
		assert.ok(free.includes("Ny eksamensøkt"));
		assert.ok(free.includes("Hvilken eksamen forbereder du deg til?"));
		assert.ok(free.includes("lager et eksamenskart med farger"));
		assert.doesNotMatch(free, /New exam session|Which exam/);
		const linked = renderToStaticMarkup(<DraftShell busy={false} text="" onChange={() => {}} onSend={() => {}} mode="exam" course={{ code: "TTK4100" }} />);
		assert.ok(linked.includes("Økta kobles til TTK4100. Læreren kartlegger pensum fra kildene i faget"));
		assert.match(linked, /href="\/fag\/TTK4100"/);
	});

	it("the first send creates kind exam, with the fag link when there is one", async () => {
		const bodies: Record<string, unknown>[] = [];
		const f = (async (_url: string, init?: RequestInit) => {
			bodies.push(JSON.parse(String(init?.body)));
			return new Response(JSON.stringify({ id: "c1" }), { status: 201 });
		}) as unknown as typeof fetch;
		const storage = new Map<string, string>();
		Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => { storage.set(key, value); },
			removeItem: (key: string) => { storage.delete(key); },
		} });
		try {
			assert.equal(await startDraftSession("Matte 1, eksamen 10. desember", f, "exam"), "/chat/c1");
			await startDraftSession("Kartlegg pensum", f, "exam", undefined, undefined, undefined, { code: "TTK4100", mode: "exam" });
		} finally {
			Reflect.deleteProperty(globalThis, "sessionStorage");
		}
		assert.deepEqual(bodies, [
			{ title: "Matte 1, eksamen 10. desember", kind: "exam" },
			{ title: "Kartlegg pensum", kind: "exam", course: { code: "TTK4100", mode: "exam" } },
		]);
	});
});

describe("the fag page's eksamensøkt card", () => {
	const actions = { onToggleDone: () => {}, onStart: () => {}, onMinutesPerDay: () => {}, onOpenWizard: () => {}, onEditExamDate: () => {}, starting: false };

	it("finds the fag's exam session in the list: newest first, this fag only, exam only", () => {
		const chats = [
			{ id: "a", title: "Lær PID", kind: "teach", course: { code: "TTK4100" } },
			{ id: "b", title: "Annen eksamen", kind: "exam", course: { code: "TMA4100" } },
			{ id: "c", title: "Fri eksamensøkt", kind: "exam" },
			{ id: "d", title: "Eksamensøkt TTK4100", kind: "exam", course: { code: "TTK4100", mode: "exam" } },
			{ id: "e", title: "Eldre", kind: "exam", course: { code: "TTK4100" } },
		];
		assert.deepEqual(findExamSession(chats, "TTK4100"), { id: "d", title: "Eksamensøkt TTK4100" });
		assert.equal(findExamSession(chats, "TDT4100"), null);
		for (const junk of [undefined, null, "x", {}, [null, 3, { kind: "exam" }]]) assert.equal(findExamSession(junk, "TTK4100"), null);
	});

	it("no session yet: one clear action with the explanation", () => {
		const document = dom(<ExamSessionCard course={course()} session={null} onStart={() => {}} starting={false} />);
		const card = document.querySelector('[data-testid="exam-session-card"]')!;
		assert.equal(card.getAttribute("data-state"), "start");
		assert.ok(card.textContent!.includes(EXAM_SESSION_BLURB));
		assert.equal(EXAM_SESSION_BLURB, "Én økt som kartlegger hele pensum fra tidligere eksamener, og følger deg tema for tema med et fargekart.");
		const start = card.querySelector('[data-testid="exam-session-start"]')!;
		assert.equal(start.textContent!.trim(), "Start eksamensøkt");
		assert.equal(start.hasAttribute("disabled"), false);
		assert.equal(card.querySelector('[data-testid="exam-session-continue"]'), null);
	});

	it("the fag has one: continue it (a link to the session), with a small «Start en ny»", () => {
		const document = dom(<ExamSessionCard course={course()} session={{ id: "chat_abc", title: "Eksamensøkt TTK4100" }} onStart={() => {}} starting={false} />);
		const card = document.querySelector('[data-testid="exam-session-card"]')!;
		assert.equal(card.getAttribute("data-state"), "continue");
		const go = card.querySelector('[data-testid="exam-session-continue"]')!;
		assert.equal(go.tagName, "A");
		assert.equal(go.getAttribute("href"), "/chat/chat_abc");
		assert.equal(go.textContent!.trim(), "Fortsett eksamensøkta");
		assert.equal(card.querySelector('[data-testid="exam-session-start-new"]')!.textContent!.trim(), "Start en ny");
		assert.equal(card.querySelector('[data-testid="exam-session-start"]'), null);
	});

	it("while the list loads, or a session is being created, the start button waits (never a duplicate)", () => {
		const loading = dom(<ExamSessionCard course={course()} session="loading" onStart={() => {}} starting={false} />);
		assert.ok(loading.querySelector('[data-testid="exam-session-start"]')!.hasAttribute("disabled"));
		const starting = dom(<ExamSessionCard course={course()} session={null} onStart={() => {}} starting />);
		assert.ok(starting.querySelector('[data-testid="exam-session-start"]')!.hasAttribute("disabled"));
	});

	it("sits in the Eksamensplan tab under the status line, also before there is a topic list", () => {
		const c = course();
		const withPlan = dom(<ExamPlanView course={c} plan={buildExamPlan(c, TODAY)} today={TODAY} actions={actions} />);
		const section = withPlan.querySelector('[data-testid="exam-plan"]')!;
		const order = [...section.querySelectorAll('[data-testid="topic-status-bar"], [data-testid="exam-session-card"], [data-testid="plan-today"]')].map((el) => el.getAttribute("data-testid"));
		assert.deepEqual(order, ["topic-status-bar", "exam-session-card", "plan-today"]);
		assert.equal(section.querySelector('[data-tour="exam-session"]'), section.querySelector('[data-testid="exam-session-card"]'));
		const continued = dom(<ExamPlanView course={c} plan={buildExamPlan(c, TODAY)} today={TODAY} actions={actions} examSession={{ id: "chat_abc", title: "t" }} />);
		assert.equal(continued.querySelector('[data-testid="exam-session-continue"]')!.getAttribute("href"), "/chat/chat_abc");
		const bare = course({ topics: [] });
		assert.ok(dom(<ExamPlanView course={bare} plan={buildExamPlan(bare, TODAY)} today={TODAY} actions={actions} />).querySelector('[data-testid="exam-session-start"]'));
	});

	it("the wizard's last step offers it as the alternative, not on the earlier steps", () => {
		const wizardActions = {
			onExamDate: async () => true, onAddSource: async () => null, onRemoveSource: () => {}, onGenerate: async () => "ai" as const,
			onStatus: () => {}, onStart: () => {}, onOpenSetup: () => {}, onDone: () => {}, starting: false,
		};
		for (const step of [0, 1] as const) {
			assert.equal(dom(<CourseWizard course={course({ topics: [] })} actions={wizardActions} initialStep={step} />).querySelector('[data-testid="exam-session-card"]'), null);
		}
		for (const c of [course({ topics: [] }), course()]) {
			const last = dom(<CourseWizard course={c} actions={wizardActions} initialStep={2} />);
			assert.ok(last.querySelector('[data-testid="exam-session-start"]'));
			assert.ok(last.body.textContent!.includes("Eller"));
		}
	});
});

describe("the sidebar", () => {
	const item = (overrides: Partial<ChatListItem>): ChatListItem => ({
		id: "c1", title: "Eksamensøkt TTK4100", kind: "teach", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
		messageCount: 4, phase: "probe", pendingQuestion: false, pendingProblem: false, busy: false, compacting: false, ...overrides,
	});
	const render = (chat: ChatListItem) => renderToStaticMarkup(<SessionRow chat={chat} active={false} onOpen={() => {}} />);

	it("an eksamensøkt row carries its own marker, in Norwegian; other rows do not", () => {
		const exam = render(item({ kind: "exam" }));
		assert.match(exam, /aria-label="Eksamensøkt"/);
		assert.doesNotMatch(exam, /Exam session|Øvingsøkt/);
		assert.doesNotMatch(render(item({})), /Eksamensøkt"/);
		assert.doesNotMatch(render(item({ kind: "practice" })), /aria-label="Eksamensøkt"/);
	});

	it("eksamensøkter sort under «Læring»", () => {
		assert.equal(matchesKindFilter("exam", "teach"), true);
		assert.equal(matchesKindFilter("exam", "practice"), false);
		assert.equal(matchesKindFilter("exam", "all"), true);
		assert.equal(matchesKindFilter("teach", "teach"), true);
		assert.equal(matchesKindFilter(undefined, "teach"), true);
		assert.equal(matchesKindFilter("practice", "practice"), true);
		assert.equal(matchesKindFilter("practice", "teach"), false);
	});
});

describe("the help center knows the eksamensøkt", () => {
	it("«Start eksamensøkt» is findable and opens the exam draft", () => {
		const feature = FEATURES.find((f) => f.id === "start-eksamensokt");
		assert.ok(feature);
		assert.equal(feature.title, "Start eksamensøkt");
		assert.deepEqual(feature.action, { kind: "route", href: "/chat/new?mode=exam" });
	});

	it("one answer explains eksamensplan versus eksamensøkt, with the same color words", () => {
		const article = findArticle("eksamensplan-eller-eksamensokt");
		assert.ok(article);
		assert.equal(article.category, "eksamensmodus");
		const text = article.answer.join(" ");
		assert.match(text, /dag for dag/);
		assert.match(text, /ett sammenhengende løp/);
		for (const label of ["Ikke kartlagt", "Kan ikke ennå", "Usikker", "Kan dette"]) assert.ok(text.includes(label), label);
	});
});
