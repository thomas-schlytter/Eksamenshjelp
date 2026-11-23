"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useServerEvent, useServerResync } from "@/components/server-events";
import type { StreakSummary } from "@/src/core";

/**
 * The flame in the browser (fase 7b): ONE shared copy of GET /api/streak
 * per window, however many places show it (sidebar, fag page, the
 * celebration). Refetched on `streak-changed`, on reconnect, when the
 * window comes back into view, and right after local midnight (the day
 * turns without any server event).
 */

let current: StreakSummary | null = null;
let inFlight: Promise<void> | null = null;
let queued = false;
const listeners = new Set<() => void>();

function publish(next: StreakSummary) {
	current = next;
	for (const listener of [...listeners]) listener();
}

export function refreshStreak(): Promise<void> {
	if (inFlight) {
		queued = true;
		return inFlight;
	}
	inFlight = (async () => {
		try {
			const res = await fetch("/api/streak", { cache: "no-store" });
			if (res.ok) publish((await res.json()) as StreakSummary);
		} catch { /* offline: keep what we have */ }
		finally {
			inFlight = null;
			if (queued) {
				queued = false;
				void refreshStreak();
			}
		}
	})();
	return inFlight;
}

/** «Nytt nivå» was shown. */
export async function markCelebrated(level: string): Promise<void> {
	try {
		const res = await fetch("/api/streak", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ celebrated: level }),
		});
		if (res.ok) publish((await res.json()) as StreakSummary);
	} catch { /* shown again next time: harmless */ }
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Milliseconds until the next local midnight (plus a little slack). */
export function msToNextMidnight(now = new Date()): number {
	const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
	return Math.max(1000, next.getTime() - now.getTime());
}

/** The flame, or null until the first answer. */
export function useStreak(): StreakSummary | null {
	const value = useSyncExternalStore(subscribe, () => current, () => null);
	useEffect(() => {
		if (!current) void refreshStreak();
		let timer: ReturnType<typeof setTimeout>;
		const arm = () => {
			timer = setTimeout(() => {
				void refreshStreak();
				arm();
			}, msToNextMidnight());
		};
		arm();
		const onVisible = () => {
			if (document.visibilityState === "visible") void refreshStreak();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, []);
	useServerEvent("streak-changed", () => void refreshStreak());
	useServerResync(() => void refreshStreak());
	return value;
}
