/**
 * The read tool (sources v0) — a Node port of pi's read semantics:
 * truncation with continuation offsets, image mime detection, error paths.
 * Driven through the NATIVE AgentTool execute (Wave A, 2026-09-26): text
 * reads return the raw string as details (the record's tool part output
 * reads it); image reads return native pi content parts (text + image)
 * with null details (the output-less part until the record persists).
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, afterEach, describe, it } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { createReadTool, PDF_IMAGE_LIMIT, PDF_PAGE_LIMIT, readTool, type ReadModel } from "../src/agent/tools/read.ts";
import { headlessOverride, realHeadless } from "../src/agent/subagents/headless.ts";
import { compactPageSpec } from "../src/agent/subagents/pdf-ops.ts";
import { tinyPdf, type Run, type TinyPage } from "./helpers/tiny-pdf.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-read-test-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function write(name: string, content: string): string {
	const file = path.join(tmp, name);
	fs.writeFileSync(file, content, "utf-8");
	return file;
}

/** Native execute → the raw string body (text reads ride details verbatim). */
const run = (args: { path: string; offset?: number; limit?: number }) =>
	readTool.execute!("test", args).then((r) => {
		assert.ok(r.content.length >= 1);
		const first = r.content[0]!;
		assert.equal(first.type, "text");
		return { text: (first as { type: "text"; text: string }).text, details: r.details };
	});

describe("read tool — text semantics", () => {
	it("reads a small file verbatim", async () => {
		const file = write("small.txt", "hello\nworld");
		const { text, details } = await run({ path: file });
		assert.equal(text, "hello\nworld");
		assert.equal(details, "hello\nworld", "the record part output carries the string verbatim");
	});

	it("resolves relative paths against the learner's home (sources v1 anchoring)", async () => {
		// sources v1: the harness has no meaningful cwd — "find my notes" must
		// work from a bare relative path, so the home directory is the anchor
		// (fs-shared resolveSourcePath). Scratch file in home, cleaned up.
		const rel = `lh-read-rel-test-${process.pid}.txt`;
		const homeFile = path.join(os.homedir(), rel);
		fs.writeFileSync(homeFile, "rel", "utf-8");
		try {
			assert.equal((await run({ path: rel })).text, "rel");
		} finally {
			fs.unlinkSync(homeFile);
		}
	});

	it("honors offset (1-indexed) and limit", async () => {
		const body = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
		const file = write("thirty.txt", body);
		const out = (await run({ path: file, offset: 10, limit: 3 })).text;
		// pi parity: the explicit limit stopping short gets a remaining notice
		assert.match(out, /^line 10\nline 11\nline 12\n\n\[18 more lines in file\. Use offset=13 to continue\.\]$/);
	});

	it("offset beyond EOF is an error the model sees", async () => {
		const file = write("tiny.txt", "one");
		await assert.rejects(() => run({ path: file, offset: 99 }), /beyond end of file/);
	});

	it("a missing file throws (pi's error-result semantics)", async () => {
		await assert.rejects(() => run({ path: path.join(tmp, "nope.txt") }), /ENOENT/);
	});

	it("truncates at 2000 lines with a use-offset continuation notice", async () => {
		const body = Array.from({ length: 3000 }, (_, i) => `l${i + 1}`).join("\n");
		const file = write("big.txt", body);
		const out = (await run({ path: file })).text;
		assert.match(out, /Showing lines 1-2000 of 3000 \(2000 line limit\)/);
		assert.match(out, /Use offset=2001 to continue/);
		assert.ok(!out.includes("l2001\n"), "line 2001 must not ride along");
	});

	it("truncates at 50KB with the same continuation notice", async () => {
		// 200 lines of ~400B = ~80KB total, under the line cap — byte cap fires
		const line = "x".repeat(400);
		const body = Array.from({ length: 200 }, () => line).join("\n");
		const file = write("wide.txt", body);
		const out = (await run({ path: file })).text;
		assert.match(out, /50\.0KB limit\)\. Use offset=\d+ to continue\./);
		// and the truncation actually cut content
		assert.ok(out.length < 52_000, "the 50KB ceiling must cut the 80KB body");
	});

	it("an explicit limit that stops short gets a remaining-lines notice", async () => {
		const body = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join("\n");
		const file = write("ten.txt", body);
		const out = (await run({ path: file, limit: 4 })).text;
		assert.match(out, /\[6 more lines in file\. Use offset=5 to continue\.\]/);
	});
});

describe("read tool — image semantics (native content parts)", () => {
	it("returns native text + image parts for image files, details null (output-less part)", async () => {
		const file = path.join(tmp, "dot.png");
		// Detection now sniffs bytes and the native processor decodes the image.
		const canvas = createCanvas(1, 1);
		canvas.getContext("2d").fillRect(0, 0, 1, 1);
		fs.writeFileSync(file, canvas.toBuffer("image/png"));
		const result = await readTool.execute!("test", { path: file });
		assert.equal(result.content.length, 2);
		const parts = result.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		const textPart = parts[0]!;
		const imagePart = parts[1]!;
		assert.equal(textPart.type, "text");
		assert.match(textPart.text!, /Read image file \[image\/png\]/);
		assert.equal(imagePart.type, "image");
		assert.equal(imagePart.mimeType, "image/png");
		assert.match(imagePart.data!, /^[A-Za-z0-9+/]+={0,2}$/);
		assert.equal(result.details, null, "image reads keep the record part output-less");
	});

	it("plain string results map to a single text part (parity)", async () => {
		const file = write("plain.txt", "body");
		const result = await readTool.execute!("test", { path: file });
		assert.equal(result.content.length, 1);
		assert.equal(result.content[0]!.type, "text");
		assert.equal((result.content[0] as { type: "text"; text: string }).text, "body");
	});
});

describe("read tool — PDFs in the same call (text per page, images where text is not enough)", () => {
	type Part = { type: string; text?: string; data?: string; mimeType?: string };
	const prose = (y = 700): Run[] => Array.from({ length: 6 }, (_, i) => ({
		text: `Line ${i + 1} of ordinary typed prose, long enough to count as real text.`, x: 72, y: y - i * 14,
	}));
	const pdf = (name: string, pages: TinyPage[]) => {
		const file = path.join(tmp, name);
		fs.writeFileSync(file, tinyPdf(pages));
		return file;
	};
	const read = async (args: { path: string; pages?: string }, tool = readTool) => {
		const result = await tool.execute!("test", args);
		const parts = result.content as Part[];
		assert.equal(parts[0]!.type, "text", "the text part leads; images follow it");
		return { text: parts[0]!.text!, images: parts.slice(1), details: result.details };
	};
	/** Count renders without painting real pages (budget tests). */
	const fakeRenders = () => {
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
		return calls;
	};
	afterEach(() => { headlessOverride.current = undefined; });

	it("a typed PDF returns every page's text under its page number, with no images", async () => {
		const file = pdf("typed.pdf", [{ runs: prose() }, { runs: [{ text: "Oppgave 2", x: 72, y: 720, size: 18 }, ...prose(690)] }]);
		const { text, images, details } = await read({ path: file });
		assert.equal(images.length, 0);
		assert.match(text, /^PDF: .*typed\.pdf \(2 pages\)\. Showing pages 1-2\./);
		assert.match(text, /--- Page 1 ---\nLine 1 of ordinary typed prose/);
		assert.match(text, /--- Page 2 ---\n# Oppgave 2/);
		assert.doesNotMatch(text, /more page/);
		assert.deepEqual(details, { text, images: [] });
	});

	it("a scanned answer (no text layer) comes back as a rendered page image in the same result", async () => {
		const file = pdf("scan.pdf", [{ image: true }, { runs: prose() }]);
		const { text, images, details } = await read({ path: file });
		assert.equal(images.length, 1, "only the scanned page is rendered");
		assert.equal(images[0]!.type, "image");
		assert.match(images[0]!.mimeType!, /^image\//);
		assert.match(images[0]!.data!, /^[A-Za-z0-9+/]+={0,2}$/);
		assert.match(text, /Page images follow after this text, in page order: p1\./);
		assert.match(text, /--- Page 1 --- \[no text layer: scan, handwriting or drawing; page image attached\]\n\[no extractable text\]/);
		assert.match(text, /--- Page 2 ---\nLine 1/);
		assert.deepEqual((details as { images: unknown[] }).images, [{ page: 1 }]);
	});

	it("decides per page: a scan under OCR text, thin text and drawn strokes are seen; a logo and a blank page are not", async () => {
		const calls = fakeRenders();
		const file = pdf("mixed.pdf", [
			{ image: true, runs: [{ text: "OCR words over the scan", x: 72, y: 720, invisible: true }, ...prose(680)] },
			{ runs: [{ text: "Oppgave 3", x: 72, y: 700 }] },
			{ strokes: 150 },
			{ runs: prose(), strokes: 150 },
			{ image: "logo", runs: prose() },
			{},
		]);
		const { text, images } = await read({ path: file });
		assert.deepEqual(calls, [[1, 2, 3, 4]]);
		assert.equal(images.length, 4);
		assert.match(text, /--- Page 1 --- \[scanned or pictured content; page image attached\]\nOCR words over the scan/);
		assert.match(text, /--- Page 2 --- \[little text; page image attached\]\nOppgave 3/);
		assert.match(text, /--- Page 3 --- \[no text layer: scan, handwriting or drawing; page image attached\]/);
		assert.match(text, /--- Page 4 --- \[drawn figure or handwriting; page image attached\]/);
		assert.match(text, /--- Page 5 ---\nLine 1/);
		assert.match(text, /--- Page 6 ---\n\[blank page\]/);
	});

	it("pages selects a range; a spec that matches nothing is an error naming the page count", async () => {
		const file = pdf("three.pdf", [1, 2, 3].map((n) => ({ runs: [{ text: `Side ${n}`, x: 72, y: 720, size: 18 }, ...prose(690)] })));
		const { text } = await read({ path: file, pages: "2-3" });
		assert.match(text, /\(3 pages\)\. Showing pages 2-3\./);
		assert.doesNotMatch(text, /--- Page 1 ---/);
		assert.match(text, /--- Page 2 ---\n# Side 2/);
		assert.match(text, /--- Page 3 ---\n# Side 3/);
		assert.match((await read({ path: file, pages: "3" })).text, /Showing page 3\./);
		await assert.rejects(() => read({ path: file, pages: "9" }), /No pages selected: pages="9" matched nothing \(the PDF has 3 pages\)/);
	});

	it(`stops at ${PDF_PAGE_LIMIT} pages and says how to read the rest`, async () => {
		const file = pdf("long.pdf", Array.from({ length: 25 }, () => ({ runs: prose() })));
		const { text } = await read({ path: file });
		assert.match(text, /\(25 pages\)\. Showing pages 1-20\./);
		assert.match(text, /--- Page 20 ---/);
		assert.doesNotMatch(text, /--- Page 21 ---/);
		assert.match(text, /\[5 more pages \(21-25\)\. Use pages="21-25" to continue\.\]$/);
	});

	it(`stops before page image number ${PDF_IMAGE_LIMIT + 1}, ending on a whole page`, async () => {
		const calls = fakeRenders();
		const file = pdf("scans.pdf", Array.from({ length: 14 }, () => ({ image: true })));
		const { text, images } = await read({ path: file, pages: "1-14" });
		assert.equal(images.length, PDF_IMAGE_LIMIT);
		assert.deepEqual(calls, [Array.from({ length: PDF_IMAGE_LIMIT }, (_, i) => i + 1)]);
		assert.match(text, /Showing pages 1-12\./);
		assert.match(text, /\[2 more pages \(13-14\)\. Use pages="13-14" to continue\.\]$/);
	});

	it("a model without image input gets the text and an honest omission note, no renders", async () => {
		const calls = fakeRenders();
		const file = pdf("blind.pdf", [{ image: true }, { runs: prose() }]);
		const tool = createReadTool({ input: ["text"] } as ReadModel);
		const { text, images } = await read({ path: file }, tool);
		assert.equal(images.length, 0);
		assert.deepEqual(calls, []);
		assert.match(text, /\[Current model does not support images\. Page images are omitted/);
		assert.match(text, /--- Page 1 --- \[no text layer: scan, handwriting or drawing; page image omitted\]/);
	});

	it("a failed render keeps the text and names the failure on the page", async () => {
		headlessOverride.current = { ...realHeadless, renderPdfPages: async () => { throw new Error("no canvas"); } };
		const file = pdf("norender.pdf", [{ image: true }]);
		const { text, images } = await read({ path: file });
		assert.equal(images.length, 0);
		assert.match(text, /page image omitted: render failed \(no canvas\)\]/);
	});

	it("a file that only claims to be a PDF is an error the model sees", async () => {
		const file = write("broken.pdf", "%PDF-1.4\nnot really a pdf");
		await assert.rejects(() => read({ path: file }), /Could not open the PDF/);
	});

	it("compactPageSpec writes the continuation spec in ranges", () => {
		assert.equal(compactPageSpec([1, 2, 3, 5, 7, 8]), "1-3,5,7-8");
		assert.equal(compactPageSpec([4]), "4");
	});
});
