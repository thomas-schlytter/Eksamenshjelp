/**
 * Shared validator for the help tests: proves a HelpAction points at
 * something that exists. Routes are checked against the app/ directory,
 * settings sections against the settings dialog's own SECTIONS table, keys
 * rows against the auth-key table, shortcuts against the keyboard registry.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findArticle } from "../components/help/content.ts";
import { findTour } from "../components/help/tours.ts";
import { TOUR_ANCHORS, type HelpAction } from "../components/help/types.ts";
import { AUTH_KEYS } from "../src/core/auth-keys.ts";
import { KEYBOARD_ACTIONS } from "../src/core/keyboard.ts";

const ROOT = join(import.meta.dirname, "..");

/** True when app/ has a page for this path (dynamic segments included). */
export function routeExists(href: string): boolean {
	const path = href.split(/[?#]/)[0] ?? "";
	const segments = path.split("/").filter(Boolean);
	let dirs = [join(ROOT, "app")];
	for (const segment of segments) {
		const next: string[] = [];
		for (const dir of dirs) {
			if (existsSync(join(dir, segment))) next.push(join(dir, segment));
			// A literal «[code]» placeholder or a concrete value both match a dynamic folder.
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				if (entry.isDirectory() && /^\[.+\]$/.test(entry.name) && entry.name !== segment) next.push(join(dir, entry.name));
			}
		}
		dirs = next;
		if (dirs.length === 0) return false;
	}
	return dirs.some((dir) => existsSync(join(dir, "page.tsx")));
}

/** The section ids the settings dialog really has, read from its source. */
export function settingsDialogSections(): string[] {
	const source = readFileSync(join(ROOT, "components/settings/settings-dialog.tsx"), "utf8");
	const table = /const SECTIONS = \[([\s\S]*?)\] as const;/.exec(source);
	assert.ok(table, "settings-dialog.tsx still declares SECTIONS");
	return [...table[1]!.matchAll(/id: "([a-z]+)"/g)].map((match) => match[1]!);
}

export function assertActionValid(action: HelpAction, where: string): void {
	switch (action.kind) {
		case "route":
			assert.ok(routeExists(action.href), `${where}: route ${action.href} has no page in app/`);
			break;
		case "settings":
			assert.ok(settingsDialogSections().includes(action.section), `${where}: settings section ${action.section} does not exist`);
			if (action.row) {
				assert.equal(action.section, "keys", `${where}: only the keys section has rows`);
				assert.ok(AUTH_KEYS.some((key) => key.id === action.row), `${where}: keys row ${action.row} does not exist`);
			}
			break;
		case "theme":
			assert.ok(["light", "dark", "system"].includes(action.mode), `${where}: unknown mode`);
			break;
		case "shortcut": {
			const def = KEYBOARD_ACTIONS.find((entry) => entry.id === action.action);
			assert.ok(def, `${where}: keyboard action ${action.action} is not in the registry`);
			assert.ok(!def.displayOnly, `${where}: ${action.action} is surface-owned and never dispatched`);
			break;
		}
		case "tour":
			assert.ok(findTour(action.id), `${where}: tour ${action.id} does not exist`);
			break;
		case "article":
			assert.ok(findArticle(action.id), `${where}: article ${action.id} does not exist`);
			break;
		case "legacy-import": {
			// The dialog opens through a window event; prove a listener is mounted.
			const provider = readFileSync(join(ROOT, "components/help/help-provider.tsx"), "utf8");
			const host = readFileSync(join(ROOT, "components/import/legacy-import-host.tsx"), "utf8");
			assert.ok(provider.includes("<LegacyImportHost />"), `${where}: the import host is not mounted`);
			assert.ok(host.includes("addEventListener(OPEN_LEGACY_IMPORT_EVENT"), `${where}: nothing listens for the import event`);
			break;
		}
		case "onboarding": {
			// The innføring opens through a window event; prove a host listens.
			const provider = readFileSync(join(ROOT, "components/help/help-provider.tsx"), "utf8");
			const host = readFileSync(join(ROOT, "components/onboarding/onboarding.tsx"), "utf8");
			assert.ok(provider.includes("<OnboardingHost />"), `${where}: the innføring host is not mounted`);
			assert.ok(host.includes("addEventListener(OPEN_ONBOARDING_EVENT"), `${where}: nothing listens for the innføring event`);
			break;
		}
		case "point":
			assert.ok(routeExists(action.route), `${where}: route ${action.route} has no page in app/`);
			assert.ok((TOUR_ANCHORS as readonly string[]).includes(action.anchor), `${where}: anchor ${action.anchor} is not in the contract`);
			assert.ok(action.title && action.text, `${where}: a pointer needs a title and a text`);
			break;
	}
}
