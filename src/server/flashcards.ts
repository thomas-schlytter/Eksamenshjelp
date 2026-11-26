/**
 * Spørsmålskort service (2026-11-26): the HTTP surface under
 * /api/flashcards/<CODE> and the background generation.
 *
 * Generation runs in this process like the topic generation does (the
 * fag page starts it, not a chat, so there is no steer to deliver): the
 * teacher slot's engine, one permit of the shared background-LLM pool, the
 * learner-file tools. While it runs, the in-memory registry (globalThis:
 * every Next module entry shares it) says so; the page polls nothing — it
 * refetches on `flashcards-changed`. A process restart simply forgets a
 * run in flight: the page then offers to start again.
 *
 * Practice uses no model: answers are scored here from the stored deck.
 */

import { emit } from "../core/events.ts";
export type { FlashcardGeneration, FlashcardGenerationMode, FlashcardView } from "../core/flashcards.ts";
import { normalizeCourseCode } from "../core/courses.ts";
import {
	appendFlashcards,
	buildFlashcards,
	flashcardStats,
	flashcardWeakTopics,
	recordFlashcardAnswer,
	resetFlashcardProgress,
	sanitizeFlashcardChoice,
	type Flashcard,
	type FlashcardDeck,
	type FlashcardDraft,
	type FlashcardGeneration,
	type FlashcardGenerationMode,
	type FlashcardProgress,
	type FlashcardStats,
	type FlashcardView,
} from "../core/flashcards.ts";
import { resolveRoleSpec } from "../core/settings-resolution.ts";
import { ROLE_SLOT } from "../core/settings.ts";
import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { withBgLlmSlot } from "../agent/subagents/bg-llm-semaphore.ts";
import { runFlashcardMaker, type FlashcardMakerInput } from "../agent/subagents/flashcard-maker.ts";
import { courseStore } from "../store/courses.ts";
import { getFlashcardDeck, newFlashcardId, saveFlashcardDeck } from "../store/flashcards.ts";
import { settingsStore } from "../store/settings.ts";
import { providerKeyPresent } from "./keys.ts";

export interface FlashcardFailure {
	ok: false;
	status: 400 | 404 | 409 | 503;
	code: string;
	error: string;
}
export type FlashcardOutcome<T> = ({ ok: true } & T) | FlashcardFailure;

const fail = (status: FlashcardFailure["status"], code: string, error: string): FlashcardFailure => ({ ok: false, status, code, error });

export function flashcardFailureResponse(failure: FlashcardFailure): Response {
	return Response.json({ error: failure.error, code: failure.code }, { status: failure.status });
}

const GENERATION_TIMEOUT_MS = 20 * 60_000;

// ─── Seams (tests swap these; production uses the defaults) ──────────────────

export const flashcardSeams: {
	/** The teacher slot's engine; undefined = no model or no key. */
	engine: () => PiEngine | undefined;
	/** The generator run (returns VALID drafts or throws). */
	generate: (input: FlashcardMakerInput, engine: PiEngine, onActivity: (line: string) => void) => Promise<FlashcardDraft[]>;
	random: () => number;
	now: () => number;
	/** undefined = the process's own zone (the desktop app: the learner's). */
	timeZone?: string;
} = {
	engine: resolveFlashcardEngine,
	generate: (input, engine, onActivity) =>
		withBgLlmSlot(undefined, () =>
			runFlashcardMaker(input, { engine, abortSignal: AbortSignal.timeout(GENERATION_TIMEOUT_MS), onActivity }),
		),
	random: Math.random,
	now: () => Date.now(),
};

/** Authoring the cards is strong-tier work: the prøveeksamen generator's
 *  slot (the teacher role, no new settings role). */
function resolveFlashcardEngine(): PiEngine | undefined {
	try {
		const spec = resolveRoleSpec("teacher", settingsStore.readSettings());
		if (!spec || !providerKeyPresent(spec.provider)) return undefined;
		return piEngineForSpec(spec, true, undefined, () => settingsStore.readSettings()?.models?.[ROLE_SLOT.teacher]?.cacheRetention);
	} catch (err) {
		console.info("[flashcards] no usable model:", err instanceof Error ? err.message : err);
		return undefined;
	}
}

// ─── The run registry ────────────────────────────────────────────────────────

interface FlashcardRuns {
	running: Map<string, FlashcardGeneration & { done: Promise<void> }>;
	errors: Map<string, string>;
}

function runs(): FlashcardRuns {
	const g = globalThis as typeof globalThis & { __lhFlashcardRuns?: FlashcardRuns };
	return (g.__lhFlashcardRuns ??= { running: new Map(), errors: new Map() });
}

/** The run in flight for a course (tests await its `done`). */
export function flashcardRun(code: string): Promise<void> | undefined {
	const normalized = normalizeCourseCode(code);
	return normalized ? runs().running.get(normalized)?.done : undefined;
}

// ─── Reads ───────────────────────────────────────────────────────────────────

function viewFor(code: string): FlashcardView {
	const deck = getFlashcardDeck(code);
	const live = deck && deck.cards.length > 0 ? deck : null;
	const run = runs().running.get(code);
	return {
		deck: live ? { cards: live.cards, progress: live.progress, createdAt: live.createdAt, updatedAt: live.updatedAt } : null,
		stats: flashcardStats(live),
		weakTopics: flashcardWeakTopics(live),
		generating: run ? { mode: run.mode, startedAt: run.startedAt, activity: run.activity } : null,
		error: runs().errors.get(code) ?? null,
	};
}

function courseCode(rawCode: string): string | FlashcardFailure {
	let decoded = rawCode;
	try {
		decoded = decodeURIComponent(rawCode);
	} catch { /* a malformed escape is just a bad code */ }
	const code = normalizeCourseCode(decoded);
	if (!code) return fail(400, "invalid_code", "Ugyldig emnekode.");
	return code;
}

const isFailure = (v: unknown): v is FlashcardFailure => typeof v === "object" && v !== null && (v as FlashcardFailure).ok === false;

export function readFlashcards(rawCode: string): FlashcardOutcome<{ view: FlashcardView }> {
	const code = courseCode(rawCode);
	if (isFailure(code)) return code;
	return { ok: true, view: viewFor(code) };
}

// ─── Generation ──────────────────────────────────────────────────────────────

function isMode(value: unknown): value is FlashcardGenerationMode {
	return value === "new" || value === "more" || value === "replace";
}

/**
 * Start a generation in the background: a first deck, 15 more, or a new
 * deck in place of the old one. The old deck stays until the new cards
 * are in, so a failed «Lag ny bunke» loses nothing.
 */
export function startFlashcardGeneration(rawCode: string, body: unknown): FlashcardOutcome<{ view: FlashcardView }> {
	const code = courseCode(rawCode);
	if (isFailure(code)) return code;
	const mode = (typeof body === "object" && body !== null ? (body as { mode?: unknown }).mode : undefined) ?? "new";
	if (!isMode(mode)) return fail(400, "invalid_mode", "Ukjent valg.");
	const course = courseStore.getCourse(code);
	if (!course) return fail(404, "not_found", `Fant ikke faget ${code}.`);
	if (runs().running.has(code)) return fail(409, "running", "Kortene lages allerede.");
	const existing = getFlashcardDeck(code);
	const hasDeck = Boolean(existing && existing.cards.length > 0);
	if (mode === "more" && !hasDeck) return fail(409, "no_deck", "Faget har ingen spørsmålskort ennå.");
	if (mode === "new" && hasDeck) return fail(409, "has_deck", "Faget har spørsmålskort allerede.");
	const engine = flashcardSeams.engine();
	if (!engine) return fail(503, "models_not_configured", "Ingen modell er satt opp. Velg en modell under Innstillinger → Agent.");

	runs().errors.delete(code);
	const startedAt = new Date(flashcardSeams.now()).toISOString();
	const entry: FlashcardGeneration & { done: Promise<void> } = { mode, startedAt, activity: "leser kildene", done: Promise.resolve() };
	runs().running.set(code, entry);
	const input: FlashcardMakerInput = {
		course,
		mode: mode === "more" ? "more" : "new",
		...(mode === "more" && existing ? { avoid: existing.cards.map((c) => c.question) } : {}),
	};
	entry.done = (async () => {
		try {
			const drafts = await flashcardSeams.generate(input, engine, (line) => {
				entry.activity = line;
			});
			const now = new Date(flashcardSeams.now()).toISOString();
			const cards = buildFlashcards(drafts, () => newFlashcardId(), flashcardSeams.random);
			// Re-read: answers may have landed while the model worked.
			const current = getFlashcardDeck(code);
			let next: FlashcardDeck;
			if (mode === "more" && current) next = appendFlashcards(current, cards, now);
			else next = { code, createdAt: now, updatedAt: now, cards, progress: {}, solvedAt: current?.solvedAt ?? [] };
			saveFlashcardDeck(next);
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			console.error(`[flashcards] generation for ${code} failed:`, reason);
			runs().errors.set(code, "Klarte ikke å lage spørsmålskortene. Prøv igjen.");
		} finally {
			runs().running.delete(code);
			emit("flashcards-changed", { code });
		}
	})();
	emit("flashcards-changed", { code });
	return { ok: true, view: viewFor(code) };
}

// ─── Practice ────────────────────────────────────────────────────────────────

/** One answer: scored from the stored card, recorded on the deck. */
export function answerFlashcard(rawCode: string, body: unknown): FlashcardOutcome<{ correct: boolean; progress: FlashcardProgress; stats: FlashcardStats }> {
	const code = courseCode(rawCode);
	if (isFailure(code)) return code;
	const b = (typeof body === "object" && body !== null ? body : {}) as { cardId?: unknown; chosen?: unknown };
	const deck = getFlashcardDeck(code);
	if (!deck || deck.cards.length === 0) return fail(404, "no_deck", "Faget har ingen spørsmålskort.");
	const card: Flashcard | undefined = typeof b.cardId === "string" ? deck.cards.find((c) => c.id === b.cardId) : undefined;
	if (!card) return fail(404, "no_card", "Fant ikke kortet. Bunken kan være laget på nytt.");
	const chosen = sanitizeFlashcardChoice(card, b.chosen);
	if (chosen === undefined) return fail(400, "invalid_choice", "Ugyldig svar.");
	const recorded = recordFlashcardAnswer(deck, card, chosen, flashcardSeams.now(), flashcardSeams.timeZone);
	saveFlashcardDeck(recorded.deck);
	emit("flashcards-changed", { code });
	return { ok: true, correct: recorded.correct, progress: recorded.deck.progress[card.id]!, stats: flashcardStats(recorded.deck) };
}

/** «Nullstill fremgang»: the cards stay, right/wrong goes. */
export function resetFlashcards(rawCode: string): FlashcardOutcome<{ view: FlashcardView }> {
	const code = courseCode(rawCode);
	if (isFailure(code)) return code;
	const deck = getFlashcardDeck(code);
	if (!deck || deck.cards.length === 0) return fail(404, "no_deck", "Faget har ingen spørsmålskort.");
	saveFlashcardDeck(resetFlashcardProgress(deck, new Date(flashcardSeams.now()).toISOString()));
	emit("flashcards-changed", { code });
	return { ok: true, view: viewFor(code) };
}
