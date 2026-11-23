/** The minimal home's KnowledgeSummary — the quiet centered summary of
 * the knowledge base (owner, 2026-10-06: "very quiet, very minimal").
 * Pure body: props in, markup out. Own-line law (same day refinement):
 * every count on its own row, NO dot separators, blocks parted by an
 * empty line, imported notes as a COUNT — never the file list. */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, it } from "node:test";
import { KnowledgeSummary } from "../components/minimal-home.tsx";

function render(props: Partial<Parameters<typeof KnowledgeSummary>[0]> = {}) {
	return renderToStaticMarkup(
		React.createElement(KnowledgeSummary, {
			propositions: 12,
			chains: 5,
			importedNotes: 4,
			...props,
		}),
	);
}

describe("KnowledgeSummary — the quiet home summary (2026-10-06)", () => {
	it("every count on its OWN line — no dot separators (owner refinement, same day)", () => {
		const html = render();
		for (const line of ["12 påstander", "5 resonnementskjeder", "4 importerte notater"]) {
			const i = html.indexOf(line);
			assert.ok(i !== -1, `${line} renders`);
			// own-line: the count is its own text node — the char after the
			// label is a tag boundary (</p>), never " · "
			const after = html.slice(i + line.length, i + line.length + 2);
			assert.ok(after.startsWith("<"), `${line} ends its own element, not a dot-joined run`);
		}
		assert.ok(!html.includes(" · "), "no dot separators anywhere");
	});

	it("the graph counts and the notes part with an empty line; no session counts by kind (fase 7b)", () => {
		const html = render();
		const graphBlock = html.indexOf("12 påstander");
		const notesBlock = html.indexOf("4 importerte notater");
		assert.ok(graphBlock !== -1 && notesBlock > graphBlock);
		// the parting is a dedicated spacer element (h-4), not a paragraph
		assert.ok(html.includes('class="h-4"'), "one empty line between blocks");
		assert.ok(!/læringsøkt|øvingsøkt/.test(html), "the læring/øving split is gone");
	});

	it("singularizes: one of each reads as single, not '1 sessions'", () => {
		const html = render({ propositions: 1, chains: 1, importedNotes: 1 });
		for (const line of ["1 påstand", "1 resonnementskjede", "1 importert notat"]) {
			// singular exactly: the label ends its element, no plural suffix
			assert.ok(html.includes(`${line}<`), `${line} is singular`);
		}
	});

	it("imported notes are a COUNT — never the file list (owner: 'the number of imported notes')", () => {
		const html = render({ importedNotes: 7 });
		assert.ok(html.includes("7 importerte notater"));
		assert.ok(!html.includes(".md"), "no file paths render");
		assert.ok(!html.includes("truncate"), "no truncating source rows");
	});

	it("the empty knowledge base says so, quietly — import is the entry point", () => {
		const html = render({ propositions: 0, chains: 0, importedNotes: 0 });
		assert.ok(html.includes("Ingenting her ennå"));
		assert.ok(html.includes("Importer notater"), "the hint names the entry point");
	});

	it("non-empty shows no empty-state hint", () => {
		const html = render();
		assert.ok(!html.includes("Ingenting her ennå"));
	});
});
