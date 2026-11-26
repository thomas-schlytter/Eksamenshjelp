/**
 * Spørsmålskort in the UI (2026-11-26), static markup only (no effects, no
 * fetch): the fag page's card in its four states, the card on the fag page
 * itself, the setup menu, one card before and after an answer, the result
 * and the practice page's first frame. Same tsx classic-JSX shim as the
 * other render tests.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { buildExamPlan, DEFAULT_FLASHCARD_SETUP, flashcardStats, type Course, type Flashcard, type FlashcardView } from "../src/core/index.ts";
import { ServerEventsProvider } from "../components/server-events.tsx";
import { CoursePage } from "../components/courses/course-page.tsx";
import { FlashcardsCard, flashcardsHref } from "../components/flashcards/flashcards-card.tsx";
import { FlashcardSetupMenu } from "../components/flashcards/flashcard-setup.tsx";
import { FlashcardCardView, FlashcardResult } from "../components/flashcards/flashcard-round.tsx";
import { FlashcardPracticePage } from "../components/flashcards/flashcard-practice.tsx";

function dom(node: React.ReactNode) {
	return parseHTML(`<html><body>${renderToStaticMarkup(node)}</body></html>`).document;
}

const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
const withProviders = (node: React.ReactNode) => (
	<AppRouterContext.Provider value={router as never}>
		<ServerEventsProvider connect={() => ({ close() {}, onOpen() {}, onEvent() {} })}>{node}</ServerEventsProvider>
	</AppRouterContext.Provider>
);

const one: Flashcard = { id: "fc_one_0001", type: "single", question: "Hva er $\\lambda$?", options: ["En egenverdi", "En egenvektor", "En matrise", "Et tall uten navn"], correct: [0], explanation: "Fordi $Av = \\lambda v$.", topic: "Egenverdier", topicId: "egen", source: "2024h eksamen, oppg. 3" };
const many: Flashcard = { id: "fc_many_0001", type: "multi", question: "Hvilke stemmer?", options: ["A1", "A2", "A3", "A4", "A5"], correct: [1, 3], explanation: "To stemmer.", topic: "Stabilitet", source: "Emnebeskrivelsen" };
const deck = {
	cards: [one, many],
	progress: { fc_one_0001: { right: 1, wrong: 0, last: "right" as const, lastSeen: "t" } },
	createdAt: "t",
	updatedAt: "t",
};
const view = (over: Partial<FlashcardView> = {}): FlashcardView => ({
	deck,
	stats: flashcardStats(deck),
	weakTopics: [],
	generating: null,
	error: null,
	...over,
});
const empty = view({ deck: null, stats: flashcardStats(null) });

describe("the fag page's «Spørsmålskort» card", () => {
	it("with a deck: the count, how many he knows and misses, and «Øv»", () => {
		const d = dom(<FlashcardsCard code="TMA4400" view={view({ stats: { ...flashcardStats(deck), missed: 4 } })} onMake={() => {}} />);
		const card = d.querySelector('[data-testid="course-flashcards"]')!;
		assert.match(card.textContent!, /Spørsmålskort/);
		assert.equal(d.querySelector('[data-testid="flashcards-total"]')!.textContent, "2 kort");
		assert.match(d.querySelector('[data-testid="flashcards-stats"]')!.textContent!, /Kan1Bommer på4/);
		const practise = d.querySelector('[data-testid="flashcards-practice"]')!;
		assert.equal(practise.getAttribute("href"), "/fag/TMA4400/sporsmalskort");
		assert.match(practise.textContent!, /Øv/);
		assert.equal(flashcardsHref("TMA 4400"), "/fag/TMA%204400/sporsmalskort");
	});

	it("without a deck: «Lag spørsmålskort», and the error of a failed run", () => {
		const d = dom(<FlashcardsCard code="TMA4400" view={{ ...empty, error: "Klarte ikke å lage spørsmålskortene. Prøv igjen." }} onMake={() => {}} />);
		assert.ok(d.querySelector('[data-testid="flashcards-empty"]'));
		assert.match(d.querySelector('[data-testid="flashcards-make"]')!.textContent!, /Lag spørsmålskort/);
		assert.match(d.querySelector('[role="alert"]')!.textContent!, /Klarte ikke/);
		assert.equal(d.querySelector('[data-testid="flashcards-practice"]'), null);
	});

	it("while the cards are made: the waiting state with the live line, no button", () => {
		const d = dom(<FlashcardsCard code="TMA4400" view={{ ...empty, generating: { mode: "new", startedAt: "t", activity: "leser eksamen-2023.pdf" } }} onMake={() => {}} />);
		const waiting = d.querySelector('[data-testid="flashcards-waiting"]')!;
		assert.equal(waiting.getAttribute("role"), "status");
		assert.match(waiting.textContent!, /Lager spørsmålskort …/);
		assert.match(waiting.textContent!, /Leser eksamen-2023\.pdf\. Tar noen minutter\./);
		assert.ok(d.querySelector("[data-pending-spinner]"));
		assert.equal(d.querySelector('[data-testid="flashcards-make"]'), null);
	});

	it("before the first read: «Laster …»; a pressed button waits", () => {
		assert.match(dom(<FlashcardsCard code="X" view={null} onMake={() => {}} />).body.textContent!, /Laster …/);
		const pressed = dom(<FlashcardsCard code="X" view={empty} starting onMake={() => {}} />);
		assert.equal(pressed.querySelector('[data-testid="flashcards-make"]')!.getAttribute("aria-busy"), "true");
	});

	it("sits on the fag page beside the mock exams", () => {
		const course: Course = {
			code: "TMA4400", name: "Matematikk 1", custom: false, exam: {}, minutesPerDay: 120, sources: [],
			topics: [{ id: "egen", title: "Egenverdier", weight: 2, status: "red" }], planDone: [], createdAt: "t", updatedAt: "t",
		};
		const d = dom(withProviders(<CoursePage initial={{ course, plan: buildExamPlan(course, "2026-11-26") }} initialConfigured />));
		assert.ok(d.querySelector('[data-testid="course-mock-exams"]'));
		const card = d.querySelector('[data-testid="course-flashcards"]')!;
		assert.ok(card);
		assert.match(card.textContent!, /Laster …/, "the deck is read after mount");
	});
});

describe("the setup menu", () => {
	it("has the four lines with one choice marked each, and the round size", () => {
		const d = dom(<FlashcardSetupMenu deck={deck} setup={DEFAULT_FLASHCARD_SETUP} onChange={() => {}} onStart={() => {}} />);
		const menu = d.querySelector('[data-testid="flashcard-setup"]')!;
		for (const label of ["Svar", "Antall", "Kort", "Type"]) assert.ok(menu.textContent!.includes(label), label);
		const groups = menu.querySelectorAll('[role="radiogroup"]');
		assert.equal(groups.length, 4);
		for (const group of groups) {
			assert.equal(group.querySelectorAll('[aria-checked="true"]').length, 1);
			assert.ok(d.getElementById(group.getAttribute("aria-labelledby")!), "each group is labelled by its line");
		}
		assert.equal(menu.querySelectorAll("svg").length >= 4, true, "an icon per line");
		for (const id of ["reveal-now", "reveal-end", "count-10", "count-20", "count-all", "pool-mixed", "pool-missed", "pool-new", "type-both", "type-single", "type-multi"]) {
			assert.ok(d.querySelector(`[data-testid="flashcard-setup-${id}"]`), id);
		}
		assert.equal(d.querySelector('[data-testid="flashcard-setup-reveal-now"]')!.getAttribute("aria-checked"), "true");
		assert.match(d.querySelector('[data-testid="flashcard-setup-reveal-now"]')!.textContent!, /Med en gang/);
		assert.match(d.querySelector('[data-testid="flashcard-setup-reveal-end"]')!.textContent!, /Til slutt/);
		assert.match(d.querySelector('[data-testid="flashcard-setup-pool-missed"]')!.textContent!, /Bare bomkort0/);
		assert.match(d.querySelector('[data-testid="flashcard-setup-pool-new"]')!.textContent!, /Bare nye1/);
		assert.equal(d.querySelector('[data-testid="flashcard-round-size"]')!.textContent, "2 kort i runden");
		assert.equal(d.querySelector('[data-testid="flashcard-start"]')!.hasAttribute("disabled"), false);
	});

	it("an empty pool says so and cannot start", () => {
		const d = dom(<FlashcardSetupMenu deck={deck} setup={{ ...DEFAULT_FLASHCARD_SETUP, pool: "missed" }} onChange={() => {}} onStart={() => {}} />);
		assert.equal(d.querySelector('[data-testid="flashcard-round-size"]')!.textContent, "Ingen kort passer valgene.");
		assert.equal(d.querySelector('[data-testid="flashcard-start"]')!.hasAttribute("disabled"), true);
	});
});

describe("one card", () => {
	const marks = [null, null];

	it("«Ett valg» before the answer: four radio options and «Vet ikke», no «Send svar»", () => {
		const d = dom(<FlashcardCardView card={one} index={0} total={2} marks={marks} answer={undefined} revealed last={false} onAnswer={() => {}} onNext={() => {}} />);
		assert.equal(d.querySelectorAll('[role="radio"]').length, 4);
		assert.match(d.querySelector('[data-testid="flashcard-count"]')!.textContent!, /Kort 1 av 2 · Ett valg/);
		assert.ok(d.querySelector('[data-testid="flashcard-dont-know"]'));
		assert.equal(d.querySelector('[data-testid="flashcard-submit"]'), null);
		assert.equal(d.querySelector('[data-testid="flashcard-feedback"]'), null);
	});

	it("«Flere valg»: checkboxes, «Velg alle som stemmer» and «Send svar»", () => {
		const d = dom(<FlashcardCardView card={many} index={1} total={2} marks={marks} answer={undefined} revealed last onAnswer={() => {}} onNext={() => {}} />);
		assert.equal(d.querySelectorAll('[role="checkbox"]').length, 5);
		assert.match(d.body.textContent!, /Velg alle som stemmer\./);
		assert.ok(d.querySelector('[data-testid="flashcard-submit"]')!.hasAttribute("disabled"), "nothing ticked yet");
	});

	it("after a partly right «Flere valg» answer with «Med en gang»: not right, the key and why", () => {
		const d = dom(<FlashcardCardView card={many} index={1} total={2} marks={["right", "wrong"]} answer={{ cardId: many.id, chosen: [1] }} revealed last onAnswer={() => {}} onNext={() => {}} />);
		const feedback = d.querySelector('[data-testid="flashcard-feedback"]')!;
		assert.match(feedback.textContent!, /Ikke riktig\. Alle valgene må stemme\./);
		assert.match(feedback.textContent!, /Riktig: B, D\./);
		assert.match(feedback.textContent!, /Kilde: Emnebeskrivelsen/);
		assert.match(d.querySelector('[data-testid="flashcard-next"]')!.textContent!, /Se resultatet/);
		assert.equal(d.querySelector('[data-testid="flashcard-dont-know"]'), null);
	});
});

describe("the result", () => {
	it("the score with its bar, «Ikke riktig» and the ways on («Til slutt» adds «Gjennomgå»)", () => {
		const answers = [{ cardId: one.id, chosen: [0] }, { cardId: many.id, chosen: null }];
		const d = dom(withProviders(<FlashcardResult code="TMA4400" cards={[one, many]} answers={answers} reveal="end" onNewRound={() => {}} onMissed={() => {}} onReview={() => {}} />));
		assert.equal(d.querySelector('[data-testid="flashcard-score"]')!.textContent, "1/2");
		assert.equal(d.querySelector('[role="img"]')!.getAttribute("aria-label"), "1 av 2 riktige");
		const missed = d.querySelector('[data-testid="flashcard-missed"]')!;
		assert.match(missed.textContent!, /Ikke riktig/);
		assert.match(missed.textContent!, /Hvilke stemmer\?/);
		assert.match(missed.textContent!, /A2/);
		assert.match(missed.textContent!, /To stemmer\./);
		assert.ok(!missed.textContent!.includes("Hva er"), "the right card is not listed");
		assert.ok(d.querySelector('[data-testid="flashcard-new-round"]'));
		assert.ok(d.querySelector('[data-testid="flashcard-practice-missed"]'));
		assert.ok(d.querySelector('[data-testid="flashcard-review"]'));
		assert.equal(d.querySelector('[data-testid="flashcard-back"]')!.getAttribute("href"), "/fag/TMA4400");
	});

	it("all right with «Med en gang»: no missed list, no «Øv på bomkortene», no «Gjennomgå»", () => {
		const d = dom(withProviders(<FlashcardResult code="X" cards={[one]} answers={[{ cardId: one.id, chosen: [0] }]} reveal="now" onNewRound={() => {}} onMissed={() => {}} onReview={() => {}} />));
		assert.match(d.body.textContent!, /Alt riktig/);
		assert.equal(d.querySelector('[data-testid="flashcard-practice-missed"]'), null);
		assert.equal(d.querySelector('[data-testid="flashcard-review"]'), null);
	});
});

describe("the practice page's first frame", () => {
	it("with a deck: the setup and «Bunken» with its three tools", () => {
		const d = dom(withProviders(<FlashcardPracticePage code="TMA4400" name="Matematikk 1" initial={view()} />));
		assert.ok(d.querySelector('[data-testid="flashcard-setup"]'));
		const tools = d.querySelector('[data-testid="flashcard-deck-tools"]')!;
		assert.match(d.querySelector('[data-testid="flashcard-deck-stats"]')!.textContent!, /2 kort · 1 kan · 0 bommer på · 1 nye/);
		for (const id of ["flashcard-add-more", "flashcard-reset", "flashcard-replace"]) assert.ok(tools.querySelector(`[data-testid="${id}"]`), id);
		assert.match(d.body.textContent!, /Mine fag.*TMA4400.*Spørsmålskort/s);
	});

	it("without a deck: «Lag spørsmålskort»; while making: the waiting state", () => {
		const none = dom(withProviders(<FlashcardPracticePage code="TMA4400" name="Matematikk 1" initial={empty} />));
		assert.ok(none.querySelector('[data-testid="flashcard-no-deck"] [data-testid="flashcards-make"]'));
		const making = dom(withProviders(<FlashcardPracticePage code="TMA4400" name="Matematikk 1" initial={{ ...empty, generating: { mode: "new", startedAt: "t", activity: "" } }} />));
		assert.ok(making.querySelector('[data-testid="flashcards-waiting"]'));
		assert.equal(making.querySelector('[data-testid="flashcards-make"]'), null);
	});
});
