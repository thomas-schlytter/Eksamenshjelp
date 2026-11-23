/**
 * The prøveeksamen paper (fase 6): public exam → HTML (core/mock-exam-html)
 * → PDF (agent/subagents/pdf-print: the app's Electron printer, system
 * Chrome as fallback) → data/mock-exams/<CODE>/<id>/exam.pdf.
 *
 * Two passes: the cover states the page count (as NTNU covers do), and that
 * number is only known after a first print. The key never enters: the HTML
 * is built from publicMockExam.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { PATHS } from "../../config.ts";
import { mockExamFooterTemplate, mockExamHtml } from "../core/mock-exam-html.ts";
import { publicMockExam, type MockExam } from "../core/mock-exam.ts";
import { pdfPageCount, printHtmlToPdf } from "../agent/subagents/pdf-print.ts";
import { saveMockExam, saveMockExamPdf } from "../store/mock-exams.ts";

let katexCssCache: string | null = null;

/** The KaTeX stylesheet with its font URLs made absolute (file://), so a
 *  paper loaded from a temp dir still finds the math fonts. */
export function katexCssForPrint(): string {
	if (katexCssCache !== null) return katexCssCache;
	// Plain file paths only: a module-resolution of the .css (require.resolve)
	// makes Turbopack try to bundle the stylesheet into the server chunk and
	// fails the build. The standalone server chdirs into its own folder, where
	// next.config's tracing includes put node_modules/katex/dist.
	const candidates = [...new Set([PATHS.root, process.cwd()])].map((dir) => path.join(dir, "node_modules", "katex", "dist", "katex.min.css"));
	for (const file of candidates) {
		try {
			const css = fs.readFileSync(file, "utf-8");
			const fontsDir = path.join(path.dirname(file), "fonts");
			katexCssCache = css.replace(/url\((['"]?)fonts\/([^)'"]+)\1\)/g, (_m, _q, name: string) => `url("${pathToFileURL(path.join(fontsDir, name)).href}")`);
			return katexCssCache;
		} catch {
			/* next candidate */
		}
	}
	throw new Error("the KaTeX stylesheet was not found, so the math cannot be typeset");
}

/** Print the paper and save it beside the exam; stores the page count on
 *  the exam. Throws with a readable reason when no engine can print. */
export async function renderMockExamPdf(exam: MockExam): Promise<{ pdfPath: string; pageCount: number }> {
	const katexCss = katexCssForPrint();
	const pub = publicMockExam(exam);
	const footerTemplate = mockExamFooterTemplate(pub);
	const first = await printHtmlToPdf(mockExamHtml(pub, { katexCss }), { footerTemplate });
	assertPdf(first);
	const withoutCover = Math.max(0, (await pdfPageCount(first)) - 1);
	// The count is digits on one cover line: the second pass cannot reflow
	// the task pages, only fill in the number.
	const pdf = await printHtmlToPdf(mockExamHtml(pub, { katexCss, pageCount: withoutCover }), { footerTemplate });
	assertPdf(pdf);
	const pdfPath = saveMockExamPdf(exam.code, exam.id, pdf);
	saveMockExam({ ...exam, pageCount: withoutCover });
	return { pdfPath, pageCount: withoutCover };
}

function assertPdf(bytes: Uint8Array): void {
	if (bytes.length < 8 || Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") {
		throw new Error("the printer returned something that is not a PDF");
	}
}
