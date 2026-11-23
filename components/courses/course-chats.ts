"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useServerEvent, useServerResync } from "@/components/server-events";
import type { ChatListItem } from "@/src/core";

/**
 * ÉN CHAT PER FAG (fase 2), the client side: open a fag's fag-chat (the
 * server finds it or creates it), move a loose session into a fag, and the
 * session list the fag page shows. The grouping rules themselves are pure
 * and live in core (groupChatsByCourse, isCourseMainChat).
 */

export interface CourseChatRef {
	id: string;
	/** No conversation yet: only the fag's context marker. */
	empty: boolean;
}

const CHAT_ID = /^[A-Za-z0-9_-]+$/;

/** «Ny underchat» in a fag: the draft view, linked to the fag (the
 *  session is created with the first message, which becomes its title). */
export function newSubChatHref(code: string): string {
	return `/chat/new?fag=${encodeURIComponent(code)}`;
}

/** The fag's fag-chat id (POST /api/courses/[code]/chat). Throws on failure. */
export async function openCourseChatId(code: string, fetchLike: typeof fetch): Promise<CourseChatRef> {
	const res = await fetchLike(`/api/courses/${encodeURIComponent(code)}/chat`, { method: "POST" });
	if (!res.ok) throw new Error(`fag-chat failed: ${res.status}`);
	const body = (await res.json()) as { id?: unknown; empty?: unknown };
	if (typeof body.id !== "string" || !CHAT_ID.test(body.id)) throw new Error("fag-chat failed: bad id");
	return { id: body.id, empty: body.empty === true };
}

/** «Flytt til fag…» (PUT /api/chats/[id]/course). Resolves to null when it
 *  worked, else the server's message (Norwegian) for the learner. */
export async function moveChatToCourse(chatId: string, code: string, fetchLike: typeof fetch): Promise<string | null> {
	try {
		const res = await fetchLike(`/api/chats/${encodeURIComponent(chatId)}/course`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code }),
		});
		if (res.ok) return null;
		const body = (await res.json().catch(() => ({}))) as { error?: unknown };
		return typeof body.error === "string" ? body.error : "Kunne ikke flytte økta.";
	} catch {
		return "Kunne ikke flytte økta.";
	}
}

/** The session list (GET /api/chats, newest activity first), kept fresh:
 *  list-shape changes, every turn's start and end (last activity moves),
 *  and reconnects. null until the first answer. */
export function useChatList(): ChatListItem[] | null {
	const [chats, setChats] = useState<ChatListItem[] | null>(null);
	const alive = useRef(true);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const reload = useCallback(async () => {
		try {
			const res = await fetch("/api/chats", { cache: "no-store" });
			const body = res.ok ? ((await res.json()) as { chats?: ChatListItem[] }) : {};
			if (alive.current) setChats(Array.isArray(body.chats) ? body.chats : []);
		} catch {
			if (alive.current) setChats((prev) => prev ?? []);
		}
	}, []);
	const schedule = useCallback(() => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => void reload(), 250);
	}, [reload]);
	useEffect(() => {
		alive.current = true;
		void reload();
		return () => {
			alive.current = false;
			if (timer.current) clearTimeout(timer.current);
		};
	}, [reload]);
	useServerEvent("chats-changed", schedule);
	useServerEvent("turn-started", schedule);
	useServerEvent("turn-settled", schedule);
	useServerResync(() => void reload());
	return chats;
}
