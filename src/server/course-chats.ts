/**
 * ÉN CHAT PER FAG (fase 2, owner 2026-11-23): the fag-chat and «Flytt til
 * fag».
 *
 * Every fag has one main chat, the fag-chat: an eksamensøkt (kind "exam",
 * link mode "exam") with the fag's context as its first message. Opening a
 * fag finds it, or creates it the first time. Every other session linked
 * to the fag is an underchat (link mode "sub", or a retired Lær/Øv/
 * Kartlegging mode on old records). The rules live in core/courses.ts
 * (isCourseMainChat, groupChatsByCourse); this module is the server side.
 *
 * «Flytt til fag» links a loose session to a fag after birth: the link
 * becomes an underchat's, and the course-context marker is written the
 * way creation writes it, so the next turn carries the fag's context and
 * the topic_status tool (chat-handler reads record.course per turn).
 */
import { emit } from "../core/events.ts";
import { isCourseMainChat, normalizeCourseCode, SUB_CHAT_MODE, type ChatCourseLink } from "../core/courses.ts";
import { danglingQuestionOf, type LhMessage } from "../core/native-messages.ts";
import { courseStore } from "../store/courses.ts";
import { readSettings } from "../store/settings.ts";
import { compactionInFlight } from "./compaction.ts";
import { courseContextMessageFor } from "./courses.ts";
import { stores } from "./stores.ts";
import { isTurnRunning } from "./turn-liveness.ts";

/** PER-SESSION MODELS (owner, 2026-09-28): a new session is stamped with
 *  the STRONG slot at birth. No strong slot configured = no stamp (the
 *  turn gate refuses honestly until setup fills it). */
export function stampNewSessionSettings(chatId: string): void {
	const strong = readSettings()?.models?.strong;
	if (strong?.model) {
		stores.chatStore.saveSettings(chatId, {
			model: { provider: strong.model.provider, id: strong.model.id },
			thinkingLevel: strong.thinkingLevel,
		});
	}
}

/** The fag-chat's title: what the session list and the search show. */
export function courseChatTitle(code: string): string {
	return `Fag-chat ${code}`;
}

export type OpenCourseChatOutcome =
	| { ok: true; id: string; created: boolean; empty: boolean }
	| { ok: false; status: 404; code: "not_found"; error: string };

/** The fag's fag-chat, created the first time. `empty` = no conversation
 *  yet (only the context marker): the caller may hand over an opening
 *  message the ordinary way. One process owns the store, and this runs
 *  synchronously, so two quick clicks can never create two. */
export function openCourseChat(rawCode: string): OpenCourseChatOutcome {
	const code = normalizeCourseCode(rawCode);
	const course = code ? courseStore.getCourse(code) : null;
	if (!code || !course) return { ok: false, status: 404, code: "not_found", error: "Fant ikke faget. Det kan ha blitt slettet." };
	// listChats is newest activity first: the first match is the fag-chat
	// (the same choice groupChatsByCourse makes for the sidebar).
	const existing = stores.chatStore.listChats().find((chat) => chat.course?.code === code && isCourseMainChat(chat));
	if (existing) {
		const record = stores.chatStore.getChat(existing.id);
		return { ok: true, id: existing.id, created: false, empty: !hasConversation(record?.messages ?? []) };
	}
	const link: ChatCourseLink = { code, mode: "exam" };
	const chat = stores.chatStore.createChat(courseChatTitle(code), "exam", link);
	stampNewSessionSettings(chat.id);
	const marker = courseContextMessageFor(link, { kind: "exam" });
	if (marker) stores.chatStore.saveMessages(chat.id, [marker]);
	return { ok: true, id: chat.id, created: true, empty: true };
}

function hasConversation(messages: readonly LhMessage[]): boolean {
	return messages.some((m) => m.role === "user" || m.role === "assistant");
}

/**
 * Where a late course-context marker goes: at the end, unless a question
 * is waiting for the learner's answer. Then it goes right BEFORE the
 * assistant message that posed it, so the question's call and its answer
 * stay adjacent (the provider shape law: nothing may come between a tool
 * call and its result). Pure; exported for tests.
 */
export function courseMarkerInsertIndex(messages: readonly LhMessage[]): number {
	const pending = danglingQuestionOf(messages);
	if (!pending) return messages.length;
	const index = messages.findIndex((m) =>
		m.role === "assistant" && m.content.some((block) => block.type === "toolCall" && block.id === pending.toolCallId));
	return index >= 0 ? index : messages.length;
}

export type MoveToCourseOutcome =
	| { ok: true; course: ChatCourseLink }
	| { ok: false; status: 400 | 404 | 409; code: string; error: string };

/** «Flytt til fag…»: a loose session becomes an underchat of `rawCode`. */
export function moveChatToCourse(chatId: string, rawCode: unknown): MoveToCourseOutcome {
	const record = stores.chatStore.getChat(chatId);
	if (!record) return { ok: false, status: 404, code: "chat_not_found", error: "Fant ikke økta." };
	const code = normalizeCourseCode(rawCode);
	if (!code) return { ok: false, status: 400, code: "invalid_code", error: "Velg et fag." };
	const course = courseStore.getCourse(code);
	if (!course) return { ok: false, status: 404, code: "not_found", error: `Fant ikke faget ${code}. Det kan ha blitt slettet.` };
	// A link to a fag that still exists is final; a link to a deleted fag
	// lists under «Uten fag» and may move.
	if (record.course && courseStore.getCourse(record.course.code)) {
		return { ok: false, status: 409, code: "already_linked", error: `Økta hører allerede til ${record.course.code}.` };
	}
	// A running turn or compaction persists from its own snapshot of the
	// record: a marker written under it would be lost.
	if (isTurnRunning(chatId) || compactionInFlight(chatId)) {
		return { ok: false, status: 409, code: "busy", error: "Økta arbeider akkurat nå. Prøv igjen når den er ferdig." };
	}
	const link: ChatCourseLink = { code, mode: SUB_CHAT_MODE };
	const marker = courseContextMessageFor(link, { kind: record.kind ?? "teach" });
	if (!marker) return { ok: false, status: 404, code: "not_found", error: `Fant ikke faget ${code}. Det kan ha blitt slettet.` };
	const messages = [...record.messages];
	messages.splice(courseMarkerInsertIndex(messages), 0, marker);
	stores.chatStore.linkCourse(chatId, link, messages);
	// The fag's surfaces (its chat list, the sidebar group) and the open
	// chat view (the new course card) follow.
	emit("courses-changed", { code, chatId });
	emit("record-changed", { chatId });
	return { ok: true, course: link };
}
