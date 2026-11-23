import type { MockExamResult } from "@/src/core";
import type { CourseTopic } from "./course-types";

/**
 * Pure helpers for the fag page's summary (fase 7b): what to work on, the
 * mock-exam curve, the countdown's words, and which topics just turned
 * green. No React, no fetch: the render and unit tests pin these.
 */

const MONTHS = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];
const WEEKDAYS = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];

/** «tirsdag 1. desember», or "" for a missing/invalid date. */
export function examDayLabel(iso: string | undefined): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
	if (!match) return "";
	const y = Number(match[1]), m = Number(match[2]), d = Number(match[3]);
	if (m < 1 || m > 12 || d < 1 || d > 31) return "";
	const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
	return `${weekday} ${d}. ${MONTHS[m - 1]}`;
}

/** The countdown's big number and its words. Null: no date. */
export function countdownParts(daysLeft: number | null): { big: string | null; words: string } {
	if (daysLeft === null) return { big: null, words: "Ingen eksamensdato" };
	if (daysLeft < 0) return { big: null, words: "Eksamen er over" };
	if (daysLeft === 0) return { big: null, words: "Eksamen er i dag" };
	return { big: String(daysLeft), words: daysLeft === 1 ? "dag igjen" : "dager igjen" };
}

export interface WorkNowTopic {
	topic: CourseTopic;
	reason: string;
}

/** «Jobb med dette nå»: the most important red, then yellow, topics. */
export function workNowTopics(topics: readonly CourseTopic[], limit = 3): WorkNowTopic[] {
	const rank = (t: CourseTopic) => (t.status === "red" ? 0 : 1);
	return topics
		.filter((t) => t.status === "red" || t.status === "yellow")
		.sort((a, b) => rank(a) - rank(b) || b.weight - a.weight || a.title.localeCompare(b.title, "nb"))
		.slice(0, limit)
		.map((topic) => ({ topic, reason: topic.statusNote?.trim() || "ikke øvd ennå" }));
}

/** What a click on a topic sends into the fag-chat. */
export function workOnTopicText(title: string): string {
	return `La oss jobbe med «${title}».`;
}

export interface MockExamPoint {
	id: string;
	percent: number;
	/** «12.11». */
	label: string;
	gradedAt: string;
}

/** The score curve: the newest grading per prøveeksamen, oldest first,
 *  at most `limit` points (the newest ones). */
export function mockExamPoints(results: readonly MockExamResult[], limit = 6): MockExamPoint[] {
	const latest = new Map<string, MockExamResult>();
	for (const r of results) {
		const seen = latest.get(r.examId);
		if (!seen || seen.gradedAt <= r.gradedAt) latest.set(r.examId, r);
	}
	return [...latest.values()]
		.sort((a, b) => a.gradedAt.localeCompare(b.gradedAt))
		.slice(-limit)
		.map((r) => {
			const date = new Date(r.gradedAt);
			const label = Number.isNaN(date.getTime())
				? ""
				: `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}`;
			return { id: r.id, percent: Math.max(0, Math.min(100, Math.round(r.percent))), label, gradedAt: r.gradedAt };
		});
}

/** «+9 poeng» from the first to the newest point; null with fewer than two. */
export function mockExamChange(points: readonly MockExamPoint[]): { delta: number; label: string } | null {
	if (points.length < 2) return null;
	const delta = points.at(-1)!.percent - points[0]!.percent;
	const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
	return { delta, label: `${sign}${Math.abs(delta)} poeng` };
}

/** Topics that are green now and were not before (by id). */
export function newlyGreen(before: readonly CourseTopic[], after: readonly CourseTopic[]): CourseTopic[] {
	const wasGreen = new Set(before.filter((t) => t.status === "green").map((t) => t.id));
	const known = new Set(before.map((t) => t.id));
	return after.filter((t) => t.status === "green" && !wasGreen.has(t.id) && known.has(t.id));
}

/** «Nytt grønt tema: X» / «Nye grønne temaer: X og Y». */
export function greenToastText(topics: readonly CourseTopic[]): string {
	if (topics.length === 1) return `Nytt grønt tema: ${topics[0]!.title}`;
	const names = topics.map((t) => t.title);
	return `Nye grønne temaer: ${names.slice(0, -1).join(", ")} og ${names.at(-1)}`;
}
