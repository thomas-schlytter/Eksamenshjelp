/**
 * ÉN CHAT PER FAG (fase 2, 2026-11-23): the fag-chat (one eksamensøkt per
 * fag, found or created), the underchat model (course link mode "sub"),
 * «Flytt til fag» (link + context marker + topic_status), the sidebar's
 * grouping, and the fag page without the Lær/Øv/Prøveeksamen/Kartlegging
 * starts. Also the doors that stay: the create route with kind exam, the
 * free eksamensøkt draft. Runs under an isolated LH_DATA_DIR.
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-course-chats-"));
process.env.LH_DATA_DIR = path.join(TMP, "data");
process.env.LH_AUTH_FILE = path.join(TMP, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const { courseStore } = await import("../src/store/courses.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { subscribe } = await import("../src/core/events.ts");
const chatsRoute = await import("../app/api/chats/route.ts");
const courseChatRoute = await import("../app/api/courses/[code]/chat/route.ts");
const moveRoute = await import("../app/api/chats/[id]/course/route.ts");
const { default: NewSessionPage } = await import("../app/chat/new/page.tsx");
const { courseContextText, buildExamPlan, groupChatsByCourse, isCourseMainChat } = await import("../src/core/courses.ts");
const { projectView } = await import("../src/core/view.ts");
const { courseMarkerInsertIndex, openCourseChat, moveChatToCourse } = await import("../src/server/course-chats.ts");
const { courseToolContextFor } = await import("../src/server/courses.ts");
const { planTools } = await import("../src/agent/tools/plan.ts");
const { ExamPlanView } = await import("../components/courses/exam-plan.tsx");
const { CourseWizard } = await import("../components/courses/course-wizard.tsx");
const { CourseChatList } = await import("../components/courses/course-chat-list.tsx");
const { courseChatMenuItems } = await import("../components/courses/course-chat-menu.tsx");
const { DraftShell, startDraftSession } = await import("../components/new-session.tsx");
const { SessionRow, SidebarCourses, activeCourseCode, courseExpanded } = await import("../components/sidebar.tsx");
const { parseCourseContext, courseContextSegments } = await import("../components/course-context-card.tsx");
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
courseStore.saveCourse(course({ code: "TMA4100", name: "Matematikk 1" }));

function dom(node: React.ReactNode) {
	return parseHTML(`<html><body>${renderToStaticMarkup(node)}</body></html>`).document;
}
const req = (body: unknown) => new Request("http://localhost/api/chats", { method: "POST", body: JSON.stringify(body) });
const params = <T,>(value: T) => ({ params: Promise.resolve(value) });

function item(overrides: Partial<ChatListItem>): ChatListItem {
	return {
		id: "c1", title: "Økt", kind: "teach", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
		messageCount: 4, phase: "probe", pendingQuestion: false, pendingProblem: false, busy: false, compacting: false, ...overrides,
	};
}

const USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function userMessage(id: string, text: string): LhMessage {
	return { id, role: "user", content: [{ type: "text", text }], timestamp: 1 } as LhMessage;
}
function quizCall(id: string, callId: string): LhMessage {
	return {
		id, role: "assistant",
		content: [{ type: "toolCall", id: callId, name: "quiz", arguments: { question: "Q", options: [{ label: "Ja", value: "ja" }, { label: "Nei", value: "nei" }], correctAnswer: "ja", explanation: "Ja." } }],
		stopReason: "toolUse", timestamp: 1, api: "openai-completions", provider: "fixture", model: "fixture", usage: USAGE,
	} as LhMessage;
}

// ─── the rules (core) ────────────────────────────────────────────────────────

describe("the fag-chat and the underchat model (core)", () => {
	it("the main chat is an eksamensøkt linked to the fag; every other link is an underchat", () => {
		assert.equal(isCourseMainChat({ kind: "exam", course: { code: "TTK4100", mode: "exam" } }), true);
		assert.equal(isCourseMainChat({ kind: "exam", course: { code: "TTK4100", mode: "sub" } }), false);
		assert.equal(isCourseMainChat({ kind: "exam" }), false, "a free eksamensøkt has no fag");
		for (const mode of ["sub", "learn", "practice", "mapping", undefined] as const) {
			assert.equal(isCourseMainChat({ kind: "teach", course: { code: "TTK4100", ...(mode ? { mode } : {}) } }), false);
		}
	});

	it("grouping: newest fag-chat is the main one, the rest of the fag are underchats, the rest is loose", () => {
		const chats = [
			item({ id: "sub-new", course: { code: "TTK4100", mode: "sub" } }),
			item({ id: "main", kind: "exam", course: { code: "TTK4100", mode: "exam" } }),
			item({ id: "old-laer", course: { code: "TTK4100", topicId: "pid-regulator", mode: "learn" } }),
			item({ id: "old-ov", kind: "practice", course: { code: "TTK4100", mode: "practice" } }),
			item({ id: "older-exam", kind: "exam", course: { code: "TTK4100", mode: "exam" } }),
			item({ id: "free" }),
			item({ id: "deleted-fag", course: { code: "GONE1" } }),
		];
		const { byCourse, loose } = groupChatsByCourse(chats, ["TTK4100", "TMA4100"]);
		assert.equal(byCourse.get("TTK4100")!.main?.id, "main");
		assert.deepEqual(byCourse.get("TTK4100")!.subs.map((c) => c.id), ["sub-new", "old-laer", "old-ov", "older-exam"]);
		assert.deepEqual(byCourse.get("TMA4100"), { main: null, subs: [] });
		assert.deepEqual(loose.map((c) => c.id), ["free", "deleted-fag"]);
	});

	it("an underchat's context says it is a side chat: topic_status yes, the exam plan map no", () => {
		const text = courseContextText(course(), { code: "TTK4100", mode: "sub" }, TODAY);
		assert.match(text, /Mode: SIDE CHAT\./);
		assert.match(text, /explain or pose exam-style tasks/);
		assert.match(text, /The exam plan map and its colors belong to the main chat/);
		assert.match(text, /`topic_status`/);
		assert.doesNotMatch(text, /EXAM SESSION|plan_status/);
		// A moved practice session grades through `problem`: no explain rule.
		assert.match(text, /Green is an approval/);
		assert.doesNotMatch(courseContextText(course(), { code: "TTK4100", mode: "sub" }, TODAY, { kind: "practice" }), /Green is an approval/);
	});

	it("the fag-chat's context keeps the exam session text and both status tools", () => {
		const text = courseContextText(course(), { code: "TTK4100", mode: "exam" }, TODAY);
		assert.match(text, /Mode: EXAM SESSION\./);
		assert.match(text, /`plan_status` colors the nodes of THIS session's plan map/);
		assert.match(text, /`topic_status` colors the\s+course's topics/);
		assert.ok(text.indexOf("Mode: EXAM SESSION.") < text.indexOf("\nSources:"));
	});

	it("plan_status belongs to the fag-chat: an underchat (kind teach) never gets it", () => {
		const store = (kind?: string) => ({ getChat: () => ({ kind, messages: [] }) }) as never;
		assert.ok(planTools({ chatId: "x", chatStore: store("exam") }).plan_status);
		assert.equal(planTools({ chatId: "x", chatStore: store(undefined) }).plan_status, undefined);
	});
});

// ─── the fag-chat (server) ───────────────────────────────────────────────────

describe("POST /api/courses/[code]/chat: the fag-chat, found or created", () => {
	it("creates it the first time: kind exam, mode exam, the fag's context as message[0], no conversation", async () => {
		const res = await courseChatRoute.POST(new Request("http://localhost", { method: "POST" }), params({ code: "ttk4100" }));
		assert.equal(res.status, 200);
		const body = (await res.json()) as { id: string; created: boolean; empty: boolean };
		assert.equal(body.created, true);
		assert.equal(body.empty, true);
		const record = chatStore.getChat(body.id)!;
		assert.equal(record.kind, "exam");
		assert.deepEqual(record.course, { code: "TTK4100", mode: "exam" });
		assert.equal(record.title, "Fag-chat TTK4100");
		assert.equal(record.messages.length, 1);
		const marker = record.messages[0] as unknown as { customType: string; content: string };
		assert.equal(marker.customType, "course-context");
		assert.match(marker.content, /Mode: EXAM SESSION\./);
	});

	it("the second open returns the same chat: one fag-chat per fag", async () => {
		const first = openCourseChat("TTK4100");
		const second = openCourseChat("TTK4100");
		assert.ok(first.ok && second.ok);
		assert.equal(first.id, second.id);
		assert.equal(second.created, false);
		const mains = chatStore.listChats().filter((c) => c.course?.code === "TTK4100" && isCourseMainChat(c));
		assert.equal(mains.length, 1);
		// Once there is conversation, it is no longer empty.
		chatStore.saveMessages(first.id, [...chatStore.getChat(first.id)!.messages, userMessage("u1", "Hei")]);
		const third = openCourseChat("TTK4100");
		assert.ok(third.ok);
		assert.equal(third.empty, false);
	});

	it("an unknown fag is a 404, and nothing is created", async () => {
		const before = chatStore.listChats().length;
		const res = await courseChatRoute.POST(new Request("http://localhost", { method: "POST" }), params({ code: "XYZ9999" }));
		assert.equal(res.status, 404);
		assert.equal(chatStore.listChats().length, before);
	});
});

describe("POST /api/chats: underchats, and the old doors", () => {
	it("an underchat (mode sub) is a teach session with the side-chat context", async () => {
		const res = await chatsRoute.POST(req({ title: "Laplace", course: { code: "TTK4100", mode: "sub" } }));
		const { id } = (await res.json()) as { id: string };
		const record = chatStore.getChat(id)!;
		assert.equal("kind" in record, false);
		assert.deepEqual(record.course, { code: "TTK4100", mode: "sub" });
		const first = record.messages[0] as unknown as { customType: string; content: string; details: unknown };
		assert.equal(first.customType, "course-context");
		assert.match(first.content, /Mode: SIDE CHAT\./);
		assert.deepEqual(first.details, { code: "TTK4100", name: "Kybernetikk introduksjon", mode: "sub", sourceCount: 1 });
		// The transcript line reads «Underchat».
		const part = projectView(record.messages as LhMessage[]).flatMap((m) => m.parts).find((p) => p.type === "data-course-context");
		const parsed = parseCourseContext((part as { data?: unknown }).data)!;
		assert.equal(courseContextSegments(parsed)[0], "Underchat");
	});

	it("old Lær/Øv/Kartlegging links read as underchats on the course line; the fag-chat reads «Fag-chat»", () => {
		for (const mode of ["learn", "practice", "mapping", "sub"] as const) {
			assert.equal(courseContextSegments(parseCourseContext({ code: "TTK4100", name: "x", mode, sourceCount: 0 })!)[0], "Underchat");
		}
		assert.equal(courseContextSegments(parseCourseContext({ code: "TTK4100", name: "x", mode: "exam", sourceCount: 0 })!)[0], "Fag-chat");
	});

	it("kind exam without a fag still works (the free door), and an unknown fag is dropped", async () => {
		const free = (await (await chatsRoute.POST(req({ title: "Matte 1 eksamen", kind: "exam" }))).json()) as { id: string };
		const record = chatStore.getChat(free.id)!;
		assert.equal(record.kind, "exam");
		assert.equal(record.course, undefined);
		assert.equal(record.messages.length, 0);
		const ghost = (await (await chatsRoute.POST(req({ title: "x", kind: "sub", course: { code: "XYZ9999" } }))).json()) as { id: string };
		assert.equal(chatStore.getChat(ghost.id)!.course, undefined);
	});
});

// ─── «Flytt til fag» ─────────────────────────────────────────────────────────

describe("PUT /api/chats/[id]/course: «Flytt til fag…»", () => {
	const put = (id: string, body: unknown) =>
		moveRoute.PUT(new Request("http://localhost", { method: "PUT", body: JSON.stringify(body) }), params({ id }));

	it("a loose session becomes an underchat: the link, the marker at the end, the events, topic_status", async () => {
		const loose = chatStore.createChat("Bodeplott");
		chatStore.saveMessages(loose.id, [userMessage("u1", "Hva er et bodeplott?")]);
		const before = chatStore.getChat(loose.id)!.updatedAt;
		const seen: string[] = [];
		const off = subscribe((event) => {
			if (event.type === "courses-changed" || event.type === "chats-changed" || event.type === "record-changed") seen.push(event.type);
		});
		try {
			const res = await put(loose.id, { code: "ttk4100" });
			assert.equal(res.status, 200);
			assert.deepEqual(await res.json(), { course: { code: "TTK4100", mode: "sub" } });
		} finally {
			off();
		}
		const record = chatStore.getChat(loose.id)!;
		assert.deepEqual(record.course, { code: "TTK4100", mode: "sub" });
		assert.equal(record.messages.length, 2);
		assert.equal(record.messages[0]!.id, "u1", "the conversation is untouched");
		const marker = record.messages[1] as unknown as { customType: string; content: string };
		assert.equal(marker.customType, "course-context");
		assert.match(marker.content, /Mode: SIDE CHAT\./);
		assert.equal(record.updatedAt, before, "moving is not conversation activity");
		assert.deepEqual([...new Set(seen)].sort(), ["chats-changed", "courses-changed", "record-changed"]);
		// The next turn gets topic_status: the handler builds it from record.course.
		const port = courseToolContextFor(record.course, loose.id);
		assert.ok(port);
		assert.equal(port.code, "TTK4100");
		assert.deepEqual(port.topics()?.map((t) => t.id), ["pid-regulator", "blokkdiagram"]);
		// And the sidebar now lists it under the fag.
		const { byCourse } = groupChatsByCourse(chatStore.listChats(), ["TTK4100"]);
		assert.ok(byCourse.get("TTK4100")!.subs.some((c) => c.id === loose.id));
	});

	it("a waiting question keeps its call and answer adjacent: the marker goes before the question", () => {
		const messages = [userMessage("u1", "Hei"), quizCall("a1", "call_q")];
		assert.equal(courseMarkerInsertIndex(messages), 1);
		assert.equal(courseMarkerInsertIndex([userMessage("u1", "Hei")]), 1, "nothing waiting: at the end");
		const chat = chatStore.createChat("Med spørsmål");
		chatStore.saveMessages(chat.id, messages);
		const outcome = moveChatToCourse(chat.id, "TMA4100");
		assert.ok(outcome.ok);
		const ids = chatStore.getChat(chat.id)!.messages.map((m) => (m as { customType?: string }).customType ?? m.id);
		assert.deepEqual(ids, ["u1", "course-context", "a1"]);
	});

	it("a moved practice session gets no explain approval rule", () => {
		const chat = chatStore.createChat("Øving", "practice");
		assert.ok(moveChatToCourse(chat.id, "TTK4100").ok);
		const marker = chatStore.getChat(chat.id)!.messages[0] as unknown as { content: string };
		assert.doesNotMatch(marker.content, /Green is an approval/);
	});

	it("refuses: unknown chat, unknown or missing fag, already in a fag; a deleted fag's session may move", async () => {
		assert.equal((await put("chat_nope", { code: "TTK4100" })).status, 404);
		const chat = chatStore.createChat("x");
		assert.equal((await put(chat.id, {})).status, 400);
		assert.equal((await put(chat.id, { code: "XYZ9999" })).status, 404);
		assert.equal(chatStore.getChat(chat.id)!.course, undefined);
		const linked = chatStore.createChat("y", undefined, { code: "TTK4100", mode: "sub" });
		const already = await put(linked.id, { code: "TMA4100" });
		assert.equal(already.status, 409);
		assert.deepEqual(chatStore.getChat(linked.id)!.course, { code: "TTK4100", mode: "sub" });
		const orphan = chatStore.createChat("z", undefined, { code: "GONE1" });
		assert.equal((await put(orphan.id, { code: "TMA4100" })).status, 200);
		assert.deepEqual(chatStore.getChat(orphan.id)!.course, { code: "TMA4100", mode: "sub" });
	});
});

// ─── the doors in the UI ─────────────────────────────────────────────────────

describe("/chat/new: ?fag= drafts an underchat", () => {
	const page = async (p: { mode?: string; fag?: string }) =>
		(await NewSessionPage({ searchParams: Promise.resolve(p) })) as React.ReactElement<{ mode: string; course?: unknown }>;

	it("the page: a fag makes an underchat link; the free doors are as before", async () => {
		assert.deepEqual((await page({ fag: "ttk4100" })).props.course, { code: "TTK4100", mode: "sub" });
		assert.equal((await page({ fag: "ttk4100" })).props.mode, "teach");
		const examWithFag = await page({ mode: "exam", fag: "TTK4100" });
		assert.equal(examWithFag.props.mode, "teach", "a fag's eksamensøkt is its fag-chat, never a draft");
		assert.deepEqual(examWithFag.props.course, { code: "TTK4100", mode: "sub" });
		assert.equal((await page({ mode: "exam" })).props.mode, "exam");
		assert.equal((await page({ mode: "exam" })).props.course, undefined);
		assert.equal((await page({})).props.mode, "teach");
		assert.equal((await page({ mode: "practice" })).props.mode, "practice");
	});

	it("the draft names the underchat and its fag; the free eksamensøkt draft is unchanged", () => {
		const sub = renderToStaticMarkup(<DraftShell busy={false} text="" onChange={() => {}} onSend={() => {}} course={{ code: "TTK4100" }} />);
		assert.ok(sub.includes("Ny underchat"));
		assert.ok(sub.includes("En egen chat i TTK4100, ved siden av fag-chatten."));
		assert.ok(sub.includes("Hva vil du jobbe med?"));
		assert.match(sub, /href="\/fag\/TTK4100"/);
		const free = renderToStaticMarkup(<DraftShell busy={false} text="" onChange={() => {}} onSend={() => {}} mode="exam" />);
		assert.ok(free.includes("Ny eksamensøkt"));
		assert.ok(free.includes("Hvilken eksamen forbereder du deg til?"));
	});

	it("the first send creates the underchat with its link", async () => {
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
			await startDraftSession("Laplace", f, undefined, undefined, undefined, undefined, { code: "TTK4100", mode: "sub" });
		} finally {
			Reflect.deleteProperty(globalThis, "sessionStorage");
		}
		assert.deepEqual(bodies, [
			{ title: "Matte 1, eksamen 10. desember", kind: "exam" },
			{ title: "Laplace", course: { code: "TTK4100", mode: "sub" } },
		]);
	});

	it("the fag page's text rides into an existing fag-chat once: taken, never sent twice", async () => {
		const { stashCarriedMessage, takeCarriedMessage } = await import("../components/opening-prompt.ts");
		const storage = new Map<string, string>();
		Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => { storage.set(key, value); },
			removeItem: (key: string) => { storage.delete(key); },
		} });
		try {
			assert.equal(stashCarriedMessage("chat_fag", "Forklar PID"), true);
			assert.equal(takeCarriedMessage("chat_fag"), "Forklar PID");
			assert.equal(takeCarriedMessage("chat_fag"), undefined, "a remount finds nothing");
			assert.equal(takeCarriedMessage("other"), undefined);
		} finally {
			Reflect.deleteProperty(globalThis, "sessionStorage");
		}
		assert.equal(takeCarriedMessage("chat_fag"), undefined, "no storage: nothing, and no throw");
	});

	it("the fag-chat's top-bar menu offers «Ny underchat» (and is a list to extend)", () => {
		const items = courseChatMenuItems({ code: "TTK4100", chatId: "c" });
		assert.deepEqual(items.map((i) => [i.id, i.label, i.href]), [["new-sub-chat", "Ny underchat", "/chat/new?fag=TTK4100"]]);
	});
});

describe("the fag page: no Lær/Øv/Prøveeksamen/Kartlegging starts, a list of the fag's chats", () => {
	const planActions = { onToggleDone: () => {}, onMinutesPerDay: () => {}, onOpenWizard: () => {}, onMapTopics: () => {}, onEditExamDate: () => {} };

	it("the plan has no start buttons, no AI-mapping button and no eksamensøkt card", () => {
		// Nothing mapped yet, so the mapping nudge shows too.
		const c = course({ topics: [{ id: "a", title: "A", weight: 2, status: "unknown" }, { id: "b", title: "B", weight: 3, status: "unknown" }] });
		const view = dom(<ExamPlanView course={c} plan={buildExamPlan(c, TODAY)} today={TODAY} actions={planActions} />);
		assert.ok(view.querySelector('[data-testid="plan-item"]'), "the plan items are still there");
		for (const gone of ["plan-item-start", "plan-map-with-ai", "exam-session-card"]) {
			assert.equal(view.querySelector(`[data-testid="${gone}"]`), null, gone);
		}
		assert.ok(view.querySelector('[data-testid="plan-map-now"]'), "«Kartlegg nå» (set the colours yourself) stays");
		assert.doesNotMatch(view.body.textContent!, /La AI-en teste meg|Start eksamensøkt/);
	});

	it("the wizard's last step has neither the mapping start nor the eksamensøkt alternative", () => {
		const wizardActions = {
			onExamDate: async () => true, onAddSource: async () => null, onRemoveSource: () => {}, onGenerate: async () => "ai" as const,
			onStatus: () => {}, onOpenSetup: () => {}, onDone: () => {},
		};
		const last = dom(<CourseWizard course={course()} actions={wizardActions} initialStep={2} />);
		assert.equal(last.querySelector('[data-testid="start-mapping"]'), null);
		assert.equal(last.querySelector('[data-testid="exam-session-card"]'), null);
		assert.ok(last.querySelector('[data-testid="wizard-done"]'));
	});

	it("the chat list: the fag-chat first, then the underchats, each with its last activity", () => {
		const group = {
			main: item({ id: "main", kind: "exam", title: "Fag-chat TTK4100", course: { code: "TTK4100", mode: "exam" }, pendingQuestion: true }),
			subs: [item({ id: "s1", title: "Laplace", course: { code: "TTK4100", mode: "sub" } })],
		};
		const list = dom(<CourseChatList code="TTK4100" group={group} onOpenMain={() => {}} />);
		const main = list.querySelector('[data-testid="course-chat-main"]')!;
		assert.equal(main.getAttribute("href"), "/chat/main");
		assert.match(main.textContent!, /Fag-chat.*Venter på svar/);
		const subs = [...list.querySelectorAll('[data-testid="course-chat-sub"]')];
		assert.deepEqual(subs.map((s) => s.getAttribute("href")), ["/chat/s1"]);
		assert.match(subs[0]!.textContent!, /Laplace/);
		assert.equal(list.querySelector('[data-testid="course-chats-new-sub"]')!.getAttribute("href"), "/chat/new?fag=TTK4100");
		assert.equal(list.querySelector('[data-tour="course-chats"]'), list.querySelector('[data-testid="course-chats"]'));
	});

	it("before the fag-chat exists the row opens it; while loading it waits", () => {
		const none = dom(<CourseChatList code="TTK4100" group={{ main: null, subs: [] }} onOpenMain={() => {}} />);
		const open = none.querySelector('[data-testid="course-chat-main"]')!;
		assert.equal(open.tagName, "BUTTON");
		assert.match(open.textContent!, /Ikke startet/);
		assert.equal(open.hasAttribute("disabled"), false);
		const loading = dom(<CourseChatList code="TTK4100" group={null} onOpenMain={() => {}} />);
		assert.ok(loading.querySelector('[data-testid="course-chat-main"]')!.hasAttribute("disabled"));
	});
});

describe("the sidebar: Oversikt, Fag with their chats, Uten fag", () => {
	const summary = (code: string, daysLeft: number) => ({
		code, name: `${code} navn`, daysLeft, counts: { green: 1, yellow: 0, red: 1, unknown: 0 }, topicCount: 2, sourceCount: 0, updatedAt: "2026-11-01T00:00:00.000Z",
	});
	const render = (props: Partial<React.ComponentProps<typeof SidebarCourses>> = {}) => {
		const chats = [
			item({ id: "main", kind: "exam", title: "Fag-chat TTK4100", course: { code: "TTK4100", mode: "exam" } }),
			item({ id: "sub", title: "Laplace", course: { code: "TTK4100", mode: "sub" } }),
		];
		return dom(
			<SidebarCourses
				courses={[summary("TMA4100", 20), summary("TTK4100", 8)]}
				groups={groupChatsByCourse(chats, ["TTK4100", "TMA4100"]).byCourse}
				activeCode="TTK4100"
				activeChatId="sub"
				expanded={(code) => code === "TTK4100"}
				onToggle={() => {}}
				onOpenCourse={() => {}}
				onOpenMainChat={() => {}}
				renderChat={(chat, label) => <span data-testid="row" data-id={chat.id}>{label ?? chat.title}</span>}
				{...props}
			/>,
		);
	};

	it("every fag is a row, nearest exam first, with the fagkode and the days left", () => {
		const document = render();
		const rows = [...document.querySelectorAll('[data-testid="sidebar-course"]')];
		assert.deepEqual(rows.map((r) => r.textContent!.slice(0, 7)), ["TTK4100", "TMA4100"]);
		const groups = [...document.querySelectorAll('[data-testid="sidebar-course-group"]')];
		assert.match(groups[0]!.textContent!, /8 d/);
		assert.equal(document.querySelector('[data-testid="sidebar-add-course"]')!.getAttribute("aria-label"), "Legg til fag");
	});

	it("the unfolded fag shows «Fag-chat» first, then its underchats; folded fag show nothing", () => {
		const document = render();
		const lists = [...document.querySelectorAll('[data-testid="sidebar-course-chats"]')];
		assert.equal(lists.length, 1);
		assert.deepEqual([...lists[0]!.querySelectorAll('[data-testid="row"]')].map((r) => r.textContent), ["Fag-chat", "Laplace"]);
		const toggles = [...document.querySelectorAll('[data-testid="sidebar-course-toggle"]')];
		assert.deepEqual(toggles.map((t) => t.getAttribute("aria-expanded")), ["true", "false"]);
		assert.equal(toggles[1]!.getAttribute("aria-label"), "Vis chattene i TMA4100");
	});

	it("each fag has a hover «+» for a new underchat; a fag with no fag-chat yet still offers the row", () => {
		const document = render({ expanded: () => true });
		const plus = [...document.querySelectorAll('[data-testid="sidebar-new-sub-chat"]')];
		assert.deepEqual(plus.map((p) => p.getAttribute("href")), ["/chat/new?fag=TTK4100", "/chat/new?fag=TMA4100"]);
		assert.equal(plus[0]!.getAttribute("aria-label"), "Ny underchat i TTK4100");
		const lists = [...document.querySelectorAll('[data-testid="sidebar-course-chats"]')];
		const empty = lists[1]!.querySelector('[data-testid="course-main-chat"]')!;
		assert.equal(empty.tagName, "BUTTON");
		assert.equal(empty.textContent, "Fag-chat");
	});

	it("folding: an explicit choice wins, otherwise the active fag is open", () => {
		assert.equal(courseExpanded({}, "TTK4100", "TTK4100"), true);
		assert.equal(courseExpanded({}, "TMA4100", "TTK4100"), false);
		assert.equal(courseExpanded({ TTK4100: false }, "TTK4100", "TTK4100"), false);
		assert.equal(courseExpanded({ TMA4100: true }, "TMA4100", undefined), true);
	});

	it("the active fag: the fag page, or a chat linked to a fag that exists", () => {
		const chats = [item({ id: "c_a", course: { code: "TTK4100", mode: "sub" } }), item({ id: "c_b", course: { code: "GONE1" } }), item({ id: "c_c" })];
		const codes = ["TTK4100"];
		assert.equal(activeCourseCode("/fag/TTK4100", chats, codes), "TTK4100");
		assert.equal(activeCourseCode("/chat/c_a", chats, codes), "TTK4100");
		assert.equal(activeCourseCode("/chat/c_b", chats, codes), undefined);
		assert.equal(activeCourseCode("/chat/c_c", chats, codes), undefined);
		assert.equal(activeCourseCode("/", chats, codes), undefined);
	});

	it("a loose row has no Læring/Øving or exam badges any more", () => {
		for (const kind of ["teach", "practice", "exam"] as const) {
			const html = renderToStaticMarkup(<SessionRow chat={item({ kind })} active={false} onOpen={() => {}} />);
			assert.doesNotMatch(html, /Øvingsøkt|Eksamensøkt|Læring|Øving/);
		}
	});
});

describe("the help center explains the fag-chat", () => {
	it("one article explains fag-chat and underchats, and is found when searching for Lær/Øv", () => {
		const article = findArticle("fag-chat-og-underchats");
		assert.ok(article);
		const text = article.answer.join(" ");
		assert.match(text, /fag-chatten/);
		assert.match(text, /underchatter/);
		assert.ok(article.keywords.includes("lær") && article.keywords.includes("øv"));
		assert.equal(findArticle("laer-eller-ov"), undefined);
	});

	it("starting an økt no longer mentions «Lær» or «Øv» buttons", () => {
		const text = findArticle("starte-okt")!.answer.join(" ");
		assert.doesNotMatch(text, /«Lær»|«Øv»/);
		assert.match(text, /Uten fag/);
	});

	it("the free eksamensøkt door is still findable", () => {
		const feature = FEATURES.find((f) => f.id === "start-eksamensokt");
		assert.ok(feature);
		assert.deepEqual(feature.action, { kind: "route", href: "/chat/new?mode=exam" });
	});
});
