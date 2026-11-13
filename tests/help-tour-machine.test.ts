/**
 * The tour engine as pure logic: the state machine, the step text rules,
 * the route resolution, and the spotlight/bubble geometry.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCompleted } from "../components/help/storage.ts";
import {
	initialPhase,
	intersectRect,
	placeBubble,
	resolveStepRoute,
	spotlightRect,
	stepSelector,
	stepText,
	TOUR_IDLE,
	tourReducer,
	type TourEvent,
	type TourState,
} from "../components/help/tour-machine.ts";
import { TOURS } from "../components/help/tours.ts";
import type { Tour } from "../components/help/types.ts";

const DEMO: Tour = {
	id: "demo",
	title: "Demo",
	description: "",
	minutes: 1,
	keywords: [],
	steps: [
		{ id: "a", title: "A", text: "plain" },
		{ id: "b", title: "B", text: "see it", anchor: "add-course", fallback: "it is on Hjem" },
		{ id: "c", title: "C", text: "on the page", route: "/hjelp" },
	],
};
const TABLE = [DEMO];

/** Feed a list of events; returns every transition's state and the completions. */
function play(events: TourEvent[], from: TourState = TOUR_IDLE) {
	let state = from;
	const completed: string[] = [];
	for (const event of events) {
		const transition = tourReducer(state, event, TABLE);
		state = transition.state;
		if (transition.completed) completed.push(transition.completed);
	}
	return { state, completed };
}

describe("tourReducer", () => {
	it("start enters step 0; a text-only step is ready at once", () => {
		assert.deepEqual(play([{ type: "start", tourId: "demo" }]).state, { status: "running", tourId: "demo", index: 0, phase: "fallback" });
	});

	it("an unknown tour changes nothing", () => {
		assert.deepEqual(play([{ type: "start", tourId: "nope" }]).state, TOUR_IDLE);
		const running = play([{ type: "start", tourId: "demo" }]).state;
		assert.deepEqual(play([{ type: "start", tourId: "nope" }], running).state, running);
	});

	it("an anchored step locates first, then anchors when found", () => {
		const located = play([{ type: "start", tourId: "demo" }, { type: "next" }]).state;
		assert.deepEqual(located, { status: "running", tourId: "demo", index: 1, phase: "locating" });
		assert.equal((play([{ type: "found", index: 1 }], located).state as { phase: string }).phase, "anchored");
	});

	it("a missing element falls back instead of blocking", () => {
		const { state } = play([{ type: "start", tourId: "demo" }, { type: "next" }, { type: "missing", index: 1 }]);
		assert.deepEqual(state, { status: "running", tourId: "demo", index: 1, phase: "fallback" });
	});

	it("an anchored element that disappears falls back too", () => {
		const { state } = play([{ type: "start", tourId: "demo" }, { type: "next" }, { type: "found", index: 1 }, { type: "missing", index: 1 }]);
		assert.equal((state as { phase: string }).phase, "fallback");
	});

	it("late answers for a step the learner already left are ignored", () => {
		const onC = play([{ type: "start", tourId: "demo" }, { type: "next" }, { type: "next" }]).state;
		assert.deepEqual(play([{ type: "found", index: 1 }], onC).state, onC);
		assert.deepEqual(play([{ type: "missing", index: 1 }], onC).state, onC);
	});

	it("a route-only step arrives in the centred phase (nothing to point at)", () => {
		const onC = play([{ type: "start", tourId: "demo" }, { type: "next" }, { type: "next" }]).state;
		assert.equal((onC as { phase: string }).phase, "locating");
		assert.equal((play([{ type: "found", index: 2 }], onC).state as { phase: string }).phase, "fallback");
	});

	it("back never leaves the first step; back re-locates the previous one", () => {
		const first = play([{ type: "start", tourId: "demo" }]).state;
		assert.deepEqual(play([{ type: "back" }], first).state, first);
		const { state } = play([{ type: "start", tourId: "demo" }, { type: "next" }, { type: "next" }, { type: "back" }]);
		assert.deepEqual(state, { status: "running", tourId: "demo", index: 1, phase: "locating" });
	});

	it("next on the last step finishes and reports the tour as completed", () => {
		const result = play([{ type: "start", tourId: "demo" }, { type: "next" }, { type: "next" }, { type: "next" }]);
		assert.deepEqual(result.state, TOUR_IDLE);
		assert.deepEqual(result.completed, ["demo"]);
	});

	it("close ends the tour without completing it", () => {
		const result = play([{ type: "start", tourId: "demo" }, { type: "next" }, { type: "close" }]);
		assert.deepEqual(result.state, TOUR_IDLE);
		assert.deepEqual(result.completed, []);
	});

	it("events while idle are no-ops", () => {
		for (const event of [{ type: "next" }, { type: "back" }, { type: "close" }, { type: "found", index: 0 }] as TourEvent[]) {
			assert.deepEqual(play([event]).state, TOUR_IDLE);
		}
	});

	it("starting another tour while one runs switches to it", () => {
		const other: Tour = { ...DEMO, id: "other" };
		const running = tourReducer(TOUR_IDLE, { type: "start", tourId: "demo" }, [DEMO, other]).state;
		const switched = tourReducer(running, { type: "start", tourId: "other" }, [DEMO, other]).state;
		assert.deepEqual(switched, { status: "running", tourId: "other", index: 0, phase: "fallback" });
	});

	it("every shipped tour can be walked to completion with every element missing", () => {
		for (const tour of TOURS) {
			let state = tourReducer(TOUR_IDLE, { type: "start", tourId: tour.id }, TOURS).state;
			let completed: string | undefined;
			for (let guard = 0; guard < 50 && state.status === "running"; guard++) {
				state = tourReducer(state, { type: "missing", index: state.index }, TOURS).state;
				assert.equal(state.status === "running" && state.phase, "fallback");
				const transition = tourReducer(state, { type: "next" }, TOURS);
				state = transition.state;
				completed = transition.completed ?? completed;
			}
			assert.equal(completed, tour.id);
		}
	});
});

describe("step helpers", () => {
	it("initialPhase: only steps with nothing to do skip locating", () => {
		assert.equal(initialPhase(DEMO.steps[0]), "fallback");
		assert.equal(initialPhase(DEMO.steps[1]), "locating");
		assert.equal(initialPhase(DEMO.steps[2]), "locating");
		assert.equal(initialPhase({ id: "x", title: "", text: "", before: { kind: "settings", section: "keys" } }), "locating");
		assert.equal(initialPhase(undefined), "fallback");
	});

	it("stepSelector prefers the contract anchor", () => {
		assert.equal(stepSelector(DEMO.steps[1]!), '[data-tour="add-course"]');
		assert.equal(stepSelector({ id: "x", title: "", text: "", selector: '[data-testid="settings-nav"]' }), '[data-testid="settings-nav"]');
		assert.equal(stepSelector(DEMO.steps[0]!), null);
	});

	it("stepText: fallback wording only when the element (or its page) is missing", () => {
		const anchored = DEMO.steps[1]!;
		assert.equal(stepText(anchored, "anchored"), "see it");
		assert.equal(stepText(anchored, "locating"), "see it");
		assert.equal(stepText(anchored, "fallback"), "it is on Hjem");
		const page = { id: "p", title: "", text: "this is the page", fallback: "every course has a page", route: "/fag/[code]" };
		assert.equal(stepText(page, "fallback"), "this is the page", "reached the page: the normal text");
		assert.equal(stepText(page, "fallback", true), "every course has a page", "no course: the general wording");
		assert.equal(stepText(DEMO.steps[0]!, "fallback", true), "plain", "no fallback text = the normal text");
	});
});

describe("resolveStepRoute", () => {
	it("static routes: navigate unless already there", () => {
		assert.equal(resolveStepRoute(undefined, "/", null), null);
		assert.equal(resolveStepRoute("/", "/", null), null);
		assert.equal(resolveStepRoute("/", "/hjelp", null), "/");
		assert.equal(resolveStepRoute("/hjelp", "/hjelp/", null), null);
	});

	it("course routes: stay on the open course, else the first course, else unresolved", () => {
		assert.equal(resolveStepRoute("/fag/[code]", "/fag/TMA4100", "TTK4100"), null);
		assert.equal(resolveStepRoute("/fag/[code]", "/", "TTK4100"), "/fag/TTK4100");
		assert.equal(resolveStepRoute("/fag/[code]", "/", "ÆØ1"), `/fag/${encodeURIComponent("ÆØ1")}`);
		assert.equal(resolveStepRoute("/fag/[code]", "/", null), "unresolved");
		assert.equal(resolveStepRoute("/fag/[code]", "/fag/", null), "unresolved");
	});
});

describe("geometry", () => {
	const viewport = { width: 1000, height: 700 };
	const bubble = { width: 352, height: 180 };

	function inside(position: { top: number; left: number }) {
		assert.ok(position.top >= 0 && position.left >= 0, JSON.stringify(position));
		assert.ok(position.top + bubble.height <= viewport.height, JSON.stringify(position));
		assert.ok(position.left + bubble.width <= viewport.width, JSON.stringify(position));
	}

	it("no element: centred", () => {
		const position = placeBubble(null, bubble, viewport);
		assert.equal(position.side, "center");
		assert.equal(position.left, (1000 - 352) / 2);
		assert.equal(position.top, (700 - 180) / 2);
	});

	it("prefers below, then above, then the sides", () => {
		assert.equal(placeBubble({ top: 40, left: 400, width: 120, height: 36 }, bubble, viewport).side, "bottom");
		assert.equal(placeBubble({ top: 640, left: 400, width: 120, height: 36 }, bubble, viewport).side, "top");
		// A full-height sidebar: no room above or below, so beside it.
		assert.equal(placeBubble({ top: 0, left: 0, width: 240, height: 700 }, bubble, viewport).side, "right");
		assert.equal(placeBubble({ top: 0, left: 760, width: 240, height: 700 }, bubble, viewport).side, "left");
	});

	it("an element with no room on any side parks the bubble in the bottom-right corner, never on top of its middle", () => {
		const filling = placeBubble({ top: 0, left: 0, width: 1000, height: 700 }, bubble, viewport);
		assert.equal(filling.side, "corner");
		inside(filling);
		assert.ok(filling.left + bubble.width >= viewport.width - 30 && filling.top + bubble.height >= viewport.height - 30, "hugging the corner, with a margin");
		assert.ok(filling.left + bubble.width < viewport.width && filling.top + bubble.height < viewport.height);
		// A section taller than the window (the topic board between the top bar and the start box).
		const tall = placeBubble({ top: 60, left: 280, width: 720, height: 560 }, bubble, viewport);
		assert.equal(tall.side, "corner");
		inside(tall);
		inside(placeBubble({ top: 0, left: 0, width: 360, height: 640 }, bubble, { width: 360, height: 640 }));
	});

	it("the spotlight can be limited to what a scroll container shows", () => {
		const scroller = { top: 60, left: 280, width: 720, height: 560 };
		assert.deepEqual(intersectRect({ top: -400, left: 300, width: 680, height: 2000 }, scroller), { top: 60, left: 300, width: 680, height: 560 });
		assert.deepEqual(intersectRect({ top: 100, left: 320, width: 100, height: 40 }, scroller), { top: 100, left: 320, width: 100, height: 40 });
		assert.equal(intersectRect({ top: 700, left: 300, width: 100, height: 40 }, scroller).height, 0, "scrolled out of sight: nothing to light");
	});

	it("the bubble always stays inside the viewport", () => {
		for (const target of [
			{ top: 10, left: 0, width: 30, height: 30 },
			{ top: 10, left: 980, width: 20, height: 20 },
			{ top: 660, left: 990, width: 10, height: 30 },
			{ top: 300, left: 0, width: 240, height: 40 },
			{ top: -500, left: -500, width: 50, height: 50 },
		]) {
			inside(placeBubble(target, bubble, viewport));
		}
		inside(placeBubble({ top: 10, left: 10, width: 20, height: 20 }, bubble, { width: 360, height: 640 }));
	});

	it("the spotlight pads the element and is clipped to the viewport", () => {
		assert.deepEqual(spotlightRect({ top: 100, left: 200, width: 50, height: 20 }, viewport), { top: 94, left: 194, width: 62, height: 32 });
		assert.deepEqual(spotlightRect({ top: -20, left: -20, width: 2000, height: 2000 }, viewport), { top: 0, left: 0, width: 1000, height: 700 });
		const offscreen = spotlightRect({ top: 900, left: 100, width: 50, height: 20 }, viewport);
		assert.equal(offscreen.height, 0);
	});
});

describe("completed-tour storage", () => {
	it("tolerates anything that is not a string list", () => {
		assert.deepEqual(parseCompleted(null), []);
		assert.deepEqual(parseCompleted("not json"), []);
		assert.deepEqual(parseCompleted('{"a":1}'), []);
		assert.deepEqual(parseCompleted('["kom-i-gang", 3, null, "eksamensmodus"]'), ["kom-i-gang", "eksamensmodus"]);
	});
});
