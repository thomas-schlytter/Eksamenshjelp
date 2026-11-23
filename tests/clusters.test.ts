/**
 * Cluster presentation-rule tests: the render threshold, and the knowledge
 * map's color families (fase 8: one family per course, topics as shades
 * within it — components/cluster-geometry.ts).
 */
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { MIN_CLUSTER_SIZE } from "../src/core/clusters.ts";
import { hexToRgb, mapClusterColors, mixHex, topicShade } from "../components/cluster-geometry.ts";

describe("MIN_CLUSTER_SIZE", () => {
	test("is 3 (the render threshold — below this, no label or tint)", () => {
		assert.equal(MIN_CLUSTER_SIZE, 3);
	});
});

describe("hexToRgb / mixHex", () => {
	test("round-trips and mixes linearly", () => {
		assert.deepEqual(hexToRgb("#ff8000"), [255, 128, 0]);
		assert.deepEqual(hexToRgb("not a color"), [128, 128, 128], "malformed input reads as mid-gray");
		assert.equal(mixHex("#000000", "#ffffff", 0), "#000000");
		assert.equal(mixHex("#000000", "#ffffff", 1), "#ffffff");
		assert.equal(mixHex("#000000", "#ffffff", 0.5), "#808080");
	});
});

describe("topicShade", () => {
	const base = "#3366cc";
	test("a single topic keeps the course's base color", () => {
		assert.equal(topicShade(base, 0, 1), base);
	});
	test("topics of one course get distinct shades that stay in the family", () => {
		const shades = Array.from({ length: 9 }, (_, i) => topicShade(base, i, 9));
		assert.equal(new Set(shades).size, 9, "every topic its own shade");
		// In the family: blue stays the dominant channel for a blue base.
		for (const shade of shades) {
			const [r, g, b] = hexToRgb(shade);
			assert.ok(b > r && b > g, `${shade} should stay blue`);
		}
	});
});

describe("mapClusterColors", () => {
	const bases: Record<string, string> = { TMA4400: "#3366cc", TTK4100: "#cc6633", none: "#888888" };
	const baseOf = (course: string | null) => bases[course ?? "none"]!;

	test("course-only and «Uten fag» clusters take the base; topics shade within their course", () => {
		const colors = mapClusterColors(
			[
				{ id: "a", course: "TMA4400", topic: null },
				{ id: "b", course: "TTK4100", topic: "pid" },
				{ id: "c", course: "TTK4100", topic: "modell" },
				{ id: "d", course: "TTK4100", topic: "annet" },
				{ id: "e", course: null, topic: null },
			],
			baseOf,
		);
		assert.equal(colors.get("a"), bases.TMA4400);
		assert.equal(colors.get("e"), bases.none);
		const ttk = ["b", "c", "d"].map((id) => colors.get(id)!);
		assert.equal(new Set(ttk).size, 3, "three topics, three shades");
		for (const shade of ttk) {
			const [r, g, b] = hexToRgb(shade);
			assert.ok(r > b && r > g - 10, `${shade} should stay in the orange family`);
		}
	});

	test("clusters without a course field (birth-session snapshots) fall into the none family", () => {
		const colors = mapClusterColors([{ id: "x" }], baseOf);
		assert.equal(colors.get("x"), bases.none);
	});
});
