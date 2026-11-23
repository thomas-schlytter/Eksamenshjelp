/**
 * Cluster color identity — pure presentation math for the knowledge map.
 * (The hull geometry that used to live here was RETIRED with the
 * convex-hull renderer: regions are a low-res world-space splat bitmap in
 * graph-canvas.ts. The file keeps the name for the barrel imports.)
 *
 * Fase 8: every course (fag) has a color family — its base color comes
 * from the theme tokens (--lh-map-1…8, app/globals.css), resolved to hex
 * by the caller — and its topic clusters are shades within that family:
 * a small hue turn and a lightness step per topic, so neighbors in one
 * course stay tellable apart while the course still reads as one color.
 */

export type Pt = { x: number; y: number };

/** "#rrggbb" → [r, g, b] (0–255). Malformed input reads as mid-gray. */
export function hexToRgb(hex: string): [number, number, number] {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return [128, 128, 128];
	const v = Number.parseInt(m[1]!, 16);
	return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const toHex = (r: number, g: number, b: number): string =>
	`#${[r, g, b].map((v) => Math.round(Math.min(Math.max(v, 0), 255)).toString(16).padStart(2, "0")).join("")}`;

/** Linear mix of two hex colors: t = 0 → a, t = 1 → b. */
export function mixHex(a: string, b: string, t: number): string {
	const [ar, ag, ab] = hexToRgb(a);
	const [br, bg, bb] = hexToRgb(b);
	return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
	r /= 255;
	g /= 255;
	b /= 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, l];
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h: number;
	if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
	else if (max === g) h = (b - r) / d + 2;
	else h = (r - g) / d + 4;
	return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
	h = ((h % 360) + 360) % 360;
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	const [r, g, b] =
		h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
	return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** The largest hue turn and lightness step across a course's topics. */
const TOPIC_HUE_SPAN = 28; // degrees, end to end
const TOPIC_LIGHTNESS_SPAN = 0.22; // HSL lightness, end to end

/** Topic `index` of `count` in a course's family: index 0 and the last
 *  index sit at opposite ends of the span, a single topic keeps the base.
 *  Alternating light/dark steps keep neighboring topics apart. */
export function topicShade(base: string, index: number, count: number): string {
	if (count <= 1) return base;
	const [r, g, b] = hexToRgb(base);
	const [h, s, l] = rgbToHsl(r, g, b);
	const t = index / (count - 1) - 0.5; // −0.5 … 0.5
	const step = index % 2 === 0 ? 1 : -1;
	const lightness = Math.min(Math.max(l + step * (TOPIC_LIGHTNESS_SPAN / 2) * (0.5 + Math.abs(t)), 0.25), 0.8);
	return hslToHex(h + t * TOPIC_HUE_SPAN, s, lightness);
}

/** The color of every cluster: its course's base, shaded per topic in
 *  the clusters' own order. `baseOf(null)` is the «Uten fag» color. */
export function mapClusterColors(
	clusters: ReadonlyArray<{ id: string; course?: string | null; topic?: string | null }>,
	baseOf: (course: string | null) => string,
): Map<string, string> {
	const byCourse = new Map<string | null, Array<{ id: string; topic: string | null }>>();
	for (const c of clusters) {
		const key = c.course ?? null;
		const list = byCourse.get(key) ?? [];
		list.push({ id: c.id, topic: c.topic ?? null });
		byCourse.set(key, list);
	}
	const out = new Map<string, string>();
	for (const [course, list] of byCourse) {
		const base = baseOf(course);
		const topics = list.filter((c) => c.topic !== null);
		for (const c of list) {
			out.set(c.id, c.topic === null ? base : topicShade(base, topics.indexOf(c), topics.length));
		}
	}
	return out;
}
