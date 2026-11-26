/**
 * The tiny-demo incident (2026-11): a demo whose SVG was sized from the
 * window height (`height: calc(100vh - 50px)`) shrank every time the
 * lesson's auto-sized iframe followed it, down to the 80 px floor — a
 * sliver of figure in a big card. Pinned: the headless layout check names
 * the problem to the builder, the builder's run_demo reports it as a
 * failure to fix, and the card's bridge reducer breaks the shrink loop for
 * demos already in transcripts.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { windowTrackingProblem, type DemoRunResult, type HeadlessApi } from "../src/agent/subagents/headless.ts";
import { createDemoBuilderTools } from "../src/agent/subagents/demo-builder.ts";
import { INITIAL_DEMO_BRIDGE_STATE, reduceDemoBridgeState, type DemoBridgeState } from "../components/artifacts/demo-card.tsx";

describe("the headless layout check", () => {
	it("a page whose height follows the window is a layout problem; a stable one is not", () => {
		assert.match(windowTrackingProblem([560, 960]) ?? "", /follows the window height: 560 px .* 960 px/);
		assert.equal(windowTrackingProblem([700, 700]), null);
		assert.equal(windowTrackingProblem([700, 712]), null, "small drift (scrollbars, rounding) is fine");
		assert.equal(windowTrackingProblem([Number.NaN, 900]), null, "an unmeasurable page is not flagged");
	});

	it("run_demo reports the layout problem as a FAILED run the builder must fix", async () => {
		const run: DemoRunResult = {
			consoleErrors: [], pageErrors: [], failedRequests: [], ok: false,
			layoutProblems: [windowTrackingProblem([560, 960])!],
		};
		const headless = { unavailableReason: () => null, runDemo: async () => run } as unknown as HeadlessApi;
		const state = { html: "<!doctype html><svg style=\"height:100vh\"></svg>", testedHtml: null, lastResult: null };
		const tools = createDemoBuilderTools(state, headless);
		const out = await tools.run_demo!.execute!("r1", {});
		const text = (out.content[0] as { text: string }).text;
		assert.match(text, /^FAILED: a layout problem\./);
		assert.match(text, /LAYOUT:\n- The page height follows the window height/);
		assert.match(text, /Fix the document/);
	});
});

describe("the demo card's shrink-loop breaker", () => {
	const resize = (state: DemoBridgeState, height: number) => reduceDemoBridgeState(state, { type: "demo-resize", height });

	it("a run of small shrinks (the vh loop) freezes the frame at the height before the run", () => {
		let state = resize(INITIAL_DEMO_BRIDGE_STATE, 350);
		for (let h = 340; h >= 300; h -= 10) state = resize(state, h);
		assert.equal(state.frozen, true);
		assert.equal(state.height, 350, "frozen at the height the loop started from, not the 80 px floor");
		assert.equal(resize(state, 120).height, 350, "frozen: later reports are ignored");
	});

	it("ordinary resizes, one real collapse, and growth never freeze", () => {
		let state = resize(INITIAL_DEMO_BRIDGE_STATE, 600);
		state = resize(state, 590);
		state = resize(state, 900);
		state = resize(state, 300);
		for (let h = 310; h <= 400; h += 10) state = resize(state, h);
		assert.equal(state.frozen, undefined);
		assert.equal(state.height, 400);
	});
});
