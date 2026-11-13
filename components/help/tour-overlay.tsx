"use client";

/**
 * The tour overlay (NTNU round): performs what tour-machine.ts decides.
 *
 * For each step it (1) opens the sidebar / a settings section if the step
 * asks, (2) navigates to the step's route, (3) waits for the step's element,
 * clicking the step's tab if the element is hidden behind one, and (4)
 * reports "found" or "missing". Found = a spotlight cut-out around the
 * element with the bubble beside it; missing = the bubble centred with the
 * step's fallback text. Nothing here can hang: every wait has a deadline.
 *
 * Layering and keys:
 * - Portaled above everything (settings dialog included: the model tour
 *   explains the dialog while it is open underneath).
 * - Keys are claimed in the document's CAPTURE phase, so one Esc closes the
 *   tour and nothing else (never the dialog underneath, never the "abort
 *   turn" confirmation in a session). ←/→ step, Tab stays inside the bubble.
 * - A "point" step (`interactive`) is not modal: the spotlighted control
 *   stays clickable, and any click outside the bubble dismisses the pointer.
 * - Motion is CSS-only and `motion-safe`, so reduced-motion users get plain
 *   position changes; scrolling an element into view is always instant.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { readCourses } from "./palette-model.ts";
import { normalizeText } from "./search.ts";
import {
	intersectRect,
	placeBubble,
	resolveStepRoute,
	spotlightRect,
	stepSelector,
	stepText,
	type Rect,
	type Size,
	type TourEvent,
	type TourState,
} from "./tour-machine.ts";
import type { HelpAction, Tour } from "./types.ts";

/** How long a step waits for its element: on the page we are already on,
 *  and after a navigation (the new page has to load and render). */
const WAIT_HERE_MS = 1500;
const WAIT_AFTER_NAVIGATION_MS = 5000;
/** A step that is still looking after this long shows its bubble centred
 *  instead of leaving the learner staring at a dimmed screen. */
const SHOW_WHILE_LOCATING_MS = 350;

const NO_COURSE_NOTE =
	"Du har ikke lagt til et fag ennå, så veiviseren viser bare forklaringen. Legg til et fag og start veiviseren på nytt for å se det på ordentlig.";

function findVisible(selector: string): HTMLElement | null {
	let nodes: NodeListOf<HTMLElement>;
	try {
		nodes = document.querySelectorAll<HTMLElement>(selector);
	} catch {
		return null; // a malformed selector must not take the tour down
	}
	for (const node of nodes) {
		if (node.getClientRects().length > 0) return node;
	}
	return null;
}

/** Click the course page's tab with this label. Returns true once the tab
 *  strip exists (clicked or not), so the caller tries exactly once. */
function clickCourseTab(label: string): boolean {
	const strip = document.querySelector('[data-tour="course-tabs"]');
	if (!strip) return false;
	const wanted = normalizeText(label);
	for (const candidate of strip.querySelectorAll<HTMLElement>('button, a, [role="tab"]')) {
		if (normalizeText(candidate.textContent ?? "").startsWith(wanted)) {
			candidate.click();
			break;
		}
	}
	return true;
}

/** The element's box as the learner sees it: cut by every scrolling or
 *  clipping ancestor. A section taller than its scroll area (the topic
 *  board) must light only its visible part, never the bars it runs under. */
function visibleBox(element: HTMLElement): Rect {
	const box = element.getBoundingClientRect();
	let rect: Rect = { top: box.top, left: box.left, width: box.width, height: box.height };
	for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
		const style = getComputedStyle(parent);
		if (style.overflowX === "visible" && style.overflowY === "visible") continue;
		const clip = parent.getBoundingClientRect();
		rect = intersectRect(rect, { top: clip.top, left: clip.left, width: clip.width, height: clip.height });
	}
	return rect;
}

function viewportSize(): Size {
	return { width: window.innerWidth, height: window.innerHeight };
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
	if (!a || !b) return a === b;
	return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

export function TourOverlay({
	state,
	tours,
	dispatch,
	run,
	sidebarOpen,
	toggleSidebar,
}: {
	state: Extract<TourState, { status: "running" }>;
	tours: readonly Tour[];
	dispatch: (event: TourEvent) => void;
	run: (action: HelpAction) => void;
	sidebarOpen: boolean;
	toggleSidebar: () => void;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const titleId = useId();
	const textId = useId();

	const tour = tours.find((candidate) => candidate.id === state.tourId);
	const step = tour?.steps[state.index];
	const { index, phase, tourId } = state;
	const interactive = !!step?.interactive;

	// Live values the step effect reads without re-running on every change.
	const live = useRef({ router, pathname, run, sidebarOpen, toggleSidebar, dispatch });
	live.current = { router, pathname, run, sidebarOpen, toggleSidebar, dispatch };

	const elementRef = useRef<HTMLElement | null>(null);
	const bubbleRef = useRef<HTMLDivElement | null>(null);
	const primaryRef = useRef<HTMLButtonElement | null>(null);
	/** undefined = not asked yet; null = the learner has no course. */
	const courseCode = useRef<string | null | undefined>(undefined);

	const [rect, setRect] = useState<Rect | null>(null);
	const [viewport, setViewport] = useState<Size>(() => viewportSize());
	const [bubbleSize, setBubbleSize] = useState<Size | null>(null);
	const [unreachableStep, setUnreachableStep] = useState<number | null>(null);
	const [showWhileLocating, setShowWhileLocating] = useState(false);

	// ── Locate: prepare the step, navigate, wait for its element.
	useEffect(() => {
		if (!step) return;
		let cancelled = false;
		let timer: number | undefined;
		elementRef.current = null;
		setUnreachableStep(null);
		setShowWhileLocating(false);
		const slow = window.setTimeout(() => setShowWhileLocating(true), SHOW_WHILE_LOCATING_MS);

		const firstCourse = async (): Promise<string | null> => {
			if (courseCode.current !== undefined) return courseCode.current;
			try {
				const res = await fetch("/api/courses");
				courseCode.current = res.ok ? (readCourses(await res.json())[0]?.code ?? null) : null;
			} catch {
				courseCode.current = null;
			}
			return courseCode.current;
		};

		void (async () => {
			const now = live.current;
			if (step.needsSidebar && !now.sidebarOpen) now.toggleSidebar();
			if (step.before) now.run(step.before);

			let navigated = false;
			if (step.route) {
				const code = step.route.includes("[code]") ? await firstCourse() : null;
				if (cancelled) return;
				const target = resolveStepRoute(step.route, live.current.pathname, code);
				if (target === "unresolved") {
					setUnreachableStep(index);
					live.current.dispatch({ type: "missing", index });
					return;
				}
				if (target) {
					live.current.router.push(target);
					navigated = true;
				}
			}

			const selector = stepSelector(step);
			if (!selector) {
				live.current.dispatch({ type: "found", index });
				return;
			}
			const deadline = Date.now() + (navigated ? WAIT_AFTER_NAVIGATION_MS : WAIT_HERE_MS);
			let tabTried = false;
			const look = () => {
				if (cancelled) return;
				const element = findVisible(selector);
				if (element) {
					elementRef.current = element;
					const box = element.getBoundingClientRect();
					const inView = box.top >= 0 && box.left >= 0 && box.bottom <= window.innerHeight && box.right <= window.innerWidth;
					// Taller than the window: show its top (centring would cut both
					// ends off); otherwise bring it to the middle.
					if (!inView) element.scrollIntoView({ block: box.height > window.innerHeight ? "start" : "center", inline: "nearest", behavior: "auto" });
					live.current.dispatch({ type: "found", index });
					return;
				}
				if (step.openTab && !tabTried) tabTried = clickCourseTab(step.openTab);
				if (Date.now() > deadline) {
					live.current.dispatch({ type: "missing", index });
					return;
				}
				timer = window.setTimeout(look, 100);
			};
			look();
		})();

		return () => {
			cancelled = true;
			window.clearTimeout(slow);
			if (timer !== undefined) window.clearTimeout(timer);
		};
		// One run per step (step objects are stable table rows); everything
		// else is read live through the ref.
	}, [step, tourId, index]);

	// ── Follow the element: resize, scroll (any scroller) and layout shifts.
	useEffect(() => {
		if (phase !== "anchored") {
			setRect(null);
			return;
		}
		const measure = () => {
			const element = elementRef.current;
			if (!element || !element.isConnected || element.getClientRects().length === 0) {
				// The element went away (a dialog closed, a tab changed): fall
				// back to the centred explanation instead of pointing at nothing.
				live.current.dispatch({ type: "missing", index });
				return;
			}
			const next = visibleBox(element);
			setRect((prev) => (sameRect(prev, next) ? prev : next));
		};
		measure();
		window.addEventListener("resize", measure);
		window.addEventListener("scroll", measure, true);
		const poll = window.setInterval(measure, 250);
		return () => {
			window.removeEventListener("resize", measure);
			window.removeEventListener("scroll", measure, true);
			window.clearInterval(poll);
		};
	}, [phase, index, tourId]);

	useEffect(() => {
		const onResize = () => setViewport(viewportSize());
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	const next = useCallback(() => dispatch({ type: "next" }), [dispatch]);
	const back = useCallback(() => dispatch({ type: "back" }), [dispatch]);
	const close = useCallback(() => dispatch({ type: "close" }), [dispatch]);

	// ── Keys: claimed before anything else in the app sees them.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				close();
				return;
			}
			if (interactive) return;
			// Modal from here: no shortcut or field underneath gets the key.
			event.stopPropagation();
			const bubble = bubbleRef.current;
			if (event.key === "ArrowRight") {
				event.preventDefault();
				next();
			} else if (event.key === "ArrowLeft") {
				event.preventDefault();
				back();
			} else if (event.key === "Tab") {
				// The focus trap: Tab walks the bubble's own buttons, wrapping.
				event.preventDefault();
				const buttons = bubble ? [...bubble.querySelectorAll<HTMLButtonElement>("button")] : [];
				if (buttons.length === 0) return;
				const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
				const delta = event.shiftKey ? -1 : 1;
				buttons[(at + delta + buttons.length) % buttons.length]?.focus();
			} else if ((event.key === "Enter" || event.key === " ") && !bubble?.contains(document.activeElement)) {
				// Enter/Space activate the focused bubble button natively;
				// anywhere else they must not press something under the overlay.
				event.preventDefault();
			}
		};
		document.addEventListener("keydown", onKey, true);
		return () => document.removeEventListener("keydown", onKey, true);
	}, [interactive, next, back, close]);

	// ── A pointer step ends when the learner clicks anywhere outside the bubble
	// (the spotlighted control included: its own click still goes through).
	useEffect(() => {
		if (!interactive) return;
		const onClick = (event: MouseEvent) => {
			if (!bubbleRef.current?.contains(event.target as Node)) close();
		};
		document.addEventListener("click", onClick, true);
		return () => document.removeEventListener("click", onClick, true);
	}, [interactive, close]);

	const visible = phase !== "locating" || showWhileLocating;

	// ── Focus: into the bubble on every step, back where it was at the end.
	useEffect(() => {
		const previous = document.activeElement as HTMLElement | null;
		return () => {
			// Only when focus was left hanging by the bubble going away: if the
			// learner clicked the pointed-at control, focus is theirs now.
			const active = document.activeElement;
			if (previous?.isConnected && (!active || active === document.body)) previous.focus({ preventScroll: true });
		};
	}, []);
	useEffect(() => {
		if (visible && bubbleSize) primaryRef.current?.focus({ preventScroll: true });
	}, [visible, bubbleSize, index, tourId]);

	const unreachable = unreachableStep === index;
	const text = step ? stepText(step, phase, unreachable) : "";

	// Measure the bubble after every content change, before paint, so it is
	// placed with its real size and never jumps on screen.
	useLayoutEffect(() => {
		const bubble = bubbleRef.current;
		if (!bubble) return;
		const size = { width: bubble.offsetWidth, height: bubble.offsetHeight };
		setBubbleSize((prev) => (prev && prev.width === size.width && prev.height === size.height ? prev : size));
	}, [text, index, tourId, unreachable, viewport]);

	if (!tour || !step || typeof document === "undefined") return null;

	const hole = rect ? spotlightRect(rect, viewport) : null;
	const position = placeBubble(hole, bubbleSize ?? { width: 0, height: 0 }, viewport);
	const total = tour.steps.length;
	const last = index === total - 1;
	// No element: a zero-sized "hole" in the middle, so the same dimmer
	// simply covers the whole screen (one element, no flicker between steps).
	const cutout = hole ?? { top: viewport.height / 2, left: viewport.width / 2, width: 0, height: 0 };

	return createPortal(
		<div
			data-testid="tour-overlay"
			data-tour-phase={phase}
			className={`fixed inset-0 z-[90] font-ui ${interactive ? "pointer-events-none" : ""}`}
		>
			<div
				aria-hidden="true"
				className={`pointer-events-none fixed rounded-lg motion-safe:transition-[top,left,width,height] motion-safe:duration-200 ${hole ? "ring-2 ring-ring" : ""}`}
				style={{ ...cutout, boxShadow: "0 0 0 200vmax rgb(0 0 0 / 0.55)" }}
			/>
			<div
				ref={bubbleRef}
				role="dialog"
				aria-modal={interactive ? undefined : true}
				aria-labelledby={titleId}
				aria-describedby={textId}
				data-testid="tour-bubble"
				className="pointer-events-auto fixed w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-2xl motion-safe:transition-[top,left] motion-safe:duration-200"
				style={{ top: position.top, left: position.left, visibility: visible && bubbleSize ? "visible" : "hidden" }}
			>
				{total > 1 && (
					<p className="text-xs text-muted-foreground">
						{tour.title} · Steg {index + 1} av {total}
					</p>
				)}
				<h2 id={titleId} className="mt-1 text-base font-semibold">
					{step.title}
				</h2>
				<p id={textId} className="mt-1.5 text-sm leading-relaxed">
					{text}
				</p>
				{unreachable && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{NO_COURSE_NOTE}</p>}
				<div className="mt-4 flex items-center gap-2">
					{total > 1 && (
						<button
							type="button"
							onClick={close}
							data-testid="tour-close"
							className="rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							Avslutt
						</button>
					)}
					<span className="flex-1" />
					{index > 0 && (
						<button
							type="button"
							onClick={back}
							data-testid="tour-back"
							className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							Tilbake
						</button>
					)}
					<button
						ref={primaryRef}
						type="button"
						onClick={next}
						data-testid="tour-next"
						className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						{total === 1 ? "Lukk" : last ? "Ferdig" : "Neste"}
					</button>
				</div>
			</div>
			<div aria-live="polite" className="sr-only">
				{visible ? `${total > 1 ? `Steg ${index + 1} av ${total}. ` : ""}${step.title}. ${text}` : ""}
			</div>
		</div>,
		document.body,
	);
}
