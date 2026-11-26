/**
 * LaTeX double-check (2026-11-26, owner: «Ved prøveeksamen og andre steder
 * med latex og PDF, må det dobbeltsjekkes»).
 *
 * KaTeX with throwOnError:false prints a formula it cannot parse as its raw
 * source in red. Two layers stop that from reaching the student:
 *
 *  1. `latexProblems` / `latexInputProblems`: model-facing problems for
 *     every math span that KaTeX rejects. The question tools and the mock
 *     exam maker return these to the model, which fixes them before anything
 *     is shown or printed.
 *  2. `repairInlineTags`: display-only repair of the most common slip,
 *     `\tag{1}` inside inline math (KaTeX allows \tag only in display mode):
 *     the tag is moved out as plain «(1)» after the formula. Used by
 *     transformMathDelimiters, so chat, docks and the exam PDF all get it.
 */
import katex from "katex";
import { readContentSpans } from "./content-reader.ts";

export interface LatexError {
	tex: string;
	display: boolean;
	message: string;
}

const TAG = /\\tag\*?\s*\{([^{}]*)\}/;

function katexError(body: string, display: boolean): string | null {
	try {
		katex.renderToString(body, { displayMode: display, throwOnError: true, strict: "ignore", trust: false, output: "html" });
		return null;
	} catch (err) {
		return err instanceof Error ? err.message.replace(/^KaTeX parse error:\s*/, "") : String(err);
	}
}

/** Display math is `$$` on its own line; `$$…$$` inside a sentence renders
 *  inline (the app's grammar), so \tag fails there too. */
function rendersAsDisplay(text: string, start: number, raw: string): boolean {
	if (!raw.startsWith("$$") && !raw.startsWith("\\[")) return false;
	const before = text.slice(text.lastIndexOf("\n", start - 1) + 1, start);
	const endIdx = start + raw.length;
	const lineEnd = text.indexOf("\n", endIdx);
	const after = text.slice(endIdx, lineEnd === -1 ? text.length : lineEnd);
	return /^[ \t>]*$/.test(before) && /^[ \t]*$/.test(after);
}

/** Every math span KaTeX cannot render, as it will be rendered. */
export function latexErrors(markdown: string): LatexError[] {
	if (!markdown || !/[$\\]/.test(markdown)) return [];
	const errors: LatexError[] = [];
	let offset = 0;
	for (const span of readContentSpans(markdown)) {
		const start = offset;
		offset += span.raw.length;
		if (span.kind !== "math") continue;
		const body = span.body.trim();
		if (!body) continue;
		const display = rendersAsDisplay(markdown, start, span.raw);
		const message = katexError(body, display);
		if (message) errors.push({ tex: span.raw, display, message });
	}
	return errors;
}

function hintFor(error: LatexError): string {
	if (/\\tag/.test(error.tex) && !error.display) return " \\tag only works in display math: put the equation alone on its own line as $$ … \\tag{1} $$, or drop \\tag and write (1) after it.";
	if (/\\begin\{(align|equation|gather)/.test(error.tex) && !error.display) return " Environments like align need display math on their own lines ($$ … $$).";
	return " Fix the TeX so it renders with KaTeX.";
}

/** Model-facing problems for one Markdown field (`where` names the field). */
export function latexProblems(markdown: string | undefined, where: string): string[] {
	if (typeof markdown !== "string") return [];
	return latexErrors(markdown).map((error) => {
		const shown = error.tex.length > 120 ? `${error.tex.slice(0, 117)}…` : error.tex;
		return `${where}: LaTeX does not render: ${shown} — ${error.message}.${hintFor(error)}`;
	});
}

/** Every string field of a tool input (figureSvg excluded), recursively. */
export function latexInputProblems(input: unknown, path = ""): string[] {
	if (typeof input === "string") return latexProblems(input, path || "input");
	if (Array.isArray(input)) return input.flatMap((item, i) => latexInputProblems(item, `${path}[${i}]`));
	if (input && typeof input === "object") {
		return Object.entries(input as Record<string, unknown>).flatMap(([key, value]) =>
			key === "figureSvg" || key === "svg" ? [] : latexInputProblems(value, path ? `${path}.${key}` : key),
		);
	}
	return [];
}

/** Display-only: move `\tag{…}` out of math that renders inline. */
export function repairInlineTags(markdown: string): string {
	if (!markdown || !markdown.includes("\\tag")) return markdown;
	let offset = 0;
	return readContentSpans(markdown)
		.map((span) => {
			const start = offset;
			offset += span.raw.length;
			if (span.kind !== "math" || !TAG.test(span.body)) return span.raw;
			if (rendersAsDisplay(markdown, start, span.raw)) return span.raw;
			const label = TAG.exec(span.body)![1]!.trim();
			const body = span.body.replace(TAG, "").replace(/\s+$/, "");
			return `${span.open}${body}${span.close} (${label})`;
		})
		.join("");
}
