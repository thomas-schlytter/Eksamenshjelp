/**
 * Render pins for the fag UI (components/courses/**, the sidebar's fag
 * section and the session top bar's fag chip): static markup of the pure
 * bodies, the way the other render-*.test.tsx suites do it. What is pinned
 * is behaviour a student depends on: the Norwegian copy, the help-center
 * anchors (`data-tour`), and that status is never colour alone.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { buildExamPlan, courseVerdict, topicCounts, type Course, type CourseSummary, type CourseTopic, type ChatListItem } from "../src/core/index.ts";
import { CourseHitList, hitExamLine, ManualCourseForm } from "../components/courses/add-course.tsx";
import { CourseLinkChip, CourseSelectChip } from "../components/courses/course-chip.tsx";
import { CountdownCard, CourseNotFound, CourseSection, MockExamsCard, ProgressRingCard, sectionFromHash, WorkNowCard } from "../components/courses/course-page.tsx";
import { workNowTopics } from "../components/courses/course-summary.ts";
import { SourceAdder, SourceList, SourcesPanel } from "../components/courses/course-sources.tsx";
import { CourseWizard, type WizardActions } from "../components/courses/course-wizard.tsx";
import { CourseCard, CoursesOverview } from "../components/courses/courses-home.tsx";
import { ExamPlanView, planNeedsMapping, type ExamPlanActions } from "../components/courses/exam-plan.tsx";
import { StatusButtons, StatusDot, TopicStatusBar } from "../components/courses/status-ui.tsx";
import { TopicBoard, TopicRow, WeightMark, type TopicBoardActions } from "../components/courses/topic-board.tsx";
import { SessionRow, SidebarCourses } from "../components/sidebar.tsx";
import { chatIdFromPath } from "../components/top-bar.tsx";

const TODAY = "2026-11-13";

function dom(node: React.ReactNode) {
	return parseHTML(`<html><body>${renderToStaticMarkup(node)}</body></html>`).document;
}

function topic(id: string, title: string, status: CourseTopic["status"], weight: 1 | 2 | 3 = 2, extra: Partial<CourseTopic> = {}): CourseTopic {
	return { id, title, weight, status, ...extra };
}

function course(overrides: Partial<Course> = {}): Course {
	return {
		code: "TTK4100",
		name: "Kybernetikk introduksjon",
		custom: false,
		credits: "7.5",
		url: "https://www.ntnu.no/studier/emner/TTK4100",
		content: "Dynamiske systemer og regulering.",
		learningOutcome: "Kandidaten kan modellere enkle systemer.",
		exam: { date: "2026-12-07", form: "Skriftlig skoleeksamen", duration: "4 timer", aids: "D" },
		minutesPerDay: 120,
		sources: [
			{ id: "s_ntnu", kind: "ntnu", title: "Emnesiden", url: "https://www.ntnu.no/studier/emner/TTK4100", auto: true, addedAt: "2026-11-01T00:00:00.000Z" },
			{ id: "s_dir", kind: "folder", title: "eksamener", path: "/Users/x/TTK4100/eksamener", fileCount: 12, auto: false, addedAt: "2026-11-02T00:00:00.000Z" },
			{ id: "s_note", kind: "note", title: "Beskjed fra faglærer", text: "Kapittel 9 er ikke pensum.", auto: false, addedAt: "2026-11-03T00:00:00.000Z" },
		],
		topics: [
			topic("laplace", "Laplacetransformasjon", "red", 3),
			topic("bode", "Bodediagram", "yellow", 2, { statusSource: "agent", statusNote: "Blandet fase og forsterkning." }),
			topic("pid", "PID-regulering", "green", 3),
			topic("tilstandsrom", "Tilstandsrom", "unknown", 1, { description: "Sette opp tilstandsligninger." }),
		],
		topicsGeneratedBy: "ai",
		planDone: [],
		createdAt: "2026-11-01T00:00:00.000Z",
		updatedAt: "2026-11-12T00:00:00.000Z",
		ntnuFetchedAt: "2026-11-01T00:00:00.000Z",
		...overrides,
	};
}

function summary(overrides: Partial<CourseSummary> = {}): CourseSummary {
	return {
		code: "TTK4100",
		name: "Kybernetikk introduksjon",
		examDate: "2026-12-07",
		daysLeft: 24,
		counts: { green: 1, yellow: 1, red: 1, unknown: 1 },
		topicCount: 4,
		sourceCount: 3,
		updatedAt: "2026-11-12T00:00:00.000Z",
		...overrides,
	};
}

const planActions: ExamPlanActions = {
	onToggleDone: () => {}, onMinutesPerDay: () => {}, onOpenWizard: () => {}, onEditExamDate: () => {},
};
const boardActions: TopicBoardActions = {
	onStatus: () => {}, onSaveTopics: async () => true, onRegenerate: () => {}, regenerating: false,
};
const wizardActions: WizardActions = {
	onExamDate: async () => true, onAddSource: async () => null, onRemoveSource: () => {}, onGenerate: async () => "ai",
	onStatus: () => {}, onOpenSetup: () => {}, onDone: () => {},
};

describe("status is never colour alone", () => {
	it("a status dot carries its label for screen readers", () => {
		for (const [status, label] of [["red", "Kan ikke ennå"], ["yellow", "Usikker"], ["green", "Kan dette"], ["unknown", "Ikke kartlagt"]] as const) {
			const document = dom(<StatusDot status={status} />);
			assert.equal(document.querySelector(".sr-only")!.textContent, label);
			assert.ok(document.querySelector("svg"), "each status also has its own glyph");
		}
	});

	it("the progress line is ONE described image; segments follow the counts", () => {
		const document = dom(<TopicStatusBar counts={{ green: 3, yellow: 2, red: 1, unknown: 0 }} legend />);
		const bar = document.querySelector('[role="img"]')!;
		assert.equal(bar.getAttribute("aria-label"), "6 temaer: 3 kan du, 2 er du usikker på, 1 kan du ikke ennå");
		assert.deepEqual(Array.from(bar.children).map((el) => el.getAttribute("data-status")), ["green", "yellow", "red"], "an empty status gets no sliver");
		assert.match(bar.children[0]!.getAttribute("style")!, /flex-grow:\s*3/);
		const legend = document.querySelector("ul")!;
		assert.equal(legend.getAttribute("aria-hidden"), "true", "the legend repeats the label for sighted users only");
		assert.match(legend.textContent!, /3Kan dette/);
	});

	it("no topics: an empty track, described as such", () => {
		const bar = dom(<TopicStatusBar counts={{ green: 0, yellow: 0, red: 0, unknown: 0 }} />).querySelector('[role="img"]')!;
		assert.equal(bar.getAttribute("aria-label"), "Ingen temaer ennå");
		assert.equal(bar.children.length, 0);
	});

	it("the three self-assessment buttons: labelled, one pressed, grouped by topic", () => {
		const document = dom(<StatusButtons value="yellow" topicTitle="Bodediagram" onChange={() => {}} />);
		const group = document.querySelector('[role="group"]')!;
		assert.equal(group.getAttribute("aria-label"), "Hvor godt kan du Bodediagram?");
		const buttons = Array.from(group.querySelectorAll("button"));
		assert.deepEqual(buttons.map((b) => b.textContent), ["Kan ikke ennå", "Usikker", "Kan dette"]);
		assert.deepEqual(buttons.map((b) => b.getAttribute("aria-pressed")), ["false", "true", "false"]);
		const unmapped = dom(<StatusButtons value="unknown" topicTitle="X" onChange={() => {}} />);
		assert.ok(Array.from(unmapped.querySelectorAll("button")).every((b) => b.getAttribute("aria-pressed") === "false"), "unmapped presses nothing");
	});
});

describe("home: Mine fag", () => {
	it("first run: the welcome question, the big search, and the add-course anchor", () => {
		const document = dom(<CoursesOverview courses={[]} adding={false} onToggleAdd={() => {}} addPanel={<div data-testid="panel" />} />);
		assert.equal(document.querySelector("h1")!.textContent, "Hvilket fag skal du ha eksamen i?");
		assert.ok(document.querySelector('[data-tour="add-course"] [data-testid="panel"]'), "the search sits inside the anchor");
		assert.equal(document.querySelectorAll("ol li").length, 3, "three steps explain what happens next");
		assert.equal(document.querySelector('[data-testid="course-card"]'), null);
	});

	it("loading shows placeholders, never a flash of the welcome", () => {
		const document = dom(<CoursesOverview courses={null} adding={false} onToggleAdd={() => {}} addPanel={null} />);
		assert.equal(document.querySelector('[data-testid="courses-empty"]'), null);
		assert.equal(document.querySelector("h1")!.textContent, "Mine fag");
		assert.equal(document.querySelectorAll('[aria-hidden="true"].animate-pulse').length, 3);
	});

	it("with fag: cards sorted by nearest exam, one course-card anchor, the add button anchored", () => {
		const document = dom(
			<CoursesOverview
				courses={[summary({ code: "TMA4100", name: "Matematikk 1", daysLeft: 40 }), summary({ code: "TTK4100", daysLeft: 3 })]}
				adding={false}
				onToggleAdd={() => {}}
				addPanel={<div data-testid="panel" />}
			/>,
		);
		const cards = Array.from(document.querySelectorAll('[data-testid="course-card"]'));
		assert.deepEqual(cards.map((c) => c.getAttribute("href")), ["/fag/TTK4100", "/fag/TMA4100"]);
		assert.equal(document.querySelectorAll('[data-tour="course-card"]').length, 1);
		assert.equal(cards[0]!.getAttribute("data-tour"), "course-card");
		const add = document.querySelector('[data-tour="add-course"]')!;
		assert.equal(add.textContent, "Legg til fag");
		assert.equal(add.getAttribute("aria-expanded"), "false");
		assert.equal(document.querySelector('[data-testid="panel"]'), null, "the search stays closed until asked for");
	});

	it("«Legg til fag» open: the panel shows and the button says how to close it", () => {
		const document = dom(<CoursesOverview courses={[summary()]} adding onToggleAdd={() => {}} addPanel={<div data-testid="panel" />} />);
		assert.ok(document.querySelector('[data-testid="panel"]'));
		assert.equal(document.querySelector('[data-tour="add-course"]')!.textContent, "Lukk");
	});

	it("a failed list read says so and offers a retry, beside whatever was already shown", () => {
		const document = dom(<CoursesOverview courses={[summary()]} error="Fikk ikke kontakt med appen." adding={false} onToggleAdd={() => {}} onRetry={() => {}} addPanel={null} />);
		const alert = document.querySelector('[role="alert"]')!;
		assert.match(alert.textContent!, /Kunne ikke hente fagene dine\. Fikk ikke kontakt med appen\./);
		assert.equal(alert.querySelector("button")!.textContent, "Prøv igjen");
		assert.ok(document.querySelector('[data-testid="course-card"]'));
	});

	it("a card is one link with code, name, countdown, progress in words, and the call to action", () => {
		const card = dom(<CourseCard course={summary()} />).querySelector("a")!;
		assert.equal(card.getAttribute("href"), "/fag/TTK4100");
		assert.match(card.textContent!, /TTK4100/);
		assert.match(card.textContent!, /Kybernetikk introduksjon/);
		assert.match(card.textContent!, /24 dager til eksamen/);
		assert.match(card.textContent!, /7\. desember 2026/);
		assert.match(card.textContent!, /1 av 4 temaer kan du/);
		assert.match(card.textContent!, /Fortsett/);
		assert.equal(card.querySelector('[role="img"]')!.getAttribute("aria-label"), "4 temaer: 1 kan du, 1 er du usikker på, 1 kan du ikke ennå, 1 er ikke kartlagt");
		assert.equal(card.querySelectorAll("a, button").length, 0, "nothing interactive nested in the link");
	});

	it("a card without a date or topics says what is missing and invites the first step", () => {
		const card = dom(<CourseCard course={summary({ examDate: undefined, daysLeft: null, topicCount: 0, counts: { green: 0, yellow: 0, red: 0, unknown: 0 } })} />).querySelector("a")!;
		assert.match(card.textContent!, /Sett eksamensdato/);
		assert.match(card.textContent!, /Ikke kartlagt ennå/);
		assert.match(card.textContent!, /Kom i gang/);
		assert.doesNotMatch(card.textContent!, /Fortsett/);
	});

	it("fagkoder with Norwegian letters are escaped into the link", () => {
		assert.equal(dom(<CourseCard course={summary({ code: "ÆØ1" })} />).querySelector("a")!.getAttribute("href"), "/fag/%C3%86%C3%981");
	});
});

describe("Legg til fag: search results and the manual reserve", () => {
	const hits = [
		{ code: "TTK4100", name: "Kybernetikk introduksjon", examDates: ["2026-12-07"], location: "Trondheim" },
		{ code: "TTK4105", name: "Reguleringsteknikk", examDates: [] },
	];

	it("a hit shows code, name and exam date; the list is a labelled listbox with one active option", () => {
		const document = dom(<CourseHitList id="hits" hits={hits} activeIndex={1} onPick={() => {}} />);
		const list = document.querySelector('[role="listbox"]')!;
		assert.equal(list.getAttribute("aria-label"), "Treff hos NTNU");
		const options = Array.from(list.querySelectorAll('[role="option"]'));
		assert.deepEqual(options.map((o) => o.id), ["hits-0", "hits-1"], "ids the combobox can point at");
		assert.deepEqual(options.map((o) => o.getAttribute("aria-selected")), ["false", "true"]);
		assert.match(options[0]!.textContent!, /TTK4100Kybernetikk introduksjonEksamen 7\. desember 2026 · Trondheim/);
		assert.match(options[1]!.textContent!, /Ingen eksamensdato hos NTNU ennå/);
	});

	it("several exam dates: the first, and how many more", () => {
		assert.equal(hitExamLine({ examDates: ["2026-12-07", "2027-08-10"] }), "Eksamen 7. desember 2026 (+1 til)");
	});

	it("the manual form: one column, labels above, examples in the fields, disabled until filled", () => {
		const document = dom(<ManualCourseForm busy={false} onSubmit={() => {}} onCancel={() => {}} />);
		const inputs = Array.from(document.querySelectorAll("input"));
		assert.equal(inputs.length, 2);
		for (const input of inputs) {
			const label = document.querySelector(`label[for="${input.id}"]`);
			assert.ok(label, "every field has a visible label");
			assert.match(input.getAttribute("placeholder")!, /^F\.eks\. /);
		}
		assert.deepEqual(Array.from(document.querySelectorAll("label")).map((l) => l.textContent), ["Fagkode", "Navn på faget"]);
		const submit = document.querySelector('button[type="submit"]')!;
		assert.equal(submit.textContent, "Legg til fag");
		assert.ok(submit.hasAttribute("disabled"));
	});

	it("the manual form shows the server's error and flags an impossible fagkode", () => {
		const document = dom(<ManualCourseForm initialCode="x" busy={false} error="Faget finnes allerede." onSubmit={() => {}} />);
		assert.equal(document.querySelector('[role="alert"]')!.textContent, "Faget finnes allerede.");
		assert.equal(document.querySelector("input")!.getAttribute("aria-invalid"), "true");
	});
});

describe("fag page (fase 7b): the summary cards, sections, not found", () => {
	it("the countdown: date, form and duration, the big number, the verdict with its rule; the date stays editable", () => {
		const c = course();
		const verdict = courseVerdict(24, topicCounts(c.topics));
		const document = dom(<CountdownCard course={c} daysLeft={24} verdict={verdict} onExamDate={async () => true} />);
		assert.equal(document.querySelector('[data-testid="course-exam-day"]')!.textContent, "Eksamen mandag 7. desember");
		assert.match(document.body.textContent!, /Skriftlig skoleeksamen · 4 timer/);
		assert.equal(document.querySelector('[data-testid="course-days-left"]')!.textContent, "24dager igjen");
		assert.equal(document.querySelector('[data-testid="course-verdict"]')!.textContent, "På god vei");
		const anchor = document.querySelector('[data-tour="exam-date"]')!;
		assert.equal(anchor.querySelector('[data-testid="exam-date-edit"]')!.getAttribute("aria-label"), "Endre eksamensdato");
	});

	it("no date: says so, offers to set it, and gives no verdict", () => {
		const c = course({ custom: true, url: undefined, exam: {}, credits: undefined });
		const document = dom(<CountdownCard course={c} daysLeft={null} verdict={courseVerdict(null, topicCounts(c.topics))} onExamDate={async () => true} />);
		assert.equal(document.querySelector('[data-testid="course-exam-day"]')!.textContent, "Ingen eksamensdato");
		assert.equal(document.querySelector('[data-testid="exam-date-edit"]')!.getAttribute("aria-label"), "Sett eksamensdato");
		assert.equal(document.querySelector('[data-testid="course-verdict"]'), null);
	});

	it("the ring: green of all, in words, with the three counts", () => {
		const document = dom(<ProgressRingCard counts={{ green: 9, yellow: 3, red: 2, unknown: 0 }} />);
		assert.equal(document.querySelector('svg[role="img"]')!.getAttribute("aria-label"), "9 av 14 temaer sitter");
		const legend = Array.from(document.querySelectorAll('[data-testid="course-progress-legend"] li')).map((li) => li.textContent);
		assert.deepEqual(legend, ["9 sitter", "3 på vei", "2 må jobbes med"]);
		const empty = dom(<ProgressRingCard counts={{ green: 0, yellow: 0, red: 0, unknown: 0 }} onMakeTopics={() => {}} />);
		assert.match(empty.body.textContent!, /Ingen temaer ennå/);
		assert.equal(empty.querySelector("button")!.textContent, "Lag temaliste");
	});

	it("«Jobb med dette nå»: red before yellow, with the reason, and a link to every topic", () => {
		const c = course();
		const document = dom(<WorkNowCard topics={c.topics} items={workNowTopics(c.topics)} onWork={() => {}} onAllTopics={() => {}} />);
		const rows = Array.from(document.querySelectorAll('[data-testid="work-now-topic"]'));
		assert.deepEqual(rows.map((r) => r.getAttribute("data-status")), ["red", "yellow"]);
		assert.match(rows[0]!.textContent!, /Laplacetransformasjon.*ikke øvd ennå/);
		assert.match(rows[1]!.textContent!, /Bodediagram.*Blandet fase og forsterkning\./);
		assert.equal(document.querySelector('[data-testid="course-all-topics"]')!.textContent, "Alle temaer");
		const none = dom(<WorkNowCard topics={[]} items={[]} onWork={() => {}} onAllTopics={() => {}} onMakeTopics={() => {}} />);
		assert.match(none.body.textContent!, /ingen temaliste/);
	});

	it("the mock exams: a curve with dates and the change; empty offers «Lag prøveeksamen»", () => {
		const points = [
			{ id: "a", percent: 62, label: "02.11", gradedAt: "2026-11-02T10:00:00.000Z" },
			{ id: "b", percent: 71, label: "12.11", gradedAt: "2026-11-12T10:00:00.000Z" },
		];
		const document = dom(<MockExamsCard points={points} loaded onMake={() => {}} />);
		assert.equal(document.querySelector('[data-testid="mock-exam-change"]')!.textContent, "+9 poeng");
		assert.deepEqual(Array.from(document.querySelectorAll("ol li")).map((li) => li.textContent), ["02.11 · 62 %", "12.11 · 71 %"]);
		assert.equal(document.querySelector('svg[role="img"]')!.getAttribute("aria-label"), "Poeng fra 62 til 71 prosent");
		const empty = dom(<MockExamsCard points={[]} loaded onMake={() => {}} />);
		assert.match(empty.querySelector('[data-testid="mock-exams-empty"]')!.textContent!, /Lag prøveeksamen/);
	});

	it("sections open by hash; the old #kontekst opens «Kilder»", () => {
		assert.equal(sectionFromHash("#temaer"), "topics");
		assert.equal(sectionFromHash("#kilder"), "sources");
		assert.equal(sectionFromHash("#kontekst"), "sources");
		assert.equal(sectionFromHash("#plan"), "plan");
		assert.equal(sectionFromHash("#chatter"), "chats");
		assert.equal(sectionFromHash(""), null);
		assert.equal(sectionFromHash("#m_123"), null);
	});

	it("a section is a button with its state, the content only while open", () => {
		const closed = dom(<CourseSection id="topics" title="Alle temaer" meta="4" open={false} onToggle={() => {}}><p>innhold</p></CourseSection>);
		assert.equal(closed.querySelector("button")!.getAttribute("aria-expanded"), "false");
		assert.ok(!closed.body.textContent!.includes("innhold"));
		const open = dom(<CourseSection id="topics" title="Alle temaer" open onToggle={() => {}}><p>innhold</p></CourseSection>);
		assert.equal(open.querySelector("button")!.getAttribute("aria-expanded"), "true");
		assert.ok(open.body.textContent!.includes("innhold"));
	});

	it("an unknown fag gets a calm page with the way home", () => {
		const document = dom(<CourseNotFound code="XXX9999" />);
		assert.equal(document.querySelector("h1")!.textContent, "Fant ikke faget");
		assert.match(document.body.textContent!, /«XXX9999»/);
		const home = document.querySelector('[data-testid="course-not-found"] a')!;
		assert.equal(home.getAttribute("href"), "/");
		assert.equal(home.textContent, "Til Mine fag");
	});
});

describe("Eksamensplan", () => {
	it("anchored; today is open with its items, each with status, minutes and a checkbox (fase 2: no Start; fase 7b: no Lær/Øv/Repeter)", () => {
		const c = course();
		const plan = buildExamPlan(c, TODAY);
		assert.ok(plan.days[0]!.items.length > 0, "fixture sanity: the planner schedules today");
		const document = dom(<ExamPlanView course={c} plan={plan} today={TODAY} actions={planActions} />);
		const section = document.querySelector('[data-tour="exam-plan"]')!;
		assert.match(section.textContent!, /24 dager til eksamen/);
		const today = section.querySelector('[data-testid="plan-today"]')!;
		assert.equal(today.querySelector("h2")!.textContent, "I dag");
		const items = Array.from(today.querySelectorAll('[data-testid="plan-item"]'));
		assert.equal(items.length, plan.days[0]!.items.length);
		for (const [index, row] of items.entries()) {
			const item = plan.days[0]!.items[index]!;
			const box = row.querySelector('input[type="checkbox"]')!;
			assert.match(box.getAttribute("aria-label")!, /^Marker som ferdig: /);
			assert.doesNotMatch(row.textContent!, /(Lær|Øv|Repeter)(\s|·|\d|$)/);
			assert.equal(row.querySelector('[data-testid="plan-item-start"]'), null);
			if (item.topicId) assert.ok(row.querySelector("[data-status] .sr-only"), "the topic's status is in words too");
			assert.match(row.textContent!, /\d+ (min|t)/);
		}
		assert.ok(section.querySelectorAll('[data-testid="plan-day"]').length > 0, "coming days as compact rows");
		assert.equal(section.querySelector('[data-testid="minutes-per-day"] option[selected]')!.textContent, "2 t");
		// On the fag page the countdown sits in the card above (fase 7b).
		const compact = dom(<ExamPlanView course={c} plan={plan} today={TODAY} actions={planActions} compact />);
		assert.doesNotMatch(compact.body.textContent!, /24 dager til eksamen/);
		assert.ok(compact.querySelector('[data-testid="minutes-per-day"]'));
	});

	it("a ticked item reads as done", () => {
		const c = course();
		const plan = buildExamPlan(c, TODAY);
		const first = plan.days[0]!.items[0]!;
		const ticked = { ...plan, days: [{ ...plan.days[0]!, items: plan.days[0]!.items.map((i) => ({ ...i, done: true })) }, ...plan.days.slice(1)] };
		const document = dom(<ExamPlanView course={c} plan={ticked} today={TODAY} actions={planActions} />);
		const row = document.querySelector('[data-testid="plan-item"]')!;
		assert.equal(row.getAttribute("data-done"), "true");
		assert.ok(row.querySelector('input[type="checkbox"]')!.hasAttribute("checked"));
		assert.match(row.querySelector('input[type="checkbox"]')!.getAttribute("aria-label")!, /^Ferdig: /);
		assert.ok(first.key.length > 0);
		assert.match(document.querySelector('[data-testid="plan-today"]')!.textContent!, /Ferdig for i dag/);
		assert.match(document.querySelector('[data-testid="plan-today"] [role="status"]')!.textContent!, /Bra jobba!/);
	});

	it("no topics: points to the wizard instead of an empty plan", () => {
		const c = course({ topics: [] });
		const document = dom(<ExamPlanView course={c} plan={buildExamPlan(c, TODAY)} today={TODAY} actions={planActions} />);
		const message = document.querySelector('[data-testid="plan-message"]')!;
		assert.match(message.textContent!, /Planen trenger en temaliste/);
		assert.equal(message.querySelector("button")!.textContent, "Kom i gang");
		assert.equal(document.querySelector('[data-testid="plan-today"]'), null);
	});

	it("exam passed: says so and offers a new date; exam today: wishes luck", () => {
		const past = course({ exam: { date: "2026-11-01" } });
		const passed = dom(<ExamPlanView course={past} plan={buildExamPlan(past, TODAY)} today={TODAY} actions={planActions} />);
		assert.match(passed.querySelector('[data-testid="plan-message"]')!.textContent!, /Eksamen er over/);
		assert.equal(passed.querySelector('[data-testid="plan-message"] button')!.textContent, "Sett ny dato");
		const now = course({ exam: { date: TODAY } });
		const today = dom(<ExamPlanView course={now} plan={buildExamPlan(now, TODAY)} today={TODAY} actions={planActions} />);
		assert.match(today.querySelector('[data-testid="plan-message"]')!.textContent!, /Eksamen er i dag\. Lykke til!/);
	});

	it("(nearly) nothing mapped: a friendly nudge on top with «Kartlegg nå»; gone once it no longer applies", () => {
		const unknown = (n: number) => Array.from({ length: n }, (_, i) => topic(`u${i}`, `Ukjent ${i}`, "unknown"));
		const unmapped = course({ topics: unknown(10) });
		const document = dom(<ExamPlanView course={unmapped} plan={buildExamPlan(unmapped, TODAY)} today={TODAY} actions={{ ...planActions, onMapTopics: () => {} }} />);
		const nudge = document.querySelector('[data-testid="plan-mapping-nudge"]')!;
		assert.match(nudge.textContent!, /Planen blir bedre når du har kartlagt temaene\. Det tar ett minutt\./);
		assert.deepEqual(Array.from(nudge.querySelectorAll("button")).map((b) => b.textContent), ["Kartlegg nå"]);
		assert.equal(document.querySelector('[data-tour="exam-plan"]')!.firstElementChild, nudge, "at the very top of the plan");

		// 7 of 10 unknown (70 %) still nudges; 6 of 10 does not.
		const at = (unknownCount: number) => {
			const c = course({ topics: [...unknown(unknownCount), ...Array.from({ length: 10 - unknownCount }, (_, i) => topic(`g${i}`, `Kan ${i}`, "green"))] });
			return dom(<ExamPlanView course={c} plan={buildExamPlan(c, TODAY)} today={TODAY} actions={planActions} />).querySelector('[data-testid="plan-mapping-nudge"]');
		};
		assert.ok(at(7));
		assert.equal(at(6), null);
		assert.equal(planNeedsMapping([]), false, "an empty list has its own message");

		// Without a Temaer handler the nudge has no button; exam day never nudges.
		const bare = dom(<ExamPlanView course={unmapped} plan={buildExamPlan(unmapped, TODAY)} today={TODAY} actions={planActions} />);
		assert.deepEqual(Array.from(bare.querySelectorAll('[data-testid="plan-mapping-nudge"] button')).map((b) => b.textContent), []);
		const examDay = course({ topics: unknown(10), exam: { date: TODAY } });
		assert.equal(dom(<ExamPlanView course={examDay} plan={buildExamPlan(examDay, TODAY)} today={TODAY} actions={planActions} />).querySelector('[data-testid="plan-mapping-nudge"]'), null);
	});

	it("no exam date: still a plan, with a nudge to set the date", () => {
		const c = course({ exam: {} });
		const document = dom(<ExamPlanView course={c} plan={buildExamPlan(c, TODAY)} today={TODAY} actions={planActions} />);
		assert.match(document.body.textContent!, /Sett eksamensdato, så rekker planen helt fram til eksamen\./);
		assert.ok(document.querySelector('[data-testid="plan-today"]'));
	});

});

describe("Temaer", () => {
	it("anchored, no Lær/Øv explainer any more, and lists what needs work first", () => {
		const document = dom(<TopicBoard course={course()} actions={boardActions} onOpenWizard={() => {}} />);
		const board = document.querySelector('[data-tour="topic-board"]')!;
		assert.doesNotMatch(board.textContent!, /Lær =|Øv =/);
		const rows = Array.from(board.querySelectorAll('[data-testid="topic-row"]'));
		assert.deepEqual(rows.map((r) => r.getAttribute("data-status")), ["red", "yellow", "unknown", "green"]);
		assert.match(board.textContent!, /Rediger temaliste/);
		assert.match(board.textContent!, /Lag temaliste på nytt/);
	});

	it("a topic row: status in words, importance in words, the AI's note, three status buttons, no Lær/Øv starts", () => {
		const c = course();
		const document = dom(<ul><TopicRow topic={c.topics[1]!} actions={boardActions} /></ul>);
		const row = document.querySelector('[data-testid="topic-row"]')!;
		assert.match(row.textContent!, /Bodediagram/);
		assert.match(row.textContent!, /Usikker/);
		assert.equal(row.querySelector('[data-testid="topic-weight"]')!.textContent, "Viktig");
		assert.equal(row.querySelector('[data-testid="topic-status-note"]')!.textContent, "Sist vurdert av AI: Blandet fase og forsterkning.");
		assert.equal(row.querySelectorAll('[data-testid="status-buttons"] button').length, 3);
		const actions = Array.from(row.querySelectorAll("button[aria-label]")).map((b) => b.getAttribute("aria-label"));
		assert.equal(actions.some((label) => /^(Lær|Øv): /.test(label ?? "")), false);
	});

	it("a self-assessed topic shows no AI note; the weight mark always has its word", () => {
		const c = course();
		const row = dom(<ul><TopicRow topic={{ ...c.topics[1]!, statusSource: "self" }} actions={boardActions} /></ul>);
		assert.equal(row.querySelector('[data-testid="topic-status-note"]'), null);
		assert.equal(dom(<WeightMark weight={3} />).body.textContent, "Svært viktig");
		assert.equal(dom(<WeightMark weight={1} />).body.textContent, "Mindre viktig");
	});

	it("a list made without AI says so; no topics offers both ways to get a list", () => {
		const fallback = dom(<TopicBoard course={course({ topicsGeneratedBy: "fallback" })} actions={boardActions} onOpenWizard={() => {}} />);
		assert.match(fallback.body.textContent!, /laget uten AI fra læringsutbyttet/);
		const empty = dom(<TopicBoard course={course({ topics: [] })} actions={boardActions} onOpenWizard={() => {}} />);
		assert.match(empty.body.textContent!, /Ingen temaer ennå/);
		assert.deepEqual(Array.from(empty.querySelectorAll("button")).map((b) => b.textContent), ["Lag temaliste", "Skriv inn selv"]);
	});
});

describe("Kontekst", () => {
	it("anchored; NTNU's texts are collapsed, the student's own sources listed with a remove button each", () => {
		const document = dom(<SourcesPanel course={course()} onAdd={async () => null} onRemove={() => {}} />);
		const panel = document.querySelector('[data-tour="course-sources"]')!;
		assert.deepEqual(Array.from(panel.querySelectorAll("h2")).map((h) => h.textContent), ["Hentet automatisk", "Ditt materiale"]);
		const details = Array.from(panel.querySelectorAll("details"));
		assert.deepEqual(details.map((d) => d.querySelector("summary")!.textContent!.replace("›", "").trim()), ["Faglig innhold", "Læringsutbytte"]);
		assert.ok(details.every((d) => !d.hasAttribute("open")));
		assert.doesNotMatch(panel.textContent!, /Canvas/, "the Canvas explanation lives in Hjelp, not on the page");
		assert.equal(panel.querySelector('a[href="/kart"]')!.textContent, "kunnskapskartet");
		const removable = Array.from(panel.querySelectorAll('[data-testid="source-row"] button')).map((b) => b.getAttribute("aria-label"));
		assert.deepEqual(removable, ["Fjern eksamener", "Fjern Beskjed fra faglærer"], "the automatic NTNU source cannot be removed");
	});

	it("each source row names its kind for screen readers and shows where it is", () => {
		const c = course();
		const document = dom(<SourceList sources={c.sources} onRemove={() => {}} />);
		const rows = Array.from(document.querySelectorAll('[data-testid="source-row"]'));
		assert.deepEqual(rows.map((r) => r.getAttribute("data-kind")), ["ntnu", "folder", "note"]);
		assert.match(rows[1]!.textContent!, /Mappe: eksamener\/Users\/x\/TTK4100\/eksamener · 12 filer/);
		assert.match(rows[2]!.textContent!, /Notat: Beskjed fra faglærerKapittel 9 er ikke pensum\./);
	});

	it("a manual fag says nothing was fetched; an empty list says so plainly", () => {
		const document = dom(<SourcesPanel course={course({ custom: true, sources: [] })} onAdd={async () => null} onRemove={() => {}} />);
		assert.match(document.body.textContent!, /Dette faget la du inn selv/);
		assert.match(document.body.textContent!, /Du har ikke lagt til noe ennå\./);
		assert.equal(document.querySelectorAll("details").length, 0);
	});

	it("the adder offers drop, paste a path, paste a note, add a link; without the desktop bridge it says how", () => {
		const document = dom(<SourceAdder onAdd={async () => null} />);
		assert.match(document.querySelector('[data-testid="source-drop-zone"]')!.textContent!, /Dra filer eller mapper hit/);
		assert.match(document.querySelector('[data-testid="source-drop-zone"]')!.textContent!, /lime inn stien til en fil eller mappe/);
		assert.deepEqual(Array.from(document.querySelectorAll("button")).map((b) => b.textContent), ["Lim inn sti", "Lim inn notat", "Legg til lenke"]);
	});
});

describe("the first-run wizard", () => {
	it("step 1: the exam date, prefilled from NTNU, skippable", () => {
		const document = dom(<CourseWizard course={course({ topics: [], examDateSetBy: "ntnu" })} actions={wizardActions} />);
		assert.equal(document.querySelector('[data-testid="wizard-step"]')!.textContent, "Steg 1 av 3");
		assert.equal(document.querySelector("h2")!.textContent, "Når er eksamen?");
		assert.match(document.body.textContent!, /NTNU oppgir 07\/12\/2026/);
		assert.doesNotMatch(document.body.textContent!, /Stemmer det/);
		assert.equal(document.querySelector('input[type="date"]')!.getAttribute("value"), "2026-12-07");
		assert.deepEqual(Array.from(document.querySelectorAll("button")).map((b) => b.textContent), ["Neste", "Hopp over"]);
	});

	it("step 1: a date the learner set is not credited to NTNU", () => {
		for (const examDateSetBy of ["self", undefined] as const) {
			const document = dom(<CourseWizard course={course({ topics: [], examDateSetBy })} actions={wizardActions} />);
			assert.doesNotMatch(document.body.textContent!, /NTNU oppgir/);
			assert.equal(document.querySelector('input[type="date"]')!.getAttribute("value"), "2026-12-07");
		}
	});

	it("step 2: material is optional and says what helps most", () => {
		const document = dom(<CourseWizard course={course({ topics: [], sources: [] })} actions={wizardActions} initialStep={1} />);
		assert.equal(document.querySelector("h2")!.textContent, "Har du noe materiale?");
		assert.match(document.body.textContent!, /Tidligere eksamener og løsningsforslag gir den beste planen/);
		assert.ok(document.querySelector('[data-testid="source-drop-zone"]'));
		assert.ok(Array.from(document.querySelectorAll("button")).some((b) => b.textContent === "Hopp over"));
	});

	it("step 3 without topics: one button makes the list", () => {
		const document = dom(<CourseWizard course={course({ topics: [] })} actions={wizardActions} initialStep={2} />);
		assert.equal(document.querySelector("h2")!.textContent, "Kartlegg hva du kan");
		assert.equal(document.querySelector('[data-testid="generate-topics"]')!.textContent, "Lag temaliste");
		assert.equal(document.querySelector('[data-testid="wizard-topic"]'), null);
	});

	it("step 3 with topics: three big buttons per topic and progress in words (no mapping start)", () => {
		const document = dom(<CourseWizard course={course()} actions={wizardActions} initialStep={2} />);
		const topics = Array.from(document.querySelectorAll('[data-testid="wizard-topic"]'));
		assert.equal(topics.length, 4);
		assert.ok(topics.every((t) => t.querySelectorAll('[data-testid="status-buttons"] button').length === 3));
		assert.equal(document.querySelector('[data-testid="start-mapping"]'), null);
		assert.match(document.body.textContent!, /3 av 4 temaer vurdert/);
		assert.equal(document.querySelector('[data-testid="wizard-done"]')!.textContent, "Ferdig, vis planen");
		assert.equal(document.querySelector('[data-testid="fallback-note"]'), null);
	});

	it("a list made without AI is flagged, with the way to a better one", () => {
		const document = dom(<CourseWizard course={course({ topicsGeneratedBy: "fallback" })} actions={wizardActions} initialStep={2} />);
		const note = document.querySelector('[data-testid="fallback-note"]')!;
		assert.match(note.textContent!, /Lista ble laget uten AI/);
		assert.equal(note.querySelector("button")!.textContent, "Sett opp modeller");
	});
});

describe("fag in the chrome: sidebar section, session rows, chips", () => {
	const sidebarProps = {
		groups: new Map(),
		expanded: () => false,
		onToggle: () => {},
		onOpenCourse: () => {},
		onOpenMainChat: () => {},
		renderChat: () => null,
	};

	it("the sidebar lists fag as rows that open the fag page, nearest exam first, with progress and days in words", () => {
		const document = dom(
			<SidebarCourses
				{...sidebarProps}
				courses={[summary({ code: "TMA4100", name: "Matematikk 1", daysLeft: 40 }), summary({ daysLeft: 3 })]}
				activeCode="TTK4100"
			/>,
		);
		const nav = document.querySelector('[data-tour="sidebar-courses"]')!;
		assert.equal(nav.getAttribute("aria-label"), "Fag");
		const rows = Array.from(nav.querySelectorAll('[data-testid="sidebar-course"]'));
		// 2026-11-26: a link to the fag page (prefetched), not a button that
		// opened the fag-chat.
		assert.deepEqual(rows.map((l) => l.tagName), ["A", "A"]);
		assert.deepEqual(rows.map((l) => l.getAttribute("href")), ["/fag/TTK4100", "/fag/TMA4100"]);
		assert.deepEqual(rows.map((l) => l.textContent!.slice(0, 7)), ["TTK4100", "TMA4100"]);
		assert.equal(rows[0]!.getAttribute("aria-current"), "page");
		assert.equal(rows[1]!.getAttribute("aria-current"), null);
		assert.match(rows[0]!.querySelector(".sr-only")!.textContent!, /Kybernetikk introduksjon\. 3 dager til eksamen\./);
		assert.ok(rows[0]!.querySelector('[role="img"]'));
		const add = nav.querySelector('[data-testid="sidebar-add-course"]')!;
		assert.equal(add.getAttribute("aria-label"), "Legg til fag");
		assert.equal(add.getAttribute("href"), "/?leggtil=1");
	});

	it("no fag yet: the section still offers «Legg til fag»", () => {
		const document = dom(<SidebarCourses {...sidebarProps} courses={[]} />);
		assert.equal(document.querySelectorAll('[data-testid="sidebar-course"]').length, 0);
		assert.ok(document.querySelector('[data-testid="sidebar-add-course"]'));
	});

	it("a loose session row carries no fag chip (a fag's sessions list under the fag)", () => {
		const item = (overrides: Partial<ChatListItem>): ChatListItem => ({
			id: "c1", title: "Laplace", kind: "teach", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
			messageCount: 2, phase: "probe", pendingQuestion: false, pendingProblem: false, busy: false, compacting: false, ...overrides,
		});
		const free = dom(<SessionRow chat={item({})} active={false} onOpen={() => {}} />);
		assert.equal(free.querySelector('[data-testid="session-course"]'), null);
		assert.match(free.body.textContent!, /Laplace/);
	});

	it("the fag chip links to the fag page; the selector lists Ingen plus every fag, and hides with none", () => {
		const chip = dom(<CourseLinkChip code="TTK4100" />).querySelector("a")!;
		assert.equal(chip.getAttribute("href"), "/fag/TTK4100");
		assert.equal(chip.getAttribute("aria-label"), "Gå til faget TTK4100");
		const select = dom(<CourseSelectChip courses={[{ code: "TTK4100", name: "K" }, { code: "TMA4100", name: "M" }]} value="TMA4100" onChange={() => {}} />);
		assert.deepEqual(Array.from(select.querySelectorAll("option")).map((o) => o.textContent), ["Ingen", "TTK4100", "TMA4100"]);
		assert.equal(select.querySelector("option[selected]")!.getAttribute("value"), "TMA4100");
		assert.equal(select.querySelector("select")!.getAttribute("aria-label"), "Koble økta til et fag");
		assert.equal(renderToStaticMarkup(<CourseSelectChip courses={[]} value="" onChange={() => {}} />), "");
	});

	it("the top bar finds the session in the route; the draft view is no session", () => {
		assert.equal(chatIdFromPath("/chat/c_abc-123"), "c_abc-123");
		assert.equal(chatIdFromPath("/chat/new"), undefined);
		assert.equal(chatIdFromPath("/fag/TTK4100"), undefined);
		assert.equal(chatIdFromPath("/"), undefined);
		assert.equal(chatIdFromPath(null), undefined);
	});
});
