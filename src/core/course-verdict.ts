/**
 * «Hvordan ligger jeg an?» (fase 7b): the fag page's one-word verdict.
 *
 * The rule is deliberately simple, so the tooltip can say it in one line:
 * how many days are left per topic that is not green yet.
 *
 *   - every topic green, or at least 1 day per topic left  → «På god vei»
 *   - at least half a day per topic left                   → «Litt bak»
 *   - less than that                                       → «Må opp i tempo»
 *
 * No topic list, no exam date, or the exam is today or over: no verdict
 * (unless everything is green, which is always «På god vei»).
 *
 * Pure and browser-safe.
 */

import type { TopicStatus } from "./courses.ts";

export type CourseVerdictId = "on-track" | "behind" | "speed-up";

export interface CourseVerdict {
	id: CourseVerdictId;
	label: string;
	/** Topics that are not green (unknown counts as not green). */
	remaining: number;
	/** Days left per remaining topic (Infinity when none remain). */
	daysPerTopic: number;
}

export const VERDICT_LABEL: Record<CourseVerdictId, string> = {
	"on-track": "På god vei",
	behind: "Litt bak",
	"speed-up": "Må opp i tempo",
};

/** The rule in words (the chip's tooltip). */
export const VERDICT_RULE =
	"Regnes ut fra dager igjen per tema som ikke er grønt ennå: minst 1 dag per tema er «På god vei», minst en halv dag er «Litt bak», mindre enn det er «Må opp i tempo».";

export function courseVerdict(daysLeft: number | null, counts: Record<TopicStatus, number>): CourseVerdict | null {
	const total = counts.green + counts.yellow + counts.red + counts.unknown;
	if (total === 0) return null;
	const remaining = total - counts.green;
	if (remaining === 0) return { id: "on-track", label: VERDICT_LABEL["on-track"], remaining, daysPerTopic: Infinity };
	if (daysLeft === null || daysLeft <= 0) return null;
	const daysPerTopic = daysLeft / remaining;
	const id: CourseVerdictId = daysPerTopic >= 1 ? "on-track" : daysPerTopic >= 0.5 ? "behind" : "speed-up";
	return { id, label: VERDICT_LABEL[id], remaining, daysPerTopic };
}
