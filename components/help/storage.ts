/**
 * Per-device help state (NTNU round): which tours are finished and whether
 * the first-launch invitation has been answered. localStorage, like the key
 * map: it is about this device's UI, not the learning record. Every access
 * is guarded, so private mode or SSR simply behaves as "nothing stored".
 */

const COMPLETED_KEY = "lh:help:tours-done";
const INVITE_KEY = "lh:help:invite-answered";

function read(key: string): string | null {
	if (typeof window === "undefined") return null;
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

function write(key: string, value: string): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(key, value);
	} catch {
		/* storage unavailable: the state just does not persist */
	}
}

/** Pure: the stored list, tolerant of anything that is not a string array. */
export function parseCompleted(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
	} catch {
		return [];
	}
}

export function loadCompletedTours(): string[] {
	return parseCompleted(read(COMPLETED_KEY));
}

export function markTourCompleted(id: string): string[] {
	const next = [...new Set([...loadCompletedTours(), id])];
	write(COMPLETED_KEY, JSON.stringify(next));
	return next;
}

/** True once the learner has answered the invitation (either way), or has
 *  finished any tour: the invitation is offered exactly once, ever. */
export function inviteAnswered(): boolean {
	return read(INVITE_KEY) === "1" || loadCompletedTours().length > 0;
}

export function answerInvite(): void {
	write(INVITE_KEY, "1");
}

/** The answer the palette asked the help page to open. Module state rather
 *  than the URL alone: the page may mount before the hash has landed. */
let pendingArticle: string | null = null;

export function setPendingArticle(id: string): void {
	pendingArticle = id;
}

export function takePendingArticle(): string | null {
	const id = pendingArticle;
	pendingArticle = null;
	return id;
}
