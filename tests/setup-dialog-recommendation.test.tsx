import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { SetupDialog, recommendedPrefill } from "../components/setup-dialog.tsx";
import { prettyModel } from "../components/usage-format.ts";
import type { ModelCatalogEntry } from "../src/core/contracts/models.ts";
import type { SubscriptionRecommendation } from "../src/core/model-recommendation.ts";

// The setup-dialog-interaction harness: real React against an isolated DOM,
// fetch wholly stubbed. Only the explicit Save test may write (to the stub).
const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	HTMLInputElement: dom.window.HTMLInputElement,
	HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
	requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
	cancelAnimationFrame: (id: number) => clearTimeout(id),
});
Object.assign(dom.window, { innerWidth: 1280, innerHeight: 800 });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};

const originalFetch = globalThis.fetch;
const claude = (id: string): ModelCatalogEntry => ({
	id, name: `Claude ${id}`, provider: "claude-code", reasoning: true, input: ["text", "image"],
	supportedLevels: ["low", "medium", "high", "xhigh", "max"], cost: null, contextWindow: null, maxTokens: null,
});
const MODELS = [claude("opus"), claude("sonnet"), claude("haiku")];
const MAX: SubscriptionRecommendation = {
	subscription: "claude",
	tier: "max",
	slots: {
		strong: { provider: "claude-code", id: "opus", thinkingLevel: "high" },
		cheap: { provider: "claude-code", id: "haiku", thinkingLevel: "low" },
		vision: { provider: "claude-code", id: "sonnet", thinkingLevel: "medium" },
	},
};
type Slots = Record<"strong" | "cheap" | "vision", { model: { provider: string; id: string }; thinkingLevel?: string } | null>;
const EMPTY: Slots = { strong: null, cheap: null, vision: null };

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let asked: string[] = [];
let writes: unknown[] = [];

async function mount({ slots = EMPTY, recommendation = MAX as SubscriptionRecommendation | null, saveLabel }: { slots?: Slots; recommendation?: SubscriptionRecommendation | null; saveLabel?: string } = {}) {
	asked = [];
	writes = [];
	globalThis.fetch = async (input, init) => {
		const path = new URL(String(input), "http://localhost").pathname;
		asked.push(path);
		if (path === "/api/keys") return Response.json({ providers: [], keys: [] });
		if (path === "/api/models") return Response.json({ providers: [{ id: "claude-code", envVar: "", keyPresent: true }], models: MODELS, slots });
		if (path === "/api/subscription-tier") return Response.json({ claude: recommendation?.tier ?? "unknown", chatgpt: "unknown", recommendation });
		if (path === "/api/settings/models" && init?.method === "PUT") { writes.push(JSON.parse(String(init.body))); return Response.json({ settings: {} }); }
		throw new Error(`Unexpected request ${path}`);
	};
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	await act(async () => { root!.render(<SetupDialog open onClose={() => {}} onDone={() => {}} saveLabel={saveLabel} />); });
	// Catalog, then the recommendation: let both round-trips settle.
	for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function text(testid: string): string {
	const node = document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
	assert.ok(node, `expected ${testid}`);
	return node.textContent ?? "";
}

afterEach(async () => {
	await act(async () => { root?.unmount(); });
	root = null;
	host?.remove();
	host = null;
	globalThis.fetch = originalFetch;
});

describe("setup dialog: recommended models for the subscription", () => {
	it("opens with the recommendation picked and says why", async () => {
		await mount();
		assert.ok(asked.includes("/api/subscription-tier"));
		assert.equal(text("setup-trigger-strong").replace("▾", ""), prettyModel("opus"));
		assert.equal(text("setup-trigger-cheap").replace("▾", ""), prettyModel("haiku"));
		assert.equal(text("setup-trigger-vision").replace("▾", ""), prettyModel("sonnet"));
		assert.equal(text("setup-thinking-strong").replace("▾", ""), "high");
		assert.equal(text("setup-thinking-cheap").replace("▾", ""), "low");
		assert.equal(text("setup-recommended-note"), "Vi har valgt modeller som passer abonnementet ditt (Claude Max). Du kan endre dem senere under Innstillinger.");
		assert.equal(document.querySelector('[data-testid^="setup-needed-"]'), null);
		const save = document.querySelector<HTMLButtonElement>('[data-testid="setup-save"]');
		assert.equal(save?.disabled, false);
		assert.equal(save?.textContent, "Lagre modeller");
		assert.deepEqual(writes, [], "a recommendation is never saved by itself");
	});

	it("the innføring's button says «Fortsett» and saves the recommendation", async () => {
		await mount({ saveLabel: "Fortsett" });
		const save = document.querySelector<HTMLButtonElement>('[data-testid="setup-save"]')!;
		assert.equal(save.textContent, "Fortsett");
		await act(async () => { save.click(); });
		assert.deepEqual(writes, [{
			strong: { model: { provider: "claude-code", id: "opus" }, thinkingLevel: "high" },
			cheap: { model: { provider: "claude-code", id: "haiku" }, thinkingLevel: "low" },
			vision: { model: { provider: "claude-code", id: "sonnet" }, thinkingLevel: "medium" },
		}]);
	});

	it("never replaces a saved pin: only the empty slots are filled", async () => {
		await mount({ slots: { ...EMPTY, strong: { model: { provider: "claude-code", id: "sonnet" }, thinkingLevel: "low" } } });
		assert.equal(text("setup-trigger-strong").replace("▾", ""), prettyModel("sonnet"));
		assert.equal(text("setup-thinking-strong").replace("▾", ""), "low");
		assert.equal(text("setup-trigger-cheap").replace("▾", ""), prettyModel("haiku"));
		assert.ok(document.querySelector('[data-testid="setup-recommended-note"]'));
	});

	it("all slots saved: the saved models stay and no note shows", async () => {
		// (The shared catalog cache may still hold the previous test's empty
		// slots for the first frame, so a request can go out; it changes nothing.)
		const pin = (id: string) => ({ model: { provider: "claude-code", id } });
		await mount({ slots: { strong: pin("haiku"), cheap: pin("haiku"), vision: pin("haiku") } });
		for (const slot of ["strong", "cheap", "vision"]) assert.equal(text(`setup-trigger-${slot}`).replace("▾", ""), prettyModel("haiku"));
		assert.equal(document.querySelector('[data-testid="setup-recommended-note"]'), null);
	});

	it("no recommendation: the pickers open empty as before", async () => {
		await mount({ recommendation: null });
		assert.equal(text("setup-trigger-strong").replace("▾", ""), "Velg modell…");
		assert.ok(document.querySelector('[data-testid="setup-needed-strong"]'));
		assert.equal(document.querySelector('[data-testid="setup-recommended-note"]'), null);
	});
});

describe("recommendedPrefill", () => {
	it("skips saved slots and models missing from the catalog", () => {
		const { picked, levels } = recommendedPrefill([claude("haiku")], { ...EMPTY, cheap: { model: { provider: "x", id: "y" } } } as never, MAX);
		assert.deepEqual(Object.keys(picked), []);
		assert.deepEqual(levels, {});
		const full = recommendedPrefill(MODELS, EMPTY as never, MAX);
		assert.deepEqual(Object.fromEntries(Object.entries(full.picked).map(([slot, m]) => [slot, m!.id])), { strong: "opus", cheap: "haiku", vision: "sonnet" });
		assert.deepEqual(full.levels, { strong: "high", cheap: "low", vision: "medium" });
	});
});
