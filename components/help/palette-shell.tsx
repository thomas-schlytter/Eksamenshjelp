"use client";

/**
 * The search palette's instant shell: the field, and nothing else.
 *
 * The palette itself (results, registry, icons) is loaded lazily, so for a
 * moment after the search chord there used to be nothing on screen and
 * nowhere for keys to go: whatever was typed right after the chord was
 * lost. This shell is what the help provider shows during that moment. It
 * has the palette's exact frame and a real, focused field; every character
 * is reported upward (`onType`) and becomes the palette's starting query
 * when the real thing takes over, with the caret after it.
 *
 * It follows the palette's key laws: Esc is claimed in the capture phase
 * (the ONE-ESC LAW), the opening chord closes it, and no key typed here
 * reaches the app's shortcut dispatcher.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import { actionForBinding, eventBinding } from "@/src/core";

export function PaletteShell({ initialQuery, onType, onClose }: {
	initialQuery: string;
	/** Every change to the field, so the real palette can start from it. */
	onType: (query: string) => void;
	onClose: () => void;
}) {
	const [query, setQuery] = useState(initialQuery);
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		const previous = document.activeElement as HTMLElement | null;
		inputRef.current?.focus();
		inputRef.current?.select();
		return () => {
			// Hand focus back before the palette mounts (it records the opener
			// from here), and when the shell is closed without it ever loading.
			if (previous?.isConnected) previous.focus({ preventScroll: true });
		};
	}, []);

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

	if (typeof document === "undefined") return null;
	return createPortal(
		<div data-testid="search-palette-backdrop" className="fixed inset-0 z-[80] flex items-start justify-center bg-background/80 px-3 pt-[12vh] font-ui">
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Søk i appen"
				aria-busy="true"
				data-testid="search-palette-shell"
				className="settings-dialog-pop flex max-h-[70vh] w-[40rem] max-w-full flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
				onKeyDown={(event) => {
					event.stopPropagation();
					if (event.key === "Tab" || event.key === "Enter") event.preventDefault();
					else if (actionForBinding(eventBinding(event.nativeEvent)) === "open-search") {
						event.preventDefault();
						onClose();
					}
				}}
			>
				<div className="flex items-center gap-3 border-b border-border px-4">
					<Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<input
						ref={inputRef}
						type="text"
						aria-label="Søk etter funksjoner, hjelp, fag og økter"
						autoComplete="off"
						spellCheck={false}
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							onType(event.target.value);
						}}
						placeholder="Søk etter funksjoner, hjelp, fag og økter…"
						data-testid="search-palette-input"
						className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
					/>
					<kbd className="rounded-sm border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Esc</kbd>
				</div>
				<div role="status" className="px-4 py-6 text-center text-sm text-muted-foreground">Laster søket…</div>
			</div>
		</div>,
		document.body,
	);
}
