"use client";

/**
 * THE TOP BAR (owner standardization ruling, 2026-09-29): one element,
 * every surface — the same mechanics ALWAYS. Born from the chains-overlay
 * incident: its hand-rolled bar broke every rule at once (wrong height,
 * wrong title size, whole-bar no-drag so window drags fell through to
 * text selection, no sidebar reopen, traffic lights over content). The
 * law: whenever a surface has a top bar, it renders THIS component —
 * never a bespoke header.
 *
 * Mechanics baked in (the chat-session bar's proven pattern):
 * - h-15 (60px) — matches the sidebar's wordmark band, one border line.
 * - lh-drag — the window-drag band. NATIVE interactive children
 *   (button/input/a/…) carve out AUTOMATICALLY via the globals.css auto
 *   carve-out rule (owner standardization ruling, 2026-09-29 night) —
 *   "draggable anywhere that is not a clickable element" is structural,
 *   not per-child discipline; manual lh-no-drag is only for clickable
 *   non-natives (spans/divs with onClick).
 * - select-none — dragging never highlights the title.
 * - SidebarToggle FIRST — the sidebar reopen when closed, with its
 *   Electron traffic-light gutter (lh-closed-toggle).
 * - border-b border-border px-3, gap-3 rhythm.
 *
 * The consumer brings the title (font-title text-3xl tracking-tight) and
 * any right-side controls. THE TITLE LAW (owner round 11, 2026-10-05):
 * the serif title ALWAYS names a session — chrome-less creation surfaces
 * (home, both /chat/new drafts) and the chain table render NO title.
 * `drag={false}` is the one escape hatch —
 * chat's rename mode (app-region:drag would eat the mousedown that
 * exits the input; owner ask).
 *
 * THE OVERLAY TWIN OF THE MASK LAW (owner, 2026-09-29 night): app-region
 * subtraction resolves by DOM order, not z-index — a surface containing
 * a TopBar that COVERS other content (a full-bleed overlay) must be the
 * LAST child of its container, or later no-drag elements punch dead
 * zones through the bar (the chains-overlay bug: the graph chrome's
 * no-drag column killed drag over the counts/search/close area).
 */

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CourseLinkChip } from "@/components/courses/course-chip";
import { CourseChatMenu } from "@/components/courses/course-chat-menu";
import { useServerEvent } from "@/components/server-events";
import { SidebarToggle } from "@/components/sidebar";
import { isCourseMainChat, type ChatListItem } from "@/src/core";

/** The session a path names, or undefined (the draft view is no session). */
export function chatIdFromPath(pathname: string | null | undefined): string | undefined {
	const id = /^\/chat\/([A-Za-z0-9_-]+)\/?$/.exec(pathname ?? "")?.[1];
	return id && id !== "new" ? id : undefined;
}

/**
 * THE FAG CHIP (NTNU round): a session started from a fag shows its
 * fagkode in the bar, as a link back to the fag page. The bar reads the
 * link itself from the session list (the one payload that carries
 * `course`), keyed by the route, so no surface has to thread a prop.
 * Renders nothing until the answer is in, and nothing for a free session.
 */
function SessionCourseChip({ chatId }: { chatId: string }) {
	const [link, setLink] = useState<{ code: string; main: boolean } | null>(null);
	const [revision, setRevision] = useState(0);
	// «Flytt til fag» links a session after birth: the list-shape event
	// brings the chip (and the menu) in without a reload.
	useServerEvent("chats-changed", () => setRevision((r) => r + 1));
	useEffect(() => {
		let live = true;
		fetch("/api/chats", { cache: "no-store" })
			.then((res) => res.json() as Promise<{ chats?: ChatListItem[] }>)
			.then((body) => {
				const chat = body.chats?.find((c) => c.id === chatId);
				if (live) setLink(chat?.course ? { code: chat.course.code, main: isCourseMainChat(chat) } : null);
			})
			.catch(() => { /* no chip is the honest fallback */ });
		return () => { live = false; };
	}, [chatId, revision]);
	if (!link) return null;
	return (
		<>
			<CourseLinkChip code={link.code} />
			{/* The fag-chat's own menu (fase 2: «Ny underchat»). */}
			{link.main && <CourseChatMenu code={link.code} chatId={chatId} />}
		</>
	);
}

export function TopBar({
	drag = true,
	onMouseDown,
	children,
}: {
	drag?: boolean;
	onMouseDown?: React.MouseEventHandler<HTMLElement>;
	children?: ReactNode;
}) {
	const chatId = chatIdFromPath(usePathname());
	return (
		<header
			onMouseDown={onMouseDown}
			className={`${drag ? "lh-drag " : ""}lh-wco-gutter flex h-15 select-none items-center gap-3 border-b border-border px-3`}
		>
			<SidebarToggle />
			{chatId && <SessionCourseChip key={chatId} chatId={chatId} />}
			{children}
		</header>
	);
}
