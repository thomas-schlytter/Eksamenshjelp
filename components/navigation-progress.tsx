"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

/**
 * THE ROUTE PROGRESS STRIPE (2026-11-26, «alt føles tregt uten loading
 * wheel»): a thin bar at the very top of the window on every route change.
 *
 * Next 16 has no app-wide «a navigation is pending» hook (useLinkStatus
 * only answers inside one <Link>), so the stripe is fed by two signals:
 *
 *  1. A navigation STARTED: a click on an internal link (one document
 *     listener covers every <Link> in the app), or beginNavigation() right
 *     before a router.push. It ends when the pathname changes.
 *  2. A route is STILL LOADING: every loading.tsx skeleton registers
 *     itself while mounted (useRouteSkeleton), so the stripe keeps running
 *     until the real page replaces the skeleton.
 *
 * Shown only after a short delay, so an instant navigation never flashes.
 * Each navigation is also measured: performance.measure("lh:navigasjon")
 * from the click to the real page, readable in DevTools.
 */

/** A started navigation never pins the stripe longer than this. */
const STALE_MS = 10_000;
/** Nothing shows for navigations faster than this. */
export const SHOW_DELAY_MS = 120;
const START_MARK = "lh:nav-start";

let pendingSince: number | null = null;
let skeletons = 0;
let staleTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function publish() {
	for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Is anything loading right now (a started navigation or a skeleton)? */
export function navigationBusy(): boolean {
	return pendingSince !== null || skeletons > 0;
}

function settleIfIdle() {
	if (navigationBusy()) return;
	try {
		performance.measure("lh:navigasjon", START_MARK);
		const entry = performance.getEntriesByName("lh:navigasjon").at(-1);
		if (entry) console.debug(`[navigasjon] ${Math.round(entry.duration)} ms`);
		performance.clearMarks(START_MARK);
		performance.clearMeasures("lh:navigasjon");
	} catch { /* no start mark (a skeleton without a click): nothing to measure */ }
}

/** Call right before router.push (links are picked up on their own). */
export function beginNavigation(): void {
	pendingSince = Date.now();
	try {
		performance.clearMarks(START_MARK);
		performance.mark(START_MARK);
	} catch { /* no performance API (tests) */ }
	clearTimeout(staleTimer);
	staleTimer = setTimeout(endNavigation, STALE_MS);
	publish();
}

/** The route changed (or the navigation went nowhere). */
export function endNavigation(): void {
	if (pendingSince === null) return;
	pendingSince = null;
	clearTimeout(staleTimer);
	publish();
	settleIfIdle();
}

/** Held by every loading.tsx skeleton while it is on screen. */
export function useRouteSkeleton(): void {
	useEffect(() => {
		skeletons++;
		publish();
		return () => {
			skeletons = Math.max(0, skeletons - 1);
			publish();
			settleIfIdle();
		};
	}, []);
}

/**
 * Does this click start an in-app navigation to ANOTHER page? Pure over
 * the event's facts, exported for tests: primary button, no modifier
 * (those open new windows), an anchor without target/download, same
 * origin, and a different pathname (a same-page link, a hash, or only a
 * new query never changes the pathname, so it would never end).
 */
export function startsNavigation(
	click: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
	anchor: { href: string; target: string; hasDownload: boolean } | null,
	current: { origin: string; pathname: string },
): boolean {
	if (!anchor || click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return false;
	if ((anchor.target && anchor.target !== "_self") || anchor.hasDownload) return false;
	let url: URL;
	try {
		url = new URL(anchor.href, `${current.origin}${current.pathname}`);
	} catch {
		return false;
	}
	return url.origin === current.origin && url.pathname !== current.pathname;
}

type Phase = "idle" | "running" | "done";

/** The stripe. Mounted once, in the app shell. */
export function NavigationProgress() {
	const pathname = usePathname();
	const busy = useSyncExternalStore(subscribe, navigationBusy, () => false);
	const [phase, setPhase] = useState<Phase>("idle");
	const phaseRef = useRef<Phase>("idle");
	phaseRef.current = phase;

	// The route changed: the started navigation is over (a skeleton, if
	// any, keeps the stripe running on its own).
	useEffect(() => {
		endNavigation();
	}, [pathname]);

	// Every internal link click, app-wide. Capture: it runs before any
	// handler can stop the event.
	useEffect(() => {
		const onClick = (e: MouseEvent) => {
			const el = e.target instanceof Element ? e.target.closest("a[href]") : null;
			const anchor = el instanceof HTMLAnchorElement
				? { href: el.href, target: el.target, hasDownload: el.hasAttribute("download") }
				: null;
			if (startsNavigation(e, anchor, window.location)) beginNavigation();
		};
		document.addEventListener("click", onClick, true);
		return () => document.removeEventListener("click", onClick, true);
	}, []);

	useEffect(() => {
		if (busy) {
			if (phaseRef.current === "running") return;
			const timer = setTimeout(() => setPhase("running"), SHOW_DELAY_MS);
			return () => clearTimeout(timer);
		}
		if (phaseRef.current !== "running") {
			setPhase("idle");
			return;
		}
		setPhase("done");
		const timer = setTimeout(() => setPhase("idle"), 300);
		return () => clearTimeout(timer);
	}, [busy]);

	if (phase === "idle") return null;
	return (
		<div
			role="progressbar"
			aria-label="Laster siden"
			aria-busy={phase === "running"}
			data-testid="navigation-progress"
			data-phase={phase}
			className="lh-nav-progress pointer-events-none fixed inset-x-0 top-0 z-[70] h-0.5 origin-left bg-primary"
		/>
	);
}
