/**
 * Figures that draw outside their own viewBox (owner, 2026-11-26: labels cut
 * off on the left). fitSvgViewBox grows the viewBox to the measured content;
 * linkedom has no layout, so getBBox is stubbed here — the real measurement
 * runs in the browser.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { fitSvgViewBox } from "../components/question-figure.tsx";

function fakeDocument(bbox: { x: number; y: number; width: number; height: number } | null) {
	const { document, DOMParser } = parseHTML("<!doctype html><html><body></body></html>");
	// linkedom has no XMLSerializer; its nodes serialize with toString().
	class XMLSerializer { serializeToString(node: Node) { return String(node); } }
	Object.assign(globalThis, { DOMParser, XMLSerializer });
	const importNode = document.importNode.bind(document);
	document.importNode = ((node: Node, deep?: boolean) => {
		const copy = importNode(node, deep) as unknown as Record<string, unknown>;
		const vb = String((node as Element).getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
		copy.viewBox = { baseVal: { x: vb[0], y: vb[1], width: vb[2], height: vb[3] } };
		if (bbox) copy.getBBox = () => bbox;
		return copy;
	}) as typeof document.importNode;
	return document as unknown as Document;
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="400" height="200"><text x="30" y="75" text-anchor="end">R1 = 3 kΩ</text></svg>';

test("a label left of the viewBox grows it, and fixed width/height go", () => {
	const out = fitSvgViewBox(SVG, fakeDocument({ x: -47, y: 40, width: 439, height: 179 }));
	assert.match(out, /viewBox="-55 0 455 227"/);
	assert.doesNotMatch(out, /\swidth="400"/);
});

test("content inside the viewBox leaves the markup untouched", () => {
	assert.equal(fitSvgViewBox(SVG, fakeDocument({ x: 10, y: 10, width: 300, height: 150 })), SVG);
});

test("no layout (no getBBox) keeps the markup as it is", () => {
	assert.equal(fitSvgViewBox(SVG, fakeDocument(null)), SVG);
});
