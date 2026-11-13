"use client";

/**
 * The global search palette (NTNU round): one field that finds things to DO
 * (the feature registry), answers, tours, the learner's courses and their
 * sessions. Opened by the search chord and by `lh:open-help`; the help
 * provider mounts it lazily, so its code only loads on first use.
 *
 * Keyboard-first: focus never leaves the field. ↑/↓ walk the flat result
 * list (wrapping), Enter opens the walked row, Esc closes.
 *
 * THE ONE-ESC LAW: Esc is claimed in the document's capture phase, and every
 * other key is stopped at the panel, so the window-level chain (cancel
 * dictation → "abort turn" confirmation in a session) never sees a key that
 * belonged to the palette.
 *
 * The course and session lists are fetched when the palette opens. Both are
 * optional: an endpoint that is missing or fails just leaves its group out.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, CircleHelp, Compass, GraduationCap, MessageSquare, Search, Sparkles } from "lucide-react";
import { actionForBinding, eventBinding } from "@/src/core";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import { useHelp } from "./help-context.ts";
import {
	buildPaletteGroups,
	flattenGroups,
	readChats,
	readCourses,
	type PaletteChat,
	type PaletteCourse,
	type PaletteGroup,
	type PaletteGroupId,
	type PaletteItem,
} from "./palette-model.ts";

const GROUP_ICON: Record<PaletteGroupId, typeof Search> = {
	features: Sparkles,
	articles: CircleHelp,
	tours: Compass,
	courses: GraduationCap,
	chats: MessageSquare,
};

async function fetchList<T>(url: string, read: (body: unknown) => T[]): Promise<T[]> {
	try {
		const res = await fetch(url);
		return res.ok ? read(await res.json()) : [];
	} catch {
		return [];
	}
}

export default function SearchPalette({ initialQuery, keepCaret = false, onClose }: {
	initialQuery: string;
	/** The query was typed by the learner while the palette loaded (the
	 *  instant shell): keep typing after it instead of selecting it. */
	keepCaret?: boolean;
	onClose: () => void;
}) {
	const { run } = useHelp();
	const [query, setQuery] = useState(initialQuery);
	const [courses, setCourses] = useState<PaletteCourse[]>([]);
	const [chats, setChats] = useState<PaletteChat[]>([]);
	const [active, setActive] = useState(0);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const listRef = useRef<HTMLDivElement | null>(null);
	const backdropDismiss = useBackdropDismiss(onClose);

	useEffect(() => {
		let alive = true;
		void fetchList("/api/courses", readCourses).then((list) => alive && setCourses(list));
		void fetchList("/api/chats", readChats).then((list) => alive && setChats(list));
		return () => {
			alive = false;
		};
	}, []);

	const groups = useMemo(() => buildPaletteGroups(query, { courses, chats }), [query, courses, chats]);
	const items = useMemo(() => flattenGroups(groups), [groups]);
	const activeItem = items[Math.min(active, items.length - 1)];

	// A new query starts the walk at the best hit again.
	useEffect(() => setActive(0), [query]);

	useEffect(() => {
		const previous = document.activeElement as HTMLElement | null;
		inputRef.current?.focus();
		if (keepCaret) {
			const end = inputRef.current?.value.length ?? 0;
			inputRef.current?.setSelectionRange(end, end);
		} else inputRef.current?.select();
		return () => {
			const current = document.activeElement;
			if (previous?.isConnected && (!current || current === document.body)) previous.focus({ preventScroll: true });
		};
	}, []);

	// Esc: capture phase at the document, so no layer underneath acts on it.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			onClose();
		};
		document.addEventListener("keydown", onKey, true);
		return () => document.removeEventListener("keydown", onKey, true);
	}, [onClose]);

	// Keep the walked row in view without moving the page.
	useEffect(() => {
		if (!activeItem) return;
		const row = listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(activeItem.key)}"]`);
		row?.scrollIntoView({ block: "nearest" });
	}, [activeItem]);

	const choose = (item: PaletteItem) => {
		onClose();
		run(item.action);
	};

	const onKeyDown = (event: React.KeyboardEvent) => {
		// Nothing typed here may reach the app's shortcut dispatcher.
		event.stopPropagation();
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			if (items.length === 0) return;
			const delta = event.key === "ArrowDown" ? 1 : -1;
			setActive((at) => (Math.min(at, items.length - 1) + delta + items.length) % items.length);
		} else if (event.key === "Enter") {
			event.preventDefault();
			if (activeItem) choose(activeItem);
		} else if (event.key === "Tab") {
			event.preventDefault(); // the field keeps focus; rows are walked with the arrows
		} else if (actionForBinding(eventBinding(event.nativeEvent)) === "open-search") {
			// The chord that opened the palette closes it (and must not fall
			// through to the browser's own binding for those keys).
			event.preventDefault();
			onClose();
		}
	};

	if (typeof document === "undefined") return null;
	const trimmed = query.trim();
	const activeId = activeItem ? `palette-row-${activeItem.key}` : undefined;

	return createPortal(
		<div
			data-testid="search-palette-backdrop"
			className="fixed inset-0 z-[80] flex items-start justify-center bg-background/80 px-3 pt-[12vh] font-ui"
			{...backdropDismiss}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Søk i appen"
				data-testid="search-palette"
				className="settings-dialog-pop flex max-h-[70vh] w-[40rem] max-w-full flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
				onKeyDown={onKeyDown}
				// Clicking the panel's chrome must not take focus from the field.
				onMouseDown={(event) => {
					if (event.target !== inputRef.current) event.preventDefault();
				}}
			>
				<div className="flex items-center gap-3 border-b border-border px-4">
					<Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<input
						ref={inputRef}
						type="text"
						role="combobox"
						aria-expanded="true"
						aria-controls="palette-results"
						aria-activedescendant={activeId}
						aria-label="Søk etter funksjoner, hjelp, fag og økter"
						autoComplete="off"
						spellCheck={false}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Søk etter funksjoner, hjelp, fag og økter…"
						data-testid="search-palette-input"
						className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
					/>
					<kbd className="rounded-sm border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Esc</kbd>
				</div>
				<div ref={listRef} id="palette-results" role="listbox" aria-label="Søkeresultater" className="min-h-0 flex-1 overflow-y-auto p-2">
					{groups.length === 0 ? (
						<EmptyState query={trimmed} onOpenHelp={() => choose({ key: "empty:help", group: "features", title: "", action: { kind: "route", href: "/hjelp" } })} />
					) : (
						groups.map((group) => (
							<ResultGroup key={group.id} group={group} activeKey={activeItem?.key} onChoose={choose} onHover={(item) => setActive(items.indexOf(item))} />
						))
					)}
				</div>
				<div className="flex items-center gap-4 border-t border-border px-4 py-2 text-xs text-muted-foreground">
					<span>↑↓ velger</span>
					<span>↵ åpner</span>
					<span>Esc lukker</span>
				</div>
			</div>
		</div>,
		document.body,
	);
}

function ResultGroup({
	group,
	activeKey,
	onChoose,
	onHover,
}: {
	group: PaletteGroup;
	activeKey: string | undefined;
	onChoose: (item: PaletteItem) => void;
	onHover: (item: PaletteItem) => void;
}) {
	const Icon = GROUP_ICON[group.id];
	return (
		<div role="group" aria-label={group.label} className="mb-1 last:mb-0">
			<div className="px-2 pt-2 pb-1 text-xs uppercase tracking-widest text-muted-foreground/70">{group.label}</div>
			{group.items.map((item) => {
				const selected = item.key === activeKey;
				return (
					<div
						key={item.key}
						id={`palette-row-${item.key}`}
						role="option"
						aria-selected={selected}
						data-key={item.key}
						data-testid="search-palette-row"
						// mousedown, not click: the row must act before the field's
						// blur can reorder anything, and focus stays in the field.
						onMouseDown={(event) => {
							event.preventDefault();
							onChoose(item);
						}}
						onMouseMove={() => !selected && onHover(item)}
						className={`flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 ${selected ? "bg-accent text-accent-foreground" : ""}`}
					>
						<Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						<span className="min-w-0 flex-1">
							<span className="block truncate text-sm">{item.title}</span>
							{item.subtitle && <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>}
						</span>
					</div>
				);
			})}
		</div>
	);
}

function EmptyState({ query, onOpenHelp }: { query: string; onOpenHelp: () => void }) {
	return (
		<div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
			<BookOpen className="size-5 text-muted-foreground" aria-hidden="true" />
			<p className="text-sm">
				{query ? `Ingen treff på «${query}».` : "Skriv for å søke."}
				<span className="block text-muted-foreground">Prøv et annet ord, eller se om hjelpesenteret har svaret.</span>
			</p>
			<button
				type="button"
				onMouseDown={(event) => {
					event.preventDefault();
					onOpenHelp();
				}}
				className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
			>
				Åpne hjelpesenteret
			</button>
		</div>
	);
}
