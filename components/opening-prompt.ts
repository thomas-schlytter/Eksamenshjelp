/**
 * Same-tab handover of a new session's full opening text. Never put the
 * message in the navigation URL: long query payloads can be rejected before
 * the chat page loads. Storage is required for automatic delivery, not an
 * optional best-effort side effect of navigating away from the source draft.
 */
export const OPENING_PROMPT_FAILURE = "Kunne ikke åpne økta. Meldingen din er fortsatt her. Prøv å sende på nytt.";

export interface OpeningPrompt {
	text: string;
	/** Written BEFORE sending. A later mount restores a draft, never reposts. */
	attempted: boolean;
}

const keyFor = (id: string) => `lh.openingPrompt.${id}`;

export function stashOpeningPrompt(id: string, text: string, attempted = false): boolean {
	try {
		const value = JSON.stringify({ text, attempted } satisfies OpeningPrompt);
		// Catch both the storage getter and its methods (quota/security errors).
		const storage = globalThis.sessionStorage;
		storage.setItem(keyFor(id), value);
		return storage.getItem(keyFor(id)) === value;
	} catch {
		return false;
	}
}

export function readOpeningPromptEntry(id: string): OpeningPrompt | undefined {
	try {
		const value = globalThis.sessionStorage.getItem(keyFor(id));
		if (!value) return undefined;
		try {
			const entry: unknown = JSON.parse(value);
			if (entry && typeof entry === "object" && "text" in entry && typeof entry.text === "string" &&
				entry.text.length > 0 && "attempted" in entry && typeof entry.attempted === "boolean") {
				return { text: entry.text, attempted: entry.attempted };
			}
		} catch { /* Old raw-text stashes have no proof that sending never began. */ }
		return { text: value, attempted: true };
	} catch {
		return undefined;
	}
}

export function readOpeningPrompt(id: string): string | undefined {
	return readOpeningPromptEntry(id)?.text;
}

/* THE CARRIED MESSAGE (fase 2): the fag page's start box sends into the
 * fag-chat. When that chat already has a conversation, the opening prompt
 * (first turn only) does not apply: the text rides here instead, and the
 * chat view takes it once on mount and sends it like a composer send (or
 * leaves it in the composer while a question waits for an answer). */
const carryKeyFor = (id: string) => `lh.carriedMessage.${id}`;

export function stashCarriedMessage(id: string, text: string): boolean {
	try {
		const storage = globalThis.sessionStorage;
		storage.setItem(carryKeyFor(id), text);
		return storage.getItem(carryKeyFor(id)) === text;
	} catch {
		return false;
	}
}

/** Read AND remove: a remount never sends the same text twice. */
export function takeCarriedMessage(id: string): string | undefined {
	try {
		const storage = globalThis.sessionStorage;
		const text = storage.getItem(carryKeyFor(id));
		storage.removeItem(carryKeyFor(id));
		return text ? text : undefined;
	} catch {
		return undefined;
	}
}

export function clearOpeningPrompt(id: string): boolean {
	try {
		globalThis.sessionStorage.removeItem(keyFor(id));
		return true;
	} catch {
		// Canonical conversation/acknowledgment remains the truth. A later
		// mount with real conversation can try cleanup again; never crash it.
		return false;
	}
}
