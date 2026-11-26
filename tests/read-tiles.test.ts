/**
 * Tall pages and pictures, the render cache and unchanged re-reads
 * (2026-11, «PDF og høye bilder kan ikke leses» + token saving).
 *
 * The case that started it: a scanned answer exported as ONE page, a strip
 * whose render is about 1010 × 5694 px, reached the model shrunk to 355 px
 * wide. Now it is cut into overlapping tiles at readable resolution, each
 * labelled with its place, in one read call.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, afterEach, describe, it } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import type { Message } from "@earendil-works/pi-ai";
import { createReadTool, earlierIdenticalRead, pageRenderDpi, PDF_IMAGE_LIMIT, readTool } from "../src/agent/tools/read.ts";
import { MAX_TILES, planTiles, TILE_ASPECT, TILE_OVERLAP } from "../src/agent/image-processing/tiles.ts";
import { readCacheDir } from "../src/agent/tools/read-cache.ts";
import { headlessOverride, realHeadless } from "../src/agent/subagents/headless.ts";
import { openPdfPages } from "../src/agent/subagents/pdf-ops.ts";
import { tinyPdf, type TinyPage } from "./helpers/tiny-pdf.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-read-tiles-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
afterEach(() => {
	headlessOverride.current = undefined;
	readCacheDir.current = null;
});

type Part = { type: string; text?: string; data?: string; mimeType?: string };

const pdf = (name: string, pages: TinyPage[]) => {
	const file = path.join(tmp, name);
	fs.writeFileSync(file, tinyPdf(pages));
	return file;
};

/** A tablet's whole answer on one page: 484 × 2733 pt, strokes only. */
const STRIP: TinyPage = { size: [484, 2733], strokes: 160 };

async function readParts(args: { path: string; pages?: string }, tool = readTool) {
	const result = await tool.execute!("test", args);
	return { parts: result.content as Part[], details: result.details };
}

describe("planTiles — where a picture is cut", () => {
	it("cuts the 1010 × 5694 strip top → bottom into 5 tiles of at most 1:1.4, overlapping, covering it all", () => {
		const plan = planTiles(1010, 5694)!;
		assert.ok(plan);
		assert.equal(plan.direction, "down");
		assert.equal(plan.scale, 1, "no shrinking: the strip's own width is readable");
		assert.equal(plan.tiles.length, 5);
		for (const tile of plan.tiles) {
			assert.equal(tile.x, 0);
			assert.equal(tile.width, 1010);
			assert.ok(tile.height <= Math.ceil(tile.width * TILE_ASPECT), "aspect at most 1:1.4");
		}
		assert.equal(plan.tiles[0]!.y, 0);
		const last = plan.tiles.at(-1)!;
		assert.equal(last.y + last.height, plan.height, "the bottom edge is in the last tile");
		for (let i = 1; i < plan.tiles.length; i++) {
			const overlap = plan.tiles[i - 1]!.y + plan.tiles[i - 1]!.height - plan.tiles[i]!.y;
			assert.ok(overlap >= Math.floor(TILE_OVERLAP * plan.tiles[i]!.height), `seam ${i} overlaps ≥ 5 %`);
		}
	});

	it("leaves ordinary pictures whole: an A4 page at 150 DPI, a phone photo, a small strip", () => {
		assert.equal(planTiles(1240, 1754), null);
		assert.equal(planTiles(4032, 3024), null);
		assert.equal(planTiles(300, 2100), null, "a 300 px strip loses almost nothing when fitted");
		assert.equal(planTiles(640, 320, { maxWidth: 96, maxHeight: 64 }), null, "a model with tiny limits gains nothing from tiles");
	});

	it("shrinks a very wide source to a readable tile width and never makes more than MAX_TILES", () => {
		const wide = planTiles(2480, 35_000)!;
		assert.ok(wide.tiles.every((t) => t.width <= 2000 && t.height <= 2000), "every tile within the model's limit");
		assert.ok(wide.tiles.length <= MAX_TILES);
		assert.ok(wide.scale < 1);
	});

	it("cuts a wide panorama left → right", () => {
		const plan = planTiles(6000, 800)!;
		assert.equal(plan.direction, "across");
		assert.ok(plan.tiles.every((t) => t.y === 0 && t.height === 800));
		assert.ok(plan.tiles.length > 1);
	});
});

describe("pageRenderDpi — narrow pages render sharper", () => {
	it("keeps A4 and Letter at 150 DPI", () => {
		assert.equal(pageRenderDpi({ widthPt: 595.3, heightPt: 841.9, sourceDpi: null }), 150);
		assert.equal(pageRenderDpi({ widthPt: 612, heightPt: 792, sourceDpi: null }), 150);
	});

	it("raises a narrow vector page until its short side is A4-wide, capped at 300", () => {
		assert.equal(pageRenderDpi({ widthPt: 484.46, heightPt: 2732.7, sourceDpi: null }), 185);
		assert.equal(pageRenderDpi({ widthPt: 100, heightPt: 400, sourceDpi: null }), 300);
	});

	it("reads a page's size and its scan's own resolution (vector pages have none)", async () => {
		const reader = await openPdfPages(tinyPdf([{ image: true }, STRIP]));
		try {
			const scan = await reader.read(1);
			assert.deepEqual([scan.widthPt, scan.heightPt, scan.sourceDpi], [612, 792, 0], "a 1 × 1 px picture over a whole page");
			const strip = await reader.read(2);
			assert.deepEqual([strip.widthPt, strip.heightPt, strip.sourceDpi], [484, 2733, null]);
		} finally {
			await reader.close();
		}
	});

	it("never renders a raster scan above its own resolution (but not below 150)", () => {
		assert.equal(pageRenderDpi({ widthPt: 484.46, heightPt: 2732.7, sourceDpi: 170 }), 170);
		assert.equal(pageRenderDpi({ widthPt: 484.46, heightPt: 2732.7, sourceDpi: 96 }), 150);
	});
});

describe("read — a tall handwritten page in one call", () => {
	it("renders the strip at a readable size and sends it as labelled tiles, each label right before its image", async () => {
		const file = pdf("strip.pdf", [STRIP]);
		const { parts, details } = await readParts({ path: file });
		const text = parts[0]!.text!;
		assert.match(text, /Page images follow after this text, in page order: p1 \(5 parts\)\./);
		assert.match(text, /--- Page 1 --- \[no text layer: scan, handwriting or drawing; page image attached as 5 overlapping parts, top to bottom\]/);
		const rest = parts.slice(1);
		assert.equal(rest.length, 10, "label + image, five times");
		for (let i = 0; i < 5; i++) {
			assert.equal(rest[2 * i]!.type, "text");
			assert.equal(rest[2 * i]!.text, `[Page 1, part ${i + 1} of 5 (top → bottom)]`);
			assert.equal(rest[2 * i + 1]!.type, "image");
		}
		// The tile is A4-page wide, not 355 px: decode the first one's header.
		const png = Buffer.from(rest[1]!.data!, "base64");
		assert.ok(png.readUInt32BE(16) >= 1240 && png.readUInt32BE(16) < 1250, "the strip renders A4-page wide (185 DPI), not 355 px");
		assert.deepEqual((details as { images: unknown[] }).images, [{ page: 1, parts: 5 }]);
	});

	it("counts tiles against the image budget and continues with pages, never mid-page", async () => {
		const file = pdf("strips.pdf", [STRIP, STRIP, STRIP]);
		const { parts } = await readParts({ path: file });
		const images = parts.filter((p) => p.type === "image");
		assert.equal(images.length, 10, `two pages of 5 tiles fit in ${PDF_IMAGE_LIMIT}; the third would not`);
		assert.match(parts[0]!.text!, /Showing pages 1-2\./);
		assert.match(parts[0]!.text!, /\[1 more page \(3\)\. Use pages="3" to continue\.\]$/);
	});

	it("a tall picture file is tiled the same way", async () => {
		const canvas = createCanvas(1010, 5694);
		const ctx = canvas.getContext("2d");
		ctx.fillStyle = "#fff";
		ctx.fillRect(0, 0, 1010, 5694);
		ctx.fillStyle = "#000";
		for (let y = 40; y < 5694; y += 60) ctx.fillRect(40, y, 900, 4);
		const file = path.join(tmp, "scan-strip.png");
		fs.writeFileSync(file, canvas.toBuffer("image/png"));
		const { parts } = await readParts({ path: file });
		assert.match(parts[0]!.text!, /original 1010x5694, too tall to read as one picture, so it comes as 5 overlapping parts, top to bottom/);
		assert.equal(parts.filter((p) => p.type === "image").length, 5);
		assert.equal(parts[1]!.text, "[Image part 1 of 5 (top → bottom)]");
		assert.equal(parts[2]!.type, "image");
	});

	it("tells the model to read on itself, never to ask the learner to split the file", () => {
		assert.match(readTool.description, /never ask the learner to split, convert or re-export a file/);
	});
});

describe("the render cache (per file content hash)", () => {
	it("renders a page once: the second read of the same PDF uses the cache", async () => {
		readCacheDir.current = fs.mkdtempSync(path.join(tmp, "cache-"));
		const calls: number[][] = [];
		const dot = createCanvas(1, 1);
		dot.getContext("2d").fillRect(0, 0, 1, 1);
		headlessOverride.current = {
			...realHeadless,
			async renderPdfPages(_path, pages) {
				calls.push(pages);
				return pages.map((page) => ({ page, png: dot.toBuffer("image/png") }));
			},
		};
		const file = pdf("cached.pdf", [{ image: true }, { image: true }]);
		const first = await readParts({ path: file });
		const second = await readParts({ path: file });
		assert.deepEqual(calls, [[1, 2]], "no second render");
		assert.deepEqual(second.parts, first.parts, "the same result, byte for byte");
		// A copy with the same bytes elsewhere still hits (keyed by content).
		const copy = path.join(tmp, "copied.pdf");
		fs.copyFileSync(file, copy);
		await readParts({ path: copy });
		assert.equal(calls.length, 1);
	});
});

describe("unchanged re-reads (the content is still above)", () => {
	const body = Array.from({ length: 80 }, (_, i) => `Line ${i + 1}: notes worth reading twice.`).join("\n");
	const history = (content: Part[]): Message[] => [
		{ role: "toolResult", toolCallId: "r1", toolName: "read", content: content as never, isError: false, timestamp: 0 },
	];

	it("returns a short note instead of the same content again", async () => {
		const file = path.join(tmp, "notes.md");
		fs.writeFileSync(file, body);
		const first = await readTool.execute!("r1", { path: file });
		const tool = createReadTool(undefined, { history: () => history(first.content as Part[]) });
		const again = await tool.execute!("r2", { path: file });
		const text = (again.content[0] as { text: string }).text;
		assert.match(text, /^\[Unchanged: .*notes\.md returns exactly what read result #1 in this conversation returned, and that result is still above\. Not sent again — use it\.\]$/);
		assert.ok(text.length < 300);
	});

	it("sends the content again when the file changed, when compaction cut the earlier result away, or when it is small", async () => {
		const file = path.join(tmp, "changing.md");
		fs.writeFileSync(file, body);
		const first = await readTool.execute!("r1", { path: file });
		fs.writeFileSync(file, `${body}\nA new line.`);
		const tool = createReadTool(undefined, { history: () => history(first.content as Part[]) });
		const changed = await tool.execute!("r2", { path: file });
		assert.match((changed.content[0] as { text: string }).text, /A new line\./);
		const compacted = createReadTool(undefined, { history: () => [] });
		assert.match(((await compacted.execute!("r3", { path: file })).content[0] as { text: string }).text, /^Line 1:/);
		assert.equal(earlierIdenticalRead(history([{ type: "text", text: "short" }]), [{ type: "text", text: "short" }]), null);
	});

	it("matches images too: a re-read of the same scan is not sent twice", async () => {
		const dot = createCanvas(1, 1);
		dot.getContext("2d").fillRect(0, 0, 1, 1);
		headlessOverride.current = { ...realHeadless, renderPdfPages: async (_p, pages) => pages.map((page) => ({ page, png: dot.toBuffer("image/png") })) };
		const file = pdf("scan-again.pdf", [{ image: true }]);
		const first = await readTool.execute!("r1", { path: file });
		const tool = createReadTool(undefined, { history: () => history(first.content as Part[]) });
		const again = await tool.execute!("r2", { path: file, pages: "1" });
		assert.equal(again.content.length, 1);
		assert.match((again.content[0] as { text: string }).text, /^\[Unchanged: .*\(pages 1\)/);
	});
});
