/**
 * The one way to open «Importer fra LearnHarness» from anywhere: a window
 * event the global host (legacy-import-host.tsx, mounted by the help
 * provider) answers. Settings, the search palette, the help centre and the
 * home screen's hint all go through it.
 */
export const OPEN_LEGACY_IMPORT_EVENT = "lh:open-legacy-import";

/** `path` preselects a folder (the home hint passes the one it found). */
export function openLegacyImport(path?: string): void {
	window.dispatchEvent(new CustomEvent(OPEN_LEGACY_IMPORT_EVENT, { detail: path ? { path } : {} }));
}
