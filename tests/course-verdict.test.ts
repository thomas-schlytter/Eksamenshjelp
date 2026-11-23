/**
 * «På god vei» / «Litt bak» / «Må opp i tempo» (fase 7b): days left per
 * topic that is not green yet.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { courseVerdict, VERDICT_RULE } from "../src/core/index.ts";

const counts = (green: number, yellow: number, red: number, unknown = 0) => ({ green, yellow, red, unknown });

describe("courseVerdict", () => {
	it("at least one day per remaining topic is on track", () => {
		assert.equal(courseVerdict(8, counts(9, 3, 2))?.label, "På god vei"); // 5 left, 1.6 d each
		assert.equal(courseVerdict(5, counts(0, 0, 5))?.label, "På god vei"); // exactly 1 d each
	});

	it("half a day per topic is a little behind; less must speed up", () => {
		assert.equal(courseVerdict(5, counts(0, 5, 5))?.label, "Litt bak"); // 0.5
		assert.equal(courseVerdict(4, counts(0, 5, 5))?.label, "Må opp i tempo"); // 0.4
	});

	it("unknown topics count as not green", () => {
		assert.equal(courseVerdict(3, counts(0, 0, 0, 10))?.id, "speed-up");
	});

	it("everything green is always on track, even without a date", () => {
		assert.equal(courseVerdict(null, counts(4, 0, 0))?.id, "on-track");
		assert.equal(courseVerdict(-3, counts(4, 0, 0))?.id, "on-track");
	});

	it("no topics, no date, exam today or over: no verdict", () => {
		assert.equal(courseVerdict(10, counts(0, 0, 0)), null);
		assert.equal(courseVerdict(null, counts(1, 1, 0)), null);
		assert.equal(courseVerdict(0, counts(1, 1, 0)), null);
		assert.equal(courseVerdict(-1, counts(1, 1, 0)), null);
	});

	it("the rule can be said in one line", () => {
		assert.match(VERDICT_RULE, /dager igjen per tema/);
		for (const label of ["På god vei", "Litt bak", "Må opp i tempo"]) assert.ok(VERDICT_RULE.includes(label));
	});
});
