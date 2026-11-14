/**
 * Help centre types (NTNU round). Everything the help surfaces show is DATA:
 * the feature registry, the questions and answers, and the guided tours are
 * plain tables, so adding one is a table row, and the integrity tests can
 * walk every action and prove it points at something that exists.
 */

import type { KeyAction } from "@/src/core";

/** Settings dialog sections. Mirrors SECTIONS in
 *  components/settings/settings-dialog.tsx (pinned by tests/help-registry). */
export const SETTINGS_SECTION_IDS = ["keys", "agent", "appearance", "graph", "keyboard", "general"] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export type ThemeMode = "light" | "dark" | "system";

/** Something the app can DO for the user. Pure data; the help provider is
 *  the one executor. */
export type HelpAction =
	/** Navigate to a static app route. */
	| { kind: "route"; href: string }
	/** Open the settings dialog on a section (optionally a keys row). */
	| { kind: "settings"; section: SettingsSectionId; row?: string }
	/** Switch light/dark/system directly. */
	| { kind: "theme"; mode: ThemeMode }
	/** Fire a keyboard-registry action (same event the shortcut sends). */
	| { kind: "shortcut"; action: KeyAction }
	/** Start a guided tour. */
	| { kind: "tour"; id: string }
	/** Open one answer in the help centre. */
	| { kind: "article"; id: string }
	/** Open the «Importer fra LearnHarness» dialog (components/import/). */
	| { kind: "legacy-import" }
	/** Go to a route and point at one control; the control stays clickable. */
	| { kind: "point"; route: string; anchor: string; title: string; text: string };

export interface FeatureEntry {
	id: string;
	title: string;
	description: string;
	/** Extra search words: synonyms, English terms, common misspellings. */
	keywords: string[];
	action: HelpAction;
	/** Shown in the palette before anything is typed. */
	suggested?: boolean;
}

export type HelpCategoryId =
	| "komme-i-gang"
	| "fag-og-kontekst"
	| "eksamensmodus"
	| "okter"
	| "sporsmal"
	| "kunnskapskart"
	| "modeller"
	| "personvern"
	| "feilsoking";

export interface HelpCategory {
	id: HelpCategoryId;
	title: string;
	blurb: string;
}

export interface HelpArticle {
	/** Stable slug; doubles as the deep-link hash (`/hjelp#<id>`). */
	id: string;
	category: HelpCategoryId;
	question: string;
	/** Answer paragraphs, plain text. */
	answer: string[];
	/** «Slik gjør du»: numbered steps. */
	steps?: string[];
	keywords: string[];
	/** Buttons that do the thing the answer describes. */
	actions?: { label: string; action: HelpAction }[];
}

export interface TourStep {
	id: string;
	title: string;
	text: string;
	/** `data-tour` name from the shared contract. */
	anchor?: string;
	/** Raw selector when no `data-tour` anchor exists (existing testids). */
	selector?: string;
	/** Route to be on. `/fag/[code]` resolves to the learner's first course. */
	route?: string;
	/** Tab label to click inside `[data-tour="course-tabs"]` first. */
	openTab?: string;
	/** The element lives in the sidebar: open the sidebar first if hidden. */
	needsSidebar?: boolean;
	/** Runs before the step looks for its element (open a settings section). */
	before?: HelpAction;
	/** Shown instead of `text` when the element is not on screen. */
	fallback?: string;
	/** The spotlighted control stays clickable; clicking it ends the tour. */
	interactive?: boolean;
}

export interface Tour {
	id: string;
	title: string;
	description: string;
	/** Rough reading time, shown on the cards. */
	minutes: number;
	keywords: string[];
	/** Listed under «Kom i gang» on the help page. */
	featured?: boolean;
	steps: TourStep[];
}

/** Window events the help provider answers on (shared contract). */
export const OPEN_HELP_EVENT = "lh:open-help";
export const START_TOUR_EVENT = "lh:start-tour";
/** Internal: ask the help page to open and scroll to one answer. */
export const FOCUS_ARTICLE_EVENT = "lh:help-focus-article";

/** The `data-tour` anchors of the shared contract. Other surfaces set these
 *  attributes; tours and "point" actions may only reference names listed here. */
export const TOUR_ANCHORS = [
	"add-course",
	"course-card",
	"home-composer",
	"sidebar-courses",
	"sidebar-help",
	"sidebar-settings",
	"course-tabs",
	"exam-plan",
	"exam-session",
	"topic-board",
	"course-sources",
	"exam-date",
	"question-skip",
	"question-hold",
	"question-explain",
] as const;
