/**
 * The innføring's pure parts (components/onboarding/onboarding.tsx draws
 * them): the steps, when it opens by itself, what the AI step reports and
 * how one course's exams read. No React, no fetch: the tests pin these.
 */

import { CLAUDE_CODE_PROVIDER, type ModelCatalogResponse } from "@/src/core";

/** Opens the innføring from anywhere (the help centre, the palette). */
export const OPEN_ONBOARDING_EVENT = "lh:open-onboarding";

export function openOnboarding(): void {
	window.dispatchEvent(new CustomEvent(OPEN_ONBOARDING_EVENT));
}

export const ONBOARDING_STEPS = ["welcome", "ai", "courses", "material", "ready"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** «1/5»: the progress line at the top. */
export function stepLabel(step: OnboardingStep): string {
	return `${ONBOARDING_STEPS.indexOf(step) + 1}/${ONBOARDING_STEPS.length}`;
}

/** At first start: show it, or not. Someone who already has courses and
 *  a connection set the app up before the innføring existed: it does not
 *  open by itself, and is marked done so it never does later. */
export function onboardingDecision(input: { done: boolean; courseCount: number; connected: boolean }): "show" | "mark-done" | "none" {
	if (input.done) return "none";
	if (input.courseCount > 0 && input.connected) return "mark-done";
	return "show";
}

/** Which AI is connected, by the catalog's own truth (keyPresent per
 *  provider: Claude Code enabled and installed, a ChatGPT account signed
 *  in, an API key saved…). `models` = all three model slots are picked. */
export interface AiConnection {
	claude: boolean;
	chatgpt: boolean;
	/** Any other provider (an API key, another subscription, an own address). */
	other: boolean;
	connected: boolean;
	models: boolean;
}

export function aiConnection(catalog: Pick<ModelCatalogResponse, "providers" | "slots"> | undefined, chatgptSignedIn = false): AiConnection {
	const present = (id: string) => catalog?.providers.some((p) => p.id === id && p.keyPresent) ?? false;
	const claude = present(CLAUDE_CODE_PROVIDER);
	const chatgpt = chatgptSignedIn || present("chatgpt");
	const other = catalog?.providers.some((p) => p.keyPresent && p.id !== CLAUDE_CODE_PROVIDER && p.id !== "chatgpt") ?? false;
	const models = !!(catalog?.slots.strong?.model && catalog.slots.cheap?.model && catalog.slots.vision?.model);
	return { claude, chatgpt, other, connected: claude || chatgpt || other, models };
}

/** «Claude», «ChatGPT», «Claude og ChatGPT» or «en annen AI». */
export function connectionName(ai: AiConnection): string {
	if (ai.claude && ai.chatgpt) return "Claude og ChatGPT";
	if (ai.claude) return "Claude";
	if (ai.chatgpt) return "ChatGPT";
	return "en annen AI";
}

/** One course's material line in step 4. */
export function examLine(entry: { exams: number; solutions: number; folder: string | null }): string {
	if (entry.exams === 0 && entry.solutions === 0) return entry.folder ? "Ingen eksamener i mappen ennå" : "Ingen mappe ennå";
	const parts = [
		entry.exams > 0 ? `${entry.exams} ${entry.exams === 1 ? "eksamen" : "eksamener"}` : "",
		entry.solutions > 0 ? `${entry.solutions} løsningsforslag` : "",
	].filter(Boolean);
	return parts.join(" · ");
}

/** GET /api/course-folders, as the browser reads it (mirrors
 *  src/server/course-folders.ts CourseFolderScan; components import only
 *  the core barrel). */
export interface CourseFolderEntry {
	code: string;
	name: string;
	folder: string | null;
	fileCount: number;
	exams: number;
	solutions: number;
}
export interface CourseFolderScan {
	root: string;
	available: boolean;
	courses: CourseFolderEntry[];
	unknown: string[];
}

export function isCourseFolderScan(value: unknown): value is CourseFolderScan {
	const v = value as CourseFolderScan | null;
	return !!v && typeof v.root === "string" && typeof v.available === "boolean" && Array.isArray(v.courses) && Array.isArray(v.unknown);
}
