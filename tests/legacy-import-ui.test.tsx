/**
 * Static render of «Importer fra LearnHarness» (components/import/): each
 * step's first-paint markup, the checkbox rules, the receipt, the home
 * hint and the entry points. Effects do not run under
 * renderToStaticMarkup; the frame is pure (props in, markup out).
 * Same tsx classic-JSX shim as the other render tests.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CoursesOverview } from "../components/courses/courses-home.tsx";
import { findArticle } from "../components/help/content.ts";
import { FEATURES } from "../components/help/features.ts";
import { buildPaletteGroups } from "../components/help/palette-model.ts";
import { OPEN_LEGACY_IMPORT_EVENT } from "../components/import/legacy-import-event.ts";
import { candidateWorthImporting, LegacyImportHintLine } from "../components/import/legacy-import-hint.tsx";
import {
	candidateSummary, importOptions, INITIAL_IMPORT_STATE, LegacyImportBody, receiptLines, type ImportDialogState,
} from "../components/import/legacy-import.tsx";
import { SettingsDialogBody } from "../components/settings/settings-dialog.tsx";
import { defaultImportInclude, parseImportInclude, type ImportCandidate, type ImportPreview, type ImportResult } from "../src/core/data-import.ts";

const ROOT = join(import.meta.dirname, "..");
const noop = () => {};
const handlers = {
	onPick: noop, onPathChange: noop, onPreviewPath: noop, onDropPath: noop, onToggle: noop,
	onBack: noop, onRun: noop, onClose: noop, onGoHome: noop, onGoGraph: noop,
};
const render = (state: Partial<ImportDialogState>) => renderToStaticMarkup(<LegacyImportBody state={{ ...INITIAL_IMPORT_STATE, ...state }} {...handlers} />);

function makePreview(over: Partial<Omit<ImportPreview, "defaults">> = {}): ImportPreview {
	const base: Omit<ImportPreview, "defaults"> = {
		dataDir: "/Users/test/Library/Application Support/LearnHarness/data",
		chats: { total: 3, new: 2, existing: 1, unsupported: 0, newTitles: ["Lineær algebra", "Termodynamikk"] },
		jobs: { total: 4, new: 4 },
		graph: { present: true, blocked: null, propositions: { total: 927, new: 900 }, chains: { total: 273, new: 270 }, sources: { total: 9, new: 9 } },
		settings: { present: true, targetHasSettings: false },
		keys: { present: true, variables: ["OPENAI_API_KEY"], newVariables: ["OPENAI_API_KEY"] },
		prompts: { total: 1, new: 1 },
		notes: [],
		...over,
	};
	return { ...base, defaults: defaultImportInclude(base) };
}

const candidate: ImportCandidate = { path: "/Users/test/Library/Application Support/LearnHarness", label: "LearnHarness (skrivebordsappen)", current: false, preview: makePreview() };

const result: ImportResult = {
	dataDir: "/x/data",
	backupDir: "/app/data/backups/import-2026-11-14T10-00-00-000Z",
	chats: { imported: 2, existing: 1, unsupported: 0 },
	jobs: { imported: 4, settled: 1 },
	graph: { propositions: 900, nodeLines: 1300, chains: 270, chainLines: 280, coverage: 70, checkpoints: 9, sources: 9, positions: 1000, organization: "copied", renderSettings: true, corruptLines: 0 },
	settings: { outcome: "copied", sections: ["models", "appearance"] },
	keys: { imported: 1, variables: ["OPENAI_API_KEY"] },
	prompts: { imported: 1 },
	skipped: [{ what: "1 økt", reason: "Finnes allerede her og ble ikke overskrevet." }],
	graphRevision: 1,
};

describe("import defaults (core)", () => {
	it("sessions and graph on, keys always off, settings only into an app without any", () => {
		assert.deepEqual(makePreview().defaults, { chats: true, graph: true, settings: true, keys: false, prompts: true });
		assert.equal(makePreview({ settings: { present: true, targetHasSettings: true } }).defaults.settings, false);
		assert.equal(makePreview({ graph: { ...makePreview().graph, blocked: "nyere" } }).defaults.graph, false);
		assert.equal(makePreview({ prompts: { total: 0, new: 0 } }).defaults.prompts, false);
	});

	it("a malformed include never widens the import", () => {
		assert.deepEqual(parseImportInclude({ chats: true, keys: "true", graph: 1 }), { chats: true, graph: false, settings: false, keys: false, prompts: false });
		assert.deepEqual(parseImportInclude(null), { chats: false, graph: false, settings: false, keys: false, prompts: false });
	});
});

describe("LegacyImportBody (static render)", () => {
	it("source step: searching, then the folders found, plus the manual path and where to look", () => {
		const loading = render({});
		assert.ok(loading.includes('data-step="source"'));
		assert.ok(loading.includes("Ser etter LearnHarness-data på denne maskinen"));

		const html = render({ candidates: [candidate, { path: "/own", label: "LearnHarness (utviklerbygg)", current: true }] });
		assert.ok(html.includes('role="dialog"') && html.includes("Importer fra LearnHarness"));
		assert.ok(html.includes("Fant LearnHarness-data på denne maskinen"));
		assert.equal(html.split('data-testid="legacy-import-candidate"').length - 1, 1, "the app's own folder is not offered");
		assert.ok(html.includes("3 økter, 927 påstander, 273 kjeder"));
		assert.ok(html.includes("Velg en annen mappe"));
		assert.ok(html.includes('data-testid="legacy-import-path"'));
		for (const where of ["~/Library/Application Support/LearnHarness", "%APPDATA%\\LearnHarness", "~/.config/LearnHarness"]) assert.ok(html.includes(where), where);
	});

	it("source step: says so when nothing was found, or when the folder is already shared", () => {
		assert.ok(render({ candidates: [] }).includes("Fant ingen LearnHarness-data på standardplassen"));
		assert.ok(render({ candidates: [{ path: "/own", label: "x", current: true }] }).includes("bruker allerede samme datamappe"));
		assert.ok(render({ candidates: [], error: "Fant ikke mappen. Sjekk at stien er riktig." }).includes('role="alert"'));
	});

	it("preview step: numbers, the five choices, keys unticked with the plain-language promise", () => {
		const preview = makePreview();
		const html = render({ step: "preview", preview, include: preview.defaults, path: candidate.path });
		assert.ok(html.includes('data-step="preview"'));
		for (const key of ["chats", "graph", "settings", "keys", "prompts"]) assert.ok(html.includes(`data-testid="legacy-import-option-${key}"`), key);
		assert.ok(html.includes("2 nye økter"));
		assert.ok(html.includes("1 økt finnes allerede her og røres ikke"));
		assert.ok(html.includes("900 nye påstander og 270 nye kjeder"));
		assert.ok(html.includes("Nøklene kopieres mellom to mapper på din egen maskin og sendes ingen steder."));
		assert.ok(html.includes("OPENAI_API_KEY"));
		const keys = /data-testid="legacy-import-option-keys"[^>]*><input[^>]*>/.exec(html)?.[0] ?? "";
		assert.ok(keys && !keys.includes("checked"), "API keys start unticked");
		const chats = /data-testid="legacy-import-option-chats"[^>]*><input[^>]*>/.exec(html)?.[0] ?? "";
		assert.ok(chats.includes("checked"));
		assert.ok(html.includes("Importen legger bare til."));
		assert.ok(html.includes("sikkerhetskopi"));
		assert.ok(html.includes("Lineær algebra"));
		assert.ok(html.includes('data-testid="legacy-import-run"'));
	});

	it("preview step: unavailable choices are disabled and explained; graph without sessions warns", () => {
		const blocked = makePreview({
			graph: { present: true, blocked: "Kunnskapskartet i mappen er lagret i et nyere format.", propositions: { total: 1, new: 1 }, chains: { total: 0, new: 0 }, sources: { total: 0, new: 0 } },
			keys: { present: false, variables: [], newVariables: [] },
			notes: ["1 økt er i et eldre format som ikke støttes og hoppes over."],
		});
		const options = importOptions(blocked, blocked.defaults);
		assert.equal(options.find((o) => o.key === "graph")!.available, false);
		assert.equal(options.find((o) => o.key === "keys")!.available, false);
		const html = render({ step: "preview", preview: blocked, include: blocked.defaults });
		assert.ok(html.includes("nyere format"));
		assert.ok(html.includes("Fant ingen nøkkelfil"));
		assert.ok(html.includes('data-testid="legacy-import-notes"'));

		const preview = makePreview();
		const warned = importOptions(preview, { ...preview.defaults, chats: false }).find((o) => o.key === "graph")!;
		assert.match(warned.warning ?? "", /uten øktnavn/);
		assert.equal(importOptions(preview, preview.defaults).find((o) => o.key === "graph")!.warning, undefined);

		const nothing = render({ step: "preview", preview, include: { chats: false, graph: false, settings: false, keys: false, prompts: false } });
		assert.match(nothing, /<button[^>]*disabled=""[^>]*data-testid="legacy-import-run"|data-testid="legacy-import-run"[^>]*disabled=""/);
	});

	it("running step locks the close button", () => {
		const html = render({ step: "running" });
		assert.ok(html.includes('data-testid="legacy-import-running"'));
		assert.match(html, /data-testid="legacy-import-close"[^>]*disabled=""|disabled=""[^>]*data-testid="legacy-import-close"/);
	});

	it("done step: the receipt, what was left out, the backup and where to go next", () => {
		const html = render({ step: "done", result });
		assert.ok(html.includes("Importen er ferdig"));
		assert.deepEqual(receiptLines(result), [
			"2 økter importert.",
			"4 bakgrunnsjobber fulgte med øktene.",
			"900 nye påstander og 270 nye kjeder i kunnskapskartet.",
			"9 importerte notatkilder lagt til.",
			"Innstillinger og modellvalg er hentet inn.",
			"1 API-nøkkel kopiert (OPENAI_API_KEY).",
			"1 egen systeminstruks kopiert.",
		]);
		assert.ok(html.includes("Ikke tatt med") && html.includes("Finnes allerede her og ble ikke overskrevet."));
		assert.ok(html.includes(result.backupDir!));
		assert.ok(html.includes("Gå til Hjem") && html.includes("Åpne kunnskapskartet"));

		const empty: ImportResult = {
			...result, backupDir: null, chats: { imported: 0, existing: 3, unsupported: 0 }, jobs: { imported: 0, settled: 0 },
			graph: { ...result.graph, propositions: 0, chains: 0, sources: 0 }, settings: { outcome: "unchanged", sections: [] },
			keys: { imported: 0, variables: [] }, prompts: { imported: 0 }, skipped: [],
		};
		assert.deepEqual(receiptLines(empty), []);
		assert.ok(render({ step: "done", result: empty }).includes("Alt var allerede importert"));
	});

	it("no em dash anywhere in the dialog's text", () => {
		const preview = makePreview();
		for (const html of [render({ candidates: [candidate] }), render({ step: "preview", preview, include: preview.defaults }), render({ step: "done", result })]) {
			assert.ok(!html.includes("—"));
		}
	});
});

describe("entry points", () => {
	it("candidate helpers", () => {
		assert.equal(candidateSummary({ path: "/x", label: "x", current: true }), "Dette er mappen appen allerede bruker.");
		assert.equal(candidateWorthImporting(candidate), true);
		assert.equal(candidateWorthImporting({ ...candidate, current: true }), false);
		assert.equal(candidateWorthImporting({ ...candidate, preview: undefined }), false);
		const nothingNew = makePreview({ chats: { total: 2, new: 0, existing: 2, unsupported: 0, newTitles: [] }, graph: { ...makePreview().graph, propositions: { total: 5, new: 0 }, chains: { total: 2, new: 0 } } });
		assert.equal(candidateWorthImporting({ ...candidate, preview: nothingNew }), false);
	});

	it("home's empty state carries the hint; the card grid does not", () => {
		const hint = <LegacyImportHintLine onOpen={noop} />;
		const empty = renderToStaticMarkup(<CoursesOverview courses={[]} adding={false} onToggleAdd={noop} addPanel={<div />} importHint={hint} />);
		assert.ok(empty.includes('data-testid="legacy-import-hint"'));
		assert.ok(empty.includes("Har du brukt LearnHarness før?"));
		assert.ok(empty.includes("Hent inn øktene og kunnskapskartet ditt."));
		const without = renderToStaticMarkup(<CoursesOverview courses={[]} adding={false} onToggleAdd={noop} addPanel={<div />} />);
		assert.ok(!without.includes("legacy-import-hint"));
	});

	it("the palette finds it, the help centre answers it, settings has the row", () => {
		const feature = FEATURES.find((entry) => entry.id === "importer-fra-learnharness");
		assert.deepEqual(feature?.action, { kind: "legacy-import" });
		for (const word of ["importer", "overfør", "flytt", "gammel", "data", "økter", "noder", "kunnskapskart", "migrer"]) {
			assert.ok(feature!.keywords.includes(word), word);
		}
		const article = findArticle("importere-fra-learnharness");
		assert.equal(article?.question, "Kan jeg ta med øktene og kunnskapskartet fra den vanlige LearnHarness-appen?");
		assert.deepEqual(article?.actions, [{ label: "Importer fra LearnHarness", action: { kind: "legacy-import" } }]);
		assert.equal(OPEN_LEGACY_IMPORT_EVENT, "lh:open-legacy-import");
		const settings = readFileSync(join(ROOT, "components/settings/settings-dialog.tsx"), "utf8");
		assert.ok(settings.includes('testid="settings-legacy-import"') && settings.includes("openLegacyImport()"));
		assert.ok(renderToStaticMarkup(<SettingsDialogBody onClose={noop} initialSection="general" />).includes('data-testid="settings-dialog"'));
	});

	it("searching for it lands on the import", () => {
		const top = (query: string, group: string) => buildPaletteGroups(query, { courses: [], chats: [] }).find((entry) => entry.id === group)?.items[0]?.key;
		for (const query of ["importer fra learnharness", "overfør gammel data", "migrer"]) {
			assert.match(top(query, "features") ?? "", /importer-fra-learnharness/, query);
		}
		assert.match(top("ta med øktene fra den vanlige appen", "articles") ?? "", /importere-fra-learnharness/);
	});
});
