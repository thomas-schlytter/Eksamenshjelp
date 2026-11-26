/**
 * FlashcardStore — the fs adapter for spørsmålskort (2026-11-26), one file
 * per course under the LH_DATA_DIR seam:
 *
 *   data/flashcards/<CODE>.json   the deck: cards, progress per card, the
 *                                 flame's days (core/flashcards.ts)
 *
 * Same idioms as the mock-exam store: sync fs, the course code is
 * normalized before it touches a path, tab-indented JSON written through a
 * temp file + rename.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../../config.ts";
import { normalizeCourseCode } from "../core/courses.ts";
import { readFlashcardDeck, type FlashcardDeck } from "../core/flashcards.ts";

const ROOT_DIR = () => path.join(PATHS.data, "flashcards");

function deckFile(code: string): string {
	const normalized = normalizeCourseCode(code);
	if (!normalized) throw new Error(`Invalid course code: ${code}`);
	return path.join(ROOT_DIR(), `${normalized}.json`);
}

/** A fresh card id: time-sortable, filename-safe. */
export function newFlashcardId(now: Date = new Date()): string {
	return `fc_${now.getTime().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

/** The course's deck, or null when it has none (or the file is unreadable). */
export function getFlashcardDeck(code: string): FlashcardDeck | null {
	const normalized = normalizeCourseCode(code);
	if (!normalized) return null;
	try {
		return readFlashcardDeck(JSON.parse(fs.readFileSync(deckFile(normalized), "utf-8")), normalized);
	} catch {
		return null;
	}
}

export function saveFlashcardDeck(deck: FlashcardDeck): void {
	const file = deckFile(deck.code);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${randomUUID()}.tmp`;
	try {
		fs.writeFileSync(tmp, JSON.stringify(deck, null, "\t") + "\n");
		fs.renameSync(tmp, file);
	} finally {
		fs.rmSync(tmp, { force: true });
	}
}

/** Every deck on disk (the flame reads their days). */
export function listFlashcardDecks(): FlashcardDeck[] {
	let names: string[];
	try {
		names = fs.readdirSync(ROOT_DIR()).filter((f) => f.endsWith(".json"));
	} catch {
		return [];
	}
	return names
		.map((name) => getFlashcardDeck(name.slice(0, -5)))
		.filter((d): d is FlashcardDeck => d !== null);
}
