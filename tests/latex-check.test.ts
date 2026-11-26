/**
 * LaTeX double-check (2026-11-26): KaTeX failures become model-facing
 * problems, and \tag in inline math is repaired for display.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { latexErrors, latexInputProblems, latexProblems, repairInlineTags } from "../src/core/latex-check.ts";
import { transformMathDelimiters } from "../src/core/math-delims.ts";
import { markdownToHtml } from "../src/core/mock-exam-html.ts";

const OWNER_CASE = "Bestem $A$ og $B$ slik at $y_p(x) = Axe^{-x} + B$ er en løsning av $y''(x) - y'(x) - 2y(x) = 6e^{-x} + 4. \\tag{1}$\nFinn deretter løsningen.";

describe("latexErrors", () => {
	it("finds the owner's case: \\tag inside inline math", () => {
		const errors = latexErrors(OWNER_CASE);
		assert.equal(errors.length, 1);
		assert.match(errors[0]!.tex, /\\tag\{1\}/);
		assert.equal(errors[0]!.display, false);
	});

	it("accepts \\tag in display math on its own line, and ordinary math", () => {
		assert.deepEqual(latexErrors("Likningen\n\n$$\ny'' - y' - 2y = 4 \\tag{1}\n$$\n\nog $\\int_0^1 x\\,dx = \\tfrac12$."), []);
		assert.deepEqual(latexErrors("Ingen matte her, bare 5 kr."), []);
	});

	it("reports broken TeX like a missing brace", () => {
		assert.equal(latexErrors("Se $\\frac{1}{2$ her.").length, 1);
	});
});

describe("latexProblems / latexInputProblems", () => {
	it("names the field and tells the model how to fix \\tag", () => {
		const [problem] = latexProblems(OWNER_CASE, 'task "4" part "" text');
		assert.match(problem!, /^task "4" part "" text: LaTeX does not render:/);
		assert.match(problem!, /\\tag only works in display math/);
	});

	it("walks every string of a tool input except the figure", () => {
		const problems = latexInputProblems({
			question: "Hva er $\\frac{1}{2$?",
			options: [{ label: "$x^2$" }, { label: "$\\sqrt{x$" }],
			figureSvg: "<svg>$\\frac{</svg>",
		});
		assert.equal(problems.length, 2);
		assert.match(problems[0]!, /^question:/);
		assert.match(problems[1]!, /^options\[1\]\.label:/);
	});
});

describe("repairInlineTags (display only)", () => {
	it("moves the tag out of inline math", () => {
		assert.equal(repairInlineTags("løsning av $y = 4. \\tag{1}$\nFinn"), "løsning av $y = 4.$ (1)\nFinn");
	});

	it("leaves display math and tag-free text alone", () => {
		const display = "Likning\n\n$$\ny = 4 \\tag{1}\n$$\n";
		assert.equal(repairInlineTags(display), display);
		assert.equal(repairInlineTags("$x$ og $y$"), "$x$ og $y$");
	});

	it("reaches the chat and the exam PDF through transformMathDelimiters", () => {
		assert.ok(!transformMathDelimiters(OWNER_CASE).includes("\\tag"));
		const html = markdownToHtml(OWNER_CASE);
		assert.ok(!html.includes("katex-error"), "no red source in the PDF");
		assert.ok(html.includes(" (1)"));
	});
});
