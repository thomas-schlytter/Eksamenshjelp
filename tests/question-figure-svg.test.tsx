/**
 * The figure INSIDE the task (2026-11, «figuren i oppgaveteksten»): the
 * teacher draws the figure as SVG markup in the question call's
 * `figureSvg`. Pinned here: the rules (validation and the display seam),
 * the render check with the real resvg, the question tools bouncing a bad
 * figure back as a validation error, the one figure resolution the dock and
 * the answered card share, and both rendering the figure in the task.
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FIGURE_SVG_MAX_CHARS, figureSvgProblems, normalizeFigureSvg } from "../src/core/figure-svg.ts";
import { figureSvgInputProblems } from "../src/agent/tools/figure-svg.ts";
import { probeQuizTool, teachExplainToolFor, teachQuizToolFor } from "../src/agent/tools.ts";
import { questionFigureSvg, type LhMessage } from "../src/core/native-messages.ts";
import { buildAnswer, normalizeOptions, resolveCorrect, type QuestionData } from "../src/core/question-core.ts";
import { parseExplainInput, parseQuizInput } from "../src/core/tool-parts.ts";
import type { ChatStore } from "../src/core/ports.ts";
import type { JobRecord } from "../src/core/contracts.ts";
import { QuestionDock } from "../components/question-dock.tsx";
import { AnsweredCard } from "../components/answered-card.tsx";

/** An exam-style op-amp circuit, drawn the way the prompt asks. */
const CIRCUIT = [
	'<svg viewBox="0 0 480 280">',
	'<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z"/></marker></defs>',
	'<g stroke="#000" stroke-width="2" fill="none">',
	'<path d="M200,80 L200,200 L320,140 Z"/>',
	'<path d="M80,100 L200,100"/><path d="M160,180 L200,180"/><path d="M320,140 L400,140"/>',
	'<path d="M160,180 L160,240 M150,240 L170,240 M154,246 L166,246 M158,252 L162,252"/>',
	'<path d="M340,140 L340,40 L170,40 L170,180" marker-end="url(#arrow)"/>',
	"</g>",
	'<circle cx="340" cy="140" r="3" fill="#000"/>',
	'<text x="208" y="105" font-size="16">+</text><text x="208" y="185" font-size="16">−</text>',
	'<text x="60" y="95" font-size="15">V<tspan baseline-shift="sub" font-size="70%">in</tspan> = 2 V</text>',
	'<text x="240" y="32" font-size="15">R₂ = 4 kΩ</text>',
	"</svg>",
].join("");

describe("figureSvg rules (core/figure-svg)", () => {
	it("a clean exam circuit passes and displays with its namespace added", () => {
		assert.deepEqual(figureSvgProblems(CIRCUIT), []);
		const shown = normalizeFigureSvg(`  ${CIRCUIT}\n`);
		assert.ok(shown?.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 280">'));
	});

	const bad: Array<[string, string, RegExp]> = [
		["script", '<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>', /<script>/],
		["foreignObject", '<svg viewBox="0 0 10 10"><foreignObject><div/></foreignObject></svg>', /<foreignObject>/],
		["an event attribute", '<svg viewBox="0 0 10 10"><rect width="5" height="5" onclick="x()"/></svg>', /event attributes/],
		["an event attribute on the root", '<svg viewBox="0 0 10 10" onload="x()"><rect width="5" height="5"/></svg>', /event attributes/],
		["an external href", '<svg viewBox="0 0 10 10"><use href="https://evil.example/a.svg#x"/></svg>', /own elements/],
		["an external url()", '<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="url(https://x.example/p)"/></svg>', /url\(#id\)/],
		["an image", '<svg viewBox="0 0 10 10"><image href="#a"/></svg>', /<image>/],
		["a link", '<svg viewBox="0 0 10 10"><a href="#a"><rect width="5" height="5"/></a></svg>', /<a>/],
		["an animation", '<svg viewBox="0 0 10 10"><set attributeName="x" to="1"/></svg>', /<set>/],
		["a javascript: URL", '<svg viewBox="0 0 10 10"><rect width="5" height="5" style="x:javascript:1"/></svg>', /javascript:/],
		["no viewBox", '<svg width="10" height="10"><rect width="5" height="5"/></svg>', /needs a viewBox/],
		["a degenerate viewBox", '<svg viewBox="0 0 0 10"><rect width="5" height="5"/></svg>', /positive width and height/],
		["text before the root", 'Figur: <svg viewBox="0 0 10 10"></svg>', /ONE complete <svg>/],
		["a DOCTYPE", '<svg viewBox="0 0 10 10"><!DOCTYPE x></svg>', /DOCTYPE/],
		["LaTeX in a label", '<svg viewBox="0 0 10 10"><text>$R_1$</text></svg>', /cannot render LaTeX/],
	];
	for (const [what, svg, problem] of bad) {
		it(`rejects ${what}, and the display seam never shows it`, () => {
			const problems = figureSvgProblems(svg);
			assert.ok(problems.some((p) => problem.test(p)), problems.join(" | "));
			assert.equal(normalizeFigureSvg(svg), undefined);
		});
	}

	it("caps the size and rejects an empty field", () => {
		const huge = `<svg viewBox="0 0 10 10"><path d="${"M0,0 L1,1 ".repeat(FIGURE_SVG_MAX_CHARS / 10)}"/></svg>`;
		assert.match(figureSvgProblems(huge)[0]!, /keep it under/);
		assert.match(figureSvgProblems("   ")[0]!, /empty/);
		assert.equal(normalizeFigureSvg(42), undefined);
	});

	it("an attribute VALUE mentioning onclick is not an event attribute", () => {
		assert.deepEqual(figureSvgProblems('<svg viewBox="0 0 10 10"><text data-note="a onclick=b">x</text></svg>'), []);
	});
});

describe("the call-boundary render check (real resvg)", () => {
	it("a drawable figure passes", () => {
		assert.deepEqual(figureSvgInputProblems(CIRCUIT), []);
		assert.deepEqual(figureSvgInputProblems(undefined), []);
	});

	it("markup that does not parse comes back to fix", () => {
		const problems = figureSvgInputProblems('<svg viewBox="0 0 10 10"><rect width="5" height="5"></svg>');
		assert.equal(problems.length, 1);
		assert.match(problems[0]!, /does not parse/);
	});

	it("a figure drawn outside its viewBox renders empty and comes back", () => {
		const problems = figureSvgInputProblems('<svg viewBox="0 0 10 10"><rect x="500" y="500" width="5" height="5"/></svg>');
		assert.match(problems[0] ?? "", /empty picture/);
	});
});

describe("the question tools bounce a bad figure (validation error, the model retries)", () => {
	const chatStore = {
		getChat: () => ({ tree: { nodes: [{ id: "opamp", title: "Opamp" }], edges: [], version: 1 }, messages: [] }),
	} as unknown as ChatStore;
	const quiz = {
		type: "check" as const,
		nodeId: "opamp",
		question: "Hva er $V_o$?",
		options: [{ label: "$10$ V", value: "a" }, { label: "$2$ V", value: "b" }],
		explanation: "Ikke-inverterende forsterker.",
		correctAnswer: "a",
	};
	const text = (r: { content: Array<{ type: string; text?: string }> }) => r.content.map((c) => c.text ?? "").join("");

	it("teach quiz: a script in the figure is an error result naming the problem; a clean figure poses", async () => {
		const tool = teachQuizToolFor({ chatId: "c1", chatStore });
		const bad = await tool.execute("q1", { ...quiz, figureSvg: '<svg viewBox="0 0 10 10"><script/></svg>' });
		assert.equal((bad as { isError?: boolean }).isError, true);
		assert.match(text(bad), /<script>/);
		const good = await tool.execute("q2", { ...quiz, figureSvg: CIRCUIT });
		assert.notEqual((good as { isError?: boolean }).isError, true);
	});

	it("teach explain and the prober's probe carry the same check", async () => {
		const explain = teachExplainToolFor({ chatId: "c1", chatStore });
		const bad = await explain.execute("e1", { type: "check", nodeId: "opamp", question: "Finn $V_o$.", correctAnswer: "10 V", figureSvg: "<svg>" });
		assert.equal((bad as { isError?: boolean }).isError, true);
		const { type: _t, nodeId: _n, ...probe } = quiz;
		const probeBad = await probeQuizTool.execute("p1", { ...probe, figureSvg: '<svg width="10" height="10"/>' });
		assert.equal((probeBad as { isError?: boolean }).isError, true);
		assert.match(text(probeBad), /viewBox/);
	});

	it("the display parse keeps figureSvg (persisted calls render it)", () => {
		assert.equal(parseQuizInput({ ...quiz, figureSvg: CIRCUIT })?.figureSvg, CIRCUIT);
		assert.equal(parseExplainInput({ question: "Finn $V_o$.", correctAnswer: "10 V", figureSvg: CIRCUIT })?.figureSvg, CIRCUIT);
	});
});

describe("questionFigureSvg: one figure resolution for the dock and the answered card", () => {
	const visualJob = {
		id: "job_v", kind: "visual", chatId: "c1", toolCallId: "v1", status: "done", forQuestion: "q1",
		createdAt: "2026-11-26T10:00:00.000Z", updatedAt: "2026-11-26T10:00:00.000Z", activity: "", result: { svg: '<svg viewBox="0 0 1 1"/>' },
	} as unknown as JobRecord;

	it("the drawn figure wins; a broken drawn figure falls back to the attached one", () => {
		assert.equal(questionFigureSvg({ figureSvg: CIRCUIT }, "q1", [], [visualJob])?.includes("R₂ = 4 kΩ"), true);
		assert.equal(questionFigureSvg({ figureSvg: "<svg><script/></svg>" }, "q1", [], [visualJob]), '<svg viewBox="0 0 1 1"/>');
		assert.equal(questionFigureSvg({}, "q1", [], [visualJob]), '<svg viewBox="0 0 1 1"/>');
		assert.equal(questionFigureSvg({}, "q2", [] as LhMessage[], [visualJob]), null);
	});
});

describe("the figure renders INSIDE the task", () => {
	const figure = normalizeFigureSvg(CIRCUIT)!;

	it("the dock: the figure frame sits in the task block, before the task text, and fills its width", () => {
		const html = renderToStaticMarkup(
			<QuestionDock toolName="explain" toolCallId="e1" input={{ type: "check", question: "Finn strømmen i R₂.", correctAnswer: "2 mA" }}
				figureSvg={figure} expanded onExpand={() => {}} onSubmit={() => {}} dictationClaim={false} />,
		);
		const at = html.indexOf('data-testid="question-figure"');
		assert.ok(at > 0, "the figure is in the dock");
		assert.ok(at < html.indexOf("Finn strømmen"), "figure first in the markup: above when narrow, beside (row-reverse) when wide");
		assert.match(html, /@2xl:flex-row-reverse/);
		assert.match(html, /<img[^>]*class="[^"]*\bw-full\b[^"]*"/, "the image fills the frame instead of its intrinsic size");
	});

	it("the answered card shows the same figure beside its task", () => {
		const options = normalizeOptions([{ label: "10 V", value: "a" }, { label: "2 V", value: "b" }]);
		const qd: QuestionData = {
			id: "q1", kind: "quiz", question: "Hva er V_o?", mode: "single-select", options,
			correctIndices: resolveCorrect("a", options).indices, explanation: "Forsterkning 5.", createdAt: new Date().toISOString(),
		};
		const answer = buildAnswer(qd, { values: ["a"] });
		const html = renderToStaticMarkup(<AnsweredCard answer={answer} figureSvg={figure} />);
		assert.ok(html.includes('data-testid="question-figure"'));
		assert.ok(html.indexOf('data-testid="question-figure"') < html.indexOf("Hva er V_o?"));
		const without = renderToStaticMarkup(<AnsweredCard answer={answer} />);
		assert.ok(!without.includes('data-testid="question-figure"'), "no figure, no frame");
	});
});
