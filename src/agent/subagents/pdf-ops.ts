import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { documentToMarkdown, type PdfPage } from "./pdf-markdown.ts";

/**
 * PDF plumbing for the pdf-reader sub-agent — sources v0 (2026-09): Node
 * ports of the four pdf-reader skill scripts (pdf_info / pdf_extract /
 * pdf_search / pdf_render), on the user-chosen hybrid stack:
 *
 * - TEXT (info / extract / search): pdfjs-dist — pure JS, no native deps.
 *   extract and search read pdf-markdown's Markdown, so words and lines
 *   survive (the raw text items glued "lecture" + "Plants").
 * - RENDER: subagents/headless.ts uses the same pdfjs engine with
 *   @napi-rs/canvas (Skia), in-process — no browser needed.
 *
 * Doctrine (the skill's reading strategy, mirrored in the sub-agent's system
 * prompt): triage with pdf_info FIRST, then size-based strategy — short PDFs
 * render all pages, medium render flagged (math/image-heavy) pages, long
 * ones search for targeted lookups before reading anything at length.
 *
 * These are pure library functions — no model in sight. The pdf-reader
 * agent (pdf-reader.ts) drives them through its own tool loop.
 */

export interface PdfPageInfo {
	page: number;
	text_length: number;
	image_count: number;
	/** Fraction of math-flavored chars — the render-this-page signal (port
	 *  of the skill's unicode-range density heuristic). */
	math_density: number;
}

export interface PdfInfo {
	path: string;
	page_count: number;
	/** Mean chars/page — the size class the strategy branches on. */
	mean_text_length: number;
	pages: PdfPageInfo[];
}

/** Load the legacy pdfjs build (runs headless in plain node, no worker). */
async function loadPdfjs() {
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	return pdfjs;
}

/** Standard-font data dir (live-smoke finding 2026-09-19: without it pdfjs
 *  warns and falls back on non-embedded standard fonts — Helvetica, Times…).
 *  The node side takes a plain filesystem path, shared by text and rendering.
 *  pdfjs checks endsWith("/") even on Windows: use a literal trailing slash,
 *  NOT path.sep ("\\" on Windows). Node fs accepts this path on every OS. */
export function standardFontsDir(): string {
	return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "node_modules", "pdfjs-dist", "standard_fonts") + "/";
}

async function openDocument(filePath: string) {
	return openBytes(new Uint8Array(await fs.readFile(filePath)));
}

async function openBytes(data: Uint8Array) {
	const pdfjs = await loadPdfjs();
	// The legacy build in plain node runs on a main-thread fake worker (no
	// workerSrc needed); teardown is the loading task's destroy().
	// verbosity 0 = errors only — scanned PDFs (JBIG2 XObjects) otherwise
	// flood the log with per-page warnings (live-smoke finding 2026-09-19).
	const task = pdfjs.getDocument({ data, standardFontDataUrl: standardFontsDir(), verbosity: 0 });
	return { doc: await task.promise, task };
}

/** Concatenate a page's text items into a body string. */
function itemsToText(items: unknown[]): string {
	let out = "";
	for (const it of items) {
		if (it && typeof it === "object" && "str" in (it as Record<string, unknown>)) {
			const str = (it as { str?: unknown }).str;
			if (typeof str === "string") out += str;
		}
	}
	return out;
}

/** Math-flavored char fraction — the skill's heuristic, verbatim ranges. */
function mathDensity(text: string): number {
	let mathChars = 0;
	for (const c of text) {
		const code = c.codePointAt(0)!;
		if (
			(code >= 0x2200 && code <= 0x22ff) || // Mathematical Operators
			(code >= 0x2100 && code <= 0x214f) || // Letterlike Symbols
			(code >= 0x2190 && code <= 0x21ff) || // Arrows
			(code >= 0x27c0 && code <= 0x27ef) || // Misc Mathematical Symbols-A
			(code >= 0x2980 && code <= 0x29ff) || // Misc Mathematical Symbols-B
			(code >= 0x2a00 && code <= 0x2aff) || // Supplemental Mathematical Operators
			(code >= 0x0370 && code <= 0x03ff) || // Greek
			(code >= 0x1d400 && code <= 0x1d7ff) || // Mathematical Alphanumeric Symbols
			"∫∑∏√∂∇∞≈≠≤≥±×÷∈∉⊂⊃∪∩∧∨¬∀∃∅".includes(c)
		) {
			mathChars++;
		}
	}
	return mathChars / Math.max(text.length, 1);
}

/** Cheap validity probe: getDocument resolves only for parseable PDFs —
 *  no page walk, no text extraction (unlike pdfInfo). The reader's upfront
 *  unreadable-source gate; garbage files throw pdfjs's precise error. */
export async function pdfProbe(filePath: string): Promise<void> {
	const { task } = await openDocument(filePath);
	await task.destroy();
}

/** pdf_info: page count + per-page triage signals. ALWAYS run first. */
export async function pdfInfo(filePath: string): Promise<PdfInfo> {
	const pdfjs = await loadPdfjs(); // OPS constant for the operator-list scan
	const { doc } = await openDocument(filePath);
	const pages: PdfPageInfo[] = [];
	let totalText = 0;
	for (let i = 1; i <= doc.numPages; i++) {
		const page = await doc.getPage(i);
		const content = await page.getTextContent();
		const text = itemsToText(content.items as unknown[]);
		// count page images: paintImageXObject ops in the operator list
		const ops = await page.getOperatorList();
		let imageCount = 0;
		for (const fn of ops.fnArray) {
			if (fn === pdfjs.OPS.paintImageXObject) imageCount++;
		}
		totalText += text.length;
		pages.push({
			page: i,
			text_length: text.length,
			image_count: imageCount,
			math_density: Math.round(mathDensity(text) * 10000) / 10000,
		});
	}
	return {
		path: filePath,
		page_count: doc.numPages,
		mean_text_length: Math.round(totalText / Math.max(doc.numPages, 1)),
		pages,
	};
}

/** Parse 'all' | '1-5' | '1,3,7' | '3' into a sorted 1-indexed page list. */
export function parsePageSpec(spec: string, total: number): number[] {
	const trimmed = spec.trim().toLowerCase();
	if (trimmed === "all") return Array.from({ length: total }, (_, i) => i + 1);
	const pages = new Set<number>();
	for (const part of spec.split(",")) {
		const p = part.trim();
		if (!p) continue;
		if (p.includes("-")) {
			const [startRaw, endRaw] = p.split("-", 2) as [string, string];
			const start = Math.max(1, parseInt(startRaw, 10));
			const end = Math.min(total, parseInt(endRaw, 10));
			for (let pg = start; pg <= end; pg++) pages.add(pg);
		} else {
			const pg = parseInt(p, 10);
			if (pg >= 1 && pg <= total) pages.add(pg);
		}
	}
	return [...pages].sort((a, b) => a - b);
}

export type PdfConversion =
	| { kind: "converted"; pages: PdfPage[] }
	| { kind: "too-long"; pageCount: number }
	/** Broken, encrypted, or not a PDF at all: pdfjs could not read it. */
	| { kind: "unreadable" };

/** An uploaded PDF's pages as Markdown (the notes import's door). The page
 *  cap is checked before any page is read. */
export async function convertPdf(data: Uint8Array, maxPages: number): Promise<PdfConversion> {
	let opened: Awaited<ReturnType<typeof openBytes>>;
	try {
		opened = await openBytes(data);
	} catch {
		return { kind: "unreadable" };
	}
	try {
		if (opened.doc.numPages > maxPages) return { kind: "too-long", pageCount: opened.doc.numPages };
		return { kind: "converted", pages: await documentToMarkdown(opened.doc) };
	} catch {
		return { kind: "unreadable" };
	} finally {
		await opened.task.destroy();
	}
}

/** A page's Markdown, or "" for a page with no text (the agent renders those). */
function pageMarkdown(page: PdfPage): string {
	return page.kind === "text" ? page.markdown : "";
}

/** pdf_extract: Markdown of the requested pages, `--- Page N ---` headed. */
export async function pdfExtract(filePath: string, pageSpec: string): Promise<string> {
	const { doc } = await openDocument(filePath);
	const pages = parsePageSpec(pageSpec, doc.numPages);
	if (pages.length === 0) return "No pages selected — page spec matched nothing.";
	const converted = await documentToMarkdown(doc, pages);
	return converted.map((page) => `--- Page ${page.number} ---\n${pageMarkdown(page)}`).join("\n");
}

export interface PdfSearchHit {
	page: number;
	line: number;
	/** contextLines around the hit, `>>>` marking the hit line. */
	context: string;
}

/** pdf_search: keyword/regex across all pages with context lines.
 *  pageTexts rides along so the agent can extract a hit's full page without
 *  a second pass (the skill pipelines `search → extract` the same way). */
export async function pdfSearch(
	filePath: string,
	query: string,
	opts?: { contextLines?: number; literal?: boolean },
): Promise<{ hits: PdfSearchHit[]; pageTexts: Map<number, string> }> {
	const contextLines = opts?.contextLines ?? 3;
	const { doc } = await openDocument(filePath);
	let pattern: RegExp;
	if (opts?.literal) {
		pattern = new RegExp(escapeRegex(query), "i");
	} else {
		try {
			pattern = new RegExp(query, "i");
		} catch (err) {
			throw new Error(`Invalid regex: ${(err as Error).message}`);
		}
	}
	const hits: PdfSearchHit[] = [];
	const pageTexts = new Map<number, string>();
	for (const page of await documentToMarkdown(doc)) {
		const i = page.number;
		const text = pageMarkdown(page);
		pageTexts.set(i, text);
		const lines = text.split("\n");
		for (let ln = 0; ln < lines.length; ln++) {
			if (!pattern.test(lines[ln]!)) continue;
			const start = Math.max(0, ln - contextLines);
			const end = Math.min(lines.length, ln + contextLines + 1);
			const context = lines
				.slice(start, end)
				.map((l, j) => `${start + j === ln ? ">>>" : "   "} ${l}`)
				.join("\n");
			hits.push({ page: i, line: ln + 1, context });
		}
	}
	return { hits, pageTexts };
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Where rendered pages land (mirrors the skill's /tmp convention). */
export function renderDir(filePath: string): string {
	// FNV-1a short hash of the absolute path — stable per file, no deps.
	const abs = path.resolve(filePath);
	let h = 0x811c9dc5;
	for (let i = 0; i < abs.length; i++) {
		h ^= abs.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return path.join("/tmp", `lh-pdf-${h.toString(16).padStart(8, "0")}`);
}
// ─── synchronous page reading (the read tool's PDF branch) ─────────────────

/** Why a page also goes to the model as a picture: its text alone would
 *  lose what is on it (a scan or handwriting, a figure, typeset math). */
export type PdfPageVisual = "no-text" | "thin-text" | "picture" | "drawing" | "math";

export interface PdfPageReading {
	number: number;
	/** The page's Markdown ("" when it has no text layer). */
	markdown: string;
	/** Why the page should be seen, or null when its text carries it. */
	visual: PdfPageVisual | null;
}

/** Below this many characters a page is "thin": a title, a stray heading
 *  over handwriting, a figure caption. */
export const THIN_TEXT_CHARS = 200;
/** A raster image covering this share of the page is content (a scan, a
 *  photographed answer, a figure), not a logo. */
const PICTURE_COVERAGE = 0.1;
/** Vector paths at or above this count: a drawn figure or handwriting from
 *  a tablet (every stroke is a path); ordinary text pages draw a handful. */
const DRAWING_PATHS = 100;
/** The pdf-reader's math signal: equations extract as flat, garbled text. */
const MATH_DENSITY = 0.03;

const IDENTITY_DET = 1;

/** Share of the page covered by raster images, and the vector path count.
 *  Every image op paints the unit square through the current transform, so
 *  its area is |det(CTM)|; determinants multiply, so a stack of scalars is
 *  the whole state (save/restore, cm, form XObjects). */
async function paintedArea(page: PDFPageProxy): Promise<{ coverage: number; paths: number }> {
	const { OPS } = await loadPdfjs();
	const imageOps = new Set<number>([
		OPS.paintImageXObject,
		OPS.paintImageXObjectRepeat,
		OPS.paintInlineImageXObject,
		OPS.paintInlineImageXObjectGroup,
		OPS.paintImageMaskXObject,
		OPS.paintImageMaskXObjectGroup,
		OPS.paintImageMaskXObjectRepeat,
		OPS.paintSolidColorImageMask,
	]);
	const det = (m: unknown): number => {
		if (!Array.isArray(m) || m.length < 4) return 1;
		const [a, b, c, d] = m.map(Number) as [number, number, number, number];
		const value = a * d - b * c;
		return Number.isFinite(value) ? value : 1;
	};
	const { fnArray, argsArray } = await page.getOperatorList();
	const stack: number[] = [];
	let current = IDENTITY_DET;
	let painted = 0;
	let paths = 0;
	for (let i = 0; i < fnArray.length; i++) {
		const fn = fnArray[i]!;
		const args = argsArray[i] as unknown[] | null;
		if (fn === OPS.save) stack.push(current);
		else if (fn === OPS.restore) current = stack.pop() ?? IDENTITY_DET;
		else if (fn === OPS.transform) current *= det(args);
		else if (fn === OPS.paintFormXObjectBegin) { stack.push(current); current *= det(args?.[0]); }
		else if (fn === OPS.paintFormXObjectEnd) current = stack.pop() ?? IDENTITY_DET;
		else if (fn === OPS.constructPath) paths++;
		else if (imageOps.has(fn)) painted += Math.abs(current);
	}
	const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view;
	const area = Math.abs((x1 - x0) * (y1 - y0)) || 1;
	return { coverage: Math.min(1, painted / area), paths };
}

async function readOnePage(doc: PDFDocumentProxy, number: number): Promise<PdfPageReading> {
	const [converted] = await documentToMarkdown(doc, [number]);
	const markdown = converted?.kind === "text" ? converted.markdown : "";
	const { coverage, paths } = await paintedArea(await doc.getPage(number));
	const text = markdown.trim();
	let visual: PdfPageVisual | null = null;
	if (!text) visual = coverage > 0 || paths > 0 ? "no-text" : null;
	else if (coverage >= PICTURE_COVERAGE) visual = "picture";
	else if (paths >= DRAWING_PATHS) visual = "drawing";
	else if (text.length < THIN_TEXT_CHARS) visual = "thin-text";
	else if (mathDensity(text) >= MATH_DENSITY) visual = "math";
	return { number, markdown, visual };
}

export interface PdfPageReader {
	pageCount: number;
	/** One page's text plus the look-at-it verdict. */
	read(page: number): Promise<PdfPageReading>;
	close(): Promise<void>;
}

/** Open a PDF for page-by-page reading. Throws pdfjs's error for a broken,
 *  encrypted or non-PDF file. */
export async function openPdfPages(data: Uint8Array): Promise<PdfPageReader> {
	const { doc, task } = await openBytes(data);
	return {
		pageCount: doc.numPages,
		read: (page) => readOnePage(doc, page),
		close: () => task.destroy(),
	};
}

/** "1-3,5,7-8" for a sorted page list — the continuation hint's spec. */
export function compactPageSpec(pages: readonly number[]): string {
	const parts: string[] = [];
	for (let i = 0; i < pages.length; i++) {
		const start = pages[i]!;
		let end = start;
		while (pages[i + 1] === end + 1) end = pages[++i]!;
		parts.push(end === start ? `${start}` : `${start}-${end}`);
	}
	return parts.join(",");
}
