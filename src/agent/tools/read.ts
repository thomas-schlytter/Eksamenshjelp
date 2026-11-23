import * as fs from "node:fs/promises";
import { Type } from "typebox";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute, type ImageFileResult } from "../tool-execute.ts";
import { resolveSourcePath } from "./fs-shared.ts";
import { detectSupportedImageMimeTypeFromFile, processImage } from "../image-processing/index.ts";
import { getHeadless } from "../subagents/headless.ts";
import { compactPageSpec, openPdfPages, parsePageSpec, type PdfPageReading, type PdfPageVisual } from "../subagents/pdf-ops.ts";

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
 *   parts so the vision-capable model actually SEES them (teacher's
 *   glm-5.3-flash accepts image input per pi's zai catalog; tool-execute's
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
 *  than mid-page. Images are the expensive part (a page ≈ a screenful). */
export const PDF_PAGE_LIMIT = 20;
export const PDF_IMAGE_LIMIT = 8;
const PDF_RENDER_DPI = 150;

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

function pageBlock(page: PdfPageReading, image: "attached" | "omitted" | null, note?: string): string {
	const tag = page.visual && image ? ` [${VISUAL_REASON[page.visual]}; page image ${image}${note ? `: ${note}` : ""}]` : "";
	const body = page.markdown.trim() || (page.visual ? "[no extractable text]" : "[blank page]");
	return `--- Page ${page.number} ---${tag}\n${body}`;
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
	let reader: Awaited<ReturnType<typeof openPdfPages>>;
	try {
		reader = await openPdfPages(new Uint8Array(buffer));
	} catch (err) {
		throw new Error(`Could not open the PDF: ${err instanceof Error ? err.message : String(err)}`);
	}
	try {
		const total = reader.pageCount;
		const requested = spec ? parsePageSpec(spec, total) : Array.from({ length: total }, (_, i) => i + 1);
		if (requested.length === 0) {
			throw new Error(`No pages selected: pages="${spec}" matched nothing (the PDF has ${total} page${total === 1 ? "" : "s"}).`);
		}
		const canSee = !model || model.input.includes("image");
		const shown: PdfPageReading[] = [];
		let imageCount = 0;
		let bytes = 0;
		for (const number of requested) {
			signal?.throwIfAborted();
			if (shown.length >= PDF_PAGE_LIMIT) break;
			const page = await reader.read(number);
			const wantsImage = canSee && page.visual !== null;
			if (shown.length > 0 && wantsImage && imageCount >= PDF_IMAGE_LIMIT) break;
			const size = Buffer.byteLength(page.markdown, "utf-8");
			if (shown.length > 0 && bytes + size > MAX_BYTES) break;
			if (size > MAX_BYTES) {
				// One page alone over the ceiling: keep its head, say so.
				let cut = page.markdown.slice(0, MAX_BYTES);
				while (Buffer.byteLength(cut, "utf-8") > MAX_BYTES) cut = cut.slice(0, -1024);
				page.markdown = `${cut}\n\n[Page ${number} truncated at ${formatSize(MAX_BYTES)}.]`;
			}
			shown.push(page);
			bytes += Math.min(size, MAX_BYTES);
			if (wantsImage) imageCount++;
		}

		// Render the pages that need looking at, in page order.
		const toRender = canSee ? shown.filter((p) => p.visual !== null).map((p) => p.number) : [];
		const images: { page: number; data: string; mimeType: string }[] = [];
		const failures = new Map<number, string>();
		const hints: string[] = [];
		if (toRender.length > 0) {
			try {
				const rendered = await getHeadless().renderPdfPages(absolute, toRender, { dpi: PDF_RENDER_DPI });
				for (const { page, png } of rendered) {
					const processed = await processImage(png, "image/png", { resizeOptions: model?.inputLimits?.images?.resize });
					signal?.throwIfAborted();
					if (processed.ok) {
						images.push({ page, data: processed.data, mimeType: processed.mimeType });
						for (const hint of processed.hints) if (!hints.includes(hint)) hints.push(hint);
					} else failures.set(page, processed.message);
				}
				for (const page of toRender) {
					if (!images.some((i) => i.page === page) && !failures.has(page)) failures.set(page, "not rendered");
				}
			} catch (err) {
				signal?.throwIfAborted();
				const message = err instanceof Error ? err.message : String(err);
				for (const page of toRender) failures.set(page, `render failed (${message})`);
			}
		}

		const range = compactPageSpec(shown.map((p) => p.number));
		const lines = [`PDF: ${absolute} (${total} page${total === 1 ? "" : "s"}). Showing page${shown.length === 1 ? "" : "s"} ${range}.`];
		if (images.length > 0) {
			lines.push(`Page images follow after this text, in page order: ${images.map((i) => `p${i.page}`).join(", ")}. Read them for what the text misses (handwriting, figures, equations).`);
			lines.push(...hints);
		}
		if (!canSee && shown.some((p) => p.visual !== null)) {
			lines.push("[Current model does not support images. Page images are omitted; only the extracted text is shown.]");
		}
		lines.push("");
		for (const page of shown) {
			const image = page.visual === null ? null : !canSee || failures.has(page.number) ? "omitted" : "attached";
			lines.push(pageBlock(page, image, failures.get(page.number)), "");
		}
		const rest = requested.slice(shown.length);
		if (rest.length > 0) {
			const next = compactPageSpec(rest);
			lines.push(`[${rest.length} more page${rest.length === 1 ? "" : "s"} (${next}). Use pages="${next}" to continue.]`);
		}
		const text = lines.join("\n").trimEnd();
		return {
			text,
			images: images.map(({ data, mimeType }) => ({ data, mimeType })),
			// The record's tool part (the transcript card): the text the model
			// read, and which pages went along as pictures — never the bytes.
			details: { text, images: images.map((i) => ({ page: i.page })) },
		};
	} finally {
		await reader.close().catch(() => {});
	}
}

/**
 * The read tool, shared verbatim by the prober and the teacher. Sources v1
 * (2026-09-19): the description is pi-verbatim (user: copy tool usage
 * guidance exactly) — the teaching doctrine moved to the shared prompt
 * fragment (prompts/shared/). Relative paths resolve against the
 * learner's home (fs-shared.ts), the harness's anchor.
 */
export type ReadModel = Pick<Model<Api>, "input" | "inputLimits">;

/** One implementation for every learner-file reader. Bind the active model
 * per agent, rather than sharing mutable model state between conversations.
 * Home-relative paths, text slicing and the app's abort guard stay unchanged;
 * image detection/processing and its notes follow native Pi read behavior. */
export function createReadTool(model?: ReadModel): AgentTool<typeof readInput> {
	return {
		name: "read",
		label: "read",
		description: `Read the contents of a file. Supports text files, images (jpg, png, gif, webp, bmp) and PDFs. Images are sent as attachments. For text files, output is truncated to 2000 lines or 50.0KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete. PDFs return each page's text under its page number, plus a page image for pages the text alone can't carry (scans, handwriting, figures, math); at most ${PDF_PAGE_LIMIT} pages and ${PDF_IMAGE_LIMIT} page images per call. Use pages (e.g. "1-5") for a range, and continue with the pages the result names.`,
		parameters: readInput,
		execute: serverExecute("read", readInput, async ({ path: rawPath, offset, limit, pages }, { signal }): Promise<string | ImageFileResult> => {
			const absolute = resolveSourcePath(rawPath);
			const mime = await detectSupportedImageMimeTypeFromFile(absolute);
			const buffer = await fs.readFile(absolute, { signal });
			if (mime) {
				const processed = await processImage(buffer, mime, { resizeOptions: model?.inputLimits?.images?.resize });
				signal?.throwIfAborted();
				const note = processed.ok
					? [`Read image file [${processed.mimeType}]`, ...processed.hints]
					: [`Read image file [${mime}]`, processed.message];
				if (model && !model.input.includes("image")) {
					note.push("[Current model does not support images. The image will be omitted from this request.]");
				}
				return {
					text: note.join("\n"),
					...(processed.ok ? { images: [{ data: processed.data, mimeType: processed.mimeType }] } : {}),
				};
			}
			if (isPdf(buffer)) return readPdf(absolute, buffer, pages, model, signal);
			return readTextSlice(buffer.toString("utf-8"), offset, limit);
		}),
	};
}

export const readTool = createReadTool();
