"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { XIcon } from "lucide-react";
import { flameLevelById, type FlameLevelId } from "@/src/core";
import { usePopoverDismiss } from "@/components/popover-dismiss";
import { Flame } from "./flame";
import { markCelebrated, useStreak } from "./use-streak";

/** «7 dager på rad. Flammen er glohet!» */
export function celebrationTitle(days: number, level: FlameLevelId): string {
	const cheer = flameLevelById(level)?.cheer ?? "";
	return `${days} ${days === 1 ? "dag" : "dager"} på rad. ${cheer}`;
}

/**
 * The card itself (sketch Flamme-og-lockin, «Nytt nivå»). Pure.
 *
 * lh-no-drag (2026-11-26, «kan ikke lukkes»): the card floats over the
 * top bars, which are the window's drag band in Electron. Without its own
 * no-drag region the band swallowed every click on the card, the close
 * button included. The card renders after the pages in the DOM, so its
 * carve-out subtracts from their drag regions (the mask law in
 * globals.css).
 */
export function CelebrationCard({ days, level, onClose, cardRef }: {
	days: number;
	level: FlameLevelId;
	onClose: () => void;
	cardRef?: React.Ref<HTMLDivElement>;
}) {
	return (
		<div
			ref={cardRef}
			role="status"
			data-testid="streak-celebration"
			data-level={level}
			className="lh-toast-in lh-no-drag pointer-events-auto relative flex w-full max-w-md items-center gap-4 rounded-lg border border-primary bg-primary p-5 pr-12 text-primary-foreground shadow-xl"
		>
			<Flame level={level} size={72} flicker />
			<div className="min-w-0 flex-1">
				<p className="font-ui text-[11px] font-semibold uppercase tracking-widest text-gold">Nytt nivå</p>
				<p className="mt-1 font-title text-xl font-semibold tracking-tight">{celebrationTitle(days, level)}</p>
			</div>
			<button
				type="button"
				onClick={onClose}
				aria-label="Lukk"
				data-testid="streak-celebration-close"
				className="absolute right-2 top-2 flex size-8 cursor-pointer items-center justify-center rounded-md text-primary-foreground/80 outline-none transition-colors hover:bg-primary-foreground/15 hover:text-primary-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
			>
				<XIcon className="size-4" aria-hidden="true" />
			</button>
		</div>
	);
}

/** Mounted once (the app shell): a level reached and not celebrated yet
 *  shows once. Closing it (the X, Esc, a click outside, or 20 seconds)
 *  marks it celebrated, so it never comes back. */
export function StreakCelebration() {
	const streak = useStreak();
	const level = streak?.celebrate ?? null;
	const [dismissed, setDismissed] = useState<string | null>(null);
	const markedRef = useRef<string | null>(null);
	const cardRef = useRef<HTMLDivElement | null>(null);
	const done = useCallback((which: FlameLevelId) => {
		setDismissed(which);
		if (markedRef.current === which) return;
		markedRef.current = which;
		void markCelebrated(which);
	}, []);
	useEffect(() => {
		if (!level) return;
		const id = setTimeout(() => done(level), 20_000);
		return () => clearTimeout(id);
	}, [level, done]);
	const shown = !!streak && !!level && dismissed !== level;
	const close = useCallback(() => {
		if (level) done(level);
	}, [level, done]);
	// Esc (claimed, so it never also aborts a turn) and any press outside.
	usePopoverDismiss(cardRef, shown, close);
	if (!shown || !streak || !level) return null;
	return (
		<div className="pointer-events-none fixed inset-x-0 top-6 z-50 flex justify-center px-4">
			<CelebrationCard days={streak.current} level={level} onClose={close} cardRef={cardRef} />
		</div>
	);
}
