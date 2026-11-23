/**
 * The fag page (fase 7b) as a whole: rendered with a full fag (topics in
 * every colour, a date, a plan) and with an empty one (no topics, no date),
 * plus the pure helpers behind its cards, the flame card and the Fokus
 * timer's form, chip and toasts. Static markup: no effects, no fetch.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { buildExamPlan, startFocus, streakSummary, type Course, type CourseTopic, type MockExamResult } from "../src/core/index.ts";
import { CoursePage } from "../components/courses/course-page.tsx";
import {
	countdownParts, examDayLabel, greenToastText, mockExamChange, mockExamPoints, newlyGreen, workNowTopics, workOnTopicText,
} from "../components/courses/course-summary.ts";
import { ServerEventsProvider } from "../components/server-events.tsx";
import { FlameCardView } from "../components/streak/flame-card.tsx";
import { celebrationTitle, CelebrationCard } from "../components/streak/streak-celebration.tsx";
import { StreakBadgeView } from "../components/streak/streak-badge.tsx";
import { FocusChip, FocusSetupForm, FocusToastCard, focusToastText } from "../components/focus/focus-ui.tsx";

const TODAY = new Date();
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const inDays = (n: number) => iso(new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + n));

function dom(node: React.ReactNode) {
	return parseHTML(`<html><body>${renderToStaticMarkup(node)}</body></html>`).document;
}

const topic = (id: string, title: string, status: CourseTopic["status"], weight: 1 | 2 | 3 = 2, extra: Partial<CourseTopic> = {}): CourseTopic =>
	({ id, title, weight, status, ...extra });

function course(overrides: Partial<Course> = {}): Course {
	return {
		code: "TMA4400",
		name: "Matematikk 1",
		custom: false,
		credits: "7.5",
		url: "https://www.ntnu.no/studier/emner/TMA4400",
		exam: { date: inDays(8), form: "Skriftlig skoleeksamen", duration: "4 timer" },
		minutesPerDay: 120,
		sources: [],
		topics: [
			topic("egen", "Egenverdier og diagonalisering", "red", 3, { statusSource: "agent", statusNote: "svakt i prøveeksamen 2" }),
			topic("diff", "Differensiallikninger av 2. orden", "red", 2),
			topic("taylor", "Taylorpolynomer og feilanalyse", "yellow", 2),
			topic("int", "Integrasjon", "green", 3),
		],
		topicsGeneratedBy: "ai",
		planDone: [],
		createdAt: "2026-11-01T00:00:00.000Z",
		updatedAt: "2026-11-12T00:00:00.000Z",
		...overrides,
	};
}

const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
function page(c: Course) {
	const plan = buildExamPlan(c, iso(TODAY));
	return dom(
		<AppRouterContext.Provider value={router as never}>
			<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>
				<CoursePage initial={{ course: c, plan }} initialConfigured />
			</ServerEventsProvider>
		</AppRouterContext.Provider>,
	);
}

describe("the fag page renders", () => {
	it("with data: title, the two buttons, the three cards, the two cards, the collapsed sections", () => {
		const document = page(course());
		assert.equal(document.querySelector("h1")!.textContent, "Matematikk 1");
		assert.match(document.querySelector('[data-testid="course-header"]')!.textContent!, /TMA4400 · 7,5 studiepoeng/);
		assert.equal(document.querySelector('[data-testid="course-make-mock-exam"]')!.textContent, "Lag prøveeksamen");
		assert.equal(document.querySelector('[data-testid="course-open-chat"]')!.textContent, "Fortsett i fag-chatten");
		assert.ok(document.querySelector('[data-testid="course-menu"]'), "Oppdater fra NTNU and Slett fag sit in the ⋯ menu");
		assert.equal(document.querySelector('[data-testid="course-days-left"]')!.textContent, "8dager igjen");
		// 3 not green, 8 days: 2.7 days each.
		assert.equal(document.querySelector('[data-testid="course-verdict"]')!.textContent, "På god vei");
		assert.equal(document.querySelector('[data-testid="course-progress"] svg')!.getAttribute("aria-label"), "1 av 4 temaer sitter");
		assert.ok(document.querySelector('[data-testid="flame-card"]'), "the flame card (loading until the streak arrives)");
		const work = Array.from(document.querySelectorAll('[data-testid="work-now-topic"]')).map((b) => b.textContent);
		assert.equal(work.length, 3);
		assert.match(work[0]!, /Egenverdier og diagonalisering.*svakt i prøveeksamen 2/);
		assert.match(work[2]!, /Taylorpolynomer/);
		assert.match(document.querySelector('[data-testid="course-mock-exams"]')!.textContent!, /Laster/);
		const sections = Array.from(document.querySelectorAll("[data-section]")).map((b) => b.getAttribute("data-section"));
		assert.deepEqual(sections, ["chats", "topics", "plan", "sources"]);
		assert.ok(Array.from(document.querySelectorAll("[data-section]")).every((b) => b.getAttribute("aria-expanded") === "false"));
		assert.ok(document.querySelector('[data-tour="course-tabs"]'), "the help tours find the sections");
		assert.equal(document.querySelector('[data-tour="exam-date"]')!.querySelector("button")!.getAttribute("aria-label"), "Endre eksamensdato");
		assert.equal(document.querySelector('[data-testid="course-wizard"], [data-testid="wizard"]'), null, "no wizard when the fag has topics");
		assert.doesNotMatch(document.body.textContent!, /Øving|læringsøkt/);
	});

	it("without data: no topics, no date — the wizard, no verdict, the empty states", () => {
		const document = page(course({ topics: [], exam: {}, credits: undefined }));
		assert.match(document.querySelector('[data-testid="course-header"]')!.textContent!, /^TMA4400/);
		assert.equal(document.querySelector('[data-testid="course-exam-day"]')!.textContent, "Ingen eksamensdato");
		assert.equal(document.querySelector('[data-testid="course-days-left"]')!.textContent, "Ingen eksamensdato");
		assert.equal(document.querySelector('[data-testid="course-verdict"]'), null, "no topic list, no verdict");
		assert.match(document.querySelector('[data-testid="course-progress"]')!.textContent!, /Ingen temaer ennå/);
		assert.match(document.querySelector('[data-testid="course-work-now"]')!.textContent!, /ingen temaliste/);
		assert.match(document.body.textContent!, /Lukk veiviseren/, "the wizard shows while there are no topics");
		const sections = Array.from(document.querySelectorAll("[data-section]")).map((b) => b.getAttribute("data-section"));
		assert.ok(!sections.includes("plan"), "no plan, no Eksamensplan section");
	});
});

describe("the summary helpers", () => {
	it("work now: red first, then yellow, by importance; the reason or «ikke øvd ennå»", () => {
		const c = course();
		const items = workNowTopics(c.topics);
		assert.deepEqual(items.map((i) => i.topic.id), ["egen", "diff", "taylor"]);
		assert.deepEqual(items.map((i) => i.reason), ["svakt i prøveeksamen 2", "ikke øvd ennå", "ikke øvd ennå"]);
		assert.equal(workOnTopicText("Integrasjon"), "La oss jobbe med «Integrasjon».");
	});

	it("the countdown's words", () => {
		assert.deepEqual(countdownParts(8), { big: "8", words: "dager igjen" });
		assert.deepEqual(countdownParts(1), { big: "1", words: "dag igjen" });
		assert.deepEqual(countdownParts(0), { big: null, words: "Eksamen er i dag" });
		assert.deepEqual(countdownParts(-2), { big: null, words: "Eksamen er over" });
		assert.equal(examDayLabel("2026-12-01"), "tirsdag 1. desember");
	});

	it("the curve: the newest grading per exam, oldest first, and the change", () => {
		const r = (id: string, examId: string, gradedAt: string, percent: number) => ({ id, examId, gradedAt, percent } as MockExamResult);
		const points = mockExamPoints([r("1", "a", "2026-11-02T10:00:00Z", 62), r("2", "b", "2026-11-10T10:00:00Z", 60), r("3", "b", "2026-11-11T10:00:00Z", 66), r("4", "c", "2026-11-12T10:00:00Z", 71)]);
		assert.deepEqual(points.map((p) => p.percent), [62, 66, 71]);
		assert.equal(mockExamChange(points)!.label, "+9 poeng");
		assert.equal(mockExamChange(points.slice(0, 1)), null);
		assert.equal(mockExamChange([points[2]!, points[0]!])!.label, "−9 poeng");
	});

	it("a topic that just turned green, for the toast", () => {
		const before = course().topics;
		const after = before.map((t) => (t.id === "taylor" ? { ...t, status: "green" as const } : t));
		const fresh = newlyGreen(before, after);
		assert.deepEqual(fresh.map((t) => t.id), ["taylor"]);
		assert.equal(greenToastText(fresh), "Nytt grønt tema: Taylorpolynomer og feilanalyse");
		assert.deepEqual(newlyGreen(after, after), [], "no change, no toast");
		assert.equal(greenToastText([before[0]!, before[1]!]), "Nye grønne temaer: Egenverdier og diagonalisering og Differensiallikninger av 2. orden");
	});
});

describe("the flame in the UI", () => {
	const week = new Set(["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);

	it("the card: number, level, days to the next level, the week, the nudge while today is not done", () => {
		const s = streakSummary(week, "2026-11-23", 0, 0);
		const document = dom(<FlameCardView streak={s} />);
		assert.equal(document.querySelector('[data-testid="flame-count"]')!.textContent, "6");
		assert.equal(document.querySelector('[data-testid="flame-level"]')!.textContent, "Flamme · 1 dag til glohet");
		const daysDone = Array.from(document.querySelectorAll('[data-testid="flame-day"]')).map((d) => d.hasAttribute("data-done"));
		assert.deepEqual(daysDone, [true, true, true, true, true, true, false]);
		assert.match(document.querySelector('[data-testid="flame-day"]:last-child')!.textContent!, /i dag.*ikke gjort ennå/);
		assert.equal(document.querySelector('[data-testid="flame-nudge"]')!.textContent, "Løs ett spørsmål i dag for å holde flammen.");
		const done = dom(<FlameCardView streak={streakSummary(new Set([...week, "2026-11-23"]), "2026-11-23", 0, 0)} />);
		assert.equal(done.querySelector('[data-testid="flame-nudge"]'), null, "today done: no nudge");
		assert.equal(done.querySelector('[data-testid="flame-card"]')!.getAttribute("data-level"), "hot");
	});

	it("the sidebar badge and the celebration", () => {
		const s = streakSummary(new Set([...week, "2026-11-23"]), "2026-11-23", 0, 0);
		assert.equal(dom(<StreakBadgeView streak={s} />).body.textContent, "7 dager på rad");
		assert.equal(celebrationTitle(7, "hot"), "7 dager på rad. Flammen er glohet!");
		const card = dom(<CelebrationCard days={7} level="hot" onClose={() => {}} />);
		assert.match(card.body.textContent!, /Nytt nivå/);
	});
});

describe("Fokus in the UI", () => {
	const T0 = Date.parse("2026-11-23T16:00:00");

	it("the setup: three presets (50 + 10 chosen), own fields with labels, sound, the finish time, Start", () => {
		const document = dom(<FocusSetupForm initial={{ workMinutes: 50, breakMinutes: 10, rounds: 3, sound: true }} now={T0} onStart={() => {}} />);
		const presets = Array.from(document.querySelectorAll('[aria-label="Forvalg"] button'));
		assert.deepEqual(presets.map((b) => b.querySelector("span")!.textContent), ["25 + 5", "50 + 10", "90 + 15"]);
		assert.deepEqual(presets.map((b) => b.getAttribute("aria-pressed")), ["false", "true", "false"]);
		for (const id of ["focus-work", "focus-break", "focus-rounds"]) {
			const input = document.querySelector(`[data-testid="${id}"]`)!;
			assert.ok(document.querySelector(`label[for="${input.id}"]`), `${id} has a label`);
		}
		assert.ok(document.querySelector('[data-testid="focus-sound"]')!.hasAttribute("checked"));
		assert.equal(document.querySelector('[data-testid="focus-finish"]')!.textContent, "Ferdig ca. kl. 18.50");
		assert.equal(document.querySelector('[data-testid="focus-start"]')!.textContent, "Start fokus");
	});

	it("the running chip: ring, «FOKUS r/R», the countdown, pause and stop", () => {
		const s = startFocus({ workMinutes: 50, breakMinutes: 10, rounds: 3, sound: true }, T0);
		const document = dom(<FocusChip state={s} now={T0 + 31 * 60_000 + 56_000} />);
		assert.match(document.body.textContent!, /FOKUS 1\/3/);
		assert.match(document.body.textContent!, /18:04/);
		assert.ok(document.querySelector('[data-testid="focus-pause"]'));
		assert.ok(document.querySelector('[data-testid="focus-stop"]'));
	});

	it("the toasts: «Pause! 10 minutter» with Start pausen / Hopp over, «Pausen er over», and done", () => {
		const breakDue = { kind: "break-due" as const, round: 2, rounds: 3, breakMinutes: 10 };
		assert.deepEqual(focusToastText(breakDue), { title: "Pause! 10 minutter", body: "Runde 2 av 3 er ferdig. Reis deg og strekk på beina." });
		const document = dom(<FocusToastCard toast={breakDue} onStartBreak={() => {}} onSkip={() => {}} onClose={() => {}} />);
		assert.equal(document.querySelector('[data-testid="focus-toast-start-break"]')!.textContent, "Start pausen");
		assert.equal(document.querySelector('[data-testid="focus-toast-skip"]')!.textContent, "Hopp over");
		assert.deepEqual(focusToastText({ kind: "break-ended", round: 3, rounds: 3, workMinutes: 50 }), { title: "Pausen er over", body: "Runde 3 av 3: 50 minutter." });
		const done = dom(<FocusToastCard toast={{ kind: "done", rounds: 3, origin: { chatId: "chat_a", label: "TMA4400" } }} onStartBreak={() => {}} onSkip={() => {}} onClose={() => {}} onOpenOrigin={() => {}} />);
		assert.equal(done.querySelector('[data-testid="focus-toast-end-session"]')!.textContent, "Avslutt økt i TMA4400");
	});
});
