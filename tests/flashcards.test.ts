/**
 * Spørsmålskort (2026-11-26): the deck contract (strict validation of a
 * generated batch, the LaTeX double-check included; shuffling; all-or-
 * nothing scoring; the round's selection per setup; reset and «Legg til
 * flere» without duplicates; the flame's days), the generator with a faux
 * model, the service and its HTTP routes over an isolated LH_DATA_DIR, the
 * flame counting a right card but not «Vet ikke», and «Jobb med dette nå».
 *
 * No browser runs here: the practice page itself is not driven.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, type FauxResponseStep, type ToolCall } from "@earendil-works/pi-ai";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-flashcards-"));
process.env.LH_DATA_DIR = path.join(TMP, "data");
process.env.LH_AUTH_FILE = path.join(TMP, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");

const core = await import("../src/core/flashcards.ts");
const { workNowTopics } = await import("../components/courses/course-summary.ts");
const { runFlashcardMaker, flashcardMakerPrompt, FLASHCARD_MAKER_INSTRUCTIONS } = await import("../src/agent/subagents/flashcard-maker.ts");
const { flashcardSeams, flashcardRun } = await import("../src/server/flashcards.ts");
const { courseStore } = await import("../src/store/courses.ts");
const { getFlashcardDeck, saveFlashcardDeck } = await import("../src/store/flashcards.ts");
const { streakSeams } = await import("../src/server/streak.ts");
const { subscribe } = await import("../src/core/events.ts");
const viewRoute = await import("../app/api/flashcards/[code]/route.ts");
const generateRoute = await import("../app/api/flashcards/[code]/generate/route.ts");
const answerRoute = await import("../app/api/flashcards/[code]/answer/route.ts");
const resetRoute = await import("../app/api/flashcards/[code]/reset/route.ts");
const streakRoute = await import("../app/api/streak/route.ts");

import type { Flashcard, FlashcardDeck, FlashcardDraft, FlashcardView } from "../src/core/flashcards.ts";
import type { Course, CourseTopic } from "../src/core/courses.ts";
import type { PiEngine } from "../src/agent/models.ts";

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// ─── fixtures ────────────────────────────────────────────────────────────────

function single(n: number, extra: Partial<FlashcardDraft> = {}): FlashcardDraft {
	return {
		type: "single",
		question: `Hva er definisjonen av begrep ${n}?`,
		options: [`Riktig ${n}`, `Feil ${n}a`, `Feil ${n}b`, `Feil ${n}c`],
		correct: [0],
		explanation: "Slik står det i pensum.",
		topic: "Numerikk",
		topicId: "numerikk",
		source: "2024h eksamen, oppg. 1",
		...extra,
	};
}

function multi(n: number, extra: Partial<FlashcardDraft> = {}): FlashcardDraft {
	return {
		type: "multi",
		question: `Hvilke påstander om $x_${n}$ stemmer?`,
		options: [`Sann ${n}a`, `Sann ${n}b`, `Usann ${n}c`, `Usann ${n}d`, `Usann ${n}e`],
		correct: [0, 1],
		explanation: "To av dem følger av teoremet.",
		topic: "Stabilitet",
		topicId: "stabilitet",
		source: "Emnebeskrivelsen",
		...extra,
	};
}

/** A valid batch of `count` cards, a third «Flere valg». */
function batch(count: number, offset = 0): FlashcardDraft[] {
	return Array.from({ length: count }, (_, i) => (i % 3 === 2 ? multi(i + offset) : single(i + offset)));
}

const TOPIC_IDS = ["numerikk", "stabilitet"];
const RANGE = { min: core.FLASHCARD_DECK_MIN, max: core.FLASHCARD_DECK_MAX, topicIds: TOPIC_IDS };

function card(id: string, extra: Partial<Flashcard> = {}): Flashcard {
	return { id, type: "single", question: `Spørsmål ${id}?`, options: ["a", "b", "c", "d"], correct: [1], explanation: "Fordi.", topic: "Numerikk", topicId: "numerikk", source: "LF", ...extra };
}

function deckOf(cards: Flashcard[], progress: FlashcardDeck["progress"] = {}): FlashcardDeck {
	return { code: "TTK4100", createdAt: "t", updatedAt: "t", cards, progress, solvedAt: [] };
}

const right = { right: 1, wrong: 0, last: "right" as const, lastSeen: "t" };
const wrong = { right: 0, wrong: 1, last: "wrong" as const, lastSeen: "t" };

/** A seeded random (mulberry32): deterministic rounds. */
function seeded(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ─── validation ──────────────────────────────────────────────────────────────

describe("validation of a generated batch", () => {
	it("accepts a valid deck of 30–40 cards with both types", () => {
		assert.deepEqual(core.flashcardDraftProblems(batch(30), RANGE), []);
		assert.deepEqual(core.flashcardDraftProblems(batch(40), RANGE), []);
	});

	it("refuses the wrong batch size and a batch without both types", () => {
		assert.match(core.flashcardDraftProblems(batch(29), RANGE).join(" "), /30 to 40 cards/);
		assert.match(core.flashcardDraftProblems(batch(16), { min: 15, max: 15 }).join(" "), /exactly 15 cards/);
		const singles = Array.from({ length: 30 }, (_, i) => single(i));
		assert.match(core.flashcardDraftProblems(singles, RANGE).join(" "), /mix the two types/);
	});

	it("checks option counts per type, the right indices and duplicate options", () => {
		const cards = batch(30);
		cards[0] = single(0, { options: ["a", "b", "c"] });
		cards[1] = single(1, { correct: [0, 1] });
		cards[2] = multi(2, { options: ["a", "b", "c"] });
		cards[3] = single(3, { correct: [4] });
		cards[4] = single(4, { options: ["Svar", "svar ", "x", "y"] });
		cards[5] = multi(5, { correct: [] });
		cards[6] = single(6, { correct: [1, 1] });
		const problems = core.flashcardDraftProblems(cards, RANGE).join("\n");
		assert.match(problems, /card 1: a "single" card has exactly 4 options/);
		assert.match(problems, /card 2: a "single" card has exactly one right option/);
		assert.match(problems, /card 3: a "multi" card has 4 or 5 options/);
		assert.match(problems, /card 4: correct holds option indices/);
		assert.match(problems, /card 5: two options are the same/);
		assert.match(problems, /card 6: a "multi" card has at least one right option/);
		assert.match(problems, /card 7: an index appears twice/);
	});

	it("refuses duplicate questions, in the batch and against the old deck", () => {
		const cards = batch(30);
		cards[5] = single(99, { question: cards[0]!.question.toUpperCase() + "  " });
		assert.match(core.flashcardDraftProblems(cards, RANGE).join(" "), /card 6: the same question as card 1/);
		const more = batch(15, 100);
		const problems = core.flashcardDraftProblems(more, { min: 15, max: 15, avoid: [more[3]!.question] });
		assert.match(problems.join(" "), /card 4: the deck already has this question/);
	});

	it("refuses figures, an unknown topic id and empty fields", () => {
		const cards = batch(30);
		cards[0] = single(0, { question: "Se figuren: ![graf](x.png)" });
		cards[1] = single(1, { topicId: "finnes-ikke" });
		cards[2] = multi(2, { explanation: " ", source: "" });
		const problems = core.flashcardDraftProblems(cards, RANGE).join("\n");
		assert.match(problems, /card 1: no figures/);
		assert.match(problems, /card 2: topicId "finnes-ikke" is not a topic/);
		assert.match(problems, /card 3: explanation is empty/);
		assert.match(problems, /card 3: source is empty/);
	});

	it("sends math KaTeX cannot render back to the model (question, option, explanation)", () => {
		const cards = batch(30);
		cards[0] = single(0, { question: "Hva er $\\frac{1}{$ her?" });
		cards[1] = single(1, { options: ["$x \\tag{1}$", "b", "c", "d"] });
		cards[2] = multi(2, { explanation: "Fordi $\\notacommand{x}$." });
		const problems = core.flashcardDraftProblems(cards, RANGE).join("\n");
		assert.match(problems, /card 1 question: LaTeX does not render/);
		assert.match(problems, /card 2 option 0: LaTeX does not render/);
		assert.match(problems, /card 3 explanation: LaTeX does not render/);
		assert.deepEqual(core.flashcardDraftProblems(batch(30), RANGE), [], "plain $x_1$ math passes");
	});
});

// ─── building, scoring, selection ────────────────────────────────────────────

describe("shuffling and scoring", () => {
	it("shuffles the options and keeps the right ones right", () => {
		const draft = multi(1, { correct: [0, 3] });
		for (let seed = 1; seed < 20; seed++) {
			const [built] = core.buildFlashcards([draft], () => "fc_test_0001", seeded(seed));
			assert.deepEqual(built!.correct.map((i) => built!.options[i]).sort(), [draft.options[0], draft.options[3]].sort());
			assert.deepEqual([...built!.correct], [...built!.correct].sort((a, b) => a - b));
		}
		const seen = new Set<number>();
		for (let seed = 1; seed < 40; seed++) seen.add(core.buildFlashcards([single(1)], () => "fc_test_0001", seeded(seed))[0]!.correct[0]!);
		assert.ok(seen.size > 1, "the right option does not always land in the same place");
	});

	it("«Ett valg» scores the one right option; «Flere valg» is all or nothing; «Vet ikke» is wrong", () => {
		const one = card("fc_a_0001", { correct: [2] });
		assert.equal(core.isFlashcardCorrect(one, [2]), true);
		assert.equal(core.isFlashcardCorrect(one, [1]), false);
		const many = card("fc_b_0001", { type: "multi", options: ["a", "b", "c", "d", "e"], correct: [0, 3] });
		assert.equal(core.isFlashcardCorrect(many, [3, 0]), true);
		assert.equal(core.isFlashcardCorrect(many, [0]), false, "one of two right is no point");
		assert.equal(core.isFlashcardCorrect(many, [0, 3, 4]), false, "an extra wrong pick is no point");
		assert.equal(core.isFlashcardCorrect(many, null), false);
		assert.deepEqual(
			core.flashcardRoundScore([one, many], [{ cardId: one.id, chosen: [2] }, { cardId: many.id, chosen: [0] }]),
			{ correct: 1, total: 2 },
		);
	});

	it("sanitizes a choice from the wire", () => {
		const c = card("fc_c_0001");
		assert.deepEqual(core.sanitizeFlashcardChoice(c, [2, 0, 2]), [0, 2]);
		assert.equal(core.sanitizeFlashcardChoice(c, null), null);
		assert.equal(core.sanitizeFlashcardChoice(c, [4]), undefined);
		assert.equal(core.sanitizeFlashcardChoice(c, []), undefined);
		assert.equal(core.sanitizeFlashcardChoice(c, "0"), undefined);
	});
});

describe("selecting the round", () => {
	const cards = [
		...Array.from({ length: 10 }, (_, i) => card(`fc_known_${i}0`)),
		...Array.from({ length: 10 }, (_, i) => card(`fc_missed_${i}0`, { type: i < 5 ? "multi" : "single", options: ["a", "b", "c", "d", "e"], correct: [0] })),
		...Array.from({ length: 10 }, (_, i) => card(`fc_fresh_${i}0`)),
	];
	const progress = Object.fromEntries([
		...cards.filter((c) => c.id.includes("known")).map((c) => [c.id, right]),
		...cards.filter((c) => c.id.includes("missed")).map((c) => [c.id, wrong]),
	]);
	const deck = deckOf(cards, progress);
	const setup = (over: Partial<import("../src/core/flashcards.ts").FlashcardSetup> = {}) => ({ ...core.DEFAULT_FLASHCARD_SETUP, ...over });

	it("takes 10, 20 or all cards, without repeats", () => {
		const ten = core.selectFlashcardRound(deck, setup({ count: 10 }), seeded(1));
		assert.equal(ten.length, 10);
		assert.equal(new Set(ten).size, 10);
		assert.equal(core.selectFlashcardRound(deck, setup({ count: 20 }), seeded(2)).length, 20);
		const all = core.selectFlashcardRound(deck, setup({ count: "all" }), seeded(3));
		assert.deepEqual([...all].sort(), cards.map((c) => c.id).sort());
	});

	it("«Bare bomkort» and «Bare nye» draw only from their pool; a small pool gives a short round", () => {
		const missed = core.selectFlashcardRound(deck, setup({ pool: "missed", count: 20 }), seeded(4));
		assert.equal(missed.length, 10);
		assert.ok(missed.every((id) => id.includes("missed")));
		const fresh = core.selectFlashcardRound(deck, setup({ pool: "new" }), seeded(5));
		assert.ok(fresh.every((id) => id.includes("fresh")));
	});

	it("the type filter keeps only «Ett valg» or «Flere valg»", () => {
		const multis = core.selectFlashcardRound(deck, setup({ type: "multi", count: "all" }), seeded(6));
		assert.equal(multis.length, 5);
		assert.ok(multis.every((id) => deck.cards.find((c) => c.id === id)!.type === "multi"));
		const missedSingles = core.selectFlashcardRound(deck, setup({ type: "single", pool: "missed", count: "all" }), seeded(7));
		assert.equal(missedSingles.length, 5);
	});

	it("«Blandet» draws missed cards more often than known ones", () => {
		const random = seeded(8);
		let missed = 0, known = 0;
		for (let i = 0; i < 400; i++) {
			const [first] = core.selectFlashcardRound(deck, setup({ count: 10 }), random);
			if (first!.includes("missed")) missed++;
			if (first!.includes("known")) known++;
		}
		assert.ok(missed > known * 2, `missed ${missed} vs known ${known}`);
	});

	it("reads a remembered setup and falls back on anything unknown", () => {
		assert.deepEqual(core.parseFlashcardSetup({ reveal: "end", count: "all", pool: "missed", type: "multi" }), { reveal: "end", count: "all", pool: "missed", type: "multi" });
		assert.deepEqual(core.parseFlashcardSetup({ reveal: "x", count: 7 }), core.DEFAULT_FLASHCARD_SETUP);
		assert.deepEqual(core.parseFlashcardSetup(null), core.DEFAULT_FLASHCARD_SETUP);
	});
});

describe("progress, reset and «Legg til flere»", () => {
	it("records an answer and lights the flame once per day, never on «Vet ikke» or a wrong answer", () => {
		const c = card("fc_d_0001");
		let deck = deckOf([c]);
		const t0 = Date.parse("2026-11-23T08:00:00Z");
		deck = core.recordFlashcardAnswer(deck, c, null, t0, "Europe/Oslo").deck;
		deck = core.recordFlashcardAnswer(deck, c, [0], t0 + 1000, "Europe/Oslo").deck;
		assert.deepEqual(deck.solvedAt, []);
		assert.deepEqual(deck.progress[c.id], { right: 0, wrong: 2, last: "wrong", lastSeen: new Date(t0 + 1000).toISOString() });
		const r = core.recordFlashcardAnswer(deck, c, [1], t0 + 2000, "Europe/Oslo");
		assert.equal(r.correct, true);
		deck = core.recordFlashcardAnswer(r.deck, c, [1], t0 + 3000, "Europe/Oslo").deck;
		assert.deepEqual(deck.solvedAt, [t0 + 2000], "one instant per day");
		assert.equal(core.flashcardStatus(deck.progress[c.id]), "known");
		deck = core.recordFlashcardAnswer(deck, c, [1], t0 + 86_400_000, "Europe/Oslo").deck;
		assert.equal(deck.solvedAt.length, 2);
	});

	it("«Nullstill fremgang» keeps the cards and the flame's days", () => {
		const deck = { ...deckOf([card("fc_e_0001")], { fc_e_0001: right }), solvedAt: [5] };
		const reset = core.resetFlashcardProgress(deck, "now");
		assert.equal(reset.cards.length, 1);
		assert.deepEqual(reset.progress, {});
		assert.deepEqual(reset.solvedAt, [5]);
		assert.equal(core.flashcardStats(reset).fresh, 1);
	});

	it("«Legg til flere» appends without duplicate questions and keeps progress", () => {
		const deck = deckOf([card("fc_f_0001", { question: "Hva er en egenverdi?" })], { fc_f_0001: wrong });
		const next = core.appendFlashcards(deck, [card("fc_g_0001", { question: "hva er en  EGENVERDI" }), card("fc_h_0001", { question: "Hva er et egenrom?" })], "now");
		assert.deepEqual(next.cards.map((c) => c.id), ["fc_f_0001", "fc_h_0001"]);
		assert.deepEqual(next.progress, deck.progress);
	});
});

describe("«Jobb med dette nå» and the cards", () => {
	const topics: CourseTopic[] = [
		{ id: "a", title: "Rød", weight: 2, status: "red" },
		{ id: "b", title: "Gul", weight: 3, status: "yellow" },
		{ id: "c", title: "Grønn", weight: 2, status: "green", statusNote: "sitter" },
		{ id: "d", title: "Ukjent", weight: 1, status: "unknown" },
	];

	it("finds topics with at least two missed cards and no fewer missed than known", () => {
		const cards = [
			card("fc_c1_0001", { topicId: "c" }), card("fc_c2_0001", { topicId: "c" }), card("fc_c3_0001", { topicId: "c" }),
			card("fc_d1_0001", { topicId: "d" }), card("fc_d2_0001", { topicId: "d" }), card("fc_d3_0001", { topicId: "d" }),
			card("fc_b1_0001", { topicId: "b" }),
		];
		const progress = {
			fc_c1_0001: wrong, fc_c2_0001: wrong, fc_c3_0001: right,
			fc_d1_0001: wrong, fc_d2_0001: right, fc_d3_0001: right,
			fc_b1_0001: wrong,
		};
		assert.deepEqual(core.flashcardWeakTopics(deckOf(cards, progress)), [{ topicId: "c", missed: 2 }]);
		assert.deepEqual(core.flashcardWeakTopics(null), []);
	});

	it("puts a card-weak topic after the red ones and before the yellow, with the reason", () => {
		const items = workNowTopics(topics, 3, [{ topicId: "c", missed: 3 }]);
		assert.deepEqual(items.map((i) => i.topic.id), ["a", "c", "b"]);
		assert.equal(items[1]!.reason, "bommer på 3 spørsmålskort");
		assert.equal(items[1]!.topic.status, "green", "the colour is not changed by the cards");
		assert.deepEqual(workNowTopics(topics).map((i) => i.topic.id), ["a", "b"], "without cards: as before");
	});
});

// ─── the generator (faux model) ──────────────────────────────────────────────

function fauxEngine(steps: FauxResponseStep[]): PiEngine {
	const faux = createFauxCore({});
	faux.setResponses(steps);
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

const COURSE: Course = {
	code: "TTK4100",
	name: "Kybernetikk, introduksjon",
	custom: false,
	content: "Modellering, stabilitet og numerikk.",
	exam: { date: "2026-12-19", form: "Skriftlig skoleeksamen", duration: "4 timer" },
	minutesPerDay: 120,
	sources: [{ id: "s1", kind: "folder", title: "TTK4100", path: "/x/Eksamenshjelp/TTK4100", auto: false, addedAt: "t" }],
	topics: [
		{ id: "numerikk", title: "Numerikk", weight: 2, status: "red" },
		{ id: "stabilitet", title: "Stabilitet", weight: 3, status: "yellow" },
	],
	planDone: [],
	createdAt: "2026-11-01T00:00:00.000Z",
	updatedAt: "2026-11-01T00:00:00.000Z",
};

describe("the generator (faux model)", () => {
	it("reads the fag folder, is refused on bad LaTeX, fixes it and submits", async () => {
		let firstPrompt = "";
		let systemPrompt = "";
		let refusal = "";
		const bad = batch(30);
		bad[0] = single(0, { question: "Hva gir $a = b \\tag{1}$?" });
		const engine = fauxEngine([
			(context) => {
				firstPrompt = JSON.stringify(context.messages);
				systemPrompt = JSON.stringify(context);
				return fauxAssistantMessage([fauxToolCall("submit_flashcards", { cards: bad } as unknown as ToolCall["arguments"], { id: "s1" })], { stopReason: "toolUse" });
			},
			(context) => {
				refusal = JSON.stringify(context.messages.at(-1));
				return fauxAssistantMessage([fauxToolCall("submit_flashcards", { cards: batch(30) } as unknown as ToolCall["arguments"], { id: "s2" })], { stopReason: "toolUse" });
			},
		]);
		const drafts = await runFlashcardMaker({ course: COURSE, mode: "new" }, { engine });
		assert.equal(drafts.length, 30);
		assert.match(firstPrompt, /\/x\/Eksamenshjelp\/TTK4100/);
		assert.match(firstPrompt, /\[numerikk\] Numerikk/);
		assert.match(firstPrompt, /30 to 40 cards/);
		assert.match(systemPrompt, /You write recall cards/, "the system prompt rides along");
		assert.ok(FLASHCARD_MAKER_INSTRUCTIONS.includes("Never \\tag"), "no \\tag");
		assert.match(FLASHCARD_MAKER_INSTRUCTIONS, /as \$…\$, in plain KaTeX-compatible TeX/);
		assert.match(refusal, /LaTeX does not render/);
	});

	it("«Legg til flere» asks for exactly 15 and lists the old questions", () => {
		const prompt = flashcardMakerPrompt({ course: COURSE, mode: "more", avoid: ["Hva er en egenverdi?"] });
		assert.match(prompt, /exactly 15 NEW cards/);
		assert.match(prompt, /- Hva er en egenverdi\?/);
		assert.match(FLASHCARD_MAKER_INSTRUCTIONS, /NO calculation/);
	});
});

// ─── the service and the routes ──────────────────────────────────────────────

const params = (code = "TTK4100") => ({ params: Promise.resolve({ code }) });
const post = (body?: unknown) => new Request("http://x", { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });

describe("the service over HTTP", () => {
	courseStore.saveCourse(COURSE);
	let generated: Array<{ mode: string; avoid?: string[] }> = [];
	let nextBatch: FlashcardDraft[] = batch(30);
	flashcardSeams.engine = () => ({}) as PiEngine;
	flashcardSeams.generate = async (input) => {
		generated.push({ mode: input.mode, ...(input.avoid ? { avoid: input.avoid } : {}) });
		return nextBatch;
	};
	flashcardSeams.random = seeded(11);
	let NOW = Date.parse("2026-11-23T12:00:00Z");
	flashcardSeams.now = () => NOW;
	flashcardSeams.timeZone = "Europe/Oslo";
	streakSeams.now = () => NOW;
	streakSeams.timeZone = "Europe/Oslo";

	async function view(): Promise<FlashcardView> {
		const res = await viewRoute.GET(new Request("http://x"), params());
		assert.equal(res.status, 200);
		return (await res.json()) as FlashcardView;
	}

	it("no deck: nothing to practise", async () => {
		const v = await view();
		assert.equal(v.deck, null);
		assert.equal(v.generating, null);
		assert.equal(v.stats.total, 0);
		const res = await answerRoute.POST(post({ cardId: "fc_x_0001", chosen: [0] }), params());
		assert.equal(res.status, 404);
	});

	it("«Lag spørsmålskort» answers at once with the waiting state, then the deck lands", async () => {
		const events: string[] = [];
		const off = subscribe((e) => {
			if (e.type === "flashcards-changed") events.push((e as { code: string }).code);
		});
		const res = await generateRoute.POST(post({ mode: "new" }), params());
		assert.equal(res.status, 202);
		const started = (await res.json()) as FlashcardView;
		assert.equal(started.generating?.mode, "new");
		const again = await generateRoute.POST(post({ mode: "new" }), params());
		assert.equal(again.status, 409, "one run at a time");
		await flashcardRun("TTK4100");
		off();
		const v = await view();
		assert.equal(v.generating, null);
		assert.equal(v.stats.total, 30);
		assert.equal(v.stats.fresh, 30);
		assert.ok(v.deck!.cards.every((c) => core.FLASHCARD_ID_PATTERN.test(c.id)));
		assert.ok(events.length >= 2, "start and finish are announced");
		assert.ok(fs.existsSync(path.join(process.env.LH_DATA_DIR!, "flashcards", "TTK4100.json")));
	});

	it("refuses a second first deck, an unknown course and an unknown mode", async () => {
		assert.equal((await generateRoute.POST(post({ mode: "new" }), params())).status, 409);
		assert.equal((await generateRoute.POST(post({ mode: "new" }), params("TMA9999"))).status, 404);
		assert.equal((await generateRoute.POST(post({ mode: "alt" }), params())).status, 400);
	});

	it("an answer is scored on the server; «Vet ikke» is wrong", async () => {
		const deck = getFlashcardDeck("TTK4100")!;
		const c = deck.cards.find((x) => x.type === "multi")!;
		const okRes = await answerRoute.POST(post({ cardId: c.id, chosen: c.correct }), params());
		assert.equal(okRes.status, 200);
		const ok = (await okRes.json()) as { correct: boolean; stats: { known: number } };
		assert.equal(ok.correct, true);
		assert.equal(ok.stats.known, 1);
		const partial = (await (await answerRoute.POST(post({ cardId: c.id, chosen: [c.correct[0]] }), params())).json()) as { correct: boolean };
		assert.equal(partial.correct, false, "all or nothing");
		const other = deck.cards.find((x) => x.type === "single")!;
		const dontKnow = (await (await answerRoute.POST(post({ cardId: other.id, chosen: null }), params())).json()) as { correct: boolean; stats: { missed: number } };
		assert.equal(dontKnow.correct, false);
		assert.equal(dontKnow.stats.missed, 2);
		assert.equal((await answerRoute.POST(post({ cardId: other.id, chosen: [9] }), params())).status, 400);
		assert.equal((await answerRoute.POST(post({ cardId: other.id }), params())).status, 400);
	});

	it("the flame counts a right card, but a day with only «Vet ikke» stays dark", async () => {
		const res = streakRoute.GET();
		const s = (await res.json()) as { current: number; todayDone: boolean };
		assert.equal(s.todayDone, true);
		assert.equal(s.current, 1);
		NOW += 86_400_000;
		const deck = getFlashcardDeck("TTK4100")!;
		await answerRoute.POST(post({ cardId: deck.cards[0]!.id, chosen: null }), params());
		const next = (await streakRoute.GET().json()) as { current: number; todayDone: boolean };
		assert.equal(next.todayDone, false, "«Vet ikke» does not light today");
		assert.equal(next.current, 1, "yesterday's right card still counts");
	});

	it("«Legg til flere» sends the old questions and adds 15 without duplicates", async () => {
		generated = [];
		const before = getFlashcardDeck("TTK4100")!;
		const dup = { ...single(0), question: before.cards[0]!.question };
		nextBatch = [dup, ...batch(14, 500)];
		assert.equal((await generateRoute.POST(post({ mode: "more" }), params())).status, 202);
		await flashcardRun("TTK4100");
		assert.equal(generated[0]!.mode, "more");
		assert.equal(generated[0]!.avoid!.length, 30);
		const after = getFlashcardDeck("TTK4100")!;
		assert.equal(after.cards.length, 44, "the duplicate is dropped");
		assert.equal(new Set(after.cards.map((c) => core.flashcardQuestionKey(c.question))).size, 44);
		assert.deepEqual(after.progress, before.progress, "progress kept");
	});

	it("«Nullstill fremgang» empties right/wrong and keeps the cards", async () => {
		const res = await resetRoute.POST(post(), params());
		assert.equal(res.status, 200);
		const v = (await res.json()) as FlashcardView;
		assert.equal(v.stats.total, 44);
		assert.equal(v.stats.fresh, 44);
		assert.ok(getFlashcardDeck("TTK4100")!.solvedAt.length > 0, "the flame's days stay");
	});

	it("«Lag ny bunke» replaces the cards when the new ones are in; a failure keeps the old deck", async () => {
		const old = getFlashcardDeck("TTK4100")!;
		flashcardSeams.generate = async () => {
			throw new Error("provider down");
		};
		assert.equal((await generateRoute.POST(post({ mode: "replace" }), params())).status, 202);
		await flashcardRun("TTK4100");
		const failed = await view();
		assert.match(failed.error ?? "", /Klarte ikke/);
		assert.equal(failed.stats.total, 44, "nothing lost");
		flashcardSeams.generate = async () => batch(32, 900);
		assert.equal((await generateRoute.POST(post({ mode: "replace" }), params())).status, 202);
		await flashcardRun("TTK4100");
		const v = await view();
		assert.equal(v.error, null);
		assert.equal(v.stats.total, 32);
		assert.ok(v.deck!.cards.every((c) => !old.cards.some((o) => o.id === c.id)));
		assert.deepEqual(getFlashcardDeck("TTK4100")!.solvedAt, old.solvedAt);
	});

	it("without a model the start is refused", async () => {
		flashcardSeams.engine = () => undefined;
		const res = await generateRoute.POST(post({ mode: "more" }), params());
		assert.equal(res.status, 503);
		flashcardSeams.engine = () => ({}) as PiEngine;
	});

	it("a hand-broken deck file is guarded on read", () => {
		const deck = getFlashcardDeck("TTK4100")!;
		saveFlashcardDeck({ ...deck, cards: [...deck.cards, { id: "fc_bad_0001", type: "single", question: "x", options: ["a"], correct: [3] } as unknown as Flashcard] });
		assert.equal(getFlashcardDeck("TTK4100")!.cards.length, 32);
	});
});
