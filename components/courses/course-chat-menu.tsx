"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, MessageSquarePlusIcon } from "lucide-react";
import { MenuShell } from "@/components/menu-shell";
import { newSubChatHref } from "./course-chats";

/**
 * THE FAG-CHAT MENU in the top bar (fase 2): the fag-chat's own actions,
 * beside the fag chip. Today one: «Ny underchat». The list is data —
 * another action is one more entry in `courseChatMenuItems` (an `href` to
 * open, or an `onSelect` to run).
 */
export interface CourseChatMenuItem {
	id: string;
	label: string;
	icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
	/** Open this route. */
	href?: string;
	/** Or run this. */
	onSelect?: () => void;
}

/** The menu's entries for a fag's fag-chat. Pure — exported for tests. */
export function courseChatMenuItems(ctx: { code: string; chatId: string }): CourseChatMenuItem[] {
	return [
		{ id: "new-sub-chat", label: "Ny underchat", icon: MessageSquarePlusIcon, href: newSubChatHref(ctx.code) },
	];
}

export function CourseChatMenu({ code, chatId }: { code: string; chatId: string }) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const items = courseChatMenuItems({ code, chatId });

	// The menu contract (the sidebar's): an outside pointerdown closes it;
	// Esc is claimed so it never also aborts a turn.
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (target instanceof Element && target.closest("[data-lh-menu]")) return;
			if (anchorRef.current?.contains(target)) return;
			setOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			setOpen(false);
			anchorRef.current?.focus();
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	return (
		<>
			<button
				ref={anchorRef}
				type="button"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label={`Valg for fag-chatten i ${code}`}
				data-testid="course-chat-menu"
				onClick={() => setOpen((v) => !v)}
				className="-ml-2 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
			>
				<ChevronDownIcon className="size-3.5" aria-hidden="true" />
			</button>
			{open && (
				<MenuShell
					anchorRef={anchorRef}
					testid="course-chat-menu-body"
					preferredSide="down"
					align="left"
					menuClass="flex w-52 flex-col gap-0.5 rounded-xl border bg-card p-2 text-xs shadow-xl"
				>
					{items.map((item) => (
						<button
							key={item.id}
							type="button"
							role="menuitem"
							data-testid={`course-chat-menu-${item.id}`}
							onClick={() => {
								setOpen(false);
								if (item.href) router.push(item.href);
								item.onSelect?.();
							}}
							className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent"
						>
							<item.icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
							{item.label}
						</button>
					))}
				</MenuShell>
			)}
		</>
	);
}
