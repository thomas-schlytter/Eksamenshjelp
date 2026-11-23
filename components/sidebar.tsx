"use client";

import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MenuShell } from "@/components/menu-shell";
import { DeleteSessionDialog } from "@/components/delete-session-dialog";
import { groupChatsByCourse, type ChatDeleteMode, type CourseChatGroup } from "@/src/core";
import {
	ChevronRightIcon, CircleHelpIcon, HomeIcon, NetworkIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, PlusIcon, SearchIcon, SettingsIcon,
} from "lucide-react";
import { ActivitySection } from "@/components/activity-dock";
import { CoverageMenuBlock } from "@/components/extraction-coverage";
import { LhMark } from "@/components/lh-mark";
import { BrailleSpinner } from "@/components/braille-spinner";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { SettingsDialogProvider, useSettingsDialog } from "@/components/settings/settings-dialog.tsx";
import { Hint } from "@/components/ui/hint";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AUTHOR_NAME, AUTHOR_URL, UPSTREAM_NAME, UPSTREAM_URL } from "@/lib/credits";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { moveChatToCourse, newSubChatHref, openCourseChatId } from "@/components/courses/course-chats";
import type { ChatListItem } from "@/src/core";
import { kbdEventForAction } from "@/src/core";
import { notifySettingsSaved } from "@/components/settings-signal";
import { daysLeftLabel, daysLeftShort, sortCoursesByExam } from "@/components/courses/course-format";
import type { CourseSummary } from "@/components/courses/course-types";
import { TopicStatusBar } from "@/components/courses/status-ui";
import { useCourseSummaries } from "@/components/courses/use-courses";

/**
 * Toggleable sidebar — NOT a modal drawer: no backdrop, no focus theft. It
 * sits inline next to the content and can stay open while working in a
 * session. Open state persists across pages (provider lives in the root
 * layout) and across reloads (localStorage).
 */

const STORAGE_KEY = "lh:sidebar-open";

/*
 * Narrow-window behavior (owner, 2026-09-17): below SIDEBAR_AUTOCLOSE the
 * sidebar would squeeze the page below the 640px window floor (the two
 * numbers compose: 640 + 288 sidebar = 928), so it auto-closes — and
 * auto-RESTORES when the window widens again (owner choice: the sidebar
 * pops back, not a manual re-open). The whole behavior is one expression:
 * rendered = pref && !narrow, where pref is the persisted user choice.
 * Manual closes persist and stay closed; auto-close does not touch the
 * preference. Opening the sidebar while narrow asks the Electron shell to
 * widen the window to the threshold (window.lh.expandWindow, IPC in
 * electron/main.cjs) — the resize listener flips `narrow` and the sidebar
 * appears. In the plain browser there is no window to widen and no
 * suppression — a narrow tab opens the sidebar if the user says so.
 *
 * Mirrors SIDEBAR_AUTOCLOSE in electron/main.cjs — keep in sync.
 */
import type { ChatGPTControlBridge, NativeSubscriptionControlBridge } from "@/src/core";
import type { UpdateState } from "@/components/settings/update-settings.tsx";
import { FilePathDropZone } from "@/components/file-path-drop-zone";
const SIDEBAR_AUTOCLOSE = 928;

// Module scope, guarded for SSR (the server has no navigator).
const IS_ELECTRON = typeof navigator !== "undefined" && navigator.userAgent.includes("Electron");

declare global {
	interface Window {
		/** Preload bridge (electron/preload.cjs) — Electron only, absent in the browser. */
		lh?: {
			/** Read-only host OS; determines the native-control gutter. */
			platform?: string;
			/** Resolve an OS-backed File without copying/uploading its contents. */
			getPathForFile?: (file: File) => string;
			/** External Next desktop-dev uses the server's web connections. */
			subscriptionTransport?: "desktop" | "web";
			openSubscriptionBrowser?: (action: string) => Promise<void>;
			chatgpt?: ChatGPTControlBridge;
			subscriptions?: NativeSubscriptionControlBridge;
			expandWindow: () => void;
			/** The zoom truth (owner round 7): subscribes to "lh:zoom" pushes; returns unsubscribe. */
			onZoom?: (cb: (factor: number) => void) => () => void;
			getZoom?: () => Promise<number>;
			/** Observational update events and a snapshot for late subscribers. */
			onUpdateStatus?: (cb: (status: UpdateState) => void) => () => void;
			getUpdateState?: () => Promise<UpdateState>;
			/** Explicit manual release check (GitHub), even with automatic checks off. */
			checkForUpdates?: () => Promise<void>;
			onOpenSettings?: (cb: (section: string) => void) => () => void;
		};
	}
}

const SidebarContext = createContext<{ open: boolean; toggle: () => void }>({
	open: false,
	toggle: () => {},
});

export function useSidebar() {
	return useContext(SidebarContext);
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
	useEffect(() => {
		const bridge = window.lh?.chatgpt;
		if (!bridge) return;
		const off = bridge.onChange(() => notifySettingsSaved("keys"));
		notifySettingsSaved("keys"); // cover changes missed before this root-lifetime subscription
		return off;
	}, []);
	// Start closed so server and client first-render agree (no hydration
	// mismatch); the stored value is applied after mount.
	const [open, setOpen] = useState(false);
	const [narrow, setNarrow] = useState(false);
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		// Electron shell detection (merged chrome, 2026-09-17): keys the
		// .lh-electron CSS (app/globals.css) that turns the header bands
		// into the window's drag surface. Post-mount only — server HTML
		// and first client render must agree (no hydration mismatch),
		// and in the plain browser the class never appears.
		if (IS_ELECTRON) {
			document.documentElement.classList.add("lh-electron");
			document.documentElement.dataset.lhPlatform = window.lh?.platform ?? "";
		}

		// THE ZOOM TRUTH (owner round 7, 2026-10-05): ⌘±/⌘0 zoom the UI
		// (Electron zoomFactor) while the native traffic lights stay
		// physical-fixed — the CSS gutter lengths divide by this factor so
		// their RENDERED size never moves. getZoom covers the first-paint
		// race; every later change arrives as an lh:zoom push.
		const setZoomVar = (factor: number) =>
			document.documentElement.style.setProperty("--lh-zoom", String(factor));
		const off = window.lh?.onZoom?.(setZoomVar);
		void window.lh?.getZoom?.().then(setZoomVar);

		const stored = localStorage.getItem(STORAGE_KEY);
		// Default: open (first run introduces the sidebar).
		setOpen(stored === null ? true : stored === "1");
		setMounted(true);
		return () => off?.();
	}, []);

	// Narrow-window auto-close/auto-restore (see SIDEBAR_AUTOCLOSE note):
	// fires only on actual resizes — a boolean compare, no layout work.
	// Both this and the mount effect land before the first paint, so a
	// narrow window never flashes the open sidebar on load.
	useEffect(() => {
		if (!IS_ELECTRON) return; // plain-browser tabs open freely
		const onResize = () => setNarrow(window.innerWidth < SIDEBAR_AUTOCLOSE);
		onResize();
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	const toggle = useCallback(() => {
		// Opening while narrow (auto-closed, or the user's own closed-at-
		// narrow): ask the shell to widen to the threshold — the resize
		// listener flips `narrow` and the sidebar appears. The preference
		// persists like any other open, so a restart at a narrow width
		// still auto-restores when widened.
		if (narrow && !open) {
			localStorage.setItem(STORAGE_KEY, "0");
			setOpen(true);
			window.lh?.expandWindow();
			return;
		}
		setOpen((v) => {
			localStorage.setItem(STORAGE_KEY, v ? "0" : "1");
			return !v;
		});
	}, [narrow, open]);

	// ⌘B: the global shortcut dispatches kbdEventForAction("toggle-sidebar")
	// and the context answers on exactly that name — the shared spelling
	// is the fix for the interlude bug (the listener sat on the pre-
	// convention name "lh:toggle-sidebar" while the dispatcher sent
	// "lh:kbd-toggle-sidebar", so ⌘B silently did nothing; owner
	// 2026-09-25).
	useEffect(() => {
		const event = kbdEventForAction("toggle-sidebar");
		const onToggle = () => toggle();
		window.addEventListener(event, onToggle);
		return () => window.removeEventListener(event, onToggle);
	}, [toggle]);

	// A stable value: consumers (every SidebarToggle, the help layer) only
	// re-render when open/toggle actually change.
	const shown = open && !narrow;
	const value = useMemo(() => ({ open: shown, toggle }), [shown, toggle]);

	return (
		<SidebarContext.Provider value={value}>
			{/* transitions gated on mount: no slide-in flash on page load.
			    overflow-clip: the shell is exactly one viewport and never
			    scrolls itself — every page owns its own scroller. Without it,
			    anything that escapes a page's scroller (an absolutely
			    positioned sr-only label whose containing block is <main>)
			    made the document scrollable: a second scrollbar. clip, not
			    hidden: a clip box is not a scroll container, so
			    scrollIntoView (tours, keyboard selection) cannot shift the
			    whole app sideways or up. */}
			<div className={cn("flex h-dvh overflow-clip", mounted && "[&_.sidebar-motion]:transition-[width,margin,opacity] [&_.sidebar-slide]:transition-[translate,visibility]")}>{children}</div>
		</SidebarContext.Provider>
	);
}

/** Hamburger for page headers — only visible when the sidebar is closed.
 *
 *  Owner, round 6c: the toggle is ALWAYS MOUNTED, owning a slot whose
 *  width+margin animate in LOCKSTEP with the sidebar's own width
 *  transition (same duration-200, same easing, both gated on mount) —
 *  before, it mounted/unmounted in one frame, so its 48px footprint
 *  (button + gap) popped and dragged the title and chips sideways while
 *  the sidebar was still mid-slide. When open the slot is exactly zero
 *  (w-0 -mr-3: width 0, the negative margin cancels the header's gap-3),
 *  so resting layouts are pixel-identical to the old conditional render.
 *  The icon fades with the slot and is clipped by it as it collapses —
 *  no popping in either direction. */
export function SidebarToggle() {
	const { open, toggle } = useSidebar();
	return (
		<span
			className={cn(
				"sidebar-motion lh-no-drag relative flex h-9 shrink-0 overflow-hidden duration-200",
				open ? "w-0 -mr-3" : "w-9 mr-0 lh-closed-toggle",
			)}
		>
			<Hint label="Åpne sidemenyen" action="toggle-sidebar">
			<Button
				variant="ghost"
				size="icon"
				aria-label="Åpne sidemenyen"
				aria-hidden={open}
				tabIndex={open ? -1 : 0}
				onClick={toggle}
				className={cn("sidebar-motion duration-200", open ? "pointer-events-none opacity-0" : "opacity-100")}
			>
				{/* Owner, round 6: size-4, SAME as the close glyph — the toggle
				    must not grow when the sidebar is closed (it did: size-5 here).
				    The small look is the standard, both directions. */}
				<PanelLeftOpenIcon className="size-4" />
			</Button>
			</Hint>
		</span>
	);
}

/**
 * The row's status indicator (owner, minimal-color round): the braille
 * spinner, ONLY while a teach turn is in flight — monochrome motion, the
 * terminal's own glyph, existing exactly as long as the work does and
 * vanishing the moment it ends. Every other state renders NOTHING:
 * phases only advance (all sessions end in Teaching — phase-as-signal was
 * decoration, now retired app-wide), and question-pending is the dominant
 * RESTING state of real sessions — a resting state has no scan value, so
 * the meta line's "Waiting for input" text carries it. Idle is the
 * absence of a signal, by design.
 */
function SessionStatus({ busy }: { busy: boolean }) {
	if (!busy) return null;
	return <BrailleSpinner />;
}

/** Compact "how long ago": "akkurat nå", "5 min siden", "3 t siden", "2 d siden",
 *  then a plain date. How long a session has been WAITING matters more
 *  than an absolute timestamp. Beyond a week the date renders ISO
 *  (YYYY-MM-DD, zero-padded) — the international standard: unambiguous
 *  in any locale and it sorts (owner, typography round 5; the old
 *  M/D/YYYY was the US convention. A user-locale setting can come later
 *  — trivial, a format function swap). Pure — exported for tests. */
export function timeAgo(iso: string, now = new Date()): string {
	const ms = now.getTime() - new Date(iso).getTime();
	if (ms < 60_000) return "akkurat nå";
	const min = Math.floor(ms / 60_000);
	if (min < 60) return `${min} min siden`;
	const h = Math.floor(min / 60);
	if (h < 24) return `${h} t siden`;
	const d = Math.floor(h / 24);
	if (d < 7) return `${d} d siden`;
	const date = new Date(iso);
	const mm = String(date.getMonth() + 1).padStart(2, "0");
	const dd = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${mm}-${dd}`;
}

/** The row's second line: the state when a state exists (waiting/working),
 *  otherwise just how long ago. The message count is DROPPED (owner,
 *  typography round 5): it informed no decision — clutter. messageCount
 *  still rides the API payload, so this is a one-line flip back if it's
 *  ever wanted. Exported: the fag page's chat list says the same. */
export function sessionMeta(chat: ChatListItem): string {
	if (chat.compacting) return `Komprimerer kontekst · ${timeAgo(chat.updatedAt)}`;
	if (chat.pendingQuestion) return `Venter på svar · ${timeAgo(chat.updatedAt)}`;
	if ((chat.kind ?? "teach") === "practice" && chat.pendingProblem) {
		return `Oppgave venter · ${timeAgo(chat.updatedAt)}`;
	}
	if (chat.busy) return "Arbeider…";
	return timeAgo(chat.updatedAt);
}

/**
 * One session row (the «Uten fag» list): the status spinner (only while
 * working), then title + state-aware meta. Fase 2: no kind badges — the
 * Læring/Øving split is gone from the UI, and a fag's sessions list
 * under the fag. Exported for render tests — pure function of the item.
 */
export function SessionRow({
	chat,
	active,
	onOpen,
	onContextMenu,
}: {
	chat: ChatListItem;
	active: boolean;
	onOpen: () => void;
	/** Right-click opens the context menu (Rename / Move / Export / Delete). */
	onContextMenu?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
	return (
		<button
			type="button"
			onClick={onOpen}
			onContextMenu={onContextMenu}
			aria-current={active ? "page" : undefined}
			data-testid="session-row"
			className={cn(
				"relative mb-0.5 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent",
				active && "bg-accent",
			)}
		>
			<SessionStatus busy={chat.busy || chat.compacting} />
			<span className="min-w-0 flex-1">
				{/* Titles are the learner's/teacher's WORDS — the prose face;
				    the meta line below stays the UI face (machine data). */}
				<span className="block truncate font-prose text-(length:--lh-prose-size)">{chat.title}</span>
				<span className="block text-xs text-muted-foreground">{sessionMeta(chat)}</span>
			</span>
		</button>
	);
}

/**
 * One chat under a fag (fase 2): the fag-chat («Fag-chat») or an
 * underchat (its title). One line, like the approved sketch; the state
 * line rides the tooltip. The spinner still shows a running turn.
 */
export function CourseChatRow({
	chat,
	label,
	active,
	onOpen,
	onContextMenu,
}: {
	chat: ChatListItem;
	/** Overrides the title (the fag-chat reads «Fag-chat»). */
	label?: string;
	active: boolean;
	onOpen: () => void;
	onContextMenu?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
	return (
		<button
			type="button"
			onClick={onOpen}
			onContextMenu={onContextMenu}
			title={sessionMeta(chat)}
			aria-current={active ? "page" : undefined}
			data-testid={label ? "course-main-chat" : "course-sub-chat"}
			className={cn(SUB_ROW, active && "bg-accent text-foreground")}
		>
			<span className="min-w-0 flex-1 truncate">{label ?? chat.title}</span>
			<SessionStatus busy={chat.busy || chat.compacting} />
		</button>
	);
}

/** The inline-rename row (wave 6): same geometry as SessionRow, but the
 *  title line becomes a text input — select-all on entry (the click means
 *  "replace", the header rename's rule), Enter/blur commits, Esc discards.
 *  The meta line stays so the row never changes height mid-edit. */
export function RenameRow({ chat, onCommit, onCancel }: { chat: ChatListItem; onCommit: (next: string) => void; onCancel: () => void }) {
	const [draft, setDraft] = useState(chat.title);
	const inputRef = useRef<HTMLInputElement | null>(null);
	useEffect(() => {
		const el = inputRef.current;
		if (el) {
			el.focus();
			el.select();
		}
	}, []);
	return (
		<div
			data-testid="session-rename-row"
			className="relative mb-0.5 flex w-full items-center rounded-lg bg-accent px-3 py-2"
		>
			{/* NOTHING MOVES (owner, polish round): the input here is
			    borderless and padding-free at the exact title x; the
			    underline is the only editing cue. */}
			<span className="flex min-w-0 w-full flex-col">
				<input
					ref={inputRef}
					value={draft}
					spellCheck={false}
					onChange={(e) => setDraft(e.target.value)}
					onBlur={() => onCommit(draft)}
					onKeyDown={(e) => {
						if (e.key === "Enter") e.currentTarget.blur();
						if (e.key === "Escape") {
							e.stopPropagation(); // discard, not also the sidebar/chat chains
							onCancel();
						}
					}}
					aria-label="Gi økta nytt navn"
					data-testid="session-rename-input"
					className="lh-input w-full min-w-0 truncate border-0 border-b border-border bg-transparent px-0 text-foreground outline-none"
				/>
				<span className="block truncate text-xs text-muted-foreground">{sessionMeta(chat)}</span>
			</span>
		</div>
	);
}

/** The window event that opens «Legg til fag» on the home screen. */
export const ADD_COURSE_EVENT = "lh:add-course";

const CREDIT_LINK = "rounded-sm underline-offset-2 outline-none hover:text-muted-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50";
/** The panel's slide (duration-200 on .sidebar-slide); the list refetch
 *  on open waits this long so it never lands mid-animation. */
const SIDEBAR_SLIDE_MS = 200;
const NAV_ROW = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 font-ui text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50";
const SUB_ROW = "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left font-ui text-[13px] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50";
const SECTION_LABEL = "px-2 text-xs uppercase tracking-widest text-muted-foreground/70";
const ICON_BUTTON = "flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50";
const MENU_ITEM = "flex items-center rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent";

/** A thin line between the sidebar's sections. */
function SidebarDivider() {
	return <div className="mx-5 my-2 border-t border-border" aria-hidden="true" />;
}

/** Which fag a route belongs to: the fag page, or a chat linked to a fag
 *  that still exists. Pure — exported for tests. */
export function activeCourseCode(
	pathname: string | null | undefined,
	chats: readonly Pick<ChatListItem, "id" | "course">[] | null,
	courseCodes: readonly string[],
): string | undefined {
	const page = /^\/fag\/([^/]+)/.exec(pathname ?? "")?.[1];
	if (page) return decodeURIComponent(page);
	const chatId = /^\/chat\/([A-Za-z0-9_-]+)\/?$/.exec(pathname ?? "")?.[1];
	const code = chatId ? chats?.find((c) => c.id === chatId)?.course?.code : undefined;
	return code && courseCodes.includes(code) ? code : undefined;
}

/** What one chat row needs from the sidebar (the rename row swaps in). */
export type ChatRowRenderer = (chat: ChatListItem, label?: string) => React.ReactNode;

/**
 * THE FAG SECTION (fase 2: one chat per fag). Every fag as a row with its
 * fagkode, the topic colours and the days left, nearest exam first. The
 * row opens the fag-chat. Under the active fag (or one the learner
 * unfolded) sit the fag-chat and the underchats, indented on a thin line;
 * the chevron folds a fag in and out, and the «+» that shows on hover
 * starts an underchat. Pure (props in, markup out) for the render pins.
 */
export function SidebarCourses({ courses, groups, activeCode, activeChatId, expanded, onToggle, onOpenCourse, onOpenMainChat, renderChat, onAdd }: {
	courses: readonly CourseSummary[] | null;
	groups: ReadonlyMap<string, CourseChatGroup<ChatListItem>>;
	/** The fag the open page belongs to, if any. */
	activeCode?: string;
	/** The open chat, if any. */
	activeChatId?: string;
	/** Is the fag unfolded? */
	expanded: (code: string) => boolean;
	onToggle: (code: string) => void;
	/** Open the fag: its fag-chat, created the first time. */
	onOpenCourse: (code: string) => void;
	/** The «Fag-chat» row of a fag that has none yet. */
	onOpenMainChat: (code: string) => void;
	renderChat: ChatRowRenderer;
	onAdd?: () => void;
}) {
	return (
		<nav aria-label="Fag" data-tour="sidebar-courses" data-testid="sidebar-courses" className="mx-3">
			<div className="mb-0.5 flex items-center justify-between pr-1">
				<span className={SECTION_LABEL}>Fag</span>
				{/* The query opens the panel on arrival; the click's event opens it
				    when home is already showing (same URL, no navigation). */}
				<Hint label="Legg til fag" side="right">
					<Link href="/?leggtil=1" onClick={onAdd} aria-label="Legg til fag" data-testid="sidebar-add-course" className={ICON_BUTTON}>
						<PlusIcon className="size-3.5" aria-hidden="true" />
					</Link>
				</Hint>
			</div>
			{courses !== null && courses.length === 0 && (
				<p className="px-2 py-1 font-ui text-xs text-muted-foreground">Ingen fag ennå.</p>
			)}
			<ul>
				{sortCoursesByExam(courses ?? []).map((course) => {
					const group = groups.get(course.code) ?? { main: null, subs: [] };
					const open = expanded(course.code);
					const active = activeCode === course.code;
					return (
						<li key={course.code} data-testid="sidebar-course-group" data-expanded={open || undefined}>
							<div
								className={cn(
									"group/course flex items-center rounded-md transition-colors hover:bg-accent",
									active && "bg-accent",
								)}
							>
								<button
									type="button"
									onClick={() => onToggle(course.code)}
									aria-expanded={open}
									aria-label={open ? `Skjul chattene i ${course.code}` : `Vis chattene i ${course.code}`}
									data-testid="sidebar-course-toggle"
									className={cn(ICON_BUTTON, "hover:bg-transparent")}
								>
									<ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden="true" />
								</button>
								<button
									type="button"
									onClick={() => onOpenCourse(course.code)}
									title={`${course.code} ${course.name}. ${daysLeftLabel(course.daysLeft)}.`}
									aria-current={active && !activeChatId ? "page" : undefined}
									data-testid="sidebar-course"
									className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-1 text-left font-ui text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
								>
									<span className="w-[4.5rem] shrink-0 truncate font-medium tabular-nums">{course.code}</span>
									<span className="sr-only">{course.name}. {daysLeftLabel(course.daysLeft)}.</span>
									<TopicStatusBar counts={course.counts} className="min-w-0 flex-1" />
								</button>
								<Hint label="Ny underchat" side="right">
									<Link
										href={newSubChatHref(course.code)}
										aria-label={`Ny underchat i ${course.code}`}
										data-testid="sidebar-new-sub-chat"
										className={cn(ICON_BUTTON, "opacity-0 group-hover/course:opacity-100 focus-visible:opacity-100")}
									>
										<PlusIcon className="size-3.5" aria-hidden="true" />
									</Link>
								</Hint>
								<span className="w-9 shrink-0 pr-2 text-right font-ui text-xs tabular-nums text-muted-foreground" aria-hidden="true">
									{daysLeftShort(course.daysLeft)}
								</span>
							</div>
							{open && (
								<ul data-testid="sidebar-course-chats" className="mb-1 ml-[1.1rem] flex flex-col gap-0.5 border-l border-border py-0.5 pl-2">
									<li>
										{group.main ? (
											renderChat(group.main, "Fag-chat")
										) : (
											<button
												type="button"
												onClick={() => onOpenMainChat(course.code)}
												data-testid="course-main-chat"
												className={SUB_ROW}
											>
												<span className="min-w-0 flex-1 truncate">Fag-chat</span>
											</button>
										)}
									</li>
									{group.subs.map((chat) => <li key={chat.id}>{renderChat(chat)}</li>)}
								</ul>
							)}
						</li>
					);
				})}
			</ul>
		</nav>
	);
}

/** Expanded state per fag: an explicit fold wins; otherwise the active fag
 *  is open and the rest are folded. Pure — exported for tests. */
export function courseExpanded(overrides: Readonly<Record<string, boolean>>, code: string, activeCode?: string): boolean {
	return overrides[code] ?? code === activeCode;
}

function SessionsSidebar() {
	const { open, toggle } = useSidebar();
	const [chats, setChats] = useState<ChatListItem[] | null>(null);
	const pathname = usePathname();
	const router = useRouter();
	const { open: openSettings } = useSettingsDialog();
	// The fag list (NTNU round): kept fresh by `courses-changed`, which a
	// topic_status call and the end-of-økt update both send (fase 2: from
	// the fag-chat, an underchat and a moved session alike).
	const { courses } = useCourseSummaries();
	const courseCodes = useMemo(() => (courses ?? []).map((c) => c.code), [courses]);
	const grouped = useMemo(() => groupChatsByCourse(chats ?? [], courseCodes), [chats, courseCodes]);
	const activeCode = activeCourseCode(pathname, chats, courseCodes);
	const activeChatId = /^\/chat\/([A-Za-z0-9_-]+)\/?$/.exec(pathname ?? "")?.[1];

	// Folding (fase 2): explicit choices per fag, for this window's life.
	const [folds, setFolds] = useState<Record<string, boolean>>({});
	const isExpanded = useCallback((code: string) => courseExpanded(folds, code, activeCode), [folds, activeCode]);
	const toggleCourse = useCallback((code: string) => {
		setFolds((prev) => ({ ...prev, [code]: !courseExpanded(prev, code, activeCode) }));
	}, [activeCode]);

	const refreshInFlightRef = useRef(false);
	const loadedRef = useRef(false);
	const refresh = useCallback(async () => {
		// In-flight coalesce (S6): event bursts may land several refresh
		// calls at once — one fetch serves them all; anything newer arrives
		// with the next event's fetch.
		if (refreshInFlightRef.current) return;
		refreshInFlightRef.current = true;
		try {
			const res = await fetch("/api/chats", { cache: "no-store" });
			const d = (await res.json()) as { chats: ChatListItem[] };
			setChats(d.chats);
			loadedRef.current = true;
		} catch {
			// a transient failure keeps the last snapshot
			setChats((prev) => prev ?? []);
		} finally {
			refreshInFlightRef.current = false;
		}
	}, []);

	/* Open a fag = open its fag-chat (fase 2). The list knows it when it
	   exists; otherwise the server finds or creates it (one per fag, also
	   under two quick clicks). Clicking a fag also unfolds it again. */
	const openingRef = useRef(false);
	const openMainChat = useCallback((code: string) => {
		if (openingRef.current) return;
		openingRef.current = true;
		void openCourseChatId(code, fetch)
			.then((chat) => {
				router.push(`/chat/${chat.id}`);
				void refresh();
			})
			.catch((err) => console.error("fag-chat failed:", err))
			.finally(() => { openingRef.current = false; });
	}, [router, refresh]);
	const openCourse = useCallback((code: string) => {
		setFolds((prev) => {
			if (!(code in prev)) return prev;
			const next = { ...prev };
			delete next[code];
			return next;
		});
		const main = grouped.byCourse.get(code)?.main;
		if (main) router.push(`/chat/${main.id}`);
		else openMainChat(code);
	}, [grouped, router, openMainChat]);

	/* Instant rename propagation (2026-09-17): the chat header's rename
	   commits dispatch lh:chat-renamed; patch the snapshot in place instead
	   of waiting for the 2.5s poll. */
	useEffect(() => {
		const onRenamed = (e: Event) => {
			const { id, title } = (e as CustomEvent<{ id: string; title: string }>).detail;
			setChats((prev) => (prev ? prev.map((c) => (c.id === id ? { ...c, title } : c)) : prev));
		};
		window.addEventListener("lh:chat-renamed", onRenamed);
		return () => window.removeEventListener("lh:chat-renamed", onRenamed);
	}, []);

	/* INSTANT TURN-STATE (owner, sidebar round 2026-10-02): the open
	   session broadcasts lh:turn-state the instant its turn starts
	   (submitted — the optimistic machine's own flip) and at settle —
	   busy mirrors the server's own definition (isTurnRunning), so the
	   patch is exact: spinner up the moment the action happens, cleared
	   and refetched once at settle (title/order move with turns). The
	   events channel is the backstop for everything only the server
	   knows: other windows, wake turns in unopened sessions. A start on
	   a chat not yet in the snapshot (a brand-new session) = one
	   immediate refresh instead of a patch. */
	const chatsRef = useRef(chats);
	chatsRef.current = chats;
	useEffect(() => {
		const onTurnState = (e: Event) => {
			const { id, running } = (e as CustomEvent<{ id: string; running: boolean }>).detail;
			if (running) {
				if (chatsRef.current?.some((c) => c.id === id)) {
					setChats((prev) => (prev ? prev.map((c) => (c.id === id ? { ...c, busy: true } : c)) : prev));
				} else {
					void refresh(); // the brand-new session: it isn't in the snapshot yet
				}
				return;
			}
			setChats((prev) => (prev ? prev.map((c) => (c.id === id ? { ...c, busy: false } : c)) : prev));
			void refresh(); // settle: the server snapshot is now truthful — land it now
		};
		window.addEventListener("lh:turn-state", onTurnState);
		return () => window.removeEventListener("lh:turn-state", onTurnState);
	}, [refresh]);

	/* PUSH (architecture S6, 2026-10-02): the 2.5s poll is RETIRED — the
	   last standing network poll in the app. List truth arrives as
	   events: chats-changed (create/rename/delete/move — the list-SHAPE
	   writes), and turn-started/turn-settled for EVERY chat (unfiltered:
	   any chat's turn flips busy/order/phase in this list). Announced
	   fetches ride the 250ms trailing debounce (the S4/S5 law); resync
	   (reconnect / dev-restart) is immediate. lh:turn-state +
	   lh:chat-renamed stay for same-tab INSTANTS — local beats any
	   round-trip. */
	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;
	const eventDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const scheduleEventRefresh = () => {
		if (eventDebounceRef.current) clearTimeout(eventDebounceRef.current);
		eventDebounceRef.current = setTimeout(() => {
			eventDebounceRef.current = undefined;
			void refreshRef.current();
		}, 250);
	};
	useServerEvent("chats-changed", scheduleEventRefresh);
	useServerEvent("turn-started", scheduleEventRefresh);
	useServerEvent("turn-settled", scheduleEventRefresh);
	useServerEvent("compaction-changed", scheduleEventRefresh);
	useServerResync(() => void refreshRef.current());
	useEffect(
		() => () => {
			if (eventDebounceRef.current) clearTimeout(eventDebounceRef.current);
		},
		[],
	);

	/* The old session search's shortcut (⌘⇧F): the search box is gone
	   (fase 2: «Søk i appen» covers search), so the shortcut opens it. */
	useEffect(() => {
		const onFocusSearch = () => window.dispatchEvent(new CustomEvent("lh:open-help"));
		window.addEventListener("lh:kbd-sessions-search", onFocusSearch);
		return () => window.removeEventListener("lh:kbd-sessions-search", onFocusSearch);
	}, []);

	/* ── Wave 6 chunk A: context menu + inline rename + deletion ──
	   Right-click a session row → MenuShell: the management actions
	   first (owner ruling), then — below a hairline — the extraction
	   coverage block. Fase 2 adds «Flytt til fag…» for a session without
	   a fag: it swaps the menu body for the list of fag. The anchor is the
	   row that was right-clicked — assigned into a ref before the state
	   flip so the shell measures it on its first (hidden) pass. */
	const [ctxChatId, setCtxChatId] = useState<string | null>(null);
	const [ctxStep, setCtxStep] = useState<"menu" | "move">("menu");
	const [moveError, setMoveError] = useState<string | null>(null);
	const [moving, setMoving] = useState(false);
	const ctxAnchorRef = useRef<HTMLElement | null>(null);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<ChatListItem | null>(null);

	const openContext = useCallback((e: React.MouseEvent<HTMLButtonElement>, chat: ChatListItem) => {
		e.preventDefault(); // suppress the native menu
		ctxAnchorRef.current = e.currentTarget;
		setCtxStep("menu");
		setMoveError(null);
		setCtxChatId(chat.id);
	}, []);

	// The menu contract (agent-section's): any pointerdown outside the menu
	// or its row closes it; Esc is CLAIMED so it never also aborts a turn
	// or folds the sidebar. Right-clicking another row re-anchors: its
	// pointerdown closes this menu, its contextmenu opens the next.
	useEffect(() => {
		if (ctxChatId === null) return;
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (target instanceof Element && target.closest("[data-lh-menu]")) return;
			if (ctxAnchorRef.current?.contains(target)) return;
			setCtxChatId(null);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				setCtxChatId(null);
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [ctxChatId]);

	// Inline rename (owner ruling, wave 6): the row swaps to a text input;
	// commit rides the SAME plumbing as the header rename — PUT the title,
	// then lh:chat-renamed patches every listener (this sidebar's own
	// listener patches the snapshot instantly; an open chat header hears
	// it too). Esc discards; empty commit discards (the header's rules).
	const commitRename = useCallback(async (id: string, next: string) => {
		setRenamingId(null);
		const t = next.trim();
		if (t === "") return;
		try {
			const res = await fetch(`/api/chats/${id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: t }),
			});
			if (!res.ok) throw new Error(`rename failed: ${res.status}`);
			window.dispatchEvent(new CustomEvent("lh:chat-renamed", { detail: { id, title: t } }));
		} catch (err) {
			console.error("rename failed:", err); // keep the old title
		}
	}, []);

	// «Flytt til fag…» (fase 2): the session becomes an underchat of the
	// fag; the server writes the fag's context into it and announces the
	// change (the list regroups on chats-changed; refreshed here at once).
	const moveToCourse = useCallback(async (chatId: string, code: string) => {
		setMoving(true);
		setMoveError(null);
		const error = await moveChatToCourse(chatId, code, fetch);
		setMoving(false);
		if (error) {
			setMoveError(error);
			return;
		}
		setCtxChatId(null);
		setFolds((prev) => ({ ...prev, [code]: true }));
		void refresh();
	}, [refresh]);

	// Delete success: patch the list instantly (the poll is the backstop),
	// navigate home if the open session died (the chat view unmounts —
	// drafts die with it, no orphan bubbles), and announce the graph
	// revision so the graph view refetches (deletion is the one writer
	// the status poll can't see — no run ever transitions some→none).
	const onDeleted = useCallback(
		(id: string, _mode: ChatDeleteMode, graphRevision: number) => {
			setDeleting(null);
			setChats((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
			if (pathname === `/chat/${id}`) router.push("/");
			window.dispatchEvent(new CustomEvent("lh:graph-revision", { detail: { revision: graphRevision } }));
		},
		[pathname, router],
	);

	// Opening + navigation refetch; while open, the events channel owns
	// freshness (S6) — no interval, nothing standing. On OPEN the fetch
	// (and the list re-render it causes) waits for the slide to finish so
	// the animation gets the main thread; navigation while open, and the
	// very first load (nothing to show yet), refetch at once.
	const wasOpenRef = useRef(false);
	useEffect(() => {
		if (!open) {
			wasOpenRef.current = false;
			return;
		}
		if (wasOpenRef.current || !loadedRef.current) {
			wasOpenRef.current = true;
			void refresh();
			return;
		}
		wasOpenRef.current = true;
		const timer = window.setTimeout(() => void refresh(), SIDEBAR_SLIDE_MS);
		return () => window.clearTimeout(timer);
	}, [open, pathname, refresh]);

	// Stable row callbacks so memoized rows skip re-rendering on a toggle.
	const openChat = useCallback((id: string) => {
		router.push(`/chat/${id}`);
	}, [router]);

	const renderCourseChat: ChatRowRenderer = (chat, label) =>
		renamingId === chat.id ? (
			<RenameRow chat={chat} onCommit={(next) => void commitRename(chat.id, next)} onCancel={() => setRenamingId(null)} />
		) : (
			<CourseChatListRow chat={chat} label={label} active={activeChatId === chat.id} onOpenChat={openChat} onChatContextMenu={openContext} />
		);

	const ctxChat = ctxChatId !== null ? chats?.find((c) => c.id === ctxChatId) : undefined;
	// Only a session without a fag moves (a link to a deleted fag counts).
	const ctxLoose = !!ctxChat && grouped.loose.some((c) => c.id === ctxChat.id);
	const moveTargets = sortCoursesByExam(courses ?? []);

	return (
		// SMOOTH TOGGLE (owner 2026-11-23): the aside's WIDTH SNAPS, so the
		// main column (chat with KaTeX, tables, the graph canvas) is laid out
		// once per toggle instead of on every frame of a width transition.
		// Only the panel moves: a translate on its own layer (compositor
		// only). Closing: main takes the full width at once and the panel
		// slides out over it; opening: main makes room at once and the panel
		// slides in. visibility flips at the END of a close (and at the start
		// of an open), so the parked panel is neither focusable nor a drag
		// region. SidebarToggle's slot keeps its own lockstep animation.
		<aside
			className={cn("relative z-40 shrink-0", open ? "w-72" : "w-0")}
			aria-hidden={!open}
		>
			<div
				className={cn(
					"sidebar-slide absolute inset-y-0 left-0 flex w-72 flex-col border-r bg-card duration-200 will-change-transform",
					open ? "visible translate-x-0" : "invisible -translate-x-full",
				)}
			>
				{/* The logo (fase 2 sketch: mark + name) — the home link; the
				    close toggle sits at the edge. Merged chrome (2026-09-17): in
				    Electron this band is the window's drag surface and starts
				    after the traffic lights (.lh-lights-gutter); in the browser
				    those classes are inert. */}
				<div className="lh-drag lh-lights-gutter flex items-center justify-between px-4 py-3">
					<Hint label="Hjem" side="right">
						<Link
							href="/"
							aria-label="Eksamenshjelp, til Hjem"
							className="lh-no-drag flex h-9 min-w-0 items-center gap-2 rounded-md px-1.5 transition-colors hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50"
						>
							<LhMark className="size-6 shrink-0" />
							<span className="truncate font-ui text-sm font-semibold">Eksamenshjelp</span>
						</Link>
					</Hint>
					<Hint label="Lukk sidemenyen" action="toggle-sidebar">
						<Button
							variant="ghost"
							size="icon"
							aria-label="Lukk sidemenyen"
							onClick={toggle}
							className="lh-no-drag"
						>
							<PanelLeftCloseIcon className="size-4" />
						</Button>
					</Hint>
				</div>

				{/* OVERSIKT (fase 2): the places, with small icons. «Ny økt» and the
				    session search are gone: Hjem starts a loose økt, «Søk i appen»
				    finds sessions too. */}
				<nav aria-label="Oversikt" className="mx-3 flex flex-col gap-0.5">
					<span className={cn(SECTION_LABEL, "mb-0.5")}>Oversikt</span>
					<Link href="/" aria-current={pathname === "/" ? "page" : undefined} className={cn(NAV_ROW, pathname === "/" && "bg-accent text-foreground")}>
						<HomeIcon className="size-3.5 shrink-0" aria-hidden="true" />
						Hjem
					</Link>
					<Hint label="Søk i appen" action="open-search" side="right">
						<button
							type="button"
							data-testid="open-app-search"
							onClick={() => window.dispatchEvent(new CustomEvent("lh:open-help"))}
							className={NAV_ROW}
						>
							<SearchIcon className="size-3.5 shrink-0" aria-hidden="true" />
							Søk i appen
						</button>
					</Hint>
					<Hint label="Kunnskapskart" action="jump-graph" side="right">
						<Link href="/kart" aria-current={pathname === "/kart" ? "page" : undefined} className={cn(NAV_ROW, pathname === "/kart" && "bg-accent text-foreground")}>
							<NetworkIcon className="size-3.5 shrink-0" aria-hidden="true" />
							Kunnskapskart
						</Link>
					</Hint>
				</nav>

				<SidebarDivider />

				{/* FAG and UTEN FAG share one scroller; it takes the free space, so
				    the background agents and the bottom rows pin to the bottom. */}
				<div className="min-h-0 flex-1 overflow-y-auto pb-2">
					<SidebarCourses
						courses={courses}
						groups={grouped.byCourse}
						activeCode={activeCode}
						activeChatId={activeChatId}
						expanded={isExpanded}
						onToggle={toggleCourse}
						onOpenCourse={openCourse}
						onOpenMainChat={openMainChat}
						renderChat={renderCourseChat}
						onAdd={() => window.dispatchEvent(new CustomEvent(ADD_COURSE_EVENT))}
					/>

					{chats === null ? (
						<div className="px-5 py-4 text-xs text-muted-foreground">Laster …</div>
					) : grouped.loose.length > 0 && (
						<section aria-label="Uten fag" data-testid="sidebar-loose" className="mx-3 mt-3">
							<span className={cn(SECTION_LABEL, "mb-0.5 block")}>Uten fag</span>
							{grouped.loose.map((c) =>
								renamingId === c.id ? (
									<RenameRow
										key={c.id}
										chat={c}
										onCommit={(next) => void commitRename(c.id, next)}
										onCancel={() => setRenamingId(null)}
									/>
								) : (
									<SessionListRow
										key={c.id}
										chat={c}
										active={activeChatId === c.id}
										onOpenChat={openChat}
										onChatContextMenu={openContext}
									/>
								),
							)}
						</section>
					)}
				</div>

				{/* Background agents (owner, sidebar round): the section is
				    ALWAYS here — empty means empty (the header sits alone); it
				    populates and grows when processes run. Sidebar closed = the
				    learner opted out (no ambient signal, user decision). */}
				<ActivitySection />

				<SidebarDivider />

				{/* Help + settings (settings-app wave; help in the NTNU round):
				    quiet, bottom-pinned, side by side. Hjelp opens the help
				    center; Innstillinger the centered dialog (also mod+,). */}
				<div className="flex items-center gap-1 px-3">
					<Hint label="Hjelpesenter" action="open-help" side="top">
						<Link href="/hjelp" data-tour="sidebar-help" data-testid="help-entry" className={cn(NAV_ROW, "w-auto flex-1")}>
							<CircleHelpIcon className="size-3.5 shrink-0" aria-hidden="true" />
							Hjelp
						</Link>
					</Hint>
					<Hint label="Innstillinger" action="open-settings" side="top">
						<button
							type="button"
							onClick={() => openSettings()}
							data-tour="sidebar-settings"
							data-testid="settings-entry"
							className={cn(NAV_ROW, "w-auto flex-1")}
						>
							<SettingsIcon className="size-3.5 shrink-0" aria-hidden="true" />
							Innstillinger
						</button>
					</Hint>
				</div>
				{/* Credits (owner 2026-11-23): small and quiet, under the two
				    bottom rows. External links open in the system browser
				    (the shell routes target=_blank to shell.openExternal). */}
				<p data-testid="sidebar-credits" className="px-5 pt-0.5 pb-2.5 font-ui text-[10px] leading-snug text-muted-foreground/45">
					Laget av{" "}
					<a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer" className={CREDIT_LINK}>{AUTHOR_NAME}</a>
					<br />
					Basert på{" "}
					<a href={UPSTREAM_URL} target="_blank" rel="noopener noreferrer" className={CREDIT_LINK}>{UPSTREAM_NAME}</a>
				</p>
			</div>

			{/* The context menu (wave 6 + the extraction-UX redesign + fase 2):
			    the management actions, then the coverage block. «Flytt til fag…»
			    swaps the body for the list of fag. MenuShell owns placement/
			    focus/arrow cycling; the dismissal effect above owns the
			    contract. */}
			{ctxChatId !== null && (
				<MenuShell
					anchorRef={ctxAnchorRef}
					testid="session-context-menu"
					preferredSide="down"
					menuClass="flex w-52 flex-col gap-0.5 rounded-xl border bg-card p-2 text-xs shadow-xl"
				>
					{ctxStep === "move" ? (
						<>
							<p className="px-2.5 pb-1 pt-0.5 font-ui text-[11px] uppercase tracking-widest text-muted-foreground/70">Flytt til fag</p>
							{moveTargets.map((course) => (
								<button
									key={course.code}
									type="button"
									disabled={moving}
									data-testid="ctx-move-target"
									onClick={() => void moveToCourse(ctxChatId, course.code)}
									className={cn(MENU_ITEM, "gap-2 disabled:opacity-60")}
								>
									<span className="shrink-0 font-medium tabular-nums">{course.code}</span>
									<span className="min-w-0 flex-1 truncate text-muted-foreground">{course.name}</span>
								</button>
							))}
							{moveError && <p role="alert" className="px-2.5 py-1 text-destructive">{moveError}</p>}
						</>
					) : (
						<>
							<button
								type="button"
								data-testid="ctx-rename"
								onClick={() => {
									setRenamingId(ctxChatId);
									setCtxChatId(null);
								}}
								className={MENU_ITEM}
							>
								Gi nytt navn
							</button>
							{ctxLoose && moveTargets.length > 0 && (
								<button
									type="button"
									data-testid="ctx-move-to-course"
									onClick={() => setCtxStep("move")}
									className={MENU_ITEM}
								>
									Flytt til fag …
								</button>
							)}
							{/* Export as Markdown (owner, release polish 2026-10-06):
							    same-origin anchor download; the route's
							    Content-Disposition names the file. Above Delete (the
							    destructive action stays last — the danger-fence law). */}
							<button
								type="button"
								data-testid="ctx-export-md"
								onClick={() => {
									const chatId = ctxChatId;
									setCtxChatId(null);
									const a = document.createElement("a");
									a.href = `/api/chats/${chatId}/markdown`;
									a.download = ""; // the route's filename wins
									document.body.appendChild(a);
									a.click();
									a.remove();
								}}
								className={MENU_ITEM}
							>
								Eksporter som Markdown …
							</button>
							<button
								type="button"
								data-testid="ctx-delete"
								onClick={() => {
									if (ctxChat) setDeleting(ctxChat);
									setCtxChatId(null);
								}}
								className={cn(MENU_ITEM, "text-muted-foreground/80 hover:text-foreground")}
							>
								Slett …
							</button>
							<div className="my-0.5 border-t border-border/60" aria-hidden="true" />
							<CoverageMenuBlock chatId={ctxChatId} />
						</>
					)}
				</MenuShell>
			)}

			{/* The two-option delete dialog (wave 6) — portaled to body
			    by the component itself, lives here for state locality. */}
			<DeleteSessionDialog
				chat={deleting}
				onClose={() => setDeleting(null)}
				onDeleted={onDeleted}
			/>
		</aside>
	);
}

/** SessionRow for the live list: memoized, with id-keyed callbacks, so a
 *  sidebar toggle or a sibling's state change does not re-render every row. */
const SessionListRow = memo(function SessionListRow({
	chat,
	active,
	onOpenChat,
	onChatContextMenu,
}: {
	chat: ChatListItem;
	active: boolean;
	onOpenChat: (id: string) => void;
	onChatContextMenu: (e: React.MouseEvent<HTMLButtonElement>, chat: ChatListItem) => void;
}) {
	return (
		<SessionRow
			chat={chat}
			active={active}
			onOpen={() => onOpenChat(chat.id)}
			onContextMenu={(e) => onChatContextMenu(e, chat)}
		/>
	);
});

/** CourseChatRow for the live list, memoized the same way. */
const CourseChatListRow = memo(function CourseChatListRow({
	chat,
	label,
	active,
	onOpenChat,
	onChatContextMenu,
}: {
	chat: ChatListItem;
	label?: string;
	active: boolean;
	onOpenChat: (id: string) => void;
	onChatContextMenu: (e: React.MouseEvent<HTMLButtonElement>, chat: ChatListItem) => void;
}) {
	return (
		<CourseChatRow
			chat={chat}
			label={label}
			active={active}
			onOpen={() => onOpenChat(chat.id)}
			onContextMenu={(e) => onChatContextMenu(e, chat)}
		/>
	);
});

/** The app frame: sidebar inline + content. Rendered once in the root layout. */
export function AppShell({ children }: { children: React.ReactNode }) {
	return (
		<SettingsDialogProvider>
			<SessionsSidebar />
			<FilePathDropZone className="relative min-w-0 flex-1">{children}</FilePathDropZone>
			{/* The single document-level keydown listener (keyboard wave A) —
			    after the content in the tree, but it's window-level so order only
			    matters for the events it dispatches, never for DOM priority. */}
			<KeyboardShortcuts />
		</SettingsDialogProvider>
	);
}
