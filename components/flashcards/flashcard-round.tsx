"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, ListRestartIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { flashcardRoundScore, isFlashcardCorrect } from "@/src/core";
import type { Flashcard, FlashcardAnswer, FlashcardReveal } from "./flashcard-types";

/**
 * Under og etter runden (owner-approved plan, 2026-11-26): one card at a
 * time; «Ett valg» answers on the click, «Flere valg» is ticked and sent
 * with «Send svar»; «Vet ikke» is always there. With «Med en gang» the
 * answer, the right options and the explanation show at once; with «Til
 * slutt» the next card follows and the key waits for the result.
 */

const LETTERS = ["A", "B", "C", "D", "E", "F"];

/** One segment of the progress line: right/wrong when revealed as he
 *  goes, «done» (neutral) with «Til slutt», null = still to come. */
export type FlashcardMark = "right" | "wrong" | "done" | null;

/** The round's progress line: one segment per card; coloured by result
 *  only when the answers are revealed as he goes. */
function RoundProgress({ marks, index }: { marks: FlashcardMark[]; index: number }) {
	return (
		<div className="flex gap-1" aria-hidden="true">
			{marks.map((mark, i) => (
				<span
					key={i}
					className={cn(
						"h-1 flex-1 rounded-full",
						i === index ? "bg-primary" : mark === "right" ? "bg-status-green" : mark === "wrong" ? "bg-status-red" : mark === "done" ? "bg-muted-foreground/50" : "bg-border",
					)}
				/>
			))}
		</div>
	);
}

function optionTone(i: number, card: Flashcard, answered: number[] | null | undefined, revealed: boolean, selected: ReadonlySet<number>): string {
	if (!revealed) {
		return selected.has(i)
			? "border-primary bg-primary/5 ring-1 ring-primary cursor-pointer"
			: "border-border hover:border-primary/60 hover:bg-accent cursor-pointer";
	}
	const right = card.correct.includes(i);
	const picked = answered?.includes(i) ?? false;
	if (right) return "border-status-green bg-status-green-soft";
	if (picked) return "border-status-red bg-status-red-soft";
	return "border-border/50 opacity-60";
}

/** The right options as a short list («B: …»). */
function rightOptions(card: Flashcard): string {
	return card.correct.map((i) => `**${LETTERS[i]}:** ${card.options[i]}`).join("\n\n");
}

/**
 * One card. `answer` undefined = not answered yet. `revealed` shows the key
 * (always after an answer with «Med en gang», and in «Gjennomgå»).
 * Exported for the tests.
 */
export function FlashcardCardView({ card, index, total, marks, answer, revealed, last, onAnswer, onNext }: {
	card: Flashcard;
	index: number;
	total: number;
	marks: FlashcardMark[];
	answer: FlashcardAnswer | undefined;
	revealed: boolean;
	last: boolean;
	onAnswer?: (chosen: number[] | null) => void;
	onNext?: () => void;
}) {
	const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
	const answered = answer !== undefined;
	const showKey = answered && revealed;
	const multi = card.type === "multi";
	const correct = answered && isFlashcardCorrect(card, answer.chosen);

	const pick = (i: number) => {
		if (answered || !onAnswer) return;
		if (!multi) {
			onAnswer([i]);
			return;
		}
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(i)) next.delete(i);
			else next.add(i);
			return next;
		});
	};
	const send = () => {
		if (!answered && onAnswer && selected.size > 0) onAnswer([...selected].sort((a, b) => a - b));
	};

	// 1–5 / A–E pick an option; Enter sends («Flere valg») or moves on.
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			const target = e.target as HTMLElement | null;
			if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
			if (e.key === "Enter") {
				if (answered && showKey && onNext) {
					e.preventDefault();
					onNext();
				} else if (!answered && multi && selected.size > 0) {
					e.preventDefault();
					send();
				}
				return;
			}
			if (answered) return;
			const key = e.key.toUpperCase();
			const i = /^[1-9]$/.test(key) ? Number(key) - 1 : LETTERS.indexOf(key);
			if (i >= 0 && i < card.options.length) {
				e.preventDefault();
				pick(i);
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	});

	return (
		<article data-testid="flashcard" data-type={card.type} className="flex flex-col gap-4">
			<RoundProgress marks={marks} index={index} />
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 font-ui text-xs text-muted-foreground">
				<span className="tabular-nums" data-testid="flashcard-count">Kort {index + 1} av {total} · {multi ? "Flere valg" : "Ett valg"}</span>
				<span className="truncate" title={card.topic}>{card.topic}</span>
			</div>
			<ToolContentResponse className="lh-prose text-base">{card.question}</ToolContentResponse>
			{multi && <p className="font-ui text-sm font-medium text-muted-foreground">Velg alle som stemmer.</p>}
			<div className="flex flex-col gap-2" role={multi ? "group" : "radiogroup"} aria-label="Svaralternativer">
				{card.options.map((option, i) => {
					const on = answered ? (answer.chosen?.includes(i) ?? false) : selected.has(i);
					return (
						<button
							key={i}
							type="button"
							role={multi ? "checkbox" : "radio"}
							aria-checked={on}
							data-testid={`flashcard-option-${i}`}
							disabled={answered || !onAnswer}
							onClick={() => pick(i)}
							className={cn("flex items-start gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-default", optionTone(i, card, answer?.chosen, showKey, selected))}
						>
							<span
								className={cn(
									"mt-0.5 flex size-5 shrink-0 items-center justify-center border text-[11px] font-semibold",
									multi ? "rounded-sm" : "rounded-full",
									!showKey && on && "border-primary bg-primary text-primary-foreground",
								)}
							>
								{showKey && card.correct.includes(i) ? <CheckIcon className="size-3" /> : showKey && on ? <XIcon className="size-3" /> : multi && on ? <CheckIcon className="size-3" /> : LETTERS[i]}
							</span>
							<ToolContentResponse className="lh-prose min-w-0 flex-1">{option}</ToolContentResponse>
						</button>
					);
				})}
			</div>
			{!answered && onAnswer && (
				<div className="flex items-center justify-between gap-2">
					<Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onAnswer(null)} data-testid="flashcard-dont-know">
						Vet ikke
					</Button>
					{multi && (
						<Button size="sm" disabled={selected.size === 0} onClick={send} data-testid="flashcard-submit">
							Send svar
						</Button>
					)}
				</div>
			)}
			{showKey && (
				<div data-testid="flashcard-feedback" className="flex flex-col gap-3">
					<div className={cn("flex flex-col gap-1.5 rounded-md px-3 py-2.5 text-sm", correct ? "bg-status-green-soft" : "bg-status-red-soft")}>
						<p className="font-semibold">
							{correct ? "Riktig!" : answer.chosen === null ? "Vet ikke." : multi ? "Ikke riktig. Alle valgene må stemme." : `Ikke riktig. Riktig svar er ${LETTERS[card.correct[0]!]}.`}
						</p>
						{!correct && multi && <ToolContentResponse className="lh-prose">{`Riktig: ${card.correct.map((i) => LETTERS[i]).join(", ")}.`}</ToolContentResponse>}
						<ToolContentResponse className="lh-prose">{card.explanation}</ToolContentResponse>
						<p className="font-ui text-xs text-muted-foreground">Kilde: {card.source}</p>
					</div>
					{onNext && (
						<div className="flex justify-end">
							<Button size="sm" autoFocus onClick={onNext} data-testid="flashcard-next">
								{last ? "Se resultatet" : "Neste"}
							</Button>
						</div>
					)}
				</div>
			)}
		</article>
	);
}

/** The cards he did not get right, with the right answer and why. */
function MissedList({ cards, answers }: { cards: Flashcard[]; answers: FlashcardAnswer[] }) {
	const byId = new Map(cards.map((c) => [c.id, c]));
	const missed = answers.flatMap((a) => {
		const card = byId.get(a.cardId);
		return card && !isFlashcardCorrect(card, a.chosen) ? [card] : [];
	});
	if (missed.length === 0) return <p className="font-ui text-sm">Alt riktig. Sterkt!</p>;
	return (
		<div className="flex flex-col gap-3" data-testid="flashcard-missed">
			<h2 className="font-title text-lg font-semibold">Ikke riktig</h2>
			{missed.map((card) => (
				<div key={card.id} className="flex flex-col gap-1.5 rounded-md border px-3 py-2.5 text-sm">
					<ToolContentResponse className="lh-prose font-medium">{card.question}</ToolContentResponse>
					<div className="flex gap-2 text-status-green-ink">
						<span className="shrink-0">Riktig:</span>
						<ToolContentResponse className="lh-prose min-w-0 flex-1">{rightOptions(card)}</ToolContentResponse>
					</div>
					<ToolContentResponse className="lh-prose text-muted-foreground">{card.explanation}</ToolContentResponse>
				</div>
			))}
		</div>
	);
}

/** Etter runden: the score with its bar, «Ikke riktig», and the ways on. */
export function FlashcardResult({ code, cards, answers, reveal, onNewRound, onMissed, onReview }: {
	code: string;
	cards: Flashcard[];
	answers: FlashcardAnswer[];
	reveal: FlashcardReveal;
	onNewRound: () => void;
	onMissed: () => void;
	onReview: () => void;
}) {
	const score = flashcardRoundScore(cards, answers);
	const share = score.total === 0 ? 0 : score.correct / score.total;
	const anyMissed = score.correct < score.total;
	return (
		<section data-testid="flashcard-result" className="flex flex-col gap-6">
			<div className="flex flex-col gap-2">
				<div className="flex items-baseline gap-2">
					<span data-testid="flashcard-score" className="font-title text-5xl font-semibold tabular-nums tracking-tight">
						{score.correct}/{score.total}
					</span>
					<span className="font-ui text-sm text-muted-foreground">riktige</span>
				</div>
				<div
					role="img"
					aria-label={`${score.correct} av ${score.total} riktige`}
					className="h-2.5 w-full overflow-hidden rounded-full bg-status-red-soft"
				>
					<div className="h-full rounded-full bg-status-green" style={{ width: `${Math.round(share * 100)}%` }} />
				</div>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button onClick={onNewRound} data-testid="flashcard-new-round">
					<RotateCcwIcon aria-hidden="true" />
					Ny runde
				</Button>
				{anyMissed && (
					<Button variant="outline" onClick={onMissed} data-testid="flashcard-practice-missed">
						<ListRestartIcon aria-hidden="true" />
						Øv på bomkortene
					</Button>
				)}
				{reveal === "end" && (
					<Button variant="outline" onClick={onReview} data-testid="flashcard-review">
						Gjennomgå
					</Button>
				)}
				<Button asChild variant="ghost" data-testid="flashcard-back">
					<Link href={`/fag/${encodeURIComponent(code)}`}>
						<ArrowLeftIcon aria-hidden="true" />
						Tilbake til faget
					</Link>
				</Button>
			</div>
			<MissedList cards={cards} answers={answers} />
		</section>
	);
}

/** «Gjennomgå» («Til slutt»): every card of the round with his answer and the key. */
export function FlashcardReview({ cards, answers, onDone }: { cards: Flashcard[]; answers: FlashcardAnswer[]; onDone: () => void }) {
	const [index, setIndex] = useState(0);
	const card = cards[index]!;
	const marks = answers.map((a) => {
		const c = cards.find((x) => x.id === a.cardId);
		return c && isFlashcardCorrect(c, a.chosen) ? ("right" as const) : ("wrong" as const);
	});
	return (
		<section data-testid="flashcard-review-view" className="flex flex-col gap-5">
			<FlashcardCardView
				key={card.id}
				card={card}
				index={index}
				total={cards.length}
				marks={marks}
				answer={answers[index]}
				revealed
				last={index === cards.length - 1}
			/>
			<div className="flex items-center justify-between gap-2">
				<Button variant="outline" size="sm" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
					<ChevronLeftIcon aria-hidden="true" />
					Forrige
				</Button>
				<Button variant="ghost" size="sm" onClick={onDone}>Til resultatet</Button>
				<Button variant="outline" size="sm" disabled={index === cards.length - 1} onClick={() => setIndex((i) => i + 1)}>
					Neste
					<ChevronRightIcon aria-hidden="true" />
				</Button>
			</div>
		</section>
	);
}
