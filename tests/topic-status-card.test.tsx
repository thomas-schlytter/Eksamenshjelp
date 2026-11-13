/**
 * The agent's `topic_status` call in the transcript: one calm line with the
 * status dot, never the raw arguments; and its live activity label.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { artifactRenderers } from "../components/artifacts/index.ts";
import { TopicStatusCard } from "../components/artifacts/topic-status-card.tsx";
import { toolActivityLabel } from "../src/core/pending.ts";

describe("topic_status in the transcript", () => {
	it("is registered and has a Norwegian activity label", () => {
		assert.equal(artifactRenderers.topic_status, TopicStatusCard);
		assert.equal(toolActivityLabel("topic_status"), "Oppdaterer temastatus…");
	});

	it("renders «Tema oppdatert: <tittel> → <status>» with the status dot and the note, no JSON", () => {
		const html = renderToStaticMarkup(<TopicStatusCard part={{
			type: "tool-topic_status", state: "output-available", toolCallId: "t1",
			input: { topicId: "pid-regulator", status: "green", note: "Løste to oppgaver uten hjelp." },
			output: { ok: true, topicId: "pid-regulator", status: "green", title: "PID-regulator" },
		}} />);
		assert.match(html, /Tema oppdatert: <span[^>]*>PID-regulator<\/span> → Kan dette/);
		assert.ok(html.includes('data-status="green"'), "the colour dot");
		assert.match(html, /Løste to oppgaver uten hjelp\./);
		assert.ok(!html.includes("topicId") && !html.includes("{"), "never the raw arguments");
	});

	it("falls back to a readable id for older results without a title", () => {
		const html = renderToStaticMarkup(<TopicStatusCard part={{
			state: "output-available", input: { topicId: "pid-regulator", status: "red", note: "" }, output: { ok: true, topicId: "pid-regulator", status: "red" },
		}} />);
		assert.match(html, /Tema oppdatert: <span[^>]*>Pid regulator<\/span> → Kan ikke ennå/);
	});

	it("renders nothing for a refused or unfinished call", () => {
		for (const part of [
			{ state: "output-error", errorText: "Invalid tool input", input: { topicId: "x", status: "green", note: "n" } },
			{ state: "input-available", input: { topicId: "x", status: "green", note: "n" } },
			{ state: "output-available", input: { topicId: "x", status: "blue", note: "n" }, output: { ok: true } },
		]) assert.equal(renderToStaticMarkup(<TopicStatusCard part={part} />), "");
	});
});
