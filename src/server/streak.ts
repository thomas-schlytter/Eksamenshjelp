/**
 * THE FLAME, server side (fase 7b): the per-chat answer cache behind
 * GET /api/streak and the `streak-changed` event.
 *
 * The cache (data/streak.json) holds, per chat file, its mtime and size and
 * the instants of its real answers (core/streak.ts answerTimestamps). A
 * refresh only STATS the chat folder and re-reads the files whose mtime or
 * size moved, so a request never reads every chat. Instants (not days) are
 * kept, so the days follow the machine's time zone at read time.
 *
 * The cache also keeps the best streak ever (a deleted chat must not lower
 * it) and the last celebrated level, so «Nytt nivå» shows once.
 *
 * The watcher listens on the bus for the events that follow an answer
 * landing on disk (turn-settled, record-changed, chats-changed), refreshes,
 * and emits `streak-changed` only when the summary actually moved.
 *
 * Spørsmålskort (2026-11-26): a right card (never «Vet ikke») is a solved
 * question too. Those days live on the decks themselves (one instant per
 * day, core/flashcards.ts) and join the chat answers here; the chat rules
 * are untouched. `flashcards-changed` wakes the watcher.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../../config.ts";
import { emit, subscribe, type ServerEvent } from "../core/events.ts";
import {
	answerDays,
	answerTimestamps,
	dayKey,
	flameLevelById,
	settleCelebratedRank,
	streakSummary,
	type StreakSummary,
} from "../core/streak.ts";
import { listFlashcardDecks } from "../store/flashcards.ts";
import { stores } from "./stores.ts";

const CACHE_VERSION = 1;

interface ChatEntry {
	mtimeMs: number;
	size: number;
	answers: number[];
}

interface StreakCache {
	version: number;
	chats: Record<string, ChatEntry>;
	best: number;
	celebratedRank: number;
}

/** Test seams: the clock and the zone. */
export const streakSeams: { now?: () => number; timeZone?: string } = {};

const cacheFile = () => path.join(PATHS.data, "streak.json");
const now = () => streakSeams.now?.() ?? Date.now();

function emptyCache(): StreakCache {
	return { version: CACHE_VERSION, chats: {}, best: 0, celebratedRank: 0 };
}

function readCache(): StreakCache {
	try {
		const raw = JSON.parse(fs.readFileSync(cacheFile(), "utf-8")) as Partial<StreakCache>;
		if (raw.version !== CACHE_VERSION || typeof raw.chats !== "object" || raw.chats === null) return emptyCache();
		return {
			version: CACHE_VERSION,
			chats: raw.chats,
			best: typeof raw.best === "number" && raw.best >= 0 ? raw.best : 0,
			celebratedRank: typeof raw.celebratedRank === "number" ? Math.max(0, Math.min(5, raw.celebratedRank)) : 0,
		};
	} catch {
		return emptyCache();
	}
}

function writeCache(cache: StreakCache): void {
	const file = cacheFile();
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${randomUUID()}.tmp`;
	try {
		fs.writeFileSync(tmp, JSON.stringify(cache) + "\n");
		fs.renameSync(tmp, file);
	} finally {
		fs.rmSync(tmp, { force: true });
	}
}

/** Bring the cache up to date with the chat folder. Returns whether
 *  anything changed (the caller writes it). */
function refreshChats(cache: StreakCache): boolean {
	let changed = false;
	let names: string[] = [];
	try {
		names = fs.readdirSync(PATHS.chats).filter((f) => f.endsWith(".json"));
	} catch {
		names = [];
	}
	const seen = new Set<string>();
	for (const name of names) {
		const id = name.slice(0, -5);
		if (!/^[A-Za-z0-9_-]+$/.test(id)) continue;
		seen.add(id);
		let stat: fs.Stats;
		try {
			stat = fs.statSync(path.join(PATHS.chats, name));
		} catch {
			continue;
		}
		const entry = cache.chats[id];
		if (entry && entry.mtimeMs === stat.mtimeMs && entry.size === stat.size) continue;
		const record = stores.chatStore.getChat(id);
		let answers: number[] = [];
		try {
			answers = record ? answerTimestamps(record.messages ?? []) : [];
		} catch (err) {
			console.error(`[streak] could not read answers in ${id}:`, err);
		}
		cache.chats[id] = { mtimeMs: stat.mtimeMs, size: stat.size, answers };
		changed = true;
	}
	for (const id of Object.keys(cache.chats)) {
		if (!seen.has(id)) {
			delete cache.chats[id];
			changed = true;
		}
	}
	return changed;
}

function summarize(cache: StreakCache): StreakSummary {
	const zone = streakSeams.timeZone;
	const chatAnswers = Object.values(cache.chats).flatMap((c) => c.answers);
	const cardAnswers = listFlashcardDecks().flatMap((deck) => deck.solvedAt);
	const days = answerDays([...chatAnswers, ...cardAnswers], zone);
	return streakSummary(days, dayKey(now(), zone), cache.best, cache.celebratedRank);
}

/** The flame as the API serves it, with the cache brought up to date. */
export function readStreak(): StreakSummary {
	const cache = readCache();
	let dirty = refreshChats(cache);
	const summary = summarize(cache);
	if (summary.best !== cache.best) {
		cache.best = summary.best;
		dirty = true;
	}
	const rank = settleCelebratedRank(cache.celebratedRank, summary.current);
	if (rank !== cache.celebratedRank) {
		cache.celebratedRank = rank;
		dirty = true;
	}
	if (dirty) writeCache(cache);
	// Recomputed: the celebration flag reads the settled rank.
	return summarize(cache);
}

/** «Nytt nivå» was shown: never again for this level (until the streak
 *  breaks and the level is reached anew). Unknown ids are refused. */
export function markStreakCelebrated(levelId: unknown): boolean {
	const level = flameLevelById(typeof levelId === "string" ? levelId : null);
	if (!level) return false;
	const cache = readCache();
	refreshChats(cache);
	cache.celebratedRank = Math.max(cache.celebratedRank, level.rank);
	writeCache(cache);
	return true;
}

// ─── the watcher ─────────────────────────────────────────────────────────────

interface StreakGlobal {
	__lhStreakWatcher?: { last: string; timer?: ReturnType<typeof setTimeout> };
}

const signature = (s: StreakSummary) => `${s.today}|${s.current}|${s.todayDone}|${s.best}`;

/** Refresh now and announce a change. Exported for tests. */
export function checkStreakChange(): void {
	const g = globalThis as typeof globalThis & StreakGlobal;
	const watch = (g.__lhStreakWatcher ??= { last: "" });
	try {
		const next = signature(readStreak());
		if (next !== watch.last) {
			const first = watch.last === "";
			watch.last = next;
			if (!first) emit("streak-changed", {});
		}
	} catch (err) {
		console.error("[streak] refresh failed:", err);
	}
}

const WATCHED: ReadonlySet<ServerEvent["type"]> = new Set(["turn-settled", "record-changed", "chats-changed", "flashcards-changed"]);

/** Install the bus listener once per process (globalThis: every Next
 *  module entry shares it). Idempotent. */
export function installStreakWatcher(): void {
	const g = globalThis as typeof globalThis & StreakGlobal & { __lhStreakWatcherOff?: () => void };
	if (g.__lhStreakWatcherOff) return;
	checkStreakChange(); // the baseline: the first real change is announced
	g.__lhStreakWatcherOff = subscribe((event) => {
		if (!WATCHED.has(event.type)) return;
		const watch = (g.__lhStreakWatcher ??= { last: "" });
		if (watch.timer) clearTimeout(watch.timer);
		watch.timer = setTimeout(() => {
			watch.timer = undefined;
			checkStreakChange();
		}, 200);
	});
}
