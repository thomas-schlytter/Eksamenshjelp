/**
 * SSR pins — abort-turn-dialog (ESC-abort guard, owner 2026-10-02):
 * the confirm popup EVERYWHERE ruling. AbortTurnBody is the pure seam
 * (the DeleteNodeBody pattern); the wrapper owns effects + portal.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AbortTurnBody } from "@/components/abort-turn-dialog";

describe("AbortTurnBody", () => {
	it("turn mode: names the turn, the partial-stays promise, Stopp", () => {
		const html = renderToStaticMarkup(
			<AbortTurnBody mode="turn" onClose={() => {}} onConfirm={() => {}} />,
		);
		assert.ok(html.includes('data-testid="abort-turn-dialog"'));
		assert.match(html, /Stoppe svaret\?/);
		assert.match(html, /Det agenten har skrevet så langt, blir stående i økta\./);
		assert.match(html, />\s*Avbryt\s*</, "the cancel button");
		assert.match(html, />\s*Stopp svaret\s*</, "the confirm never shares the cancel's word");
	});

	it("question mode: names the dismissal and points at the two gentler ways out", () => {
		const html = renderToStaticMarkup(
			<AbortTurnBody mode="question" onClose={() => {}} onConfirm={() => {}} />,
		);
		assert.match(html, /Lukke spørsmålet\?/);
		// What Esc does, and how it differs from the dock's two buttons (2026-11).
		assert.match(html, /lukkes uten svar/);
		assert.match(html, /«Hopp over»/);
		assert.match(html, /«Spør agenten»/);
		assert.match(html, />\s*Lukk spørsmålet\s*</);
		// the abort copy must not leak into the dismissal mode
		assert.ok(!html.includes("Stoppe svaret"));
	});

	it("the confirm action is the destructive pair, never the cancel", () => {
		const html = renderToStaticMarkup(
			<AbortTurnBody mode="turn" onClose={() => {}} onConfirm={() => {}} />,
		);
		const confirmAt = html.indexOf('data-testid="abort-turn-confirm"');
		const cancelAt = html.indexOf('data-testid="abort-turn-cancel"');
		assert.ok(confirmAt > -1 && cancelAt > -1);
		const confirmBtn = html.slice(confirmAt, html.indexOf("</button>", confirmAt));
		assert.match(confirmBtn, /destructive/);
		const cancelBtn = html.slice(cancelAt, html.indexOf("</button>", cancelAt));
		assert.ok(!cancelBtn.includes("destructive"));
	});
});
