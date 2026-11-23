"use client";

import { useSyncExternalStore } from "react";
import {
	advanceFocus,
	DEFAULT_FOCUS_CONFIG,
	normalizeFocusConfig,
	parseFocusState,
	pauseFocus,
	resumeFocus,
	skipBreak,
	startBreak,
	startFocus,
	type FocusConfig,
	type FocusEvent,
	type FocusOrigin,
	type FocusState,
} from "@/src/core";

/**
 * FOKUS in the browser (fase 7b): one timer for the whole window, outside
 * React's page tree, so it keeps running from page to page and fag to fag.
 * The state (end timestamps, never a ticking counter) lives in
 * localStorage and survives a reload; other windows follow through the
 * `storage` event. The transitions are core/focus-timer.ts.
 *
 * Also held here: the last used setup, the toast that a boundary raised
 * (the runtime shows it), and how many chat headers show the chip (the
 * sidebar shows its small copy only when none does).
 */

const STATE_KEY = "lh-focus-state";
const CONFIG_KEY = "lh-focus-config";

export type FocusToast =
	| { kind: "break-due"; round: number; rounds: number; breakMinutes: number }
	| { kind: "break-ended"; round: number; rounds: number; workMinutes: number }
	| { kind: "done"; rounds: number; origin?: FocusOrigin };

interface Snapshot {
	state: FocusState | null;
	toast: FocusToast | null;
	headerChips: number;
}

let snapshot: Snapshot = { state: null, toast: null, headerChips: 0 };
let loaded = false;
const listeners = new Set<() => void>();

function emitChange() {
	for (const listener of [...listeners]) listener();
}

function read(key: string): unknown {
	try {
		const raw = window.localStorage.getItem(key);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

function write(key: string, value: unknown) {
	try {
		if (value === null) window.localStorage.removeItem(key);
		else window.localStorage.setItem(key, JSON.stringify(value));
	} catch { /* private mode: the timer still runs in this window */ }
}

function ensureLoaded() {
	if (loaded || typeof window === "undefined") return;
	loaded = true;
	snapshot = { ...snapshot, state: parseFocusState(read(STATE_KEY)) };
	window.addEventListener("storage", (e) => {
		if (e.key !== STATE_KEY) return;
		snapshot = { ...snapshot, state: parseFocusState(read(STATE_KEY)) };
		emitChange();
	});
}

function setState(state: FocusState | null) {
	snapshot = { ...snapshot, state };
	write(STATE_KEY, state);
	emitChange();
}

export function setFocusToast(toast: FocusToast | null) {
	snapshot = { ...snapshot, toast };
	emitChange();
}

function subscribe(listener: () => void) {
	ensureLoaded();
	listeners.add(listener);
	return () => listeners.delete(listener);
}

const SERVER: Snapshot = { state: null, toast: null, headerChips: 0 };

export function useFocusSnapshot(): Snapshot {
	return useSyncExternalStore(subscribe, () => {
		ensureLoaded();
		return snapshot;
	}, () => SERVER);
}

export function focusSnapshot(): Snapshot {
	ensureLoaded();
	return snapshot;
}

/** The setup the form opens with: the last one used. */
export function lastFocusConfig(): FocusConfig {
	ensureLoaded();
	const stored = typeof window === "undefined" ? null : read(CONFIG_KEY);
	return stored ? normalizeFocusConfig(stored) : DEFAULT_FOCUS_CONFIG;
}

/** Replay the boundaries up to now; the newest event raises the toast.
 *  Returns the events (the runtime notifies on the newest). */
export function tickFocus(now = Date.now()): FocusEvent[] {
	ensureLoaded();
	const state = snapshot.state;
	if (!state) return [];
	const { state: next, events } = advanceFocus(state, now);
	if (events.length === 0) return [];
	setState(next);
	const last = events.at(-1)!;
	const c = next.config;
	if (last.type === "work-ended") setFocusToast({ kind: "break-due", round: last.round, rounds: c.rounds, breakMinutes: c.breakMinutes });
	else if (last.type === "break-ended") setFocusToast({ kind: "break-ended", round: last.round, rounds: c.rounds, workMinutes: c.workMinutes });
	else setFocusToast({ kind: "done", rounds: c.rounds, origin: next.origin });
	return events;
}

export const focusActions = {
	start(config: FocusConfig, origin?: FocusOrigin) {
		const clean = normalizeFocusConfig(config);
		write(CONFIG_KEY, clean);
		setFocusToast(null);
		setState(startFocus(clean, Date.now(), origin));
	},
	pause() {
		if (snapshot.state) setState(pauseFocus(snapshot.state, Date.now()));
	},
	resume() {
		if (snapshot.state) setState(resumeFocus(snapshot.state, Date.now()));
	},
	startBreak() {
		if (snapshot.state) setState(startBreak(snapshot.state, Date.now()));
		setFocusToast(null);
	},
	skipBreak() {
		if (snapshot.state) setState(skipBreak(snapshot.state, Date.now()));
		setFocusToast(null);
	},
	stop() {
		setFocusToast(null);
		setState(null);
	},
};

/** A chat header shows the chip while mounted (the sidebar steps back). */
export function registerHeaderChip(): () => void {
	snapshot = { ...snapshot, headerChips: snapshot.headerChips + 1 };
	emitChange();
	let done = false;
	return () => {
		if (done) return;
		done = true;
		snapshot = { ...snapshot, headerChips: Math.max(0, snapshot.headerChips - 1) };
		emitChange();
	};
}

// ─── «Avslutt økt» after the last round ──────────────────────────────────────

/** The window event a chat answers to open its end dialog. A chat that
 *  handled it sets `detail.handled`. */
export const FOCUS_END_SESSION_EVENT = "lh:focus-end-session";
export interface FocusEndSessionDetail {
	chatId?: string;
	handled: boolean;
}

let pendingEndFor: string | null = null;

/** Ask the open chat (or, with chatId, that chat once it opens) to show
 *  the end dialog. True when an open chat took it. */
export function requestEndSession(chatId?: string): boolean {
	const detail: FocusEndSessionDetail = { chatId, handled: false };
	window.dispatchEvent(new CustomEvent(FOCUS_END_SESSION_EVENT, { detail }));
	if (!detail.handled && chatId) pendingEndFor = chatId;
	return detail.handled;
}

/** A chat that just opened: was it asked to show the end dialog? */
export function consumePendingEndSession(chatId: string): boolean {
	if (pendingEndFor !== chatId) return false;
	pendingEndFor = null;
	return true;
}
