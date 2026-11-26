"use client";

import Link from "next/link";
import { LayersIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/pending";
import { cn } from "@/lib/utils";
import type { FlashcardView } from "./flashcard-types";

/** The practice page of a fag. */
export function flashcardsHref(code: string): string {
	return `/fag/${encodeURIComponent(code)}/sporsmalskort`;
}

/** «Lager spørsmålskort …» with the generator's live line. */
export function FlashcardsWaiting({ activity, more = false }: { activity?: string; more?: boolean }) {
	return (
		<div role="status" data-testid="flashcards-waiting" className="flex items-start gap-2.5 font-ui text-sm">
			<Spinner className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
			<div className="flex min-w-0 flex-col gap-0.5">
				<span className="font-medium">{more ? "Lager flere kort …" : "Lager spørsmålskort …"}</span>
				<span className="truncate text-xs text-muted-foreground" title={activity}>
					{activity ? `${activity.charAt(0).toUpperCase()}${activity.slice(1)}. ` : ""}Tar noen minutter.
				</span>
			</div>
		</div>
	);
}

/**
 * The fag page's «Spørsmålskort» card: how many cards, how many he knows
 * and misses, and «Øv». Without a deck: «Lag spørsmålskort», and a waiting
 * state while the cards are made. Pure: the view in, markup out.
 */
export function FlashcardsCard({ code, view, starting = false, onMake }: {
	code: string;
	/** null until the first read. */
	view: FlashcardView | null;
	/** «Lag spørsmålskort» was pressed and waits for the server. */
	starting?: boolean;
	onMake: () => void;
}) {
	const stats = view?.stats;
	const deck = Boolean(view?.deck && stats && stats.total > 0);
	return (
		<section data-testid="course-flashcards" aria-labelledby="flashcards-title" className="flex flex-col gap-3 rounded-lg border bg-card p-5">
			<div className="flex items-baseline justify-between gap-3">
				<h2 id="flashcards-title" className="font-title text-xl font-semibold tracking-tight">Spørsmålskort</h2>
				{deck && <span className="font-ui text-sm tabular-nums text-muted-foreground" data-testid="flashcards-total">{stats!.total} kort</span>}
			</div>
			{view === null ? (
				<p className="font-ui text-sm text-muted-foreground">Laster …</p>
			) : deck ? (
				<>
					<dl className="grid grid-cols-2 gap-2 font-ui" data-testid="flashcards-stats">
						<div className="flex flex-col rounded-md bg-muted px-3 py-2.5">
							<dt className="text-xs text-muted-foreground">Kan</dt>
							<dd className="font-title text-2xl font-semibold tabular-nums text-status-green-ink">{stats!.known}</dd>
						</div>
						<div className="flex flex-col rounded-md bg-muted px-3 py-2.5">
							<dt className="text-xs text-muted-foreground">Bommer på</dt>
							<dd className={cn("font-title text-2xl font-semibold tabular-nums", stats!.missed > 0 ? "text-status-red-ink" : "text-foreground")}>{stats!.missed}</dd>
						</div>
					</dl>
					{view.generating && <FlashcardsWaiting activity={view.generating.activity} more={view.generating.mode === "more"} />}
					<Button asChild className="self-start" data-testid="flashcards-practice">
						<Link href={flashcardsHref(code)}>
							<LayersIcon aria-hidden="true" />
							Øv
						</Link>
					</Button>
				</>
			) : view.generating ? (
				<FlashcardsWaiting activity={view.generating.activity} />
			) : (
				<div className="flex flex-1 flex-col items-start justify-center gap-3" data-testid="flashcards-empty">
					<p className="font-ui text-sm text-muted-foreground">Ingen spørsmålskort ennå.</p>
					{view.error && <p role="alert" className="font-ui text-sm text-destructive">{view.error}</p>}
					<Button variant="outline" onClick={onMake} pending={starting} data-testid="flashcards-make">
						<SparklesIcon aria-hidden="true" />
						Lag spørsmålskort
					</Button>
				</div>
			)}
		</section>
	);
}
