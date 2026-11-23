/**
 * Empty-graph chrome pins (empty-graph chrome wave, owner 2026-09-25):
 * Import Notes renders ALWAYS — the one action that works on an empty
 * graph, the entry point itself; search + settings render only when the
 * snapshot has nodes (dead controls are lies — the honesty principle).
 * GraphChromeRow is the pure seam (the DeleteNodeBody pattern): SSR of
 * both states pins the ruling. Fetches don't run under renderToStaticMarkup
 * (effects never fire), so these pins exercise the component directly.
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GraphChromeRow, MapLegend, UNCOURSED, courseColorVar, isInCourse } from "../components/graph-view.tsx";
import type { GraphRenderSettings } from "../components/graph-canvas.ts";

/** Ref doubles — the SSR harness never attaches them. */
const ref = { current: null };

const PROPS = {
	query: "",
	onQuery: () => {},
	noMatch: false,
	importing: false,
	searchInputRef: ref,
	onImportFiles: () => {},
	settings: {} as GraphRenderSettings,
	changeSettings: () => {},
	onOpenChains: () => {},
};

describe("GraphChromeRow — the empty-graph ruling (owner, 2026-09-25)", () => {
	it("EMPTY graph: Import and source inventory render; canvas search/settings stay absent", () => {
		const html = renderToStaticMarkup(createElement(GraphChromeRow, { ...PROPS, isEmpty: true }));
		assert.ok(html.includes('data-testid="import-notes"'));
		assert.ok(html.includes("Importer notater…"));
		assert.ok(!html.includes("Søk i noder…"), "search is a lie on an empty graph");
		// the settings gear is the lucide-settings svg (tooltip wave: its old
		// native title is gone — the styled tooltip carries the label now)
		assert.ok(!html.includes("lucide-settings"), "settings is a lie on an empty graph");
		assert.ok(html.includes('data-testid="open-chain-table"'), "source inventory includes chats/files without graph nodes");
		assert.equal(html.split("graph-chrome-fade-in").length - 1, 1, "only the inventory button has the appearance animation");
	});

	it("POPULATED graph: all four render, the gated trio carries the fade", () => {
		const html = renderToStaticMarkup(createElement(GraphChromeRow, { ...PROPS, isEmpty: false }));
		assert.ok(html.includes('data-testid="import-notes"'));
		assert.ok(html.includes("Søk i noder…"));
		assert.ok(html.includes("lucide-settings"), "the settings gear renders");
		assert.ok(html.includes('data-testid="open-chain-table"'), "the chains entry renders");
		// the appear-once fade rides exactly the three gated controls, never Import Notes
		assert.equal(html.split("graph-chrome-fade-in").length - 1, 3, "three fade carriers: search + chains + settings");
	});

	it("the no-match note renders only when the wrapper says so (its truth stays upstream)", () => {
		const html = renderToStaticMarkup(
			createElement(GraphChromeRow, { ...PROPS, isEmpty: false, query: "zzz", noMatch: true }),
		);
		assert.ok(html.includes("Ingen noder passer."));
		const quiet = renderToStaticMarkup(
			createElement(GraphChromeRow, { ...PROPS, isEmpty: false, query: "zzz", noMatch: false }),
		);
		assert.ok(!quiet.includes("No matching nodes."));
	});

	it("the source table's entry is named «Kilder» (fase 8)", () => {
		const html = renderToStaticMarkup(createElement(GraphChromeRow, { ...PROPS, isEmpty: false }));
		assert.ok(html.includes("Kilder"));
		assert.ok(!html.includes("Kjeder"));
	});
});

describe("the knowledge map's course chrome (fase 8)", () => {
	const courses = [
		{ code: "TMA4400", name: "Matematikk 1" },
		{ code: "TTK4100", name: "Kybernetikk, introduksjon" },
	];

	it("the course filter lists every course, plus «Uten fag» only when it has nodes", () => {
		const html = renderToStaticMarkup(
			createElement(GraphChromeRow, { ...PROPS, isEmpty: false, courses, hasUncoursed: true, courseFilter: "TTK4100" }),
		);
		assert.ok(html.includes('data-testid="map-course-filter"'));
		for (const label of ["Alle fag", "TMA4400", "TTK4100", "Uten fag"]) assert.ok(html.includes(`>${label}</option>`), label);
		assert.ok(html.includes('value="TTK4100" selected=""'), "the current choice is selected");
		const without = renderToStaticMarkup(createElement(GraphChromeRow, { ...PROPS, isEmpty: false, courses, hasUncoursed: false }));
		assert.ok(!without.includes(">Uten fag</option>"));
	});

	it("no courses, or an empty graph: no filter", () => {
		assert.ok(!renderToStaticMarkup(createElement(GraphChromeRow, { ...PROPS, isEmpty: false })).includes("map-course-filter"));
		assert.ok(!renderToStaticMarkup(createElement(GraphChromeRow, { ...PROPS, isEmpty: true, courses })).includes("map-course-filter"));
	});

	it("the legend: one swatch per course in the canvas's own token, «Uten fag», and the arrow line", () => {
		const html = renderToStaticMarkup(createElement(MapLegend, { courses, hasUncoursed: true }));
		assert.ok(html.includes("var(--lh-map-1)") && html.includes("var(--lh-map-2)") && html.includes("var(--lh-map-none)"));
		assert.ok(html.includes("TMA4400") && html.includes("Matematikk 1") && html.includes("Uten fag"));
		assert.ok(html.includes("En strek betyr: dette følger av det"));
	});

	it("courseColorVar cycles the eight tokens; isInCourse reads the filter", () => {
		const many = Array.from({ length: 9 }, (_, i) => ({ code: `C${i}` }));
		assert.equal(courseColorVar("C0", many), "--lh-map-1");
		assert.equal(courseColorVar("C8", many), "--lh-map-1", "the ninth course wraps around");
		assert.equal(courseColorVar(null, many), "--lh-map-none");
		assert.equal(isInCourse("TTK4100", ""), true);
		assert.equal(isInCourse(undefined, ""), true, "no filter shows nodes outside every cluster");
		assert.equal(isInCourse(undefined, "TTK4100"), false);
		assert.equal(isInCourse("TTK4100", "TTK4100"), true);
		assert.equal(isInCourse("TMA4400", "TTK4100"), false);
		assert.equal(isInCourse(null, UNCOURSED), true);
		assert.equal(isInCourse("TTK4100", UNCOURSED), false);
	});
});