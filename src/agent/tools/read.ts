import * as fs from "node:fs/promises";
import { Type } from "typebox";
import type { Api, ImageContent, Message, Model, TextContent } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute, toToolResult, type ImageFileResult } from "../tool-execute.ts";
import { resolveSourcePath } from "./fs-shared.ts";
import { detectSupportedImageMimeTypeFromFile, processImage, type ModelImageResizeOptions } from "../image-processing/index.ts";
import { cutPicture, planTiles, tilePosition, tileSummary, type TileDirection, type TilePlan } from "../image-processing/tiles.ts";
import { getHeadless, pdfCanvasGeometry } from "../subagents/headless.ts";
import { compactPageSpec, openPdfPages, parsePageSpec, type PdfPageReader, type PdfPageReading, type PdfPageVisual } from "../subagents/pdf-ops.ts";
import { contentHash, readCacheGet, readCacheSet } from "./read-cache.ts";

/**
 * The read tool — sources v0 (2026-09): a Node port of pi's read semantics
 * for the learner's local files. The flow is learner-owned: he pastes file
 * paths into the chat, the agent reads on its own terms (nothing is
 * auto-injected). Unrestricted local reads are the user-decided v0 scope —
 * this is a personal study harness, not a multi-tenant service.
 *
 * Ported behaviors (mirroring pi's dist/core/tools/read.js):
 * - text files: utf-8, offset (1-indexed) / limit slicing, and the
 *   2000-line / 50KB truncation ceiling with actionable "use offset=N"
 *   continuation notices — a huge file never silently floods the context.
 * - image files (jpg/png/gif/webp/bmp): returned as native image content
 *   parts so the vision-capable model actually SEES them (tool-execute's
 *   toToolResult maps ImageFileResult to pi's ImageContent).
 * - PDF files (2026-11, fase 5): read in the same call — each page's text
 *   under a `--- Page N ---` marker, plus a rendered page image for pages
 *   whose text alone would lose them (no text layer, little text, a scan
 *   or figure, drawn strokes, typeset math). `pages` picks a range; a
 *   per-call budget (pages, images, bytes) ends the window early with a
 *   `pages="…"` continuation notice, never mid-page.
 * - unreadable/missing files throw — pi turns that into an error tool
 *   result the model sees and recovers from.
 *
 * Tall pages and pictures (2026-11, «Den skal kunne se PDF»): a page or
 * picture that would shrink unreadably when fitted whole (a scanned answer
 * that is one long strip) is cut into overlapping tiles at readable
 * resolution (image-processing/tiles.ts), each labelled with its place in
 * reading order. Narrow pages render at a higher DPI so their short side
 * reaches an A4 page's 150-DPI width (raster scans never above their own
 * resolution). The agent never has to ask the learner to split a file.
 *
 * Token saving (2026-11): rendered pages and tiles are cached on disk per
 * file content hash (read-cache.ts), and a read whose result is exactly an
 * earlier result still in the model's context returns a short "unchanged,
 * it is above" note instead of the same content again.
 *
 * Usage guidance ships in the description (the self-contained-tools
 * principle, user-decided 2026-09: system prompts reference only
 * always-on tools — read IS always-on, but its doctrine still lives here).
 */

const MAX_LINES = 2000;
const MAX_BYTES = 50 * 1024;

const readInput = Type.Object({
	path: Type.String({ minLength: 1, description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(Type.Integer({ minimum: 1, description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum number of lines to read" })),
	pages: Type.Optional(Type.String({ minLength: 1, description: 'PDF only: pages to read, e.g. "1-5", "3" or "2,4,7" (default: from page 1)' })),
});

function formatSize(bytes: number): string {
	return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${bytes}B`;
}

/** Slice + truncate the text body, pi's continuation-notice style. */
function readTextSlice(text: string, offset: number | undefined, limit: number | undefined): string {
	const allLines = text.split("\n");
	const totalLines = allLines.length;
	const startLine = offset ? Math.max(0, offset - 1) : 0;
	if (startLine >= totalLines) {
		throw new Error(`Offset ${offset} is beyond end of file (${totalLines} lines total)`);
	}
	// honor an explicit limit first (never beyond EOF)
	let selected = allLines.slice(startLine, limit !== undefined ? startLine + limit : totalLines);
	// then the 2000-line ceiling
	let truncatedBy: "lines" | "bytes" | null = null;
	if (selected.length > MAX_LINES) {
		selected = selected.slice(0, MAX_LINES);
		truncatedBy = "lines";
	}
	// then the 50KB ceiling
	if (Buffer.byteLength(selected.join("\n"), "utf-8") > MAX_BYTES) {
		while (selected.length > 0 && Buffer.byteLength(selected.join("\n"), "utf-8") > MAX_BYTES) {
			selected.pop();
		}
		truncatedBy = "bytes";
	}
	if (truncatedBy === null) {
		const remaining = totalLines - (startLine + selected.length);
		if (remaining > 0) {
			return `${selected.join("\n")}\n\n[${remaining} more lines in file. Use offset=${startLine + selected.length + 1} to continue.]`;
		}
		return selected.join("\n");
	}
	const endLineDisplay = startLine + selected.length;
	const reason =
		truncatedBy === "lines" ? `${MAX_LINES} line limit` : `${formatSize(MAX_BYTES)} limit`;
	return `${selected.join("\n")}\n\n[Showing lines ${startLine + 1}-${endLineDisplay} of ${totalLines} (${reason}). Use offset=${endLineDisplay + 1} to continue.]`;
}

/** Per-call PDF budget: whole pages only, so the window ends early rather
 *  than mid-page. Images are the expensive part (a page ≈ a screenful);
 *  a tiled page counts every tile, and the image budget is above the tile
 *  cap (MAX_TILES), so one tall page always fits in a single call. */
export const PDF_PAGE_LIMIT = 20;
export const PDF_IMAGE_LIMIT = 12;
/** An ordinary page renders at 150 DPI (A4: 1240 px wide). A narrower page
 *  renders until its short side is as wide, up to 300 DPI; a raster scan
 *  never above its own resolution. */
const BASE_DPI = 150;
const MAX_DPI = 300;
const TARGET_SHORT_SIDE_PX = 1240;

/** The DPI a page renders at (pure; exported for tests). */
export function pageRenderDpi(page: Pick<PdfPageReading, "widthPt" | "heightPt" | "sourceDpi">): number {
	const shortPt = Math.min(page.widthPt, page.heightPt);
	if (!Number.isFinite(shortPt) || shortPt <= 0) return BASE_DPI;
	let dpi = Math.min(MAX_DPI, Math.max(BASE_DPI, (72 * TARGET_SHORT_SIDE_PX) / shortPt));
	dpi = Math.ceil(dpi); // whole DPI, never below the target width
	if (page.sourceDpi !== null) dpi = Math.min(dpi, Math.max(BASE_DPI, page.sourceDpi));
	return dpi;
}

/** How a page's picture will be cut (null: one image), from its geometry —
 *  known before rendering, so the image budget can count tiles. */
function pageTilePlan(page: PdfPageReading, limits: ModelImageResizeOptions | undefined): TilePlan | null {
	try {
		const { width, height } = pdfCanvasGeometry(page.widthPt, page.heightPt, pageRenderDpi(page));
		return planTiles(width, height, limits);
	} catch {
		return null;
	}
}

const VISUAL_REASON: Record<PdfPageVisual, string> = {
	"no-text": "no text layer: scan, handwriting or drawing",
	"thin-text": "little text",
	picture: "scanned or pictured content",
	drawing: "drawn figure or handwriting",
	math: "math-heavy",
};

/** `%PDF-` may sit anywhere in the first 1024 bytes (PDF spec, 7.5.2). */
function isPdf(buffer: Buffer): boolean {
	return buffer.subarray(0, 1024).includes("%PDF-");
}

function pageBlock(page: PdfPageReading, image: "attached" | "omitted" | null, note?: string, ready?: ReadyImages): string {
	const attached = image === "attached" && ready?.parts && ready.parts > 1
		? `attached as ${ready.parts} overlapping parts, ${ready.direction === "across" ? "left to right" : "top to bottom"}`
		: image;
	const tag = page.visual && image ? ` [${VISUAL_REASON[page.visual]}; page image ${attached}${note ? `: ${note}` : ""}]` : "";
	const body = page.markdown.trim() || (page.visual ? "[no extractable text]" : "[blank page]");
	return `--- Page ${page.number} ---${tag}\n${body}`;
}

type ModelImage = { data: string; mimeType: string; label?: string };

/** A rendered page (or picture file) made model-ready: whole, or tiled
 *  with each tile labelled. Cached per file hash by the callers. */
interface ReadyImages {
	images: ModelImage[];
	hints: string[];
	/** Tile count when tiled (absent: one image). */
	parts?: number;
	/** The source size the tiles were cut from, and the cut direction. */
	size?: { width: number; height: number };
	direction?: TileDirection;
	error?: string;
}

async function prepareImage(bytes: Uint8Array, mime: string, limits: ModelImageResizeOptions | undefined, label: (position: string) => string): Promise<ReadyImages> {
	const cut = await cutPicture(bytes, limits);
	if (!cut) {
		const processed = await processImage(bytes, mime, { resizeOptions: limits });
		return processed.ok
			? { images: [{ data: processed.data, mimeType: processed.mimeType }], hints: processed.hints }
			: { images: [], hints: [], error: processed.message };
	}
	const images: ModelImage[] = [];
	const hints: string[] = [];
	for (const [i, tile] of cut.tiles.entries()) {
		const processed = await processImage(tile, "image/png", { resizeOptions: limits });
		if (!processed.ok) return { images: [], hints: [], error: processed.message };
		images.push({ data: processed.data, mimeType: processed.mimeType, label: label(tilePosition(cut.plan, i)) });
		for (const hint of processed.hints) if (!hints.includes(hint)) hints.push(hint);
	}
	return {
		images,
		hints,
		parts: cut.tiles.length,
		direction: cut.plan.direction,
		size: { width: Math.round(cut.plan.width / cut.plan.scale), height: Math.round(cut.plan.height / cut.plan.scale) },
	};
}

function limitsKey(limits: ModelImageResizeOptions | undefined): string {
	if (!limits) return "default";
	return [limits.maxWidth, limits.maxHeight, limits.maxBytes, limits.jpegQuality].map((v) => v ?? "-").join("x");
}

interface PdfTextCache {
	pageCount: number;
	pages: Record<string, PdfPageReading>;
}

/** The PDF branch: text per page plus page images where text is not enough,
 *  in ONE tool result (no background job). */
async function readPdf(
	absolute: string,
	buffer: Buffer,
	spec: string | undefined,
	model: ReadModel | undefined,
	signal: AbortSignal | undefined,
): Promise<ImageFileResult> {
	const hash = contentHash(buffer);
	const textCache: PdfTextCache | null = readCacheGet<PdfTextCache>(hash, "pdf-text");
	let reader: PdfPageReader | null = null;
	const open = async (): Promise<PdfPageReader> => {
		if (reader) return reader;
		try {
			reader = await openPdfPages(new Uint8Array(buffer));
		} catch (err) {
			throw new Error(`Could not open the PDF: ${err instanceof Error ? err.message : String(err)}`);
		}
		return reader;
	};
	try {
		const total = textCache?.pageCount ?? (await open()).pageCount;
		const known: Record<string, PdfPageReading> = { ...(textCache?.pages ?? {}) };
		let learned = false;
		const requested = spec ? parsePageSpec(spec, total) : Array.from({ length: total }, (_, i) => i + 1);
		if (requested.length === 0) {
			throw new Error(`No pages selected: pages="${spec}" matched nothing (the PDF has ${total} page${total === 1 ? "" : "s"}).`);
		}
		const limits = model?.inputLimits?.images?.resize;
		const canSee = !model || model.input.includes("image");
		const shown: PdfPageReading[] = [];
		const plans = new Map<number, TilePlan | null>();
		let imageCount = 0;
		let bytes = 0;
		for (const number of requested) {
			signal?.throwIfAborted();
			if (shown.length >= PDF_PAGE_LIMIT) break;
			let cached = known[String(number)];
			if (!cached) {
				cached = await (await open()).read(number);
				known[String(number)] = cached;
				learned = true;
			}
			const page = { ...cached };
			const wantsImage = canSee && page.visual !== null;
			const plan = wantsImage ? pageTilePlan(page, limits) : null;
			const cost = wantsImage ? (plan?.tiles.length ?? 1) : 0;
			if (shown.length > 0 && wantsImage && imageCount + cost > PDF_IMAGE_LIMIT) break;
			const size = Buffer.byteLength(page.markdown, "utf-8");
			if (shown.length > 0 && bytes + size > MAX_BYTES) break;
			if (size > MAX_BYTES) {
				// One page alone over the ceiling: keep its head, say so.
				let cut = page.markdown.slice(0, MAX_BYTES);
				while (Buffer.byteLength(cut, "utf-8") > MAX_BYTES) cut = cut.slice(0, -1024);
				page.markdown = `${cut}\n\n[Page ${number} truncated at ${formatSize(MAX_BYTES)}.]`;
			}
			shown.push(page);
			plans.set(number, plan);
			bytes += Math.min(size, MAX_BYTES);
			imageCount += cost;
		}
		if (learned) readCacheSet(hash, "pdf-text", { pageCount: total, pages: known } satisfies PdfTextCache);

		// Render the pages that need looking at, in page order (cached
		// renders skip the renderer entirely).
		const toRender = canSee ? shown.filter((p) => p.visual !== null) : [];
		const ready = new Map<number, ReadyImages>();
		const failures = new Map<number, string>();
		const imageKey = (page: PdfPageReading) => `page-${page.number}-${pageRenderDpi(page)}dpi-${limitsKey(limits)}`;
		const uncached: PdfPageReading[] = [];
		for (const page of toRender) {
			const hit = readCacheGet<ReadyImages>(hash, imageKey(page));
			if (hit && hit.images.length > 0) ready.set(page.number, hit);
			else uncached.push(page);
		}
		if (uncached.length > 0) {
			try {
				const dpiByPage = Object.fromEntries(uncached.map((p) => [p.number, pageRenderDpi(p)]));
				const rendered = await getHeadless().renderPdfPages(absolute, uncached.map((p) => p.number), { dpi: BASE_DPI, dpiByPage });
				for (const { page, png } of rendered) {
					const prepared = await prepareImage(png, "image/png", limits, (position) => `[Page ${page}, ${position}]`);
					signal?.throwIfAborted();
					if (prepared.error || prepared.images.length === 0) {
						failures.set(page, prepared.error ?? "not rendered");
						continue;
					}
					ready.set(page, prepared);
					const source = uncached.find((p) => p.number === page);
					if (source) readCacheSet(hash, imageKey(source), prepared);
				}
				for (const page of uncached) {
					if (!ready.has(page.number) && !failures.has(page.number)) failures.set(page.number, "not rendered");
				}
			} catch (err) {
				signal?.throwIfAborted();
				const message = err instanceof Error ? err.message : String(err);
				for (const page of uncached) failures.set(page.number, `render failed (${message})`);
			}
		}

		const imagePages = toRender.filter((p) => ready.has(p.number)).map((p) => p.number);
		const hints: string[] = [];
		for (const n of imagePages) for (const hint of ready.get(n)!.hints) if (!hints.includes(hint)) hints.push(hint);
		const range = compactPageSpec(shown.map((p) => p.number));
		const lines = [`PDF: ${absolute} (${total} page${total === 1 ? "" : "s"}). Showing page${shown.length === 1 ? "" : "s"} ${range}.`];
		if (imagePages.length > 0) {
			const order = imagePages.map((n) => {
				const parts = ready.get(n)!.parts;
				return parts ? `p${n} (${parts} parts)` : `p${n}`;
			});
			lines.push(`Page images follow after this text, in page order: ${order.join(", ")}. Read them for what the text misses (handwriting, figures, equations).`);
			if (imagePages.some((n) => ready.get(n)!.parts)) {
				lines.push("A tall or wide page comes as overlapping parts at readable resolution, each labelled with its place; a line on a seam appears in both neighbouring parts.");
			}
			lines.push(...hints);
		}
		if (!canSee && shown.some((p) => p.visual !== null)) {
			lines.push("[Current model does not support images. Page images are omitted; only the extracted text is shown.]");
		}
		lines.push("");
		for (const page of shown) {
			const image = page.visual === null ? null : !canSee || failures.has(page.number) ? "omitted" : "attached";
			lines.push(pageBlock(page, image, failures.get(page.number), ready.get(page.number)), "");
		}
		const rest = requested.slice(shown.length);
		if (rest.length > 0) {
			const next = compactPageSpec(rest);
			lines.push(`[${rest.length} more page${rest.length === 1 ? "" : "s"} (${next}). Use pages="${next}" to continue.]`);
		}
		const text = lines.join("\n").trimEnd();
		const images = imagePages.flatMap((n) => ready.get(n)!.images);
		return {
			text,
			images,
			// The record's tool part (the transcript card): the text the model
			// read, and which pages went along as pictures — never the bytes.
			details: { text, images: imagePages.map((page) => (ready.get(page)!.parts ? { page, parts: ready.get(page)!.parts } : { page })) },
		};
	} finally {
		if (reader) await (reader as PdfPageReader).close().catch(() => {});
	}
}

/** A picture file: whole within the model's limits, or tiled when it would
 *  shrink unreadably (a long screenshot, a scan strip). */
async function readImage(buffer: Buffer, mime: string, model: ReadModel | undefined, signal: AbortSignal | undefined): Promise<ImageFileResult> {
	const limits = model?.inputLimits?.images?.resize;
	if (model && !model.input.includes("image")) {
		// pi omits the image for a text-only model; say so, as pi does.
		const processed = await processImage(buffer, mime, { resizeOptions: limits });
		return {
			text: [
				...(processed.ok ? [`Read image file [${processed.mimeType}]`, ...processed.hints] : [`Read image file [${mime}]`, processed.message]),
				"[Current model does not support images. The image will be omitted from this request.]",
			].join("\n"),
			...(processed.ok ? { images: [{ data: processed.data, mimeType: processed.mimeType }] } : {}),
		};
	}
	const hash = contentHash(buffer);
	const key = `image-${limitsKey(limits)}`;
	let prepared = readCacheGet<ReadyImages>(hash, key);
	if (!prepared) {
		prepared = await prepareImage(buffer, mime, limits, (position) => `[Image ${position}]`);
		// Only tiled pictures are worth keeping: a whole one is one resize.
		if (prepared.parts) readCacheSet(hash, key, prepared);
	}
	signal?.throwIfAborted();
	if (prepared.error || prepared.images.length === 0) {
		return { text: [`Read image file [${mime}]`, prepared.error ?? "[Image omitted.]"].join("\n") };
	}
	if (prepared.parts && prepared.size && prepared.direction) {
		return {
			text: [
				`Read image file [${mime}]`,
				`[Image: original ${prepared.size.width}x${prepared.size.height}, too ${prepared.direction === "down" ? "tall" : "wide"} to read as one picture, so it comes as ${tileSummary(prepared.direction, prepared.parts)}. Each part is at readable resolution and labelled with its place.]`,
				...prepared.hints,
			].join("\n"),
			images: prepared.images,
		};
	}
	return {
		text: [`Read image file [${prepared.images[0]!.mimeType}]`, ...prepared.hints].join("\n"),
		images: prepared.images,
	};
}

// ─── unchanged re-reads (token saving, 2026-11) ──────────────────────────────

/** Below this size a re-send costs about what the note does. */
const MIN_DEDUP_CHARS = 1_500;

type ResultPart = TextContent | ImageContent;

function partsSize(parts: readonly ResultPart[]): number {
	return parts.reduce((n, p) => n + (p.type === "text" ? p.text.length : p.data.length), 0);
}

function sameParts(a: readonly ResultPart[], b: readonly ResultPart[]): boolean {
	if (a.length !== b.length) return false;
	return a.every((p, i) => {
		const q = b[i]!;
		if (p.type !== q.type) return false;
		if (p.type === "text") return p.text === (q as TextContent).text;
		return p.data === (q as ImageContent).data && p.mimeType === (q as ImageContent).mimeType;
	});
}

/** The 1-based position of an earlier read result, still in the model's
 *  context, whose content is byte-identical to `parts` — or null. Only the
 *  model-facing history counts: what compaction cut away is not "above". */
export function earlierIdenticalRead(history: readonly Message[], parts: readonly ResultPart[]): number | null {
	if (partsSize(parts) < MIN_DEDUP_CHARS && !parts.some((p) => p.type === "image")) return null;
	let ordinal = 0;
	let found: number | null = null;
	for (const message of history) {
		if (message.role !== "toolResult" || message.toolName !== "read" || message.isError) continue;
		ordinal++;
		if (sameParts(message.content as ResultPart[], parts)) found = ordinal;
	}
	return found;
}

/**
 * The read tool, shared verbatim by the prober and the teacher. Sources v1
 * (2026-09-19): the description is pi-verbatim (user: copy tool usage
 * guidance exactly) — the teaching doctrine moved to the shared prompt
 * fragment (prompts/shared/). Relative paths resolve against the
 * learner's home (fs-shared.ts), the harness's anchor.
 */
export type ReadModel = Pick<Model<Api>, "input" | "inputLimits">;

export interface ReadToolOptions {
	/** The model-facing conversation so far (compaction applied). With it,
	 *  a re-read that would return exactly an earlier result still in
	 *  context returns a short note instead. */
	history?: () => readonly Message[];
}

/** One implementation for every learner-file reader. Bind the active model
 * per agent, rather than sharing mutable model state between conversations.
 * Home-relative paths, text slicing and the app's abort guard stay unchanged;
 * image detection/processing and its notes follow native Pi read behavior. */
export function createReadTool(model?: ReadModel, options: ReadToolOptions = {}): AgentTool<typeof readInput> {
	return {
		name: "read",
		label: "read",
		description: `Read the contents of a file. Supports text files, images (jpg, png, gif, webp, bmp) and PDFs. Images are sent as attachments. For text files, output is truncated to 2000 lines or 50.0KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete. PDFs return each page's text under its page number, plus a page image for pages the text alone can't carry (scans, handwriting, figures, math); at most ${PDF_PAGE_LIMIT} pages and ${PDF_IMAGE_LIMIT} images per call. A tall or wide page or image (a scanned answer, a long screenshot) comes as overlapping parts at readable resolution, labelled in reading order. Use pages (e.g. "1-5") for a range, and continue with the pages the result names. Every file is readable this way: never ask the learner to split, convert or re-export a file. Re-reading a file that has not changed since an earlier read in this conversation returns a short note that the content is unchanged and still above.`,
		parameters: readInput,
		execute: serverExecute("read", readInput, async ({ path: rawPath, offset, limit, pages }, { signal }): Promise<string | ImageFileResult> => {
			const absolute = resolveSourcePath(rawPath);
			const mime = await detectSupportedImageMimeTypeFromFile(absolute);
			const buffer = await fs.readFile(absolute, { signal });
			const value = mime
				? await readImage(buffer, mime, model, signal)
				: isPdf(buffer)
					? await readPdf(absolute, buffer, pages, model, signal)
					: readTextSlice(buffer.toString("utf-8"), offset, limit);
			if (options.history) {
				const earlier = earlierIdenticalRead(options.history(), toToolResult(value).content as ResultPart[]);
				if (earlier !== null) {
					return `[Unchanged: ${absolute}${pages ? ` (pages ${pages})` : ""}${offset || limit ? ` (offset ${offset ?? 1}${limit ? `, limit ${limit}` : ""})` : ""} returns exactly what read result #${earlier} in this conversation returned, and that result is still above. Not sent again — use it.]`;
				}
			}
			return value;
		}),
	};
}

export const readTool = createReadTool();
