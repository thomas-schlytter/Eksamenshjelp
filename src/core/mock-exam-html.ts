/**
 * The mock exam as a printable HTML document (fase 6) — what the PDF is
 * printed from. A sober NTNU-style paper: a cover page with the exam facts
 * (as the past papers list them), then the tasks with their points, parts,
 * figures and multiple-choice options. Math is KaTeX HTML; figures are SVG
 * inside <img> data URIs (an image document never runs script or loads
 * anything). No script anywhere, and a CSP that forbids it.
 *
 * Takes the PUBLIC exam only: the type carries no key, so no solution,
 * rubric or correct option can reach the paper.
 *
 * Pure (string in, string out). The caller passes the KaTeX stylesheet with
 * its font URLs already resolved.
 */

import katex from "katex";
import { fromMarkdown } from "mdast-util-from-markdown";
import { mathFromMarkdown } from "mdast-util-math";
import { math } from "micromark-extension-math";
import { transformMathDelimiters } from "./math-delims.ts";
import { durationLabel, pointsLabel, taskPoints, totalPoints, withSvgNamespace, type PublicMockExam } from "./mock-exam.ts";

type MdNode = {
	type: string;
	value?: string;
	children?: MdNode[];
	ordered?: boolean;
	start?: number | null;
	depth?: number;
	url?: string;
	alt?: string;
};

export function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function tex(body: string, display: boolean): string {
	try {
		return katex.renderToString(body, { displayMode: display, throwOnError: false, trust: false, strict: false, output: "html" });
	} catch {
		return `<code>${escapeHtml(body)}</code>`;
	}
}

function renderNodes(nodes: MdNode[] | undefined): string {
	return (nodes ?? []).map(renderNode).join("");
}

function renderNode(node: MdNode): string {
	switch (node.type) {
		case "root":
			return renderNodes(node.children);
		case "paragraph":
			return `<p>${renderNodes(node.children)}</p>`;
		case "heading":
			return `<p class="md-heading"><strong>${renderNodes(node.children)}</strong></p>`;
		case "text":
			return escapeHtml(node.value ?? "");
		case "strong":
			return `<strong>${renderNodes(node.children)}</strong>`;
		case "emphasis":
			return `<em>${renderNodes(node.children)}</em>`;
		case "delete":
			return renderNodes(node.children);
		case "inlineCode":
			return `<code>${escapeHtml(node.value ?? "")}</code>`;
		case "code":
			return `<pre><code>${escapeHtml(node.value ?? "")}</code></pre>`;
		case "break":
			return "<br>";
		case "thematicBreak":
			return "<hr>";
		case "blockquote":
			return `<blockquote>${renderNodes(node.children)}</blockquote>`;
		case "list": {
			const tag = node.ordered ? "ol" : "ul";
			const start = node.ordered && typeof node.start === "number" && node.start !== 1 ? ` start="${node.start}"` : "";
			return `<${tag}${start}>${renderNodes(node.children)}</${tag}>`;
		}
		case "listItem":
			return `<li>${renderNodes(node.children)}</li>`;
		// Links print as their text: a paper has nothing to click.
		case "link":
		case "linkReference":
			return renderNodes(node.children);
		case "image":
		case "imageReference":
			return node.alt ? escapeHtml(node.alt) : "";
		case "inlineMath":
			return tex(node.value ?? "", false);
		case "math":
			return `<div class="math-display">${tex(node.value ?? "", true)}</div>`;
		case "html":
			return escapeHtml(node.value ?? "");
		default:
			return node.children ? renderNodes(node.children) : escapeHtml(node.value ?? "");
	}
}

/** Markdown + $…$ / $$…$$ math → HTML (the app's own math grammar). */
export function markdownToHtml(markdown: string): string {
	const source = transformMathDelimiters(markdown ?? "");
	const tree = fromMarkdown(source, {
		extensions: [math({ singleDollarTextMath: true })],
		mdastExtensions: [mathFromMarkdown()],
	}) as unknown as MdNode;
	return renderNode(tree);
}

/** A figure as an image document (never inline SVG: no script, no fetch). */
function figureHtml(svg: string | undefined): string {
	if (!svg) return "";
	return `<figure class="figure"><img alt="Figur" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(withSvgNamespace(svg))}"></figure>`;
}

const PAPER_CSS = `
@page { size: A4; margin: 22mm 20mm 20mm 20mm; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: "Times New Roman", Times, serif; font-size: 11.5pt; line-height: 1.45; color: #000; background: #fff; margin: 0; }
.cover { page-break-after: always; break-after: page; }
.cover .inst { font-size: 10pt; margin: 0 0 18mm 0; color: #000; }
.cover h1 { font-size: 17pt; font-weight: bold; margin: 0 0 2mm 0; }
.cover .mock { font-size: 10.5pt; font-style: italic; margin: 0 0 12mm 0; }
.cover dl { display: grid; grid-template-columns: max-content 1fr; gap: 2.2mm 6mm; margin: 0 0 10mm 0; }
.cover dt { font-weight: bold; }
.cover dd { margin: 0; }
.cover .info { margin-top: 8mm; }
.cover .info p { margin: 0 0 2mm 0; }
.task { margin: 0 0 9mm 0; }
.task h2 { font-size: 13pt; font-weight: bold; margin: 0 0 3mm 0; break-after: avoid; }
.part { margin: 0 0 4mm 0; }
.part .lead { font-weight: bold; }
.part > .body > p:first-child { display: inline; }
.options { list-style: none; padding: 0; margin: 2mm 0 0 6mm; }
.options li { margin: 0 0 1.4mm 0; display: flex; gap: 3mm; align-items: baseline; }
.options .box { display: inline-block; width: 3.2mm; height: 3.2mm; border: 0.3mm solid #000; flex: none; transform: translateY(0.4mm); }
.options .opt > p { display: inline; margin: 0; }
.choose { font-style: italic; margin: 2mm 0 0 0; }
.figure { margin: 3mm 0; text-align: center; break-inside: avoid; }
.figure img { max-width: 100%; max-height: 95mm; }
.math-display { margin: 2mm 0; overflow: hidden; }
p { margin: 0 0 2mm 0; }
.md-heading { margin-top: 3mm; }
pre { font-size: 10pt; white-space: pre-wrap; }
`;

export interface MockExamHtmlOptions {
	/** The KaTeX stylesheet, font URLs already absolute (file:// or data:). */
	katexCss: string;
	/** Pages without the cover (known after a first render); absent → "–". */
	pageCount?: number;
}

/**
 * The whole paper. `exam` is the public shape — the key is not in the type,
 * so it cannot be printed.
 */
export function mockExamHtml(exam: PublicMockExam, opts: MockExamHtmlOptions): string {
	const { cover } = exam;
	const facts: Array<[string, string]> = [
		["Eksamensdato:", cover.date],
		...(cover.time ? ([["Eksamenstid (fra–til):", cover.time]] as Array<[string, string]>) : []),
		["Varighet:", durationLabel(cover.durationMinutes)],
		["Hjelpemiddelkode/Tillatte hjelpemidler:", cover.aids],
		["Målform/språk:", "Bokmål"],
		["Antall oppgaver:", String(exam.tasks.length)],
		[exam.scoring === "percent" ? "Vekting:" : "Totalt antall poeng:", exam.scoring === "percent" ? "Vektingen står ved hver oppgave (sum 100 %)" : String(totalPoints(exam)).replace(".", ",")],
		["Antall sider (uten forside):", opts.pageCount !== undefined ? String(opts.pageCount) : "–"],
	];
	const coverHtml = `
<section class="cover">
<p class="inst">Norges teknisk-naturvitenskapelige universitet</p>
<h1>Eksamensoppgave i ${escapeHtml(exam.code)} ${escapeHtml(exam.courseName)}</h1>
<p class="mock">Prøveeksamen, laget i Eksamenshjelp etter formen på tidligere eksamener.</p>
<dl>${facts.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("")}</dl>
${cover.info && cover.info.length > 0 ? `<div class="info"><p><strong>Annen informasjon:</strong></p>${cover.info.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</div>` : ""}
</section>`;

	const tasksHtml = exam.tasks
		.map((task) => {
			const heading = `Oppgave ${escapeHtml(task.number)}${task.title ? ` ${escapeHtml(task.title)}` : ""} (${escapeHtml(pointsLabel(taskPoints(task), exam.scoring))})`;
			const single = task.parts.length === 1 && task.parts[0]!.label === "";
			const parts = task.parts
				.map((part) => {
					const lead = single ? "" : `<span class="lead">${escapeHtml(part.label)})</span> (${escapeHtml(pointsLabel(part.points, exam.scoring))}) `;
					const options = part.options && part.options.length > 0
						? `<p class="choose">Velg ett alternativ:</p><ul class="options">${part.options
							.map((o) => `<li><span class="box"></span><span class="opt">${markdownToHtml(o.text)}</span></li>`)
							.join("")}</ul>`
						: "";
					return `<div class="part"><div class="body">${lead}${markdownToHtml(part.text)}</div>${figureHtml(part.figureSvg)}${options}</div>`;
				})
				.join("");
			return `<section class="task"><h2>${heading}</h2>${task.intro ? markdownToHtml(task.intro) : ""}${figureHtml(task.figureSvg)}${parts}</section>`;
		})
		.join("");

	return `<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src file: data:; img-src data:">
<title>${escapeHtml(exam.title)}</title>
<style>${opts.katexCss}</style>
<style>${PAPER_CSS}</style>
</head>
<body>
${coverHtml}
${tasksHtml}
</body>
</html>`;
}

/** The page footer (Chromium print template): course + page x of y. */
export function mockExamFooterTemplate(exam: Pick<PublicMockExam, "code">): string {
	return `<div style="width:100%;font-family:'Times New Roman',serif;font-size:9pt;color:#000;padding:0 20mm;display:flex;justify-content:space-between"><span>${escapeHtml(exam.code)} prøveeksamen</span><span><span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`;
}
