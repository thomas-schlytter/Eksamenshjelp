/**
 * The feature registry has no dead entries: every route, settings section,
 * keys row, shortcut, tour and anchor a feature points at exists.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FEATURES } from "../components/help/features.ts";
import { SETTINGS_SECTION_IDS } from "../components/help/types.ts";
import { actionForBinding, kbdEventForAction, KEYBOARD_ACTIONS } from "../src/core/keyboard.ts";
import { assertActionValid, routeExists, settingsDialogSections } from "./help-actions.ts";

const ROOT = join(import.meta.dirname, "..");

describe("feature registry integrity", () => {
	it("ids are unique slugs", () => {
		const ids = FEATURES.map((feature) => feature.id);
		assert.equal(new Set(ids).size, ids.length, "duplicate feature id");
		for (const id of ids) assert.match(id, /^[a-z0-9-]+$/, id);
	});

	it("every entry is findable: title, description and keywords", () => {
		for (const feature of FEATURES) {
			assert.ok(feature.title.trim(), feature.id);
			assert.ok(feature.description.trim(), feature.id);
			assert.ok(feature.keywords.length > 0, `${feature.id} has no keywords`);
		}
	});

	it("no dead actions", () => {
		for (const feature of FEATURES) assertActionValid(feature.action, `feature ${feature.id}`);
	});

	it("covers what the owner asked to be searchable", () => {
		const ids = new Set(FEATURES.map((feature) => feature.id));
		for (const id of [
			"hjem", "legg-til-fag", "apne-fag", "ny-okt", "kunnskapskart", "importer-notater", "hjelpesenter", "innstillinger",
			"innstillinger-leverandorer", "innstillinger-modeller", "innstillinger-utseende", "innstillinger-tastatur",
			"innstillinger-diktering", "innstillinger-oppdateringer", "tema-lys", "tema-mork", "tema-system", "sidemeny", "snarveioversikt",
		]) assert.ok(ids.has(id), `missing feature ${id}`);
	});

	it("the palette shows a starting menu before anything is typed", () => {
		assert.ok(FEATURES.filter((feature) => feature.suggested).length >= 3);
	});
});

describe("settings sections", () => {
	it("the help layer's section list is the settings dialog's list", () => {
		assert.deepEqual([...SETTINGS_SECTION_IDS].sort(), settingsDialogSections().sort());
	});
});

describe("route checker", () => {
	it("knows real pages from made-up ones", () => {
		assert.ok(routeExists("/"));
		assert.ok(routeExists("/hjelp"));
		assert.ok(routeExists("/hjelp#fargene"));
		assert.ok(routeExists("/chat/new"));
		assert.ok(!routeExists("/finnes-ikke"));
		assert.ok(!routeExists("/hjelp/finnes/ikke"));
	});
});

describe("help shortcuts", () => {
	it("Mod+P opens the search palette and F1 the help centre", () => {
		assert.equal(actionForBinding("mod+p"), "open-search");
		assert.equal(actionForBinding("f1"), "open-help");
	});

	it("no two dispatched actions share a default binding", () => {
		const seen = new Map<string, string>();
		for (const def of KEYBOARD_ACTIONS) {
			if (def.displayOnly) continue;
			assert.ok(!seen.has(def.binding), `${def.id} and ${seen.get(def.binding)} both bind ${def.binding}`);
			seen.set(def.binding, def.id);
		}
	});

	it("the dispatcher handles both, and answers the cheat-sheet event the palette sends", () => {
		const source = readFileSync(join(ROOT, "components/keyboard-shortcuts.tsx"), "utf8");
		assert.match(source, /case "open-search":[\s\S]*?"lh:open-help"/);
		assert.match(source, /case "open-help":[\s\S]*?router\.push\("\/hjelp"\)/);
		assert.match(source, /kbdEventForAction\("cheat-sheet"\)/);
		assert.equal(kbdEventForAction("cheat-sheet"), "lh:kbd-cheat-sheet");
	});

	it("the reference doc lists the new shortcuts", () => {
		const doc = readFileSync(join(ROOT, "docs/keyboard.md"), "utf8");
		assert.match(doc, /Mod\+P/);
		assert.match(doc, /F1/);
	});
});

describe("the help layer is mounted", () => {
	it("app/layout.tsx mounts HelpProvider inside the app shell, in Norwegian", () => {
		const layout = readFileSync(join(ROOT, "app/layout.tsx"), "utf8");
		assert.match(layout, /<AppShell>\s*<HelpProvider>\{children\}<\/HelpProvider>\s*<\/AppShell>/);
		assert.match(layout, /<html lang="nb"/);
	});
});
