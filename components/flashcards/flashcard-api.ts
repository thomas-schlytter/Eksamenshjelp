"use client";

import { useCallback, useEffect, useState } from "react";
import { useServerEvent, useServerResync } from "@/components/server-events";
import type { FlashcardProgress, FlashcardStats, FlashcardView, FlashcardGenerationMode } from "./flashcard-types";

/**
 * The browser's client for /api/flashcards/<CODE> (spørsmålskort). Every
 * failure throws a FlashcardApiError carrying the server's Norwegian line.
 */

export class FlashcardApiError extends Error {
	constructor(message: string, readonly status: number, readonly code?: string) {
		super(message);
		this.name = "FlashcardApiError";
	}
}

const OFFLINE = "Fikk ikke kontakt med appen. Prøv igjen.";
const FALLBACK = "Noe gikk galt. Prøv igjen.";

async function call<T>(fetchLike: typeof fetch, url: string, init?: RequestInit): Promise<T> {
	let res: Response;
	try {
		res = await fetchLike(url, { cache: "no-store", ...init });
	} catch {
		throw new FlashcardApiError(OFFLINE, 0, "network");
	}
	let body: unknown = null;
	try {
		body = await res.json();
	} catch { /* reported through the status below */ }
	if (!res.ok) {
		const failure = (body ?? {}) as { error?: unknown; code?: unknown };
		throw new FlashcardApiError(
			typeof failure.error === "string" && failure.error ? failure.error : FALLBACK,
			res.status,
			typeof failure.code === "string" ? failure.code : undefined,
		);
	}
	if (body === null || typeof body !== "object") throw new FlashcardApiError(FALLBACK, res.status);
	return body as T;
}

const base = (code: string, rest = "") => `/api/flashcards/${encodeURIComponent(code)}${rest}`;
const post = (body?: unknown): RequestInit => ({
	method: "POST",
	...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
});

export const flashcardApi = {
	get: (code: string, f: typeof fetch = fetch) => call<FlashcardView>(f, base(code)),
	generate: (code: string, mode: FlashcardGenerationMode, f: typeof fetch = fetch) => call<FlashcardView>(f, base(code, "/generate"), post({ mode })),
	answer: (code: string, cardId: string, chosen: number[] | null, f: typeof fetch = fetch) =>
		call<{ correct: boolean; progress: FlashcardProgress; stats: FlashcardStats }>(f, base(code, "/answer"), post({ cardId, chosen })),
	reset: (code: string, f: typeof fetch = fetch) => call<FlashcardView>(f, base(code, "/reset"), post()),
};

export function flashcardErrorMessage(err: unknown): string {
	return err instanceof FlashcardApiError ? err.message || FALLBACK : OFFLINE;
}

/** The course's deck view, kept fresh by `flashcards-changed` and
 *  reconnects. null until the first read (unless `initial` is given). */
export function useFlashcards(code: string, initial: FlashcardView | null = null): {
	view: FlashcardView | null;
	setView: (view: FlashcardView) => void;
	reload: () => Promise<void>;
} {
	const [view, setView] = useState<FlashcardView | null>(initial);
	const reload = useCallback(async () => {
		try {
			setView(await flashcardApi.get(code));
		} catch {
			// Keep what is shown; the next event or reconnect tries again.
		}
	}, [code]);
	useEffect(() => {
		void reload();
	}, [reload]);
	useServerEvent("flashcards-changed", (payload) => {
		if (payload.code === code) void reload();
	});
	useServerResync(() => void reload());
	return { view, setView, reload };
}
