import { createRequire } from "node:module";
import { figureSvgProblems, withFigureNamespace } from "../../core/figure-svg.ts";

/**
 * The call-boundary check for a question's `figureSvg` (2026-11): the pure
 * rules (core/figure-svg) and then a real render with resvg, the same
 * native rasterizer the visual-maker and the mock-exam maker use. A figure
 * that does not parse, or parses into an empty picture, goes back to the
 * teacher as a validation problem instead of an empty box in the dock.
 */

let resvgModule: typeof import("@resvg/resvg-js") | null = null;

/** Test seam: replaces the native render check. */
export const figureRenderCheck: { current: (svg: string) => string | null } = { current: renderProblem };

/** Render once at a modest width; any painted pixel counts as a picture. */
function renderProblem(svg: string): string | null {
	let pixels: Uint8Array;
	try {
		resvgModule ??= createRequire(import.meta.url)("@resvg/resvg-js") as typeof import("@resvg/resvg-js");
		const rendered = new resvgModule.Resvg(svg, { fitTo: { mode: "width", value: 400 }, font: { loadSystemFonts: false } }).render();
		pixels = rendered.pixels;
	} catch (err) {
		return `figureSvg does not parse as SVG (${err instanceof Error ? err.message : String(err)}). Fix the markup.`;
	}
	for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 0) return null;
	return "figureSvg renders as an empty picture — check the viewBox against your coordinates, and that strokes or fills are set.";
}

/** Every problem with an optional `figureSvg` (empty = none, or valid). */
export function figureSvgInputProblems(svg: string | undefined): string[] {
	if (svg === undefined) return [];
	const problems = figureSvgProblems(svg);
	if (problems.length > 0) return problems;
	const render = figureRenderCheck.current(withFigureNamespace(svg.trim()));
	return render ? [render] : [];
}
