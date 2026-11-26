/**
 * PARKED DISMISSALS (owner, 2026-10-04): ESC-discard while the turn is
 * still working. Mid-turn the STORED record holds no pending question or
 * problem (the turn hasn't persisted — its messages land at settle), so a
 * dismissal arriving now CANNOT validate; the old behavior was a hard 409,
 * which left the learner trapped with a phantom question until the turn
 * died (the GLM practice-loop incident: the only escape was killing the
 * dev server).
 *
 * The park (owner ruling: "server-side park"): the dismiss route, finding
 * a live turn, parks the intent and answers 202; the turn's settle path
 * (chat-handler onFinish, AFTER persistTurn, BEFORE endTurn — the same
 * ordering law that makes turn-settled imply durable truth) applies it
 * against the freshly persisted record. Validation runs at APPLY time
 * against real state: if the dismissed question/problem really is pending
 * there, the dismissal lands exactly as the route would have written it;
 * if it never materialized (the call errored, the model re-posed and
 * answered), the park is dropped silently — the thing the user dismissed
 * no longer exists.
 *
 * Lives on globalThis, NOT a module-level Map — the same Next.js module
 * instance discipline as turn-liveness: the dismiss route and the
 * chat-handler entry must see the SAME registry or the park is written in
 * one world and read in another. Ephemeral by design; one parked
 * dismissal per chat (last write wins — there is one dock, one discard).
 */

import { ChatInputError, dismissAppends, emit, heldQuestionRepose } from "../core";
import type { ChatStore } from "../core/ports.ts";

/** The parked dismissal body — exactly the parsed input the dismiss route
 *  accepted ({type:"dismiss", toolCallId, answer} or
 *  {type:"dismiss-problem", problemCallId}). */
export type ParkedDismissal = unknown;

interface LhGlobal {
	__lhParkedDismissals?: Map<string, ParkedDismissal>;
}

function registry(): Map<string, ParkedDismissal> {
	const g = globalThis as typeof globalThis & LhGlobal;
	return (g.__lhParkedDismissals ??= new Map<string, ParkedDismissal>());
}

/** Park (or overwrite) the chat's dismissal intent. Called by the dismiss
 *  route when a turn owns the chat. */
export function parkDismissal(chatId: string, input: ParkedDismissal): void {
	registry().set(chatId, input);
}

/** Take the chat's parked dismissal (removes it). Returns null when
 *  nothing is parked. */
export function takeParkedDismissal(chatId: string): ParkedDismissal | null {
	const parked = registry().get(chatId);
	if (parked === undefined) return null;
	registry().delete(chatId);
	return parked;
}

/** Apply the chat's parked dismissal, if any, against the current record.
 *  Runs in the turn's onFinish — between persistTurn and endTurn, so a
 *  client reacting to "turn-settled" reads the dismissal already in the
 *  record. The append path is the route's own (dismissAppends); a
 *  ChatInputError means the dismissed thing never materialized — the park
 *  is dropped, silence is the correct outcome. Emits "record-changed"
 *  exactly when something was written. */
export function applyParkedDismissal(chatStore: ChatStore, chatId: string): void {
	const input = takeParkedDismissal(chatId);
	if (input === null) return;
	const record = chatStore.getChat(chatId);
	if (!record) return;
	try {
		const appends = dismissAppends(record, input as Parameters<typeof dismissAppends>[1]);
		chatStore.saveMessages(chatId, [...record.messages, ...appends]);
		emit("record-changed", { chatId });
	} catch (err) {
		if (err instanceof ChatInputError) return; // never materialized — drop
		throw err;
	}
}

/** THE HELD-QUESTION RE-POSE (fase 4, 2026-11): after a reply turn has
 *  persisted, a question the learner parked with «Spør agenten» comes back
 *  by itself — the synthetic re-pose (heldQuestionRepose, core) is appended
 *  when the record says it is owed. Runs in onFinish beside the parked-
 *  dismissal apply (after persistTurn, before endTurn), so a client
 *  reacting to "turn-settled" already reads the question in the record and
 *  the dock arms it without a "fortsett". Idempotent: once appended, the
 *  record no longer owes it. `callId`: the id minted ahead when the
 *  re-pose waited for a figure or demo of the reply (chat-handler). */
export function applyHeldQuestionRepose(chatStore: ChatStore, chatId: string, callId?: string): void {
	const record = chatStore.getChat(chatId);
	if (!record) return;
	const repose = heldQuestionRepose(record.messages, callId);
	if (!repose) return;
	chatStore.saveMessages(chatId, [...record.messages, repose]);
	emit("record-changed", { chatId });
}

/** Does the record owe the held question's re-pose right now? */
export function heldQuestionReposeOwed(chatStore: ChatStore, chatId: string): boolean {
	const record = chatStore.getChat(chatId);
	return !!record && heldQuestionRepose(record.messages) !== null;
}
