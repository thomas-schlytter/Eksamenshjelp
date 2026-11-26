/**
 * SPØRSMÅLSKORT (owner-approved plan, 2026-11-26): a deck of recall cards
 * per course, made once by the teacher model from the course's sources and
 * practised without any model call.
 *
 * Two card types: «Ett valg» (exactly four options, one right) and «Flere
 * valg» («Velg alle som stemmer», four or five options, at least one
 * right). A «Flere valg» card scores only when the chosen set is exactly
 * the right set (all or nothing). «Vet ikke» is a wrong answer that never
 * feeds the flame.
 *
 * The deck keeps per-card progress (right/wrong counts, the last result,
 * when it was last seen). A card is «ny» until answered, then «kan» or
 * «bom» after its LAST answer. The flame reads `solvedAt`: one instant per
 * local day with at least one right card; it survives «Nullstill
 * fremgang» and «Lag ny bunke» (earned days are never taken back).
 *
 * Pure and browser-safe: no IO here. Persistence is src/store/flashcards.ts,
 * the service and the generator run on the server.
 */

import { latexProblems } from "./latex-check.ts";
import { dayKey } from "./streak.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

export type FlashcardType = "single" | "multi";

export interface Flashcard {
	/** "fc_…" — unique within the deck. */
	id: string;
	type: FlashcardType;
	/** Markdown + LaTeX ($…$), Norwegian bokmål. No figures. */
	question: string;
	/** Shuffled at generation; the stored order is final. */
	options: string[];
	/** The right options' indices, ascending. */
	correct: number[];
	/** One or two sentences on why. */
	explanation: string;
	/** The topic's title as the learner reads it. */
	topic: string;
	/** The course topic id, when the card belongs to one of the course's topics. */
	topicId?: string;
	/** Where it comes from: «2024h eksamen, oppg. 3», «Emnebeskrivelsen». */
	source: string;
}

export interface FlashcardProgress {
	right: number;
	wrong: number;
	/** The last answer: decides «kan» / «bom». */
	last: "right" | "wrong";
	/** ISO instant of the last answer. */
	lastSeen: string;
}

export interface FlashcardDeck {
	code: string;
	createdAt: string;
	updatedAt: string;
	cards: Flashcard[];
	/** cardId → progress; absent = never answered. */
	progress: Record<string, FlashcardProgress>;
	/** The flame: one instant (ms) per local day with a right card. */
	solvedAt: number[];
}

/** What the generator submits per card: everything but the id. */
export type FlashcardDraft = Omit<Flashcard, "id">;

// ─── Limits ──────────────────────────────────────────────────────────────────

/** A new deck: 30–40 cards, after the size of the pensum. */
export const FLASHCARD_DECK_MIN = 30;
export const FLASHCARD_DECK_MAX = 40;
/** «Legg til flere»: 15 new cards. */
export const FLASHCARD_MORE_COUNT = 15;
export const FLASHCARD_SINGLE_OPTIONS = 4;
export const FLASHCARD_MULTI_MIN_OPTIONS = 4;
export const FLASHCARD_MULTI_MAX_OPTIONS = 5;
/** Each batch carries both types: at least this many of each. */
export const FLASHCARD_MIN_PER_TYPE = 3;
const QUESTION_MAX = 600;
const OPTION_MAX = 300;
const EXPLANATION_MAX = 400;
const SOURCE_MAX = 120;
const TOPIC_MAX = 120;

export const FLASHCARD_ID_PATTERN = /^fc_[a-z0-9_]{4,40}$/;

// ─── Validation (the generator's submit seam) ────────────────────────────────

const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** The comparison key for «no duplicates»: case, spacing and the closing
 *  punctuation do not make a question new. */
export function flashcardQuestionKey(question: string): string {
	return question.toLowerCase().replace(/\s+/g, " ").replace(/[\s.?!:]+$/, "").trim();
}

const FIGURE = /<svg[\s>]|<img[\s>]|!\[[^\]]*\]\(/i;

/**
 * Every rule a generated batch must satisfy, as model-facing problems
 * (empty = valid): the batch size, both types present, the option counts
 * per type, valid and unique right indices, no duplicate options or
 * questions (within the batch and against `avoid`), no figures, a known
 * topic id, and math that KaTeX renders (src/core/latex-check.ts).
 */
export function flashcardDraftProblems(
	drafts: readonly FlashcardDraft[],
	opts: { min: number; max: number; topicIds?: readonly string[]; avoid?: readonly string[] },
): string[] {
	const problems: string[] = [];
	if (!Array.isArray(drafts) || drafts.length < opts.min || drafts.length > opts.max) {
		problems.push(
			opts.min === opts.max
				? `submit exactly ${opts.min} cards (got ${Array.isArray(drafts) ? drafts.length : 0})`
				: `submit ${opts.min} to ${opts.max} cards (got ${Array.isArray(drafts) ? drafts.length : 0})`,
		);
		if (!Array.isArray(drafts)) return problems;
	}
	const singles = drafts.filter((d) => d.type === "single").length;
	const multis = drafts.filter((d) => d.type === "multi").length;
	if (singles < FLASHCARD_MIN_PER_TYPE || multis < FLASHCARD_MIN_PER_TYPE) {
		problems.push(`mix the two types: at least ${FLASHCARD_MIN_PER_TYPE} "single" and ${FLASHCARD_MIN_PER_TYPE} "multi" cards (got ${singles} single, ${multis} multi)`);
	}
	const known = opts.topicIds ? new Set(opts.topicIds) : null;
	const seen = new Map<string, number>();
	const avoid = new Set((opts.avoid ?? []).map(flashcardQuestionKey));
	drafts.forEach((d, i) => {
		const at = `card ${i + 1}`;
		if (d.type !== "single" && d.type !== "multi") {
			problems.push(`${at}: type must be "single" or "multi"`);
			return;
		}
		if (!isText(d.question)) problems.push(`${at}: question is empty`);
		else {
			if (d.question.length > QUESTION_MAX) problems.push(`${at}: the question is too long (at most ${QUESTION_MAX} characters)`);
			const key = flashcardQuestionKey(d.question);
			const twin = seen.get(key);
			if (twin !== undefined) problems.push(`${at}: the same question as card ${twin + 1}`);
			else seen.set(key, i);
			if (avoid.has(key)) problems.push(`${at}: the deck already has this question — write a new one`);
		}
		const options: string[] = Array.isArray(d.options) ? d.options : [];
		if (d.type === "single" && options.length !== FLASHCARD_SINGLE_OPTIONS) {
			problems.push(`${at}: a "single" card has exactly ${FLASHCARD_SINGLE_OPTIONS} options`);
		}
		if (d.type === "multi" && (options.length < FLASHCARD_MULTI_MIN_OPTIONS || options.length > FLASHCARD_MULTI_MAX_OPTIONS)) {
			problems.push(`${at}: a "multi" card has ${FLASHCARD_MULTI_MIN_OPTIONS} or ${FLASHCARD_MULTI_MAX_OPTIONS} options`);
		}
		if (options.some((o) => !isText(o))) problems.push(`${at}: an option is empty`);
		else {
			if (options.some((o) => o.length > OPTION_MAX)) problems.push(`${at}: an option is too long (at most ${OPTION_MAX} characters)`);
			const keys = options.map((o) => o.trim().toLowerCase());
			if (new Set(keys).size !== keys.length) problems.push(`${at}: two options are the same`);
		}
		const correct: number[] = Array.isArray(d.correct) ? d.correct : [];
		if (correct.some((c) => !Number.isInteger(c) || c < 0 || c >= options.length)) {
			problems.push(`${at}: correct holds option indices from 0 to ${Math.max(0, options.length - 1)}`);
		} else if (new Set(correct).size !== correct.length) {
			problems.push(`${at}: an index appears twice in correct`);
		} else if (d.type === "single" && correct.length !== 1) {
			problems.push(`${at}: a "single" card has exactly one right option`);
		} else if (d.type === "multi" && correct.length < 1) {
			problems.push(`${at}: a "multi" card has at least one right option`);
		}
		if (!isText(d.explanation)) problems.push(`${at}: explanation is empty`);
		else if (d.explanation.trim().length > EXPLANATION_MAX) problems.push(`${at}: the explanation must be one or two short sentences (at most ${EXPLANATION_MAX} characters)`);
		if (!isText(d.topic)) problems.push(`${at}: topic is empty`);
		else if (d.topic.trim().length > TOPIC_MAX) problems.push(`${at}: topic is too long`);
		if (d.topicId !== undefined && known && !known.has(d.topicId)) {
			problems.push(`${at}: topicId ${JSON.stringify(d.topicId)} is not a topic of this course — copy an id from the topic list or leave it out`);
		}
		if (!isText(d.source)) problems.push(`${at}: source is empty — name the exam and task, or «Emnebeskrivelsen»`);
		else if (d.source.trim().length > SOURCE_MAX) problems.push(`${at}: source is too long`);
		const text = [d.question, ...options, d.explanation].join("\n");
		if (FIGURE.test(text)) problems.push(`${at}: no figures or images — text and LaTeX only`);
		// The LaTeX double-check: math KaTeX cannot render goes back to the model.
		problems.push(
			...latexProblems(d.question, `${at} question`),
			...options.flatMap((o, j) => latexProblems(o, `${at} option ${j}`)),
			...latexProblems(d.explanation, `${at} explanation`),
		);
	});
	return problems;
}

// ─── Building the cards ──────────────────────────────────────────────────────

/** Shuffle one card's options (models put the right one first far too
 *  often) and remap the right indices. `random` is injectable for tests. */
export function shuffleFlashcardOptions<T extends Pick<Flashcard, "options" | "correct">>(card: T, random: () => number = Math.random): T {
	const order = card.options.map((_, i) => i);
	for (let i = order.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[order[i], order[j]] = [order[j]!, order[i]!];
	}
	return {
		...card,
		options: order.map((i) => card.options[i]!),
		correct: card.correct.map((c) => order.indexOf(c)).sort((a, b) => a - b),
	};
}

/** Valid drafts → stored cards: trimmed, shuffled, with fresh ids. */
export function buildFlashcards(drafts: readonly FlashcardDraft[], newId: () => string, random: () => number = Math.random): Flashcard[] {
	return drafts.map((d) =>
		shuffleFlashcardOptions(
			{
				id: newId(),
				type: d.type,
				question: d.question.trim(),
				options: d.options.map((o) => o.trim()),
				correct: [...d.correct].sort((a, b) => a - b),
				explanation: d.explanation.trim(),
				topic: d.topic.trim(),
				...(d.topicId ? { topicId: d.topicId } : {}),
				source: d.source.trim(),
			},
			random,
		),
	);
}

/** «Legg til flere»: the new cards behind the old ones, without any whose
 *  question the deck already has. */
export function appendFlashcards(deck: FlashcardDeck, cards: readonly Flashcard[], now: string): FlashcardDeck {
	const have = new Set(deck.cards.map((c) => flashcardQuestionKey(c.question)));
	const ids = new Set(deck.cards.map((c) => c.id));
	const fresh: Flashcard[] = [];
	for (const card of cards) {
		const key = flashcardQuestionKey(card.question);
		if (have.has(key) || ids.has(card.id)) continue;
		have.add(key);
		ids.add(card.id);
		fresh.push(card);
	}
	return { ...deck, cards: [...deck.cards, ...fresh], updatedAt: now };
}

/** «Nullstill fremgang»: the cards stay, right/wrong goes. The flame's
 *  days stay. */
export function resetFlashcardProgress(deck: FlashcardDeck, now: string): FlashcardDeck {
	return { ...deck, progress: {}, updatedAt: now };
}

// ─── Status ──────────────────────────────────────────────────────────────────

/** new = never answered; known = the last answer was right; missed = wrong. */
export type FlashcardStatus = "new" | "known" | "missed";

export function flashcardStatus(progress: FlashcardProgress | undefined): FlashcardStatus {
	if (!progress) return "new";
	return progress.last === "right" ? "known" : "missed";
}

export interface FlashcardStats {
	total: number;
	known: number;
	missed: number;
	fresh: number;
	single: number;
	multi: number;
}

export function flashcardStats(deck: Pick<FlashcardDeck, "cards" | "progress"> | null): FlashcardStats {
	const stats: FlashcardStats = { total: 0, known: 0, missed: 0, fresh: 0, single: 0, multi: 0 };
	if (!deck) return stats;
	for (const card of deck.cards) {
		stats.total++;
		stats[card.type]++;
		const status = flashcardStatus(deck.progress[card.id]);
		if (status === "known") stats.known++;
		else if (status === "missed") stats.missed++;
		else stats.fresh++;
	}
	return stats;
}

// ─── The round's setup ───────────────────────────────────────────────────────

/** «Med en gang» (feedback after each card) or «Til slutt» (after the round). */
export type FlashcardReveal = "now" | "end";
export type FlashcardCount = 10 | 20 | "all";
/** «Blandet» (missed cards more often), «Bare bomkort», «Bare nye». */
export type FlashcardPool = "mixed" | "missed" | "new";
export type FlashcardTypeFilter = "both" | "single" | "multi";

export interface FlashcardSetup {
	reveal: FlashcardReveal;
	count: FlashcardCount;
	pool: FlashcardPool;
	type: FlashcardTypeFilter;
}

export const DEFAULT_FLASHCARD_SETUP: FlashcardSetup = { reveal: "now", count: 10, pool: "mixed", type: "both" };

/** A remembered setup (localStorage): every unknown field falls back. */
export function parseFlashcardSetup(raw: unknown): FlashcardSetup {
	const r = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Record<keyof FlashcardSetup, unknown>>;
	return {
		reveal: r.reveal === "end" ? "end" : "now",
		count: r.count === 20 ? 20 : r.count === "all" ? "all" : 10,
		pool: r.pool === "missed" || r.pool === "new" ? r.pool : "mixed",
		type: r.type === "single" || r.type === "multi" ? r.type : "both",
	};
}

/** The cards a setup draws from: its pool and its type. */
export function flashcardCandidates(deck: Pick<FlashcardDeck, "cards" | "progress">, setup: Pick<FlashcardSetup, "pool" | "type">): Flashcard[] {
	return deck.cards.filter((card) => {
		if (setup.type !== "both" && card.type !== setup.type) return false;
		const status = flashcardStatus(deck.progress[card.id]);
		if (setup.pool === "missed") return status === "missed";
		if (setup.pool === "new") return status === "new";
		return true;
	});
}

/** «Blandet»: a missed card is three times, a new card twice, as likely to
 *  be drawn as one he knows. */
const MIX_WEIGHT: Record<FlashcardStatus, number> = { missed: 3, new: 2, known: 1 };

/**
 * The round: card ids in the order they are shown. «Blandet» draws by
 * weight without replacement; the other pools draw evenly. «Alle» (and a
 * pool smaller than the count) takes every candidate, shuffled.
 */
export function selectFlashcardRound(deck: Pick<FlashcardDeck, "cards" | "progress">, setup: FlashcardSetup, random: () => number = Math.random): string[] {
	const pool = flashcardCandidates(deck, setup).map((card) => ({
		id: card.id,
		weight: setup.pool === "mixed" ? MIX_WEIGHT[flashcardStatus(deck.progress[card.id])] : 1,
	}));
	const take = setup.count === "all" ? pool.length : Math.min(setup.count, pool.length);
	const out: string[] = [];
	while (out.length < take) {
		const total = pool.reduce((sum, c) => sum + c.weight, 0);
		let at = random() * total;
		let index = pool.length - 1;
		for (let i = 0; i < pool.length; i++) {
			at -= pool[i]!.weight;
			if (at < 0) {
				index = i;
				break;
			}
		}
		out.push(pool[index]!.id);
		pool.splice(index, 1);
	}
	return out;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

/** One answer in a round; chosen null = «Vet ikke». */
export interface FlashcardAnswer {
	cardId: string;
	chosen: number[] | null;
}

/** Right only when the chosen set is exactly the right set (all or
 *  nothing for «Flere valg»); «Vet ikke» is never right. */
export function isFlashcardCorrect(card: Pick<Flashcard, "correct">, chosen: readonly number[] | null): boolean {
	if (chosen === null) return false;
	const picked = new Set(chosen);
	if (picked.size !== card.correct.length) return false;
	return card.correct.every((c) => picked.has(c));
}

export interface FlashcardRoundScore {
	correct: number;
	total: number;
}

export function flashcardRoundScore(cards: readonly Flashcard[], answers: readonly FlashcardAnswer[]): FlashcardRoundScore {
	const byId = new Map(cards.map((c) => [c.id, c]));
	let correct = 0;
	for (const a of answers) {
		const card = byId.get(a.cardId);
		if (card && isFlashcardCorrect(card, a.chosen)) correct++;
	}
	return { correct, total: answers.length };
}

/** A chosen list from the wire: unique in-range integers, ascending; null
 *  stays null («Vet ikke»); anything else is refused (undefined). */
export function sanitizeFlashcardChoice(card: Pick<Flashcard, "options">, raw: unknown): number[] | null | undefined {
	if (raw === null) return null;
	if (!Array.isArray(raw)) return undefined;
	const out = new Set<number>();
	for (const v of raw) {
		if (!Number.isInteger(v) || (v as number) < 0 || (v as number) >= card.options.length) return undefined;
		out.add(v as number);
	}
	if (out.size === 0) return undefined;
	return [...out].sort((a, b) => a - b);
}

/**
 * Record one answer on the deck: the card's counts, its last result and
 * when it was seen; a right card (never «Vet ikke») also lights today's
 * flame — one instant per local day is kept.
 */
export function recordFlashcardAnswer(
	deck: FlashcardDeck,
	card: Flashcard,
	chosen: readonly number[] | null,
	nowMs: number,
	timeZone?: string,
): { deck: FlashcardDeck; correct: boolean } {
	const correct = isFlashcardCorrect(card, chosen);
	const before = deck.progress[card.id];
	const seen = new Date(nowMs).toISOString();
	const progress: FlashcardProgress = {
		right: (before?.right ?? 0) + (correct ? 1 : 0),
		wrong: (before?.wrong ?? 0) + (correct ? 0 : 1),
		last: correct ? "right" : "wrong",
		lastSeen: seen,
	};
	let solvedAt = deck.solvedAt;
	if (correct) {
		const today = dayKey(nowMs, timeZone);
		if (!solvedAt.some((ms) => dayKey(ms, timeZone) === today)) solvedAt = [...solvedAt, nowMs];
	}
	return { deck: { ...deck, progress: { ...deck.progress, [card.id]: progress }, solvedAt, updatedAt: seen }, correct };
}

// ─── «Jobb med dette nå» ─────────────────────────────────────────────────────

export interface FlashcardTopicMiss {
	topicId: string;
	/** Cards on the topic whose last answer was wrong. */
	missed: number;
}

/** A topic counts as weak on the cards when at least this many of its
 *  cards are missed… */
export const FLASHCARD_WEAK_MIN_MISSED = 2;

/**
 * The course topics he misses a lot on the cards: at least two missed
 * cards on the topic, and no fewer missed than known. Most missed first.
 * Read-only: the topic colours are never changed by the cards.
 */
export function flashcardWeakTopics(deck: Pick<FlashcardDeck, "cards" | "progress"> | null): FlashcardTopicMiss[] {
	if (!deck) return [];
	const per = new Map<string, { missed: number; known: number }>();
	for (const card of deck.cards) {
		if (!card.topicId) continue;
		const status = flashcardStatus(deck.progress[card.id]);
		if (status === "new") continue;
		const acc = per.get(card.topicId) ?? { missed: 0, known: 0 };
		if (status === "missed") acc.missed++;
		else acc.known++;
		per.set(card.topicId, acc);
	}
	return [...per]
		.filter(([, t]) => t.missed >= FLASHCARD_WEAK_MIN_MISSED && t.missed >= t.known)
		.map(([topicId, t]) => ({ topicId, missed: t.missed }))
		.sort((a, b) => b.missed - a.missed || a.topicId.localeCompare(b.topicId));
}

/** «bommer på 3 spørsmålskort» — the reason line in «Jobb med dette nå». */
export function flashcardMissReason(missed: number): string {
	return `bommer på ${missed} spørsmålskort`;
}

// ─── What the pages read (GET /api/flashcards/<CODE>) ───────────────────────

/** "new" = the first deck; "more" = «Legg til flere»; "replace" = «Lag ny bunke». */
export type FlashcardGenerationMode = "new" | "more" | "replace";

export interface FlashcardGeneration {
	mode: FlashcardGenerationMode;
	startedAt: string;
	/** The generator's latest activity line («leser eksamen-2023.pdf»). */
	activity: string;
}

/** What the fag page and the practice page read. */
export interface FlashcardView {
	deck: Pick<FlashcardDeck, "cards" | "progress" | "createdAt" | "updatedAt"> | null;
	stats: FlashcardStats;
	/** The course topics he misses a lot on the cards («Jobb med dette nå»). */
	weakTopics: FlashcardTopicMiss[];
	generating: FlashcardGeneration | null;
	/** The last generation's failure, until the next start. */
	error: string | null;
}

// ─── Guards ──────────────────────────────────────────────────────────────────

/** Guard a deck read from disk: drops cards and progress that do not hold. */
export function readFlashcardDeck(raw: unknown, code: string): FlashcardDeck | null {
	if (typeof raw !== "object" || raw === null) return null;
	const d = raw as Partial<FlashcardDeck>;
	if (!Array.isArray(d.cards)) return null;
	const cards = d.cards.filter((c): c is Flashcard =>
		typeof c === "object" && c !== null &&
		typeof c.id === "string" && (c.type === "single" || c.type === "multi") &&
		typeof c.question === "string" && Array.isArray(c.options) && c.options.every((o) => typeof o === "string") &&
		Array.isArray(c.correct) && c.correct.every((i) => Number.isInteger(i) && i >= 0 && i < c.options.length) &&
		typeof c.explanation === "string" && typeof c.topic === "string" && typeof c.source === "string");
	const ids = new Set(cards.map((c) => c.id));
	const progress: Record<string, FlashcardProgress> = {};
	for (const [id, p] of Object.entries(typeof d.progress === "object" && d.progress !== null ? d.progress : {})) {
		if (!ids.has(id) || typeof p !== "object" || p === null) continue;
		const q = p as Partial<FlashcardProgress>;
		if ((q.last !== "right" && q.last !== "wrong") || typeof q.right !== "number" || typeof q.wrong !== "number") continue;
		progress[id] = { right: q.right, wrong: q.wrong, last: q.last, lastSeen: typeof q.lastSeen === "string" ? q.lastSeen : "" };
	}
	return {
		code,
		createdAt: typeof d.createdAt === "string" ? d.createdAt : "",
		updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : "",
		cards,
		progress,
		solvedAt: Array.isArray(d.solvedAt) ? d.solvedAt.filter((n): n is number => typeof n === "number" && Number.isFinite(n)) : [],
	};
}
