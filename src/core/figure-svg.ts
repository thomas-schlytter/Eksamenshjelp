/**
 * A QUESTION'S OWN FIGURE (2026-11, «figuren i oppgaveteksten»): the
 * teacher writes the SVG markup for a task's figure (circuit diagram,
 * graph, block diagram) straight into the question call's `figureSvg`
 * field, and the dock shows it inside the task. No job, no wait.
 *
 * The markup is model-authored, so it is checked twice:
 * - at the call boundary (the question tools' execute, through
 *   figureSvgProblems plus a render check in the agent layer): a figure
 *   that breaks a rule goes back to the teacher as a validation error he
 *   fixes, the same pattern as every other authoring rule;
 * - at the display seam (normalizeFigureSvg): a persisted figure that
 *   breaks a rule is never rendered (old records, hand-edited data).
 *
 * The rules are an allow-by-shape boundary for a STATIC picture: one
 * <svg>…</svg> with a usable viewBox, no script or foreignObject, no event
 * attributes, no links, images or animations, and no reference outside
 * the document (every href and url() points at a local #id). The app also
 * renders figures through an <img> data URI (components/artifacts/
 * svg-image.tsx), where script never runs; these rules keep the stored
 * markup itself clean as well. Pure: no DOM, no native renderer.
 */

/** The largest figure a question may carry, in characters. A hand-drawn
 *  circuit or graph is a few thousand; the cap keeps a runaway call (an
 *  embedded raster, a path with ten thousand points) out of the record. */
export const FIGURE_SVG_MAX_CHARS = 60_000;

/** Elements a static figure never needs, each a way to run code, load
 *  something, or rewrite attributes after the checks. */
const FORBIDDEN_ELEMENTS = [
	"script",
	"foreignObject",
	"iframe",
	"object",
	"embed",
	"image",
	"a",
	"animate",
	"animateMotion",
	"animateTransform",
	"set",
	"handler",
	"listener",
] as const;

/** The root <svg …> start tag (attribute values may hold `>`). */
function rootTag(svg: string): string | null {
	const match = /^<svg(?:[^<>"']|"[^"]*"|'[^']*')*>/i.exec(svg);
	return match ? match[0] : null;
}

/** A root attribute's value, or null when absent. */
function rootAttribute(tag: string, name: string): string | null {
	const re = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
	const match = re.exec(tag);
	return match ? (match[1] ?? match[2] ?? "") : null;
}

/**
 * Every rule `figureSvg` breaks, as model-facing problems (empty = a
 * figure the dock may show). The text is the teacher's fix list.
 */
export function figureSvgProblems(raw: string): string[] {
	const svg = raw.trim();
	if (svg.length === 0) return ["figureSvg is empty — leave the field out when the question has no figure."];
	if (svg.length > FIGURE_SVG_MAX_CHARS) {
		return [`figureSvg is ${svg.length} characters; keep it under ${FIGURE_SVG_MAX_CHARS} (draw with fewer, simpler elements).`];
	}
	const problems: string[] = [];
	const tag = rootTag(svg);
	if (!tag || !/<\/svg>$/i.test(svg)) {
		problems.push("figureSvg must be ONE complete <svg>…</svg> element: start with <svg and end with </svg>, nothing before or after.");
	}
	if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(svg)) {
		problems.push("figureSvg must not contain a DOCTYPE, an ENTITY declaration or a stylesheet instruction.");
	}
	for (const name of FORBIDDEN_ELEMENTS) {
		if (new RegExp(`<${name}(?=[\\s/>])`, "i").test(svg)) {
			problems.push(`figureSvg must not contain <${name}> — a figure is static SVG drawing only.`);
		}
	}
	if (/<(?:[^<>"']|"[^"]*"|'[^']*')*\son[a-z]+\s*=/i.test(svg)) {
		problems.push("figureSvg must not contain event attributes (onclick, onload, …).");
	}
	if (/javascript:/i.test(svg)) problems.push("figureSvg must not contain javascript: URLs.");
	if (/@import/i.test(svg)) problems.push("figureSvg must not use @import.");
	for (const match of svg.matchAll(/\s(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
		const value = (match[1] ?? match[2] ?? "").trim();
		if (!value.startsWith("#")) {
			problems.push(`figureSvg may only reference its own elements (href="#id"); found href="${value.slice(0, 60)}".`);
			break;
		}
	}
	if (/url\(\s*(?!['"]?\s*#)/i.test(svg)) {
		problems.push("figureSvg may only use url(#id) references to its own elements — no external or data: URLs.");
	}
	if (tag) {
		const viewBox = rootAttribute(tag, "viewBox");
		const numbers = viewBox?.trim().split(/[\s,]+/).map(Number) ?? [];
		if (!viewBox) {
			problems.push('figureSvg needs a viewBox on the root <svg>, e.g. viewBox="0 0 400 240", so it scales to the answer field.');
		} else if (numbers.length !== 4 || numbers.some((n) => !Number.isFinite(n)) || numbers[2]! <= 0 || numbers[3]! <= 0) {
			problems.push(`figureSvg's viewBox "${viewBox}" must be four numbers "minX minY width height" with a positive width and height.`);
		}
	}
	if (/\$[^$<>\n]*[\\_^][^$<>\n]*\$/.test(svg)) {
		problems.push(
			"figureSvg text cannot render LaTeX: write labels as plain SVG text, e.g. R₁ or R<tspan baseline-shift=\"sub\" font-size=\"70%\">1</tspan>, never $R_1$.",
		);
	}
	return problems;
}

/** The SVG namespace on the root when the author left it out — an <img>
 *  data URI and the native renderer both refuse a namespace-less SVG. */
export function withFigureNamespace(svg: string): string {
	const tag = rootTag(svg);
	if (!tag || /\sxmlns\s*=/.test(tag)) return svg;
	return svg.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
}

/**
 * The DISPLAY seam for a question's `figureSvg`: the trimmed markup with
 * its namespace when every rule holds, else undefined (the dock and the
 * answered card then show no figure — never a figure that broke a rule).
 */
export function normalizeFigureSvg(raw: unknown): string | undefined {
	if (typeof raw !== "string") return undefined;
	const svg = raw.trim();
	if (figureSvgProblems(svg).length > 0) return undefined;
	return withFigureNamespace(svg);
}
