/**
 * build-site.mjs — fills the setup prompts into site/index.html.
 *
 * One source for the prompt: site/prompts/oppsett.txt (the template) and
 * site/prompts/verktoy.json (the per-tool words: Claude Code, Codex). The
 * rendered, HTML-escaped text lands between the markers
 *   <!-- prompt:<tool> --> … <!-- /prompt:<tool> -->
 * in site/index.html, so the committed page works as-is (no build step on
 * Vercel, see site/vercel.json) and the page never drifts from the template.
 *
 *   node scripts/build-site.mjs           rewrite site/index.html
 *   node scripts/build-site.mjs --check   exit 1 if index.html is stale
 *                                         (a test runs this)
 *
 * When the app gets its own copy of the prompt (src/core/setup-prompts.ts),
 * point this script at that one source instead of keeping two.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SITE_DIR = path.join(repoRoot, "site");
const TEMPLATE = path.join(SITE_DIR, "prompts", "oppsett.txt");
const TOOLS = path.join(SITE_DIR, "prompts", "verktoy.json");
const INDEX = path.join(SITE_DIR, "index.html");

/**
 * Optional sections: {{#name}} … {{/name}} on their own lines are kept when
 * flags[name] is true and dropped (with their lines) otherwise. Used for the
 * «Jeg bruker LearnHarness» checkbox: one template, two variants per tool.
 */
export function applySections(template, flags = {}) {
	return template.replace(/\{\{#([a-z_]+)\}\}\n([\s\S]*?)\{\{\/\1\}\}\n*/g, (_, name, body) => (flags[name] ? `${body}\n` : ""));
}

/** Every {{name}} in the template must have a value, and vice versa. */
export function renderPrompt(template, values, flags = {}) {
	template = applySections(template, flags);
	const used = new Set();
	const text = template.replace(/\{\{([a-z_]+)\}\}/g, (_, name) => {
		if (typeof values[name] !== "string") throw new Error(`build-site: no value for {{${name}}}`);
		used.add(name);
		return values[name];
	});
	for (const name of Object.keys(values)) {
		if (!used.has(name)) throw new Error(`build-site: {{${name}}} is never used in the template`);
	}
	return text.trimEnd();
}

export function escapeHtml(text) {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderAll() {
	const template = fs.readFileSync(TEMPLATE, "utf8");
	const tools = JSON.parse(fs.readFileSync(TOOLS, "utf8"));
	// Each tool twice: plain, and "<tool>-lh" with the LearnHarness step.
	return Object.fromEntries(
		Object.entries(tools).flatMap(([tool, values]) => [
			[tool, renderPrompt(template, values)],
			[`${tool}-lh`, renderPrompt(template, values, { learnharness: true })],
		]),
	);
}

/** Replace each tool's marked block; every tool needs exactly one block. */
export function fillIndex(html, prompts) {
	let out = html;
	for (const [tool, text] of Object.entries(prompts)) {
		const pattern = new RegExp(`(<!-- prompt:${tool} -->)[\\s\\S]*?(<!-- /prompt:${tool} -->)`, "g");
		const count = (out.match(pattern) ?? []).length;
		if (count !== 1) throw new Error(`build-site: expected one prompt:${tool} block in index.html, found ${count}`);
		out = out.replace(pattern, (_, open, close) => `${open}${escapeHtml(text)}${close}`);
	}
	return out;
}

function main() {
	const check = process.argv.includes("--check");
	const html = fs.readFileSync(INDEX, "utf8");
	const filled = fillIndex(html, renderAll());
	if (check) {
		if (filled !== html) {
			console.error("site/index.html is out of date with site/prompts/. Run: node scripts/build-site.mjs");
			process.exit(1);
		}
		console.log("site/index.html matches site/prompts/.");
		return;
	}
	if (filled !== html) fs.writeFileSync(INDEX, filled);
	console.log(filled === html ? "site/index.html already up to date." : "site/index.html updated.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
