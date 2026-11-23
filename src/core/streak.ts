/**
 * THE FLAME (fase 7b): days in a row with real work, for the whole app.
 *
 * A day counts when the learner gave at least one real answer in any chat:
 * a question answered (not «Hopp over», not dismissed, not parked with
 * «Spør agenten», not closed by «Avslutt økt»), a thinking submission on a
 * practice task, or a recall quiz at the end of an økt with at least one
 * answer. The day is the answer's local calendar day.
 *
 * The streak counts consecutive days backwards from today. When today has
 * no answer yet, it counts from yesterday (today reads «ikke gjort ennå»);
 * when neither today nor yesterday has one, the streak is 0.
 *
 * Pure and browser-safe: the server keeps the per-chat cache
 * (src/server/streak.ts), the shell renders the summary.
 */

import type { LhMessage } from "./native-messages.ts";

// ─── days ────────────────────────────────────────────────────────────────────

const DAY_FORMATS = new Map<string, Intl.DateTimeFormat>();

/** The local calendar day ("YYYY-MM-DD") of an instant. `timeZone`
 *  undefined = the process's own zone (the desktop app: the learner's). */
export function dayKey(ms: number, timeZone?: string): string {
	const key = timeZone ?? "";
	let format = DAY_FORMATS.get(key);
	if (!format) {
		// en-CA formats dates as YYYY-MM-DD.
		format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
		DAY_FORMATS.set(key, format);
	}
	return format.format(new Date(ms));
}

/** `iso` moved by `n` calendar days (pure date arithmetic, no zone). */
export function addDays(iso: string, n: number): string {
	const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
	const date = new Date(Date.UTC(y, m - 1, d + n));
	return date.toISOString().slice(0, 10);
}

// ─── which answers count ─────────────────────────────────────────────────────

/** The instants (ms) of every real answer in one chat record. */
export function answerTimestamps(messages: readonly LhMessage[]): number[] {
	const out: number[] = [];
	for (const m of messages) {
		if (m.role === "toolResult") {
			if (m.isError) continue;
			const details = m.details as { answeredAt?: unknown; dismissed?: unknown } | null | undefined;
			if (!details || typeof details !== "object" || typeof details.answeredAt !== "string") continue;
			// skipped, onHold and sessionEnded are always paired with dismissed.
			if (details.dismissed === true) continue;
			const at = Date.parse(details.answeredAt);
			out.push(Number.isFinite(at) ? at : m.timestamp);
		} else if (m.role === "custom") {
			if (m.customType === "practice-thinking") {
				const text = (m.details as { text?: unknown } | null)?.text;
				if (typeof text === "string" && text.trim()) out.push(m.timestamp);
			} else if (m.customType === "session-wrap") {
				const details = m.details as { answers?: unknown; completedAt?: unknown } | null;
				const answered = Array.isArray(details?.answers) && details.answers.some((a) => typeof a === "number");
				if (!answered) continue;
				const at = typeof details?.completedAt === "string" ? Date.parse(details.completedAt) : NaN;
				out.push(Number.isFinite(at) ? at : m.timestamp);
			}
		}
	}
	return out;
}

/** The set of local days with at least one answer. */
export function answerDays(timestamps: Iterable<number>, timeZone?: string): Set<string> {
	const days = new Set<string>();
	for (const ms of timestamps) if (Number.isFinite(ms)) days.add(dayKey(ms, timeZone));
	return days;
}

// ─── the streak ──────────────────────────────────────────────────────────────

export interface StreakCount {
	/** Days in a row, ending today (or yesterday when today is not done). */
	current: number;
	todayDone: boolean;
	/** The longest run anywhere in the history. */
	longest: number;
}

export function computeStreak(days: ReadonlySet<string>, today: string): StreakCount {
	const todayDone = days.has(today);
	let current = 0;
	let cursor = todayDone ? today : addDays(today, -1);
	while (days.has(cursor)) {
		current++;
		cursor = addDays(cursor, -1);
	}
	let longest = 0;
	for (const day of days) {
		// Only the first day of a run starts a count.
		if (days.has(addDays(day, -1))) continue;
		let run = 0;
		let at = day;
		while (days.has(at)) {
			run++;
			at = addDays(at, 1);
		}
		longest = Math.max(longest, run);
	}
	return { current, todayDone, longest };
}

// ─── levels ──────────────────────────────────────────────────────────────────

export type FlameLevelId = "spark" | "flame" | "hot" | "inferno" | "blue";

export interface FlameLevel {
	id: FlameLevelId;
	/** 1–5. */
	rank: number;
	name: string;
	/** The lowest streak on this level. */
	from: number;
	/** «Flammen er …!» in the celebration. */
	cheer: string;
}

export const FLAME_LEVELS: readonly FlameLevel[] = [
	{ id: "spark", rank: 1, name: "Gnist", from: 1, cheer: "Flammen er tent!" },
	{ id: "flame", rank: 2, name: "Flamme", from: 3, cheer: "Flammen brenner!" },
	{ id: "hot", rank: 3, name: "Glohet", from: 7, cheer: "Flammen er glohet!" },
	{ id: "inferno", rank: 4, name: "Inferno", from: 14, cheer: "Flammen er et inferno!" },
	{ id: "blue", rank: 5, name: "Blå flamme", from: 30, cheer: "Flammen brenner blått!" },
];

/** The level of a streak, or null at 0. */
export function flameLevel(streak: number): FlameLevel | null {
	let level: FlameLevel | null = null;
	for (const candidate of FLAME_LEVELS) if (streak >= candidate.from) level = candidate;
	return level;
}

/** The next level and how many days are left to it; null on the top level. */
export function nextFlameLevel(streak: number): { level: FlameLevel; days: number } | null {
	const next = FLAME_LEVELS.find((level) => level.from > streak);
	return next ? { level: next, days: next.from - Math.max(0, streak) } : null;
}

/** «5 dager til inferno», «1 dag til flamme», «Høyeste nivå». */
export function nextLevelLabel(streak: number): string {
	const next = nextFlameLevel(streak);
	if (!next) return "Høyeste nivå";
	return `${next.days} ${next.days === 1 ? "dag" : "dager"} til ${next.level.name.toLowerCase()}`;
}

// ─── the week row ────────────────────────────────────────────────────────────

const WEEKDAY_SHORT = ["sø", "ma", "ti", "on", "to", "fr", "lø"];

export interface StreakDay {
	date: string;
	/** «ma», «ti», … — «i dag» for today. */
	label: string;
	done: boolean;
	today: boolean;
}

/** The last seven days, oldest first, ending today. */
export function weekRow(days: ReadonlySet<string>, today: string): StreakDay[] {
	const out: StreakDay[] = [];
	for (let i = 6; i >= 0; i--) {
		const date = addDays(today, -i);
		const [y, m, d] = date.split("-").map(Number) as [number, number, number];
		const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
		out.push({ date, label: i === 0 ? "i dag" : WEEKDAY_SHORT[weekday]!, done: days.has(date), today: i === 0 });
	}
	return out;
}

// ─── the summary the API serves ──────────────────────────────────────────────

export interface StreakSummary {
	today: string;
	current: number;
	best: number;
	todayDone: boolean;
	/** The current level's id, null at 0. */
	level: FlameLevelId | null;
	week: StreakDay[];
	/** A level reached and not celebrated yet: show the celebration once. */
	celebrate: FlameLevelId | null;
}

/**
 * The full summary. `storedBest` is the best streak kept on disk (a deleted
 * chat must not lower it); `celebratedRank` the last celebrated level rank.
 */
export function streakSummary(days: ReadonlySet<string>, today: string, storedBest: number, celebratedRank: number): StreakSummary {
	const count = computeStreak(days, today);
	const level = flameLevel(count.current);
	return {
		today,
		current: count.current,
		best: Math.max(storedBest, count.longest, count.current),
		todayDone: count.todayDone,
		level: level?.id ?? null,
		week: weekRow(days, today),
		celebrate: level && level.rank > celebratedRank ? level.id : null,
	};
}

/** The celebrated rank to keep: it follows a broken streak down, so the
 *  same level is celebrated again when it is reached anew. */
export function settleCelebratedRank(celebratedRank: number, currentStreak: number): number {
	return Math.min(celebratedRank, flameLevel(currentStreak)?.rank ?? 0);
}

export function flameLevelById(id: string | null | undefined): FlameLevel | null {
	return FLAME_LEVELS.find((level) => level.id === id) ?? null;
}
