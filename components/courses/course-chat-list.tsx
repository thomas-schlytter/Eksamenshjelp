"use client";

import Link from "next/link";
import { MessageSquareIcon, PlusIcon } from "lucide-react";
import { sessionMeta } from "@/components/sidebar";
import { Spinner } from "@/components/ui/pending";
import { cn } from "@/lib/utils";
import type { ChatListItem, CourseChatGroup } from "@/src/core";
import { newSubChatHref } from "./course-chats";

const ROW = "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left font-ui text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * THE FAG'S CHATS on the fag page (fase 2): the fag-chat first, then the
 * underchats, each with when it was last active. Deliberately simple: the
 * fag page is redesigned later. Pure (props in, markup out); `group` null
 * means the list is not loaded yet.
 */
export function CourseChatList({ code, group, onOpenMain, opening = false }: {
	code: string;
	group: CourseChatGroup<ChatListItem> | null;
	/** Open the fag-chat, creating it the first time. */
	onOpenMain: () => void;
	/** The fag-chat is being opened. */
	opening?: boolean;
}) {
	return (
		<section data-tour="course-chats" data-testid="course-chats" aria-labelledby="course-chats-title" className="rounded-2xl border bg-card p-3">
			<div className="mb-1 flex items-center justify-between gap-2 px-2">
				<h2 id="course-chats-title" className="font-ui text-sm font-semibold">Chatter</h2>
				<Link
					href={newSubChatHref(code)}
					data-testid="course-chats-new-sub"
					className="flex items-center gap-1 rounded-md px-2 py-1 font-ui text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
				>
					<PlusIcon className="size-3.5" aria-hidden="true" />
					Ny underchat
				</Link>
			</div>
			<ul className="flex flex-col">
				<li>
					{group?.main ? (
						<Link href={`/chat/${group.main.id}`} data-testid="course-chat-main" className={ROW}>
							<MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							<span className="min-w-0 flex-1 truncate font-medium">Fag-chat</span>
							<span className="shrink-0 text-xs text-muted-foreground">{sessionMeta(group.main)}</span>
						</Link>
					) : (
						<button type="button" onClick={onOpenMain} disabled={opening || group === null} aria-busy={opening || undefined} data-testid="course-chat-main" className={cn(ROW, "cursor-pointer disabled:cursor-default disabled:opacity-60")}>
							{opening
								? <Spinner className="size-4 shrink-0 text-muted-foreground" />
								: <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
							<span className="min-w-0 flex-1 truncate font-medium">Fag-chat</span>
							<span className="shrink-0 text-xs text-muted-foreground">{group === null ? "Laster …" : "Ikke startet"}</span>
						</button>
					)}
				</li>
				{group?.subs.map((chat) => (
					<li key={chat.id}>
						<Link href={`/chat/${chat.id}`} data-testid="course-chat-sub" className={cn(ROW, "pl-9")}>
							<span className="min-w-0 flex-1 truncate font-prose">{chat.title}</span>
							<span className="shrink-0 text-xs text-muted-foreground">{sessionMeta(chat)}</span>
						</Link>
					</li>
				))}
			</ul>
		</section>
	);
}
