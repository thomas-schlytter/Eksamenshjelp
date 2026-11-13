/**
 * The search palette's instant shell: keys typed right after the search
 * chord, before the lazy palette has loaded, land in a real field and carry
 * over as the palette's starting query.
 */
import React, { act, Suspense } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
	IS_REACT_ACT_ENVIRONMENT: true,
});

// React only wires `input` events when the document claims to support them.
Object.assign(dom.document, { oninput: null });
// linkedom has no focus model: the smallest shim the shell needs.
let active: unknown = null;
Object.defineProperty(dom.document, "activeElement", { get: () => active, configurable: true });
Object.assign(dom.window.HTMLElement.prototype, {
	focus(this: unknown) { active = this; },
	select() {},
});

// react-dom decides at import time whether a DOM (and `input` events)
// exists, so it loads after the globals above are in place.
const { createRoot } = await import("react-dom/client");
const { PaletteShell } = await import("../components/help/palette-shell.tsx");

function setValue(input: HTMLInputElement, value: string) {
	// React tracks the value through the element's own setter.
	Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
	input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

test("the shell shows a focused field at once and reports what is typed", async () => {
	const opener = document.createElement("button"); document.body.append(opener); opener.focus();
	const host = document.createElement("div"); document.body.append(host);
	const root = createRoot(host);
	const typed: string[] = []; let closed = 0;
	try {
		await act(async () => root.render(<PaletteShell initialQuery="" onType={(q) => typed.push(q)} onClose={() => { closed++; }} />));
		const input = document.querySelector<HTMLInputElement>('[data-testid="search-palette-input"]')!;
		assert.ok(input, "the field exists before any result code has loaded");
		assert.equal(document.activeElement, input, "and it has focus, so keys go nowhere else");
		assert.ok(document.querySelector('[data-testid="search-palette-shell"][aria-busy="true"]'));
		await act(async () => setValue(input, "tem"));
		await act(async () => setValue(input, "temaer"));
		assert.deepEqual(typed, ["tem", "temaer"]);
		assert.equal(input.value, "temaer");
		// Esc closes through the document-level (capture) listener. linkedom has
		// no capture phase, so the event is dispatched at the document itself.
		await act(async () => {
			const event = new window.Event("keydown", { bubbles: true, cancelable: true });
			Object.assign(event, { key: "Escape" });
			document.dispatchEvent(event);
			assert.equal(event.defaultPrevented, true);
		});
		assert.equal(closed, 1);
	} finally {
		await act(async () => root.unmount());
		assert.equal(document.activeElement, opener, "focus goes back to where it came from");
		host.remove(); opener.remove();
	}
});

test("as a Suspense fallback, typed-ahead text becomes the lazy palette's starting query", async () => {
	const host = document.createElement("div"); document.body.append(host);
	const root = createRoot(host);
	let resolve!: (module: { default: (props: { initialQuery: string; keepCaret: boolean }) => React.ReactElement }) => void;
	const Lazy = React.lazy(() => new Promise<{ default: (props: { initialQuery: string; keepCaret: boolean }) => React.ReactElement }>((r) => { resolve = r; }));
	function Harness() {
		const [typed, setTyped] = React.useState<string | null>(null);
		return (
			<Suspense fallback={<PaletteShell initialQuery="" onType={setTyped} onClose={() => {}} />}>
				<Lazy initialQuery={typed ?? ""} keepCaret={typed !== null} />
			</Suspense>
		);
	}
	try {
		await act(async () => root.render(<Harness />));
		const input = document.querySelector<HTMLInputElement>('[data-testid="search-palette-input"]')!;
		await act(async () => setValue(input, "eksamen"));
		await act(async () => {
			resolve({ default: ({ initialQuery, keepCaret }) => <output data-testid="real-palette" data-keep-caret={String(keepCaret)}>{initialQuery}</output> });
		});
		const real = document.querySelector('[data-testid="real-palette"]')!;
		assert.equal(real.textContent, "eksamen", "nothing typed during the load was lost");
		assert.equal(real.getAttribute("data-keep-caret"), "true");
		assert.equal(document.querySelector('[data-testid="search-palette-shell"]'), null, "the shell is gone once the palette is in");
	} finally { await act(async () => root.unmount()); host.remove(); }
});
