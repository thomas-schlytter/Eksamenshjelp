"use client";

/**
 * The help centre page body (`/hjelp`, NTNU round): a calm, single-column
 * page. Search on top (the same engine as the global palette, filtering
 * answers and tours as you type), the guided tours as cards, then every
 * question grouped by category.
 *
 * Deep links: `/hjelp#<article-id>` opens that answer and scrolls to it.
 * The palette uses the same ids; when the page is already open it sends
 * FOCUS_ARTICLE_EVENT instead of relying on a hash change.
 *
 * Everything the page can DO goes through useHelp(), whose default is a
 * no-op, so the page renders (and is tested) without the provider.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Compass, Search } from "lucide-react";
import { findArticle, HELP_ARTICLES, HELP_CATEGORIES } from "./content.ts";
import { useHelp } from "./help-context.ts";
import { articleIndex, tourIndex } from "./palette-model.ts";
import { search } from "./search.ts";
import { takePendingArticle } from "./storage.ts";
import { TOURS } from "./tours.ts";
import { FOCUS_ARTICLE_EVENT, type HelpArticle, type Tour } from "./types.ts";

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function HelpCenter() {
	const { run, openSearch, startTour, completedTours } = useHelp();
	const [query, setQuery] = useState("");
	const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());

	const toggle = useCallback((id: string) => {
		setOpenIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	/** Open one answer and bring it into view (deep link / palette). */
	const focusArticle = useCallback((id: string) => {
		if (!findArticle(id)) return;
		setQuery("");
		setOpenIds((prev) => new Set(prev).add(id));
		// After the render that opens it, so the scroll lands on the final layout.
		window.requestAnimationFrame(() => {
			const row = document.getElementById(id);
			row?.scrollIntoView({ block: "start", behavior: "auto" });
			row?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
		});
	}, []);

	useEffect(() => {
		const fromHash = () => decodeURIComponent(window.location.hash.replace(/^#/, ""));
		const initial = takePendingArticle() ?? fromHash();
		if (initial) focusArticle(initial);
		const onHash = () => focusArticle(fromHash());
		const onFocus = (event: Event) => {
			takePendingArticle(); // consumed here, not by a later visit
			const id = (event as CustomEvent<{ id?: unknown }>).detail?.id;
			if (typeof id === "string") focusArticle(id);
		};
		window.addEventListener("hashchange", onHash);
		window.addEventListener(FOCUS_ARTICLE_EVENT, onFocus);
		return () => {
			window.removeEventListener("hashchange", onHash);
			window.removeEventListener(FOCUS_ARTICLE_EVENT, onFocus);
		};
	}, [focusArticle]);

	const trimmed = query.trim();
	const hits = useMemo(
		() => (trimmed ? { tours: search(tourIndex, trimmed, 5).map((hit) => hit.item), articles: search(articleIndex, trimmed, 30).map((hit) => hit.item) } : null),
		[trimmed],
	);

	return (
		<div data-testid="help-center" className="min-h-0 flex-1 overflow-y-auto font-ui">
			<div className="mx-auto w-full max-w-[46rem] px-5 pt-10 pb-20">
				<h1 className="font-title text-2xl tracking-tight">Hjelpesenter</h1>
				<p className="mt-1 text-base text-muted-foreground">Finn svar, eller la en veiviser vise deg rundt.</p>

				<div className="relative mt-6">
					<Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
					<input
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							// Esc clears the field first; an empty field lets Esc through.
							if (event.key === "Escape" && query) {
								event.stopPropagation();
								setQuery("");
							}
						}}
						placeholder="Hva lurer du på? For eksempel «tidligere eksamener» eller «mørk modus»"
						aria-label="Søk i hjelpesenteret"
						autoComplete="off"
						data-testid="help-search"
						className={`h-12 w-full rounded-lg border border-input bg-card pr-4 pl-11 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50`}
					/>
				</div>

				{hits ? (
					<section aria-label="Søkeresultater" aria-live="polite" className="mt-8" data-testid="help-results">
						{hits.tours.length === 0 && hits.articles.length === 0 ? (
							<div className="rounded-lg border border-border bg-card p-5">
								<p className="text-sm">
									Ingen treff på «{trimmed}» i hjelpesenteret.
									<span className="block text-muted-foreground">Prøv et annet ord, eller søk i hele appen etter funksjoner, fag og økter.</span>
								</p>
								<button
									type="button"
									onClick={() => openSearch(trimmed)}
									className={`mt-3 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent ${FOCUS_RING}`}
								>
									Søk i hele appen
								</button>
							</div>
						) : (
							<>
								{hits.tours.length > 0 && (
									<>
										<SectionHeading>Veivisere</SectionHeading>
										<TourGrid tours={hits.tours} completed={completedTours} onStart={startTour} />
									</>
								)}
								{hits.articles.length > 0 && (
									<>
										<SectionHeading>Spørsmål og svar</SectionHeading>
										<ArticleList articles={hits.articles} openIds={openIds} onToggle={toggle} run={run} />
									</>
								)}
							</>
						)}
					</section>
				) : (
					<>
						<section aria-labelledby="hjelp-veivisere" className="mt-10">
							<h2 id="hjelp-veivisere" className="text-lg font-semibold">
								Kom i gang
							</h2>
							<p className="mt-0.5 mb-3 text-sm text-muted-foreground">Veiviserne peker på tingene i appen og forklarer dem steg for steg.</p>
							<div data-testid="help-onboarding" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
								<div className="min-w-0">
									<h3 className="text-sm font-semibold">Innføring</h3>
									<p className="mt-1 text-sm text-muted-foreground">Sett opp appen steg for steg: koble til AI, legg til fag og hent tidligere eksamener.</p>
								</div>
								<button
									type="button"
									onClick={() => run({ kind: "onboarding" })}
									data-testid="help-onboarding-start"
									className={`shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 ${FOCUS_RING}`}
								>
									Start innføringen
								</button>
							</div>
							<TourGrid tours={TOURS} completed={completedTours} onStart={startTour} />
						</section>

						<nav aria-label="Kategorier" className="mt-10 flex flex-wrap gap-2">
							{HELP_CATEGORIES.map((category) => (
								<a
									key={category.id}
									href={`#kategori-${category.id}`}
									className={`rounded-sm border border-border px-3 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${FOCUS_RING}`}
								>
									{category.title}
								</a>
							))}
						</nav>

						{HELP_CATEGORIES.map((category) => (
							<section key={category.id} id={`kategori-${category.id}`} aria-labelledby={`tittel-${category.id}`} className="mt-10 scroll-mt-6">
								<h2 id={`tittel-${category.id}`} className="text-lg font-semibold">
									{category.title}
								</h2>
								<p className="mt-0.5 mb-2 text-sm text-muted-foreground">{category.blurb}</p>
								<ArticleList
									articles={HELP_ARTICLES.filter((article) => article.category === category.id)}
									openIds={openIds}
									onToggle={toggle}
									run={run}
								/>
							</section>
						))}

						<div className="mt-12 rounded-lg border border-border bg-card p-5">
							<p className="text-sm font-medium">Fant du ikke det du lette etter?</p>
							<p className="mt-0.5 text-sm text-muted-foreground">Søket i appen finner også funksjoner, fag og økter.</p>
							<button
								type="button"
								onClick={() => openSearch()}
								className={`mt-3 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent ${FOCUS_RING}`}
							>
								Søk i hele appen
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}

function SectionHeading({ children }: { children: React.ReactNode }) {
	return <h2 className="mt-8 mb-3 text-xs uppercase tracking-widest text-muted-foreground/70 first:mt-0">{children}</h2>;
}

function TourGrid({ tours, completed, onStart }: { tours: readonly Tour[]; completed: readonly string[]; onStart: (id: string) => void }) {
	return (
		<ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
			{tours.map((tour) => {
				const done = completed.includes(tour.id);
				return (
					<li key={tour.id} data-testid="help-tour-card" className="flex flex-col rounded-lg border border-border bg-card p-4">
						<div className="flex items-center gap-2">
							<Compass className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							<h3 className="text-sm font-semibold">{tour.title}</h3>
						</div>
						<p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">{tour.description}</p>
						<div className="mt-3 flex items-center gap-3">
							<button
								type="button"
								onClick={() => onStart(tour.id)}
								data-testid={`help-tour-start-${tour.id}`}
								className={`rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 ${FOCUS_RING}`}
							>
								{done ? "Start på nytt" : "Start"}
							</button>
							<span className="text-xs text-muted-foreground">
								{done ? (
									<span className="inline-flex items-center gap-1">
										<Check className="size-3" aria-hidden="true" />
										Fullført
									</span>
								) : (
									`ca. ${tour.minutes} min`
								)}
							</span>
						</div>
					</li>
				);
			})}
		</ul>
	);
}

function ArticleList({
	articles,
	openIds,
	onToggle,
	run,
}: {
	articles: readonly HelpArticle[];
	openIds: ReadonlySet<string>;
	onToggle: (id: string) => void;
	run: ReturnType<typeof useHelp>["run"];
}) {
	return (
		<div className="rounded-lg border border-border bg-card">
			{articles.map((article) => {
				const open = openIds.has(article.id);
				const panelId = `svar-${article.id}`;
				const buttonId = `sporsmal-${article.id}`;
				return (
					<div key={article.id} id={article.id} data-testid="help-article" className="scroll-mt-6 border-b border-border last:border-b-0">
						<h3>
							<button
								type="button"
								id={buttonId}
								aria-expanded={open}
								aria-controls={panelId}
								onClick={() => onToggle(article.id)}
								className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-accent/50 ${FOCUS_RING}`}
							>
								<span className="flex-1">{article.question}</span>
								<ChevronDown
									className={`size-4 shrink-0 text-muted-foreground motion-safe:transition-transform ${open ? "rotate-180" : ""}`}
									aria-hidden="true"
								/>
							</button>
						</h3>
						{open && (
							<div id={panelId} role="region" aria-labelledby={buttonId} className="px-4 pb-4 text-sm leading-relaxed">
								{article.answer.map((paragraph) => (
									<p key={paragraph} className="mt-2 first:mt-0">
										{paragraph}
									</p>
								))}
								{article.steps && (
									<>
										<p className="mt-3 font-medium">Slik gjør du:</p>
										<ol className="mt-1 list-decimal space-y-1 pl-5">
											{article.steps.map((step) => (
												<li key={step}>{step}</li>
											))}
										</ol>
									</>
								)}
								{article.actions && (
									<div className="mt-4 flex flex-wrap gap-2">
										{article.actions.map((entry) => (
											<button
												key={entry.label}
												type="button"
												onClick={() => run(entry.action)}
												className={`rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent ${FOCUS_RING}`}
											>
												{entry.label}
											</button>
										))}
									</div>
								)}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
