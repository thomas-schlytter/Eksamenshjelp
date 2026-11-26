"use client";

/**
 * The global help layer (NTNU round): mounted once in app/layout.tsx, inside
 * the app shell so it can reach the settings dialog, the sidebar and the
 * appearance record. It owns:
 *
 * - the search palette (lazy: its code loads the first time it opens),
 * - the tour engine (tour-machine.ts decides, tour-overlay.tsx draws),
 * - the two contract events: `lh:open-help` ({ query? }) and
 *   `lh:start-tour` ({ id }),
 * - the one executor for HelpAction, so the palette, the help page and the
 *   tours all "do the thing" through the same code path,
 * - the innføring (components/onboarding/): the first-launch walk-through.
 *   It replaced the old first-launch tour invitation (2026-11): two
 *   first-start prompts competed, and the innføring covers what the welcome
 *   tour's first steps did (adding a course) plus the AI connection. The
 *   tours stay in the help centre.
 *
 * Nothing here blocks the app: every fetch is optional, every missing
 * element has a fallback, and every layer closes on Esc.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { kbdEventForAction, type AppearanceSettings } from "@/src/core";
import { useSettingsDialog } from "@/components/settings/settings-dialog.tsx";
import { useAppearance } from "@/components/settings/appearance.tsx";
import { notifySettingsSaved } from "@/components/settings-signal";
import { useSidebar } from "@/components/sidebar";
import { openLegacyImport } from "@/components/import/legacy-import-event";
import { LegacyImportHost } from "@/components/import/legacy-import-host";
import { HelpContext, type HelpApi } from "./help-context.ts";
import { loadCompletedTours, markTourCompleted, setPendingArticle } from "./storage.ts";
import { TOUR_IDLE, tourReducer, type TourEvent, type TourState } from "./tour-machine.ts";
import { PaletteShell } from "./palette-shell.tsx";
import { TourOverlay } from "./tour-overlay.tsx";
import { TOURS } from "./tours.ts";
import { OnboardingHost } from "@/components/onboarding/onboarding";
import { openOnboarding } from "@/components/onboarding/onboarding-model";
import { FOCUS_ARTICLE_EVENT, OPEN_HELP_EVENT, START_TOUR_EVENT, type HelpAction, type ThemeMode, type Tour } from "./types.ts";

const loadSearchPalette = () => import("./search-palette.tsx");
const SearchPalette = lazy(loadSearchPalette);

/** Id of the throwaway one-step tour a "point" action runs. */
const POINT_TOUR_ID = "__pek";

/** Persist the light/dark/system choice the way the settings dialog does:
 *  PUT the whole appearance section, then tell the live theme. */
async function saveThemeMode(mode: ThemeMode): Promise<AppearanceSettings | null> {
	try {
		const current = await fetch("/api/settings").then((res) => (res.ok ? res.json() : null));
		const appearance = (current as { settings?: { appearance?: AppearanceSettings } } | null)?.settings?.appearance;
		const next: AppearanceSettings = { ...(appearance ?? {}), mode };
		const saved = await fetch("/api/settings/appearance", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(next),
		});
		return saved.ok ? next : null;
	} catch {
		return null;
	}
}

export function HelpProvider({ children }: { children: React.ReactNode }) {
	const router = useRouter();
	const { open: openSettings } = useSettingsDialog();
	const { onAppearanceChange } = useAppearance();
	const sidebar = useSidebar();

	// `typed`: what was typed into the instant shell while the palette's code
	// was still loading (null = nothing, the opener's query stands).
	const [palette, setPalette] = useState<{ open: boolean; query: string; nonce: number; typed: string | null }>({ open: false, query: "", nonce: 0, typed: null });
	const [tour, setTour] = useState<TourState>(TOUR_IDLE);
	const [pointTour, setPointTour] = useState<Tour | null>(null);
	const [completedTours, setCompletedTours] = useState<string[]>([]);

	const tours = useMemo(() => (pointTour ? [...TOURS, pointTour] : TOURS), [pointTour]);
	// The reducer needs the tour list of the SAME call (a "point" action
	// creates its tour and starts it in one go), so it travels in a ref.
	const toursRef = useRef<readonly Tour[]>(tours);
	toursRef.current = tours;
	const tourRef = useRef<TourState>(tour);
	tourRef.current = tour;

	const dispatchTour = useCallback((event: TourEvent) => {
		const transition = tourReducer(tourRef.current, event, toursRef.current);
		tourRef.current = transition.state;
		setTour(transition.state);
		if (transition.completed && transition.completed !== POINT_TOUR_ID) {
			setCompletedTours(markTourCompleted(transition.completed));
		}
	}, []);

	const openSearch = useCallback((query?: string) => {
		setPalette((prev) => ({ open: true, query: query ?? "", nonce: prev.nonce + 1, typed: null }));
	}, []);
	const typeAhead = useCallback((typed: string) => setPalette((prev) => ({ ...prev, typed })), []);

	// Fetch the palette's code before it is asked for: when the browser is
	// idle, or at the learner's first key or click, whichever comes first.
	// The shell below still covers a chord that beats the download.
	useEffect(() => {
		let done = false;
		const preload = () => {
			if (done) return;
			done = true;
			cleanup();
			void loadSearchPalette().catch(() => {});
		};
		const idle = window.setTimeout(preload, 2000);
		const cleanup = () => {
			window.clearTimeout(idle);
			window.removeEventListener("pointerdown", preload, true);
			window.removeEventListener("keydown", preload, true);
		};
		window.addEventListener("pointerdown", preload, true);
		window.addEventListener("keydown", preload, true);
		return () => {
			done = true;
			cleanup();
		};
	}, []);
	const closeSearch = useCallback(() => setPalette((prev) => ({ ...prev, open: false })), []);

	const startTour = useCallback(
		(id: string) => {
			closeSearch();
			dispatchTour({ type: "start", tourId: id });
		},
		[closeSearch, dispatchTour],
	);

	const run = useCallback(
		(action: HelpAction) => {
			switch (action.kind) {
				case "route":
					router.push(action.href);
					break;
				case "settings":
					openSettings(action.section, action.row);
					break;
				case "theme":
					void saveThemeMode(action.mode).then((next) => {
						if (!next) return;
						onAppearanceChange(next);
						notifySettingsSaved("appearance");
					});
					break;
				case "shortcut":
					window.dispatchEvent(new CustomEvent(kbdEventForAction(action.action)));
					break;
				case "tour":
					startTour(action.id);
					break;
				case "article":
					setPendingArticle(action.id);
					router.push(`/hjelp#${action.id}`);
					// Already on the help page: no mount will pick the id up.
					window.dispatchEvent(new CustomEvent(FOCUS_ARTICLE_EVENT, { detail: { id: action.id } }));
					break;
				case "legacy-import":
					closeSearch();
					openLegacyImport();
					break;
				case "onboarding":
					closeSearch();
					openOnboarding();
					break;
				case "point": {
					const one: Tour = {
						id: POINT_TOUR_ID,
						title: action.title,
						description: "",
						minutes: 0,
						keywords: [],
						steps: [
							{
								id: "pek",
								route: action.route,
								anchor: action.anchor,
								title: action.title,
								text: action.text,
								interactive: true,
							},
						],
					};
					toursRef.current = [...TOURS, one];
					setPointTour(one);
					closeSearch();
					dispatchTour({ type: "start", tourId: POINT_TOUR_ID });
					break;
				}
			}
		},
		[router, openSettings, onAppearanceChange, startTour, closeSearch, dispatchTour],
	);

	// The contract events. The sidebar's search button, the keyboard chord
	// and any other surface reach the help layer through these two names.
	useEffect(() => {
		const onOpen = (event: Event) => {
			const query = (event as CustomEvent<{ query?: unknown }>).detail?.query;
			openSearch(typeof query === "string" ? query : undefined);
		};
		const onStart = (event: Event) => {
			const id = (event as CustomEvent<{ id?: unknown }>).detail?.id;
			if (typeof id === "string") startTour(id);
		};
		window.addEventListener(OPEN_HELP_EVENT, onOpen);
		window.addEventListener(START_TOUR_EVENT, onStart);
		return () => {
			window.removeEventListener(OPEN_HELP_EVENT, onOpen);
			window.removeEventListener(START_TOUR_EVENT, onStart);
		};
	}, [openSearch, startTour]);

	// Per-device state is read after mount (SSR renders "nothing stored").
	useEffect(() => {
		setCompletedTours(loadCompletedTours());
	}, []);

	const api = useMemo<HelpApi>(() => ({ run, openSearch, startTour, completedTours }), [run, openSearch, startTour, completedTours]);
	const running = tour.status === "running";

	return (
		<HelpContext.Provider value={api}>
			{children}
			{/* The global listener for lh:open-legacy-import (settings, palette, help, home). */}
			<LegacyImportHost />
			{palette.open && (
				// The fallback is a real, focused field: keys typed before the
				// palette's code has arrived land there and carry over.
				<Suspense fallback={<PaletteShell key={palette.nonce} initialQuery={palette.query} onType={typeAhead} onClose={closeSearch} />}>
					<SearchPalette
						key={palette.nonce}
						initialQuery={palette.typed ?? palette.query}
						keepCaret={palette.typed !== null}
						onClose={closeSearch}
					/>
				</Suspense>
			)}
			{running && (
				<TourOverlay
					state={tour}
					tours={tours}
					dispatch={dispatchTour}
					run={run}
					sidebarOpen={sidebar.open}
					toggleSidebar={sidebar.toggle}
				/>
			)}
			{/* First start: the innføring (it decides for itself whether to open). */}
			<OnboardingHost />
		</HelpContext.Provider>
	);
}
