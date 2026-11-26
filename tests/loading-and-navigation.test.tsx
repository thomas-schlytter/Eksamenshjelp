/**
 * «Alt føles tregt» (2026-11-26): the route progress stripe's click rule,
 * the loading.tsx skeletons, the shared waiting look on buttons, the fag
 * row opening the fag page, the sidebar's dock timing, the celebration's
 * close button, and the chat payload without tool-result image bytes.
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
import type { ChatListItem, LhMessage } from "../src/core/index.ts";

// The seam, BEFORE any config-loading import: never the repo's data/.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-loading-"));
process.env.LH_DATA_DIR = path.join(TMP, "data");
process.env.LH_AUTH_FILE = path.join(TMP, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const { startsNavigation, SHOW_DELAY_MS } = await import("../components/navigation-progress.tsx");
const { ChatSkeleton, CourseSkeleton, HelpSkeleton, MapSkeleton } = await import("../components/route-skeletons.tsx");
const { Button } = await import("../components/ui/button.tsx");
const { Spinner } = await import("../components/ui/pending.tsx");
const { CelebrationCard } = await import("../components/streak/streak-celebration.tsx");
const { CourseChatRow, SessionRow, SidebarCourses, dockDelay } = await import("../components/sidebar.tsx");
const { groupChatsByCourse, messagesForClient } = await import("../src/core/index.ts");
const { chatStore } = await import("../src/store/chats.ts");
const chatRoute = await import("../app/api/chats/[id]/route.ts");
const loadings = await Promise.all([
	import("../app/fag/[code]/loading.tsx"),
	import("../app/chat/[id]/loading.tsx"),
	import("../app/kart/loading.tsx"),
	import("../app/hjelp/loading.tsx"),
]);

function dom(node: React.ReactNode) {
	return parseHTML(`<html><body>${renderToStaticMarkup(node)}</body></html>`).document;
}

const item = (overrides: Partial<ChatListItem>): ChatListItem => ({
	id: "c1", title: "Laplace", kind: "teach", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
	messageCount: 2, phase: "probe", pendingQuestion: false, pendingProblem: false, busy: false, compacting: false, ...overrides,
});

describe("the route progress stripe: which clicks start it", () => {
	const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
	const here = { origin: "http://localhost:3000", pathname: "/fag/TTK4100" };
	const a = (href: string, target = "", hasDownload = false) => ({ href, target, hasDownload });

	it("an internal link to another page", () => {
		assert.equal(startsNavigation(plain, a("http://localhost:3000/chat/c_1"), here), true);
		assert.equal(startsNavigation(plain, a("/kart"), here), true, "relative hrefs resolve against the page");
	});

	it("not: the same page (also with only a new query or hash), another origin, new windows, downloads, no anchor", () => {
		assert.equal(startsNavigation(plain, a("/fag/TTK4100?x=1"), here), false);
		assert.equal(startsNavigation(plain, a("/fag/TTK4100#plan"), here), false);
		assert.equal(startsNavigation(plain, a("https://www.ntnu.no/"), here), false);
		assert.equal(startsNavigation({ ...plain, metaKey: true }, a("/kart"), here), false);
		assert.equal(startsNavigation({ ...plain, button: 1 }, a("/kart"), here), false);
		assert.equal(startsNavigation(plain, a("/kart", "_blank"), here), false);
		assert.equal(startsNavigation(plain, a("/api/chats/c_1/markdown", "", true), here), false);
		assert.equal(startsNavigation(plain, null, here), false);
	});

	it("only shows when a navigation takes a moment", () => {
		assert.ok(SHOW_DELAY_MS > 0 && SHOW_DELAY_MS <= 200);
	});
});

describe("the loading.tsx skeletons", () => {
	it("every route's loading file renders its skeleton: busy, a spoken status, the top bar's frame", () => {
		const labels = ["Laster faget …", "Laster chatten …", "Laster kunnskapskartet …", "Laster hjelpesenteret …"];
		loadings.forEach(({ default: Loading }, i) => {
			const document = dom(<Loading />);
			const root = document.querySelector('[data-testid="route-skeleton"]')!;
			assert.equal(root.getAttribute("aria-busy"), "true");
			assert.equal(document.querySelector('[role="status"]')!.textContent, labels[i]);
			assert.ok(document.querySelector(".lh-drag"), "the window-drag band is there while loading");
			assert.ok(document.querySelector('[aria-label="Åpne sidemenyen"]'), "the sidebar toggle is there");
		});
	});

	it("the grey blocks pulse only when motion is welcome", () => {
		for (const Skeleton of [CourseSkeleton, ChatSkeleton, MapSkeleton, HelpSkeleton]) {
			const html = renderToStaticMarkup(<Skeleton />);
			assert.match(html, /motion-safe:animate-pulse/);
			assert.doesNotMatch(html, /[" ]animate-pulse/, "never an unconditional pulse");
		}
	});

	it("the fag skeleton keeps the breadcrumb's «Mine fag»", () => {
		assert.match(dom(<CourseSkeleton />).querySelector("header")!.textContent!, /Mine fag/);
	});
});

describe("the waiting look on buttons", () => {
	it("pending: disabled, aria-busy, the spinner first and the button's own icon hidden", () => {
		const document = dom(<Button pending><svg data-icon="" />Lag prøveeksamen</Button>);
		const button = document.querySelector("button")!;
		assert.ok(button.hasAttribute("disabled"));
		assert.equal(button.getAttribute("aria-busy"), "true");
		assert.equal(button.getAttribute("data-pending"), "true");
		assert.ok(button.firstElementChild!.hasAttribute("data-pending-spinner"));
		assert.match(button.getAttribute("class")!, /\[&>\[data-pending-spinner\]\+svg\]:hidden/);
		assert.match(button.textContent!, /Lag prøveeksamen/);
	});

	it("not pending: untouched (no spinner, no aria-busy, disabled only when asked)", () => {
		const button = dom(<Button>Lagre</Button>).querySelector("button")!;
		assert.equal(button.hasAttribute("disabled"), false);
		assert.equal(button.getAttribute("aria-busy"), null);
		assert.equal(button.querySelector("[data-pending-spinner]"), null);
		assert.ok(dom(<Button disabled>Lagre</Button>).querySelector("button")!.hasAttribute("disabled"));
	});

	it("the spinner turns only under motion-safe and is hidden from screen readers", () => {
		const svg = dom(<Spinner />).querySelector("svg")!;
		assert.match(svg.getAttribute("class")!, /motion-safe:animate-spin/);
		assert.equal(svg.getAttribute("aria-hidden"), "true");
	});
});

describe("the sidebar: a fag opens its page, the chevron only folds", () => {
	const summary = (code: string) => ({
		code, name: `${code} navn`, daysLeft: code === "TTK4100" ? 3 : 20, counts: { green: 1, yellow: 0, red: 1, unknown: 0 }, topicCount: 2, sourceCount: 0, updatedAt: "2026-11-01T00:00:00.000Z",
	});
	const render = (props: Partial<React.ComponentProps<typeof SidebarCourses>> = {}) => dom(
		<SidebarCourses
			courses={[summary("TTK4100"), summary("TMA4100")]}
			groups={groupChatsByCourse([item({ id: "main", kind: "exam", title: "Fag-chat TTK4100", course: { code: "TTK4100", mode: "exam" } })], ["TTK4100", "TMA4100"]).byCourse}
			expanded={() => true}
			onToggle={() => {}}
			onOpenCourse={() => {}}
			onOpenMainChat={() => {}}
			renderChat={(chat, label) => <CourseChatRow chat={chat} label={label} active={false} href={`/chat/${chat.id}`} />}
			{...props}
		/>,
	);

	it("the fag's name is a link to /fag/<KODE>; the chevron is a button with no link", () => {
		const document = render();
		const rows = Array.from(document.querySelectorAll('[data-testid="sidebar-course"]'));
		assert.deepEqual(rows.map((r) => [r.tagName, r.getAttribute("href")]), [["A", "/fag/TTK4100"], ["A", "/fag/TMA4100"]]);
		const chevron = document.querySelector('[data-testid="sidebar-course-toggle"]')!;
		assert.equal(chevron.tagName, "BUTTON");
		assert.equal(chevron.getAttribute("href"), null);
	});

	it("an existing «Fag-chat» is a link to the chat; one not created yet is a button", () => {
		const document = render();
		const mains = Array.from(document.querySelectorAll('[data-testid="course-main-chat"]'));
		assert.deepEqual(mains.map((m) => [m.tagName, m.getAttribute("href")]), [["A", "/chat/main"], ["BUTTON", null]]);
	});

	it("while the fag-chat is being created, its row spins and cannot be pressed twice", () => {
		const document = render({ openingMainChat: "TMA4100" });
		const pending = Array.from(document.querySelectorAll('[data-testid="course-main-chat"]'))[1]!;
		assert.ok(pending.hasAttribute("disabled"));
		assert.equal(pending.getAttribute("aria-busy"), "true");
		assert.ok(pending.querySelector("[data-pending-spinner]"));
	});

	it("a loose session row with an href is a link (prefetched), without one a button", () => {
		assert.equal(dom(<SessionRow chat={item({})} active={false} href="/chat/c1" />).querySelector('[data-testid="session-row"]')!.getAttribute("href"), "/chat/c1");
		assert.equal(dom(<SessionRow chat={item({})} active={false} onOpen={() => {}} />).querySelector('[data-testid="session-row"]')!.tagName, "BUTTON");
	});

	it("the page gives the panel its room after the glide; at once on first paint and under reduced motion", () => {
		assert.equal(dockDelay(true, false), 200);
		assert.equal(dockDelay(false, false), 0);
		assert.equal(dockDelay(true, true), 0);
	});
});

describe("the celebration can be closed", () => {
	it("a clear close button, and the card is no window-drag surface", () => {
		const document = dom(<CelebrationCard days={7} level="hot" onClose={() => {}} />);
		const card = document.querySelector('[data-testid="streak-celebration"]')!;
		assert.match(card.getAttribute("class")!, /lh-no-drag/);
		const close = document.querySelector('[data-testid="streak-celebration-close"]')!;
		assert.equal(close.tagName, "BUTTON");
		assert.equal(close.getAttribute("aria-label"), "Lukk");
	});
});

describe("the chat view's payload: no tool-result image bytes", () => {
	const image = { type: "image", data: "QUJD".repeat(1000), mimeType: "image/png" };
	const messages = [
		{ id: "u1", role: "user", content: [{ type: "text", text: "Se her" }, image], timestamp: 1 },
		{ id: "r1", role: "toolResult", toolCallId: "t1", toolName: "read", content: [{ type: "text", text: "side 1" }, image], details: { pages: 1 }, isError: false, timestamp: 2 },
		{ id: "r2", role: "toolResult", toolCallId: "t2", toolName: "read", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 3 },
	] as unknown as LhMessage[];

	it("tool-result images keep their block but lose the bytes; the learner's own images and the rest stay", () => {
		const out = messagesForClient(messages);
		const result = out[1] as unknown as { content: { type: string; data?: string; mimeType?: string }[]; details: unknown };
		assert.deepEqual(result.content[1], { type: "image", data: "", mimeType: "image/png" });
		assert.equal(result.content[0]!.type, "text");
		assert.deepEqual(result.details, { pages: 1 });
		assert.equal(out[0], messages[0], "a user message is the same object");
		assert.equal(out[2], messages[2], "a result without images is the same object");
		assert.equal((messages[1] as unknown as { content: { data?: string }[] }).content[1]!.data!.length, 4000, "the input is not mutated");
	});

	it("GET /api/chats/[id] serves the slim messages; the record on disk keeps the bytes", async () => {
		const chat = chatStore.createChat("Fag-chat");
		chatStore.saveMessages(chat.id, messages);
		const res = await chatRoute.GET(new Request("http://localhost/"), { params: Promise.resolve({ id: chat.id }) });
		const body = (await res.json()) as { messages: { content: { data?: string }[] }[] };
		assert.equal(body.messages[1]!.content[1]!.data, "");
		assert.equal(body.messages[0]!.content[1]!.data!.length, 4000);
		const disk = chatStore.getChat(chat.id)!;
		assert.equal((disk.messages[1] as unknown as { content: { data?: string }[] }).content[1]!.data!.length, 4000);
	});
});
