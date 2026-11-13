/**
 * THE EXAM PLAN (exam mode): buildExamPlan is pure and deterministic — the
 * plan is a function of topic status, topic weight, the exam date, the
 * minutes per day, the checked-off keys and "today". These pins hold the
 * shape the fag page renders: weakest and most important first, learn
 * before practice, spaced reviews, a mock exam at the end, a daily budget
 * that is respected, and keys that survive a regeneration.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildExamPlan,
	examPlanKey,
	MOCK_EXAM_TITLE,
	type Course,
	type CourseTopic,
	type ExamPlan,
	type ExamPlanItem,
	type TopicStatus,
} from "../src/core/courses.ts";

const TODAY = "2026-11-13";

function topic(id: string, status: TopicStatus, weight: 1 | 2 | 3 = 2, extra: Partial<CourseTopic> = {}): CourseTopic {
	return { id, title: `Tema ${id}`, weight, status, ...extra };
}

function course(overrides: Partial<Course> = {}): Course {
	return {
		code: "TTK4100",
		name: "Kybernetikk, introduksjon",
		custom: false,
		exam: { date: "2026-12-10" },
		minutesPerDay: 120,
		sources: [],
		topics: [
			topic("a", "red", 3),
			topic("b", "unknown", 2),
			topic("c", "yellow", 2),
			topic("d", "green", 1),
			topic("e", "red", 1),
		],
		planDone: [],
		createdAt: "2026-11-01T00:00:00.000Z",
		updatedAt: "2026-11-01T00:00:00.000Z",
		...overrides,
	};
}

type Placed = ExamPlanItem & { date: string; dayIndex: number };

function flat(plan: ExamPlan): Placed[] {
	return plan.days.flatMap((day, dayIndex) => day.items.map((item) => ({ ...item, date: day.date, dayIndex })));
}

function first(plan: ExamPlan, topicId: string, activity: string): Placed | undefined {
	return flat(plan).find((i) => i.topicId === topicId && i.activity === activity);
}

describe("buildExamPlan — the frame", () => {
	it("is deterministic: same input, same plan", () => {
		assert.deepEqual(buildExamPlan(course(), TODAY), buildExamPlan(course(), TODAY));
	});

	it("does not mutate the course", () => {
		const c = course();
		const before = JSON.stringify(c);
		buildExamPlan(c, TODAY);
		assert.equal(JSON.stringify(c), before);
	});

	it("counts the days to the exam and plans from today to the day before it", () => {
		const plan = buildExamPlan(course(), TODAY);
		assert.equal(plan.daysLeft, 27);
		const dates = plan.days.map((d) => d.date);
		assert.ok(dates.length > 0);
		assert.equal(dates[0], TODAY, "the plan starts today");
		assert.ok(dates.every((d) => d >= TODAY && d < "2026-12-10"), "never on or after the exam day");
		assert.deepEqual([...dates].sort(), dates, "days are in order");
		assert.equal(new Set(dates).size, dates.length, "one entry per day");
	});

	it("accepts a full ISO timestamp as today and stamps generatedAt", () => {
		const plan = buildExamPlan(course(), "2026-11-13T08:30:00.000Z");
		assert.equal(plan.daysLeft, 27);
		assert.equal(plan.generatedAt, "2026-11-13T08:30:00.000Z");
		assert.equal(buildExamPlan(course(), TODAY, "2026-11-13T09:00:00.000Z").generatedAt, "2026-11-13T09:00:00.000Z");
	});

	it("every item has a stable date|topicId|activity key, unique across the plan", () => {
		const items = flat(buildExamPlan(course(), TODAY));
		for (const item of items) assert.equal(item.key, examPlanKey(item.date, item.topicId, item.activity));
		assert.equal(new Set(items.map((i) => i.key)).size, items.length);
	});

	it("no topics: an empty plan, days left still reported", () => {
		const plan = buildExamPlan(course({ topics: [] }), TODAY);
		assert.deepEqual(plan.days, []);
		assert.equal(plan.daysLeft, 27);
	});

	it("an exam date in the past: negative days left and an empty plan", () => {
		const plan = buildExamPlan(course({ exam: { date: "2026-11-10" } }), TODAY);
		assert.equal(plan.daysLeft, -3);
		assert.deepEqual(plan.days, []);
	});

	it("exam today: zero days left and nothing to schedule", () => {
		const plan = buildExamPlan(course({ exam: { date: TODAY } }), TODAY);
		assert.equal(plan.daysLeft, 0);
		assert.deepEqual(plan.days, []);
	});

	it("an invalid exam date reads as no date", () => {
		const plan = buildExamPlan(course({ exam: { date: "10.12.2026" } }), TODAY);
		assert.equal(plan.daysLeft, null);
		assert.ok(plan.days.length > 0);
	});
});

describe("buildExamPlan — what goes where", () => {
	it("red and unknown topics are learned first and practiced later; yellow topics are practiced; green ones only reviewed", () => {
		const plan = buildExamPlan(course(), TODAY);
		for (const id of ["a", "b", "e"]) {
			const learn = first(plan, id, "learn");
			const practice = first(plan, id, "practice");
			assert.ok(learn, `${id} gets a learn item`);
			assert.ok(practice, `${id} gets a practice item`);
			assert.ok(practice.date > learn.date, `${id}: practice comes after learn`);
		}
		assert.equal(first(plan, "c", "learn"), undefined, "a yellow topic is not re-taught");
		assert.ok(first(plan, "c", "practice"));
		const green = flat(plan).filter((i) => i.topicId === "d");
		assert.ok(green.length > 0, "a green topic still gets a refresh");
		assert.ok(green.every((i) => i.activity === "review"));
	});

	it("priority is status weight × topic weight: the most important weak topic starts first", () => {
		const plan = buildExamPlan(course(), TODAY);
		// a: red×3 = 12, b: unknown×2 = 6, e: red×1 = 4, c: yellow×2 = 4.
		const order = ["a", "b", "e"].map((id) => first(plan, id, "learn")!.date);
		assert.deepEqual([...order].sort(), order);
		assert.equal(first(plan, "a", "learn")!.date, TODAY);
	});

	it("green topics are reviewed in the last part of the plan, not at the start", () => {
		const plan = buildExamPlan(course(), TODAY);
		const greenReview = first(plan, "d", "review")!;
		assert.ok(greenReview.dayIndex > 0);
		assert.ok(greenReview.date >= "2026-11-28", `expected a late review, got ${greenReview.date}`);
	});

	it("spaced repetition: a learned topic comes back for review days later, more than once on a long plan", () => {
		const plan = buildExamPlan(course(), TODAY);
		const practice = first(plan, "a", "practice")!;
		const reviews = flat(plan).filter((i) => i.topicId === "a" && i.activity === "review" && i.date < "2026-12-08");
		assert.ok(reviews.length >= 2, "at least two spaced reviews before the closing days");
		assert.ok(reviews[0]!.date > practice.date, "the first review follows the practice");
		const gap = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
		assert.ok(gap(practice.date, reviews[0]!.date) >= 2, "not the very next day");
		assert.ok(gap(reviews[0]!.date, reviews[1]!.date) > gap(practice.date, reviews[0]!.date), "the interval grows");
	});

	it("the last two days hold a mock exam and a review of the weakest topics", () => {
		const plan = buildExamPlan(course(), TODAY);
		const mocks = flat(plan).filter((i) => i.activity === "mock");
		assert.equal(mocks.length, 1);
		assert.equal(mocks[0]!.date, "2026-12-08");
		assert.equal(mocks[0]!.title, MOCK_EXAM_TITLE);
		assert.equal(mocks[0]!.topicId, undefined);
		assert.equal(mocks[0]!.key, "2026-12-08||mock");
		const lastDay = plan.days.at(-1)!;
		assert.equal(lastDay.date, "2026-12-09", "the day before the exam");
		assert.ok(lastDay.items.every((i) => i.activity === "review"), "only light repetition the day before");
		assert.equal(lastDay.items[0]!.topicId, "a", "weakest and most important first");
		assert.ok(!lastDay.items.some((i) => i.topicId === "d"), "what is already green is not the weakest");
	});

	it("titles are Norwegian and name the activity", () => {
		const plan = buildExamPlan(course(), TODAY);
		assert.equal(first(plan, "a", "learn")!.title, "Lær: Tema a");
		assert.equal(first(plan, "c", "practice")!.title, "Øv: Tema c");
		assert.equal(first(plan, "d", "review")!.title, "Repeter: Tema d");
	});

	it("all topics green: short reviews and the mock exam, nothing to learn", () => {
		const plan = buildExamPlan(course({ topics: [topic("a", "green", 3), topic("b", "green", 2)] }), TODAY);
		const items = flat(plan);
		assert.ok(items.length > 0);
		assert.ok(items.every((i) => i.activity === "review" || i.activity === "mock"));
		assert.ok(items.some((i) => i.activity === "mock"));
	});
});

describe("buildExamPlan — time", () => {
	it("respects minutes per day on every day", () => {
		for (const minutesPerDay of [15, 45, 120, 600]) {
			const plan = buildExamPlan(course({ minutesPerDay }), TODAY);
			for (const day of plan.days) {
				const total = day.items.reduce((sum, i) => sum + i.minutes, 0);
				assert.ok(total <= minutesPerDay, `${day.date}: ${total} > ${minutesPerDay}`);
				assert.ok(day.items.every((i) => i.minutes > 0));
			}
		}
	});

	it("clamps minutes per day to 15–600", () => {
		const tiny = buildExamPlan(course({ minutesPerDay: 1 }), TODAY);
		assert.ok(tiny.days.every((d) => d.items.reduce((s, i) => s + i.minutes, 0) <= 15));
		assert.ok(tiny.days.length > 0, "a tiny budget still yields a plan");
		const huge = buildExamPlan(course({ minutesPerDay: 100_000 }), TODAY);
		assert.ok(huge.days.every((d) => d.items.reduce((s, i) => s + i.minutes, 0) <= 600));
	});

	it("few days left: compresses, keeps the most important topics and drops the rest", () => {
		const topics = Array.from({ length: 12 }, (_, i) => topic(`t${i}`, "red", i < 3 ? 3 : 1));
		const plan = buildExamPlan(course({ topics, exam: { date: "2026-11-16" }, minutesPerDay: 120 }), TODAY);
		assert.equal(plan.daysLeft, 3);
		assert.ok(plan.days.length <= 3);
		const learned = new Set(flat(plan).filter((i) => i.activity === "learn").map((i) => i.topicId));
		for (const id of ["t0", "t1", "t2"]) assert.ok(learned.has(id), `${id} (weight 3) is kept`);
		assert.ok(learned.size < 12, "not everything fits in three days");
		const full = buildExamPlan(course({ topics }), TODAY);
		assert.ok(first(plan, "t0", "learn")!.minutes < first(full, "t0", "learn")!.minutes, "items shrink under pressure");
		assert.ok(flat(plan).some((i) => i.activity === "mock"), "the last day still has the mock exam");
		for (const day of plan.days) assert.ok(day.items.reduce((s, i) => s + i.minutes, 0) <= 120);
	});

	it("exam tomorrow: one day, the most important topic first, no mock", () => {
		const plan = buildExamPlan(course({ exam: { date: "2026-11-14" } }), TODAY);
		assert.equal(plan.daysLeft, 1);
		assert.equal(plan.days.length, 1);
		assert.equal(plan.days[0]!.date, TODAY);
		assert.equal(plan.days[0]!.items[0]!.topicId, "a");
		assert.ok(!flat(plan).some((i) => i.activity === "mock"));
	});

	it("many days left: does not fill every day, but keeps a steady rhythm", () => {
		const plan = buildExamPlan(course({ exam: { date: "2027-03-13" } }), TODAY);
		assert.equal(plan.daysLeft, 120);
		assert.ok(plan.days.length < 60, `expected rest days, got ${plan.days.length} study days of 120`);
		// New topics are paced out: not all learned on day one …
		const learnDates = flat(plan).filter((i) => i.activity === "learn").map((i) => i.date);
		assert.ok(new Set(learnDates).size === learnDates.length, "one new topic per study day");
		// … and no long silence anywhere before the closing days.
		const stamps = plan.days.map((d) => Date.parse(d.date) / 86_400_000);
		const gaps = stamps.slice(1).map((s, i) => s - stamps[i]!);
		assert.ok(Math.max(...gaps) <= 60, `longest pause ${Math.max(...gaps)} days`);
		assert.ok(flat(plan).filter((i) => i.topicId === "a" && i.activity === "review").length >= 3, "long plans repeat more");
	});

	it("without an exam date: a prioritized list over the next 14 days, no mock exam", () => {
		const plan = buildExamPlan(course({ exam: {} }), TODAY);
		assert.equal(plan.daysLeft, null);
		assert.ok(plan.days.length > 0);
		assert.ok(plan.days.every((d) => d.date >= TODAY && d.date <= "2026-11-26"));
		assert.ok(!flat(plan).some((i) => i.activity === "mock"));
		assert.equal(plan.days[0]!.items[0]!.topicId, "a");
		assert.equal(plan.days[0]!.items[0]!.activity, "learn");
	});
});

describe("buildExamPlan — checked-off items", () => {
	it("done is set from planDone and survives a regeneration on the same day", () => {
		const plan = buildExamPlan(course(), TODAY);
		const target = first(plan, "a", "learn")!;
		const again = buildExamPlan(course({ planDone: [target.key, "2026-11-01|gone|learn"] }), TODAY);
		const same = flat(again).find((i) => i.key === target.key);
		assert.ok(same, "the same key is generated again");
		assert.equal(same.done, true);
		assert.equal(flat(again).filter((i) => i.done).length, 1, "only that item is checked");
	});

	it("work checked off on an earlier day moves the topic on to its next step", () => {
		const yesterday = "2026-11-12";
		const plan = buildExamPlan(course({ planDone: [`${yesterday}|a|learn`] }), TODAY);
		assert.equal(first(plan, "a", "learn"), undefined, "the learn item is not scheduled again");
		assert.equal(first(plan, "a", "practice")!.date, TODAY, "practice is now the first step");
		const both = buildExamPlan(course({ planDone: [`${yesterday}|a|learn`, `${yesterday}|a|practice`] }), TODAY);
		assert.deepEqual([...new Set(flat(both).filter((i) => i.topicId === "a").map((i) => i.activity))], ["review"]);
	});

	it("a status set after the checked-off work wins: the topic is learned again", () => {
		const topics = [topic("a", "red", 3, { updatedAt: "2026-11-13T07:00:00.000Z" }), topic("b", "unknown", 2)];
		const plan = buildExamPlan(course({ topics, planDone: ["2026-11-10|a|learn"] }), TODAY);
		assert.equal(first(plan, "a", "learn")!.date, TODAY);
	});
});
