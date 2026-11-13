/**
 * The tour engine's brain (NTNU round): a pure state machine plus the pure
 * geometry the overlay needs. No React and no DOM, so the whole flow is
 * unit-tested (tests/help-tour-machine.test.ts); tour-overlay.tsx only
 * performs the effects this module asks for.
 *
 * One step moves through three phases:
 *   locating → the overlay navigates (if the step has a route) and waits for
 *              the step's element to appear;
 *   anchored → the element was found: spotlight it, bubble beside it;
 *   fallback → no element (timeout, or the step has none): bubble centred
 *              with the step's fallback text. A tour never blocks on a
 *              missing element.
 */

import type { Tour, TourStep } from "./types.ts";

export type TourPhase = "locating" | "anchored" | "fallback";

export type TourState =
	| { status: "idle" }
	| { status: "running"; tourId: string; index: number; phase: TourPhase };

export type TourEvent =
	| { type: "start"; tourId: string }
	| { type: "next" }
	| { type: "back" }
	/** The current step's element appeared / could not be found. `index`
	 *  guards against a late answer for a step the user already left. */
	| { type: "found"; index: number }
	| { type: "missing"; index: number }
	| { type: "close" };

export interface TourTransition {
	state: TourState;
	/** Set when this event finished the tour by walking past its last step. */
	completed?: string;
}

export const TOUR_IDLE: TourState = { status: "idle" };

function hasTarget(step: TourStep | undefined): boolean {
	return !!step && !!(step.anchor || step.selector);
}

/** The phase a step STARTS in: steps with nothing to find and nowhere to go
 *  are ready at once; everything else must be located first. */
export function initialPhase(step: TourStep | undefined): TourPhase {
	return hasTarget(step) || step?.route || step?.before ? "locating" : "fallback";
}

function enter(tour: Tour, index: number): TourState {
	return { status: "running", tourId: tour.id, index, phase: initialPhase(tour.steps[index]) };
}

export function tourReducer(state: TourState, event: TourEvent, tours: readonly Tour[]): TourTransition {
	if (event.type === "start") {
		const tour = tours.find((candidate) => candidate.id === event.tourId);
		// Unknown or empty tour: stay where we are rather than show nothing.
		if (!tour || tour.steps.length === 0) return { state };
		return { state: enter(tour, 0) };
	}
	if (state.status !== "running") return { state };
	const tour = tours.find((candidate) => candidate.id === state.tourId);
	if (!tour) return { state: TOUR_IDLE };
	switch (event.type) {
		case "next":
			if (state.index >= tour.steps.length - 1) return { state: TOUR_IDLE, completed: tour.id };
			return { state: enter(tour, state.index + 1) };
		case "back":
			if (state.index === 0) return { state };
			return { state: enter(tour, state.index - 1) };
		case "found":
			if (event.index !== state.index || state.phase !== "locating") return { state };
			// A step with nothing to point at still "arrives" (route reached).
			return { state: { ...state, phase: hasTarget(tour.steps[state.index]) ? "anchored" : "fallback" } };
		case "missing":
			if (event.index !== state.index || state.phase === "fallback") return { state };
			return { state: { ...state, phase: "fallback" } };
		case "close":
			return { state: TOUR_IDLE };
	}
}

/** The CSS selector a step points at (contract anchors win over raw selectors). */
export function stepSelector(step: TourStep): string | null {
	if (step.anchor) return `[data-tour="${step.anchor}"]`;
	return step.selector ?? null;
}

/** The text a step shows in its current phase: the fallback wording when
 *  the step's element is missing, or when its page could not be reached at
 *  all (`unreachable`: no course to show a course page for). */
export function stepText(step: TourStep, phase: TourPhase, unreachable = false): string {
	const useFallback = phase === "fallback" && !!step.fallback && (hasTarget(step) || unreachable);
	return useFallback && step.fallback ? step.fallback : step.text;
}

export interface Rect {
	top: number;
	left: number;
	width: number;
	height: number;
}

export interface Size {
	width: number;
	height: number;
}

export type BubbleSide = "bottom" | "top" | "right" | "left" | "corner" | "center";

const GAP = 12; // spotlight edge → bubble
const EDGE = 12; // the bubble never touches the viewport edge
const CORNER_INSET = 12; // extra air when the bubble is parked in the corner

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), Math.max(min, max));
}

/** The spotlight cut-out: the target grown by `pad`, clipped to the viewport
 *  (a section taller than the window must not push the hole off-screen). */
export function spotlightRect(target: Rect, viewport: Size, pad = 6): Rect {
	const top = clamp(target.top - pad, 0, viewport.height);
	const left = clamp(target.left - pad, 0, viewport.width);
	const bottom = clamp(target.top + target.height + pad, 0, viewport.height);
	const right = clamp(target.left + target.width + pad, 0, viewport.width);
	return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** Where the bubble goes: beside the spotlight on the first side with room
 *  (below, above, right, left). A target with no room on any side (a
 *  section taller or wider than the window) gets the bubble anchored in the
 *  bottom-right corner with a margin: centred, it would sit right on top of
 *  the content it is pointing at. Always fully inside the viewport.
 *  `target` null = no element: centred. */
export function placeBubble(target: Rect | null, bubble: Size, viewport: Size): { side: BubbleSide; top: number; left: number } {
	const centered = {
		side: "center" as const,
		top: clamp((viewport.height - bubble.height) / 2, EDGE, viewport.height - bubble.height - EDGE),
		left: clamp((viewport.width - bubble.width) / 2, EDGE, viewport.width - bubble.width - EDGE),
	};
	if (!target) return centered;
	const maxLeft = viewport.width - bubble.width - EDGE;
	const maxTop = viewport.height - bubble.height - EDGE;
	const alongX = clamp(target.left + target.width / 2 - bubble.width / 2, EDGE, maxLeft);
	const alongY = clamp(target.top + target.height / 2 - bubble.height / 2, EDGE, maxTop);
	const room = {
		bottom: viewport.height - (target.top + target.height) - GAP - EDGE,
		top: target.top - GAP - EDGE,
		right: viewport.width - (target.left + target.width) - GAP - EDGE,
		left: target.left - GAP - EDGE,
	};
	// The final clamp covers a target that is itself (partly) off-screen.
	if (room.bottom >= bubble.height) return { side: "bottom", top: clamp(target.top + target.height + GAP, EDGE, maxTop), left: alongX };
	if (room.top >= bubble.height) return { side: "top", top: clamp(target.top - GAP - bubble.height, EDGE, maxTop), left: alongX };
	if (room.right >= bubble.width) return { side: "right", top: alongY, left: clamp(target.left + target.width + GAP, EDGE, maxLeft) };
	if (room.left >= bubble.width) return { side: "left", top: alongY, left: clamp(target.left - GAP - bubble.width, EDGE, maxLeft) };
	return { side: "corner", top: clamp(maxTop - CORNER_INSET, EDGE, maxTop), left: clamp(maxLeft - CORNER_INSET, EDGE, maxLeft) };
}

/** The part of `target` that `clip` lets through (a scroll container's
 *  box): what the learner can actually see of the element. Never negative. */
export function intersectRect(target: Rect, clip: Rect): Rect {
	const top = Math.max(target.top, clip.top);
	const left = Math.max(target.left, clip.left);
	const bottom = Math.min(target.top + target.height, clip.top + clip.height);
	const right = Math.min(target.left + target.width, clip.left + clip.width);
	return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** Resolve a step's route against where the user is. Returns the path to
 *  navigate to, `null` when already there (or the step has no route), and
 *  `"unresolved"` when a course route cannot be filled in (no course yet). */
export function resolveStepRoute(
	route: string | undefined,
	pathname: string,
	firstCourseCode: string | null,
): string | null | "unresolved" {
	if (!route) return null;
	if (!route.includes("[code]")) return samePath(pathname, route) ? null : route;
	const prefix = route.slice(0, route.indexOf("[code]"));
	// Already on a course page: stay on the course the learner is looking at.
	if (pathname.startsWith(prefix) && pathname.length > prefix.length) return null;
	if (!firstCourseCode) return "unresolved";
	return route.replace("[code]", encodeURIComponent(firstCourseCode));
}

function samePath(a: string, b: string): boolean {
	const trim = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path);
	return trim(a) === trim(b);
}
