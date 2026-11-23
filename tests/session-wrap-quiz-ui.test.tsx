/**
 * «Avslutt økt» quiz (owner, 2026-11-23): an option click or 1-4 / A-D only
 * SELECTS (and can change); «Send svar» or Enter sends. Driven in a
 * linkedom DOM through the real QuestionBody.
 */
import React, { act, useState } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";

const dom = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
dom.window.HTMLElement.prototype.focus = function () {};

const { QuestionBody } = await import("../components/session-wrap.tsx");

const wrapBase = {
	questions: [
		{ question: "Hva er en pol?", options: ["Rot i nevneren", "Rot i telleren", "Et nullpunkt", "En forsterkning"], correctIndex: 0, explanation: "Polene er røttene i nevneren." },
		{ question: "Neste", options: ["a", "b", "c", "d"], correctIndex: 1, explanation: "Fordi." },
	],
};

let root: Root | undefined;
let host: HTMLDivElement;
let sent: number[] = [];
let nexts = 0;

function Harness() {
	const [answers, setAnswers] = useState<(number | null)[]>([null, null]);
	return (
		<QuestionBody
			index={0}
			wrap={{ ...wrapBase, answers }}
			onAnswer={(choice) => {
				sent.push(choice);
				setAnswers([choice, null]);
			}}
			onNext={() => void nexts++}
		/>
	);
}

async function mount() {
	sent = [];
	nexts = 0;
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	await act(async () => {
		root!.render(<Harness />);
	});
}
afterEach(async () => {
	await act(async () => {
		root?.unmount();
	});
	root = undefined;
	host?.remove();
});

const option = (i: number) => document.querySelector<HTMLElement>(`[data-testid="session-wrap-option-${i}"]`)!;
const submit = () => document.querySelector<HTMLButtonElement>('[data-testid="session-wrap-submit"]');
const feedback = () => document.querySelector('[data-testid="session-wrap-feedback"]');
async function click(el: Element) {
	await act(async () => {
		el.dispatchEvent(new dom.window.Event("click", { bubbles: true, cancelable: true }));
	});
}
async function key(k: string) {
	const event = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "key", { value: k });
	await act(async () => {
		document.body.dispatchEvent(event);
	});
	return event;
}

it("a click only selects; the selection can change; Send svar sends it", async () => {
	await mount();
	assert.equal(submit()!.disabled, true, "nothing to send yet");
	await click(option(1));
	assert.deepEqual(sent, [], "a click is not an answer");
	assert.equal(option(1).getAttribute("aria-checked"), "true");
	assert.equal(feedback(), null);
	await click(option(2));
	assert.equal(option(2).getAttribute("aria-checked"), "true");
	assert.equal(option(1).getAttribute("aria-checked"), "false");
	assert.equal(submit()!.disabled, false);
	await click(submit()!);
	assert.deepEqual(sent, [2]);
	assert.ok(feedback(), "feedback after sending");
	assert.equal(submit(), null, "Send svar gives way to Neste");
	assert.match(feedback()!.textContent ?? "", /Ikke helt\. Riktig svar er A\./);
});

it("1-4 / A-D select, Enter sends, then Enter moves on", async () => {
	await mount();
	const early = await key("Enter");
	assert.equal(early.defaultPrevented, false, "Enter with nothing selected does nothing");
	await key("3");
	assert.equal(option(2).getAttribute("aria-checked"), "true");
	await key("a");
	assert.equal(option(0).getAttribute("aria-checked"), "true");
	assert.deepEqual(sent, [], "keys only select");
	const send = await key("Enter");
	assert.equal(send.defaultPrevented, true);
	assert.deepEqual(sent, [0]);
	assert.match(feedback()!.textContent ?? "", /Riktig!/);
	await key("2");
	assert.deepEqual(sent, [0], "the answer is locked once sent");
	await key("Enter");
	assert.equal(nexts, 1);
});
