"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRightIcon, PlusIcon, RefreshCwIcon, RotateCcwIcon, SparklesIcon, XIcon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/courses/confirm-dialog";
import { DEFAULT_FLASHCARD_SETUP, isFlashcardCorrect, selectFlashcardRound } from "@/src/core";
import { flashcardApi, flashcardErrorMessage, useFlashcards } from "./flashcard-api";
import { FlashcardCardView, FlashcardResult, FlashcardReview, type FlashcardMark } from "./flashcard-round";
import { FlashcardSetupMenu, loadFlashcardSetup, saveFlashcardSetup } from "./flashcard-setup";
import { FlashcardsWaiting } from "./flashcards-card";
import type { Flashcard, FlashcardAnswer, FlashcardGenerationMode, FlashcardReveal, FlashcardSetup, FlashcardView } from "./flashcard-types";

interface Round {
	cards: Flashcard[];
	answers: FlashcardAnswer[];
	index: number;
	reveal: FlashcardReveal;
}

type Phase = "setup" | "round" | "result" | "review";

/** The round's progress marks: right/wrong as he goes with «Med en gang»,
 *  neutral with «Til slutt». */
function roundMarks(round: Round): FlashcardMark[] {
	return round.cards.map((card, i) => {
		const a = round.answers[i];
		if (!a) return null;
		if (round.reveal === "end") return "done";
		return isFlashcardCorrect(card, a.chosen) ? "right" : "wrong";
	});
}

/** Shuffle the order of a list (Fisher–Yates). */
function shuffled<T>(items: readonly T[]): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[out[i], out[j]] = [out[j]!, out[i]!];
	}
	return out;
}

/** «Bunken»: the counts and the three ways to manage the deck. */
function DeckTools({ view, busy, onMore, onReset, onReplace }: {
	view: FlashcardView;
	busy: FlashcardGenerationMode | null;
	onMore: () => void;
	onReset: () => void;
	onReplace: () => void;
}) {
	const { stats } = view;
	const running = Boolean(view.generating);
	return (
		<section data-testid="flashcard-deck-tools" aria-labelledby="deck-tools-title" className="flex flex-col gap-3 rounded-lg border bg-card p-5">
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<h2 id="deck-tools-title" className="font-title text-base font-semibold">Bunken</h2>
				<p className="font-ui text-xs tabular-nums text-muted-foreground" data-testid="flashcard-deck-stats">
					{stats.total} kort · {stats.known} kan · {stats.missed} bommer på · {stats.fresh} nye
				</p>
			</div>
			{view.generating && <FlashcardsWaiting activity={view.generating.activity} more={view.generating.mode === "more"} />}
			{view.error && !running && <p role="alert" className="font-ui text-sm text-destructive">{view.error}</p>}
			<div className="flex flex-wrap gap-2">
				<Button variant="outline" size="sm" onClick={onMore} disabled={running} pending={busy === "more"} data-testid="flashcard-add-more">
					<PlusIcon aria-hidden="true" />
					Legg til flere
				</Button>
				<Button variant="ghost" size="sm" onClick={onReset} disabled={running || stats.fresh === stats.total} data-testid="flashcard-reset">
					<RotateCcwIcon aria-hidden="true" />
					Nullstill fremgang
				</Button>
				<Button variant="ghost" size="sm" onClick={onReplace} disabled={running} pending={busy === "replace"} data-testid="flashcard-replace">
					<RefreshCwIcon aria-hidden="true" />
					Lag ny bunke
				</Button>
			</div>
		</section>
	);
}

/**
 * THE PRACTICE PAGE (/fag/[code]/sporsmalskort): the setup, the round, the
 * result and «Gjennomgå», plus the deck's tools. No chat and no model: the
 * answers are scored here and recorded on the server one by one.
 */
export function FlashcardPracticePage({ code, name, initial }: { code: string; name: string; initial: FlashcardView }) {
	const { view: liveView, setView } = useFlashcards(code, initial);
	const view = liveView ?? initial;
	const [phase, setPhase] = useState<Phase>("setup");
	const [setup, setSetup] = useState<FlashcardSetup>(DEFAULT_FLASHCARD_SETUP);
	const [round, setRound] = useState<Round | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState<FlashcardGenerationMode | null>(null);
	const [confirm, setConfirm] = useState<"reset" | "replace" | null>(null);
	const [confirmBusy, setConfirmBusy] = useState(false);
	const [confirmError, setConfirmError] = useState<string | null>(null);
	const top = useRef<HTMLDivElement>(null);

	// The remembered setup (after mount: the server render has no storage).
	useEffect(() => setSetup(loadFlashcardSetup()), []);
	const changeSetup = (next: FlashcardSetup) => {
		setSetup(next);
		saveFlashcardSetup(next);
	};
	const scrollTop = () => top.current?.closest("[data-scroll-root]")?.scrollTo({ top: 0 });

	const begin = (cards: Flashcard[], reveal: FlashcardReveal) => {
		if (cards.length === 0) return;
		setRound({ cards, answers: [], index: 0, reveal });
		setPhase("round");
		setNotice(null);
		scrollTop();
	};
	const start = () => {
		if (!view.deck) return;
		const byId = new Map(view.deck.cards.map((c) => [c.id, c]));
		// The stored option order is final (the server scores by index).
		begin(selectFlashcardRound(view.deck, setup).map((id) => byId.get(id)!), setup.reveal);
	};
	const practiseMissed = () => {
		if (!round) return;
		const missed = round.cards.filter((card, i) => !isFlashcardCorrect(card, round.answers[i]?.chosen ?? null));
		begin(shuffled(missed), round.reveal);
	};

	const advance = (current: Round) => {
		if (current.index + 1 < current.cards.length) setRound({ ...current, index: current.index + 1 });
		else {
			setRound(current);
			setPhase("result");
			scrollTop();
		}
	};
	const answer = (chosen: number[] | null) => {
		if (!round) return;
		const card = round.cards[round.index]!;
		if (round.answers[round.index]) return;
		const next: Round = { ...round, answers: [...round.answers, { cardId: card.id, chosen }] };
		// The server scores the stored card the same way; the page does not wait.
		flashcardApi.answer(code, card.id, chosen).catch((err) => setNotice(`Svaret ble ikke lagret. ${flashcardErrorMessage(err)}`));
		if (round.reveal === "end") advance(next);
		else setRound(next);
	};

	const generate = (mode: FlashcardGenerationMode) => {
		setBusy(mode);
		return flashcardApi.generate(code, mode)
			.then((fresh) => {
				setView(fresh);
				return null;
			})
			.catch((err) => flashcardErrorMessage(err))
			.finally(() => setBusy(null));
	};
	const makeFirst = () => void generate("new").then((error) => error && setNotice(`Kunne ikke lage spørsmålskort. ${error}`));
	const addMore = () => void generate("more").then((error) => error && setNotice(`Kunne ikke lage flere kort. ${error}`));
	const runConfirm = async () => {
		setConfirmBusy(true);
		setConfirmError(null);
		let error: string | null = null;
		if (confirm === "reset") {
			try {
				setView(await flashcardApi.reset(code));
			} catch (err) {
				error = flashcardErrorMessage(err);
			}
		} else if (confirm === "replace") {
			error = await generate("replace");
		}
		setConfirmBusy(false);
		if (error) setConfirmError(error);
		else setConfirm(null);
	};

	const current = round && phase === "round" ? round.cards[round.index] : undefined;

	return (
		<div className="flex h-dvh flex-col">
			<TopBar>
				<nav aria-label="Brødsmuler" className="flex min-w-0 items-center gap-1 font-ui text-sm">
					<Link href="/" className="rounded-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
						Mine fag
					</Link>
					<ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
					<Link href={`/fag/${encodeURIComponent(code)}`} className="rounded-sm tabular-nums text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
						{code}
					</Link>
					<ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
					<span className="truncate font-medium" aria-current="page">Spørsmålskort</span>
				</nav>
			</TopBar>
			<div data-scroll-root className="relative min-h-0 flex-1 overflow-y-auto">
				<div ref={top} className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-7 sm:px-8" data-testid="flashcard-practice">
					<header className="min-w-0">
						<p className="font-ui text-[11px] font-semibold uppercase tracking-widest text-muted-foreground tabular-nums">{code} · {name}</p>
						<h1 className="mt-1.5 font-title text-3xl font-semibold leading-tight tracking-tight">Spørsmålskort</h1>
					</header>

					<div role="alert" className="empty:hidden">
						{notice && (
							<p className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2 font-ui text-sm">
								<span className="min-w-0 flex-1">{notice}</span>
								<button
									type="button"
									onClick={() => setNotice(null)}
									aria-label="Lukk meldingen"
									className="shrink-0 cursor-pointer rounded-sm p-0.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
								>
									<XIcon className="size-4" aria-hidden="true" />
								</button>
							</p>
						)}
					</div>

					{!view.deck && phase === "setup" ? (
						<section className="flex flex-col items-start gap-3 rounded-lg border bg-card p-5" data-testid="flashcard-no-deck">
							{view.generating ? (
								<FlashcardsWaiting activity={view.generating.activity} />
							) : (
								<>
									<p className="font-ui text-sm text-muted-foreground">Ingen spørsmålskort ennå.</p>
									{view.error && <p role="alert" className="font-ui text-sm text-destructive">{view.error}</p>}
									<Button onClick={makeFirst} pending={busy === "new"} data-testid="flashcards-make">
										<SparklesIcon aria-hidden="true" />
										Lag spørsmålskort
									</Button>
								</>
							)}
						</section>
					) : phase === "setup" && view.deck ? (
						<>
							<div className="rounded-lg border bg-card p-5">
								<FlashcardSetupMenu deck={view.deck} setup={setup} onChange={changeSetup} onStart={start} />
							</div>
							<DeckTools
								view={view}
								busy={busy}
								onMore={addMore}
								onReset={() => setConfirm("reset")}
								onReplace={() => setConfirm("replace")}
							/>
						</>
					) : phase === "round" && round && current ? (
						<div className="rounded-lg border bg-card p-5">
							<FlashcardCardView
								key={`${round.index}-${current.id}`}
								card={current}
								index={round.index}
								total={round.cards.length}
								marks={roundMarks(round)}
								answer={round.answers[round.index]}
								revealed={round.reveal === "now"}
								last={round.index === round.cards.length - 1}
								onAnswer={answer}
								onNext={() => advance(round)}
							/>
						</div>
					) : phase === "result" && round ? (
						<div className="rounded-lg border bg-card p-5">
							<FlashcardResult
								code={code}
								cards={round.cards}
								answers={round.answers}
								reveal={round.reveal}
								onNewRound={() => setPhase("setup")}
								onMissed={practiseMissed}
								onReview={() => setPhase("review")}
							/>
						</div>
					) : phase === "review" && round ? (
						<div className="rounded-lg border bg-card p-5">
							<FlashcardReview cards={round.cards} answers={round.answers} onDone={() => setPhase("result")} />
						</div>
					) : null}
				</div>
			</div>

			<ConfirmDialog
				open={confirm === "reset"}
				title="Nullstille fremgangen?"
				confirmLabel="Nullstill"
				busy={confirmBusy}
				error={confirmError}
				onConfirm={() => void runConfirm()}
				onCancel={() => {
					setConfirm(null);
					setConfirmError(null);
				}}
			>
				Kortene beholdes, men alle blir nye igjen: hva du kan og bommer på, slettes. Dette kan ikke angres.
			</ConfirmDialog>
			<ConfirmDialog
				open={confirm === "replace"}
				title="Lage en ny bunke?"
				confirmLabel="Lag ny bunke"
				destructive
				busy={confirmBusy}
				error={confirmError}
				onConfirm={() => void runConfirm()}
				onCancel={() => {
					setConfirm(null);
					setConfirmError(null);
				}}
			>
				Kortene og fremgangen din slettes, og appen lager nye kort fra pensum. De gamle kortene byttes ut når de nye er klare. Det tar noen minutter.
			</ConfirmDialog>
		</div>
	);
}
