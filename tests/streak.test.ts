/**
 * The flame (fase 7b), the pure rules: which answers count, the local day
 * (around midnight and across time zones), the streak, the levels, the
 * week row and the once-only celebration.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	addDays,
	answerDays,
	answerTimestamps,
	computeStreak,
	dayKey,
	flameLevel,
	nextFlameLevel,
	nextLevelLabel,
	settleCelebratedRank,
	streakSummary,
	weekRow,
	type LhMessage,
} from "../src/core/index.ts";

const days = (...list: string[]) => new Set(list);

/** A toolResult carrying an answered question's details. */
function answer(at: string, extra: Record<string, unknown> = {}, isError = false): LhMessage {
	return {
		id: `m_${Math.random().toString(36).slice(2)}`,
		role: "toolResult",
		toolCallId: "c1",
		toolName: "quiz",
		content: [{ type: "text", text: "{}" }],
		details: { kind: "quiz", questionText: "Q?", dontKnow: false, answers: [], answeredAt: at, ...extra },
		isError,
		timestamp: Date.parse(at),
	} as unknown as LhMessage;
}

function marker(customType: string, details: unknown, timestamp: number): LhMessage {
	return { id: `m_${timestamp}`, role: "custom", customType, content: "", display: true, details, timestamp } as unknown as LhMessage;
}

describe("dayKey: the local calendar day", () => {
	it("splits at local midnight, not at UTC midnight", () => {
		// 22:59 UTC on 30 Nov = 23:59 in Oslo (winter, UTC+1); one minute later is 1 Dec there.
		assert.equal(dayKey(Date.parse("2026-11-30T22:59:00Z"), "Europe/Oslo"), "2026-11-30");
		assert.equal(dayKey(Date.parse("2026-11-30T23:00:00Z"), "Europe/Oslo"), "2026-12-01");
		assert.equal(dayKey(Date.parse("2026-11-30T23:00:00Z"), "UTC"), "2026-11-30");
	});

	it("the same instant is a different day in another zone", () => {
		const instant = Date.parse("2026-12-01T03:00:00Z");
		assert.equal(dayKey(instant, "Europe/Oslo"), "2026-12-01");
		assert.equal(dayKey(instant, "America/New_York"), "2026-11-30");
	});

	it("summer time: Oslo is UTC+2", () => {
		assert.equal(dayKey(Date.parse("2026-06-30T21:59:00Z"), "Europe/Oslo"), "2026-06-30");
		assert.equal(dayKey(Date.parse("2026-06-30T22:00:00Z"), "Europe/Oslo"), "2026-07-01");
	});

	it("addDays crosses months, years and leap days", () => {
		assert.equal(addDays("2026-12-31", 1), "2027-01-01");
		assert.equal(addDays("2028-03-01", -1), "2028-02-29");
		assert.equal(addDays("2026-03-29", 1), "2026-03-30", "the DST night is still one day");
	});
});

describe("which answers count", () => {
	it("a real answer counts; skipped, parked, dismissed, closed by «Avslutt økt» and errors do not", () => {
		const msgs = [
			answer("2026-11-20T10:00:00Z"),
			answer("2026-11-21T10:00:00Z", { dismissed: true, skipped: true }),
			answer("2026-11-22T10:00:00Z", { dismissed: true, onHold: true }),
			answer("2026-11-23T10:00:00Z", { dismissed: true, sessionEnded: true }),
			answer("2026-11-24T10:00:00Z", { dismissed: true }),
			answer("2026-11-25T10:00:00Z", {}, true),
		];
		assert.deepEqual(answerTimestamps(msgs), [Date.parse("2026-11-20T10:00:00Z")]);
	});

	it("«Vet ikke» is an honest answer and counts", () => {
		assert.equal(answerTimestamps([answer("2026-11-20T10:00:00Z", { dontKnow: true })]).length, 1);
	});

	it("other tool results (no answeredAt) do not count", () => {
		const other = { ...answer("2026-11-20T10:00:00Z"), details: { title: "x" } } as unknown as LhMessage;
		assert.deepEqual(answerTimestamps([other]), []);
	});

	it("a thinking submission on a practice task counts; an empty one does not", () => {
		const t = Date.parse("2026-11-20T12:00:00Z");
		assert.deepEqual(answerTimestamps([marker("practice-thinking", { problemCallId: "p", text: "x = 2" }, t)]), [t]);
		assert.deepEqual(answerTimestamps([marker("practice-thinking", { problemCallId: "p", text: "  " }, t)]), []);
	});

	it("a recall quiz at the end of an økt counts when at least one question was answered", () => {
		const t = Date.parse("2026-11-20T12:00:00Z");
		const done = marker("session-wrap", { answers: [null, 2], completedAt: "2026-11-20T12:05:00.000Z" }, t);
		const bare = marker("session-wrap", { answers: [], completedAt: "2026-11-20T12:05:00.000Z" }, t);
		assert.deepEqual(answerTimestamps([done, bare]), [Date.parse("2026-11-20T12:05:00.000Z")]);
	});

	it("days are deduplicated in the given zone", () => {
		const set = answerDays([Date.parse("2026-11-30T22:30:00Z"), Date.parse("2026-11-30T23:30:00Z")], "Europe/Oslo");
		assert.deepEqual([...set].sort(), ["2026-11-30", "2026-12-01"]);
	});
});

describe("the streak", () => {
	it("counts back from today when today is done", () => {
		assert.deepEqual(computeStreak(days("2026-11-21", "2026-11-22", "2026-11-23"), "2026-11-23"), { current: 3, todayDone: true, longest: 3 });
	});

	it("today not done yet: counts from yesterday", () => {
		assert.deepEqual(computeStreak(days("2026-11-21", "2026-11-22"), "2026-11-23"), { current: 2, todayDone: false, longest: 2 });
	});

	it("neither today nor yesterday: 0, but the longest run is kept", () => {
		assert.deepEqual(computeStreak(days("2026-11-10", "2026-11-11", "2026-11-12", "2026-11-21"), "2026-11-23"), { current: 0, todayDone: false, longest: 3 });
	});

	it("a gap breaks the run", () => {
		assert.equal(computeStreak(days("2026-11-20", "2026-11-22", "2026-11-23"), "2026-11-23").current, 2);
	});

	it("just after midnight: yesterday's answer still holds the streak", () => {
		// 00:10 in Oslo on 24 Nov; the last answer was at 23:50 on the 23rd.
		const answers = answerDays([Date.parse("2026-11-22T12:00:00Z"), Date.parse("2026-11-23T22:50:00Z")], "Europe/Oslo");
		const today = dayKey(Date.parse("2026-11-23T23:10:00Z"), "Europe/Oslo");
		assert.equal(today, "2026-11-24");
		assert.deepEqual(computeStreak(answers, today), { current: 2, todayDone: false, longest: 2 });
	});

	it("nothing at all", () => {
		assert.deepEqual(computeStreak(days(), "2026-11-23"), { current: 0, todayDone: false, longest: 0 });
	});
});

describe("levels", () => {
	it("Gnist 1–2, Flamme 3–6, Glohet 7–13, Inferno 14–29, Blå flamme 30+", () => {
		const at = (n: number) => flameLevel(n)?.name ?? null;
		assert.equal(at(0), null);
		assert.deepEqual([1, 2].map(at), ["Gnist", "Gnist"]);
		assert.deepEqual([3, 6].map(at), ["Flamme", "Flamme"]);
		assert.deepEqual([7, 13].map(at), ["Glohet", "Glohet"]);
		assert.deepEqual([14, 29].map(at), ["Inferno", "Inferno"]);
		assert.deepEqual([30, 365].map(at), ["Blå flamme", "Blå flamme"]);
	});

	it("days to the next level, in words", () => {
		assert.deepEqual(nextFlameLevel(9)?.days, 5);
		assert.equal(nextLevelLabel(9), "5 dager til inferno");
		assert.equal(nextLevelLabel(2), "1 dag til flamme");
		assert.equal(nextLevelLabel(29), "1 dag til blå flamme");
		assert.equal(nextLevelLabel(30), "Høyeste nivå");
	});
});

describe("the week row", () => {
	it("seven days ending today, weekday labels, today named", () => {
		// 2026-11-23 is a Monday.
		const row = weekRow(days("2026-11-17", "2026-11-22"), "2026-11-23");
		assert.deepEqual(row.map((d) => d.label), ["ti", "on", "to", "fr", "lø", "sø", "i dag"]);
		assert.deepEqual(row.map((d) => d.done), [true, false, false, false, false, true, false]);
		assert.ok(row.at(-1)!.today);
	});
});

describe("the summary and the celebration", () => {
	it("a new level is celebrated once; a broken streak lets it be celebrated again", () => {
		const week = days("2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23");
		const fresh = streakSummary(week, "2026-11-23", 0, 2);
		assert.equal(fresh.current, 7);
		assert.equal(fresh.level, "hot");
		assert.equal(fresh.celebrate, "hot");
		assert.equal(streakSummary(week, "2026-11-23", 0, 3).celebrate, null, "already celebrated");
		assert.equal(settleCelebratedRank(3, 0), 0, "the streak broke: the rank follows it down");
		assert.equal(settleCelebratedRank(3, 9), 3);
	});

	it("the best streak never drops below what was stored", () => {
		assert.equal(streakSummary(days("2026-11-23"), "2026-11-23", 12, 0).best, 12);
		assert.equal(streakSummary(days("2026-11-22", "2026-11-23"), "2026-11-23", 1, 0).best, 2);
	});
});
