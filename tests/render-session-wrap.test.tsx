/**
 * «Oppsummering» — SSR render pins for the top-bar chip and the
 * «Økt avsluttet» divider: the labels per state, the score on the
 * divider, the invitation to start a new økt, and the review door.
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { SessionWrapChip, SessionWrapDivider } from "../components/session-wrap.tsx";

const wrap = {
	id: "w",
	createdAt: "2026-11-22T10:00:00.000Z",
	completedAt: "2026-11-22T10:10:00.000Z",
	model: "faux:m",
	coversThroughId: "x",
	summary: ["Poler"],
	questions: Array.from({ length: 10 }, (_, i) => ({ question: `q${i}`, options: ["a", "b", "c", "d"], correctIndex: 0, explanation: "e" })),
	answers: [0, 0, 0, 0, 0, 0, 0, 0, 1, null],
};

describe("the Oppsummering chip", () => {
	it("reads Oppsummering, or Fortsett quizen while a quiz waits", () => {
		assert.match(renderToStaticMarkup(<SessionWrapChip state="ready" onClick={() => {}} />), /Oppsummering/);
		assert.match(renderToStaticMarkup(<SessionWrapChip state="resume" onClick={() => {}} />), /Fortsett quizen/);
	});
	it("is marked disabled while the chat is busy or empty", () => {
		assert.match(renderToStaticMarkup(<SessionWrapChip state="busy" onClick={() => {}} />), /aria-disabled="true"/);
		assert.match(renderToStaticMarkup(<SessionWrapChip state="empty" onClick={() => {}} />), /aria-disabled="true"/);
	});
});

describe("the Økt avsluttet divider", () => {
	it("shows the score, the new-økt line and the review door", () => {
		const html = renderToStaticMarkup(<SessionWrapDivider data={wrap} onOpen={() => {}} />);
		assert.match(html, /Økt avsluttet · 8\/10 riktige/);
		assert.match(html, /Skriv i chatten for å starte en ny økt\./);
		assert.match(html, /Se oppsummering/);
	});
	it("renders nothing for an unreadable payload", () => {
		assert.equal(renderToStaticMarkup(<SessionWrapDivider data={{ nope: true }} onOpen={() => {}} />), "");
	});
});
