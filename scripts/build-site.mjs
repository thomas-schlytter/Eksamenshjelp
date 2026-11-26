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
const UPDATE_TEMPLATE = path.join(SITE_DIR, "prompts", "oppdatering.txt");
const TOOLS = path.join(SITE_DIR, "prompts", "verktoy.json");

/**
 * Every file that carries prompts, with the prompt keys it must hold once
 * each. The release notes are Markdown (code blocks), so they are not
 * HTML-escaped; `{{version}}` in them is filled by the release workflow.
 */
export const PROMPT_PAGES = [
	{ file: path.join(SITE_DIR, "index.html"), keys: ["claude", "claude-lh", "codex", "codex-lh"], html: true },
	{ file: path.join(SITE_DIR, "oppdater.html"), keys: ["oppdater-claude", "oppdater-codex"], html: true },
	{ file: path.join(repoRoot, ".github", "release-notes.md"), keys: ["oppdater-claude", "oppdater-codex"], html: false },
];

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

const FENCE = "```";

/** Only the tool values a template uses (the update prompt needs fewer). */
function usedValues(template, values) {
	const names = new Set([...template.matchAll(/\{\{([a-z_]+)\}\}/g)].map((m) => m[1]));
	return Object.fromEntries(Object.entries(values).filter(([name]) => names.has(name)));
}

export function renderAll() {
	const template = fs.readFileSync(TEMPLATE, "utf8");
	const update = fs.readFileSync(UPDATE_TEMPLATE, "utf8");
	const tools = JSON.parse(fs.readFileSync(TOOLS, "utf8"));
	// Each tool three times: setup, setup with the LearnHarness step, update.
	return Object.fromEntries(
		Object.entries(tools).flatMap(([tool, values]) => [
			[tool, renderPrompt(template, values)],
			[`${tool}-lh`, renderPrompt(template, values, { learnharness: true })],
			[`oppdater-${tool}`, renderPrompt(update, usedValues(update, values))],
		]),
	);
}

/** Replace each key's marked block; every key needs exactly one block. */
export function fillIndex(html, prompts, { keys = Object.keys(prompts), escape = true, name = "index.html" } = {}) {
	let out = html;
	for (const key of keys) {
		const text = prompts[key];
		if (typeof text !== "string") throw new Error(`build-site: no prompt named ${key}`);
		const pattern = new RegExp(`(<!-- prompt:${key} -->)[\\s\\S]*?(<!-- /prompt:${key} -->)`, "g");
		const count = (out.match(pattern) ?? []).length;
		if (count !== 1) throw new Error(`build-site: expected one prompt:${key} block in ${name}, found ${count}`);
		// Markdown pages get the prompt as a fenced block (GitHub adds a copy button).
		out = out.replace(pattern, (_, open, close) => `${open}${escape ? escapeHtml(text) : `\n\n${FENCE}text\n${text}\n${FENCE}\n\n`}${close}`);
	}
	return out;
}

/** Every prompt page, filled: [{ file, current, filled }]. */
export function fillAll(prompts = renderAll()) {
	return PROMPT_PAGES.map((page) => {
		const current = fs.readFileSync(page.file, "utf8");
		const filled = fillIndex(current, prompts, { keys: page.keys, escape: page.html, name: path.relative(repoRoot, page.file) });
		return { file: page.file, current, filled };
	});
}

function main() {
	const check = process.argv.includes("--check");
	const pages = fillAll();
	const stale = pages.filter((page) => page.filled !== page.current);
	if (check) {
		if (stale.length > 0) {
			for (const page of stale) console.error(`${path.relative(repoRoot, page.file)} is out of date with site/prompts/. Run: node scripts/build-site.mjs`);
			process.exit(1);
		}
		console.log("Every prompt page matches site/prompts/.");
		return;
	}
	for (const page of stale) fs.writeFileSync(page.file, page.filled);
	console.log(stale.length ? `Updated: ${stale.map((page) => path.relative(repoRoot, page.file)).join(", ")}` : "Every prompt page already up to date.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
