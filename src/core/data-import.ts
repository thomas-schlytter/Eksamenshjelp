/**
 * "Importer fra LearnHarness": the contract between the import service
 * (src/server/data-import.ts), the /api/import/legacy routes and the dialog
 * (components/import/legacy-import.tsx). Pure and browser-safe: types plus
 * the one default rule both sides must agree on.
 *
 * The import is ADDITIVE by law: it copies what the target lacks and never
 * overwrites or deletes; the source directory is only ever read.
 */

/** What the user chose to bring over. */
export interface ImportInclude {
	chats: boolean;
	graph: boolean;
	settings: boolean;
	keys: boolean;
	prompts: boolean;
}

export const IMPORT_INCLUDE_KEYS = ["chats", "graph", "settings", "keys", "prompts"] as const satisfies readonly (keyof ImportInclude)[];

/** new = would be added by an import; total = what the source holds. */
export interface ImportCount {
	total: number;
	new: number;
}

export interface ImportPreview {
	/** The resolved data directory (the folder holding chats/ and graph/). */
	dataDir: string;
	chats: ImportCount & {
		/** Same id already in this app; never overwritten. */
		existing: number;
		/** Unreadable here: newer format, the old pre-native dialect, or corrupt. */
		unsupported: number;
		/** Titles of the sessions an import would add (capped). */
		newTitles: string[];
	};
	jobs: ImportCount;
	graph: {
		present: boolean;
		/** Set when the source graph cannot be imported at all (Norwegian reason). */
		blocked: string | null;
		propositions: ImportCount;
		chains: ImportCount;
		/** Imported-notes sources (sources.json). */
		sources: ImportCount;
	};
	settings: {
		present: boolean;
		/** This app already has a settings record (only missing sections are filled). */
		targetHasSettings: boolean;
	};
	keys: {
		present: boolean;
		/** Importable key variables in the source. Names only, never values. */
		variables: string[];
		/** The subset this app does not have yet. */
		newVariables: string[];
	};
	prompts: ImportCount;
	/** Norwegian sentences worth showing before the import. */
	notes: string[];
	/** The suggested checkbox state. */
	defaults: ImportInclude;
}

export interface ImportCandidate {
	/** The userData folder (what the user would recognize in Finder/Explorer). */
	path: string;
	label: string;
	/** True when this IS the app's own data directory: nothing to import. */
	current: boolean;
	preview?: ImportPreview;
}

/** One thing the import left alone, and why (Norwegian, user-facing). */
export interface ImportSkipped {
	what: string;
	reason: string;
}

export interface ImportResult {
	dataDir: string;
	/** Where the pre-import copy of graph/ and settings.json went; null when
	 *  there was nothing to back up or nothing was written. */
	backupDir: string | null;
	chats: { imported: number; existing: number; unsupported: number };
	jobs: {
		imported: number;
		/** Imported jobs that were still "running" or awaiting delivery in the
		 *  source and were closed honestly instead of being resumed. */
		settled: number;
	};
	graph: {
		propositions: number;
		nodeLines: number;
		chains: number;
		chainLines: number;
		coverage: number;
		checkpoints: number;
		sources: number;
		positions: number;
		organization: "none" | "copied" | "merged" | "unchanged" | "skipped";
		renderSettings: boolean;
		/** Unparseable or shape-invalid ledger lines left behind. */
		corruptLines: number;
	};
	settings: { outcome: "none" | "copied" | "merged" | "unchanged"; sections: string[] };
	keys: { imported: number; variables: string[] };
	prompts: { imported: number };
	skipped: ImportSkipped[];
	graphRevision: number;
}

/** The checkbox defaults: sessions and graph on; settings only into an app
 *  without any; keys always off (an explicit choice); prompts when present. */
export function defaultImportInclude(preview: Omit<ImportPreview, "defaults">): ImportInclude {
	return {
		chats: preview.chats.new > 0,
		graph: preview.graph.present && preview.graph.blocked === null,
		settings: preview.settings.present && !preview.settings.targetHasSettings,
		keys: false,
		prompts: preview.prompts.new > 0,
	};
}

/** Lenient body parse for the POST: absent or non-boolean reads as false,
 *  so a malformed request can never widen what gets imported. */
export function parseImportInclude(raw: unknown): ImportInclude {
	const r = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	return {
		chats: r.chats === true,
		graph: r.graph === true,
		settings: r.settings === true,
		keys: r.keys === true,
		prompts: r.prompts === true,
	};
}

/** Where the desktop app keeps its data, per platform (for the dialog's help text). */
export const LEGACY_DATA_LOCATIONS = [
	{ platform: "Mac", path: "~/Library/Application Support/LearnHarness" },
	{ platform: "Windows", path: "%APPDATA%\\LearnHarness" },
	{ platform: "Linux", path: "~/.config/LearnHarness" },
] as const;
