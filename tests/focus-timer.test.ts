/**
 * Fokus (fase 7b): the timer's state machine. work → break → work → … →
 * done, pause/fortsett, «Hopp over», and the stored state surviving a
 * reload (end timestamps replayed, never a ticking counter).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	advanceFocus,
	countdownLabel,
	focusFinishAt,
	focusProgress,
	focusRemainingMs,
	normalizeFocusConfig,
	parseFocusState,
	pauseFocus,
	resumeFocus,
	skipBreak,
	startBreak,
	startFocus,
} from "../src/core/index.ts";

const MIN = 60_000;
const T0 = Date.parse("2026-11-23T16:00:00Z");
const config = { workMinutes: 50, breakMinutes: 10, rounds: 3, sound: true };

describe("the cycle", () => {
	it("work → break due → break → work → … → done", () => {
		let s = startFocus(config, T0);
		assert.equal(s.phase, "work");
		assert.equal(s.round, 1);

		let r = advanceFocus(s, T0 + 49 * MIN);
		assert.deepEqual(r.events, [], "nothing before the end");

		r = advanceFocus(s, T0 + 50 * MIN);
		assert.deepEqual(r.events, [{ type: "work-ended", round: 1 }]);
		s = r.state;
		assert.equal(s.phase, "break-due");
		assert.equal(advanceFocus(s, T0 + 999 * MIN).events.length, 0, "a due break waits for the learner");

		s = startBreak(s, T0 + 51 * MIN);
		assert.equal(s.phase, "break");
		r = advanceFocus(s, T0 + 61 * MIN);
		assert.deepEqual(r.events, [{ type: "break-ended", round: 2 }]);
		s = r.state;
		assert.equal(s.phase, "work");
		assert.equal(s.round, 2);
		assert.equal(s.endsAt, T0 + 111 * MIN, "the next round starts when the break ended");

		s = skipBreak(advanceFocus(s, T0 + 111 * MIN).state, T0 + 112 * MIN);
		assert.equal(s.round, 3);
		r = advanceFocus(s, T0 + 162 * MIN);
		assert.deepEqual(r.events, [{ type: "done" }]);
		assert.equal(r.state.phase, "done");
		assert.equal(r.state.endsAt, null);
	});

	it("one round: work ends straight in done", () => {
		const s = startFocus({ ...config, rounds: 1 }, T0);
		assert.deepEqual(advanceFocus(s, T0 + 50 * MIN).events, [{ type: "done" }]);
	});

	it("«Hopp over» during a running break also starts the next round", () => {
		const due = advanceFocus(startFocus(config, T0), T0 + 50 * MIN).state;
		const breaking = startBreak(due, T0 + 50 * MIN);
		const next = skipBreak(breaking, T0 + 55 * MIN);
		assert.equal(next.phase, "work");
		assert.equal(next.round, 2);
	});

	it("the finish time assumes every break is taken at once", () => {
		assert.equal(focusFinishAt(config, T0), T0 + (3 * 50 + 2 * 10) * MIN);
	});
});

describe("pause and fortsett", () => {
	it("pausing keeps what was left; resuming continues from there", () => {
		const s = startFocus(config, T0);
		const paused = pauseFocus(s, T0 + 20 * MIN);
		assert.equal(paused.endsAt, null);
		assert.equal(paused.remainingMs, 30 * MIN);
		assert.deepEqual(advanceFocus(paused, T0 + 500 * MIN).events, [], "a paused timer never fires");
		assert.equal(focusRemainingMs(paused, T0 + 500 * MIN), 30 * MIN);
		const resumed = resumeFocus(paused, T0 + 100 * MIN);
		assert.equal(resumed.endsAt, T0 + 130 * MIN);
		assert.deepEqual(advanceFocus(resumed, T0 + 130 * MIN).events, [{ type: "work-ended", round: 1 }]);
	});

	it("pause is a no-op while a break is due or the timer is done", () => {
		const due = advanceFocus(startFocus(config, T0), T0 + 50 * MIN).state;
		assert.equal(pauseFocus(due, T0 + 51 * MIN), due);
	});

	it("progress and the countdown", () => {
		const s = startFocus(config, T0);
		assert.equal(focusProgress(s, T0 + 25 * MIN), 0.5);
		assert.equal(countdownLabel(focusRemainingMs(s, T0 + 31 * MIN + 56_000)), "18:04");
		assert.equal(countdownLabel(65 * MIN), "1:05:00");
	});
});

describe("surviving a reload", () => {
	it("the stored state round-trips through JSON and catches up on what passed", () => {
		const s = startBreak(advanceFocus(startFocus(config, T0, { chatId: "chat_a1", label: "Fag-chat" }), T0 + 50 * MIN).state, T0 + 50 * MIN);
		const stored = JSON.parse(JSON.stringify(s));
		const back = parseFocusState(stored)!;
		assert.deepEqual(back, s);
		// Closed for 50 minutes: the break ended (round 2 began), round 2 is still running.
		const r = advanceFocus(back, T0 + 100 * MIN);
		assert.deepEqual(r.events, [{ type: "break-ended", round: 2 }]);
		assert.equal(r.state.endsAt, T0 + 110 * MIN);
		// …and a later look replays round 2's end too.
		assert.deepEqual(advanceFocus(r.state, T0 + 200 * MIN).events, [{ type: "work-ended", round: 2 }]);
	});

	it("both boundaries in one go when the app was closed through them", () => {
		const breaking = startBreak(advanceFocus(startFocus(config, T0), T0 + 50 * MIN).state, T0 + 50 * MIN);
		const r = advanceFocus(breaking, T0 + 300 * MIN);
		assert.deepEqual(r.events, [{ type: "break-ended", round: 2 }, { type: "work-ended", round: 2 }]);
		assert.equal(r.state.phase, "break-due");
	});

	it("a paused state survives too", () => {
		const paused = pauseFocus(startFocus(config, T0), T0 + 10 * MIN);
		assert.deepEqual(parseFocusState(JSON.parse(JSON.stringify(paused))), paused);
	});

	it("garbage and half states are refused; numbers are clamped", () => {
		assert.equal(parseFocusState(null), null);
		assert.equal(parseFocusState({ phase: "nope", startedAt: 1 }), null);
		assert.equal(parseFocusState({ phase: "work", startedAt: 1, config }), null, "running with no end and no remainder");
		const odd = parseFocusState({ phase: "work", startedAt: 1, endsAt: 5, config: { workMinutes: 9999, breakMinutes: -2, rounds: "4", sound: "yes" }, round: 99 })!;
		assert.deepEqual(odd.config, { workMinutes: 240, breakMinutes: 1, rounds: 4, sound: true });
		assert.equal(odd.round, 4);
		assert.equal(parseFocusState({ phase: "work", startedAt: 1, endsAt: 5, origin: { chatId: "../x", label: "x" } })!.origin, undefined);
	});

	it("a form's strings become a clean config", () => {
		assert.deepEqual(normalizeFocusConfig({ workMinutes: "25", breakMinutes: "5", rounds: "2", sound: false }), { workMinutes: 25, breakMinutes: 5, rounds: 2, sound: false });
		assert.deepEqual(normalizeFocusConfig({ workMinutes: "", breakMinutes: "x" }), { workMinutes: 50, breakMinutes: 10, rounds: 3, sound: true });
	});
});
