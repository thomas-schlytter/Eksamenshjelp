"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { XIcon } from "lucide-react";
import { flameLevelById, type FlameLevelId } from "@/src/core";
import { Flame } from "./flame";
import { markCelebrated, useStreak } from "./use-streak";

/** «7 dager på rad. Flammen er glohet!» */
export function celebrationTitle(days: number, level: FlameLevelId): string {
	const cheer = flameLevelById(level)?.cheer ?? "";
	return `${days} ${days === 1 ? "dag" : "dager"} på rad. ${cheer}`;
}

/** The card itself (sketch Flamme-og-lockin, «Nytt nivå»). Pure. */
export function CelebrationCard({ days, level, onClose }: { days: number; level: FlameLevelId; onClose: () => void }) {
	return (
		<div
			role="status"
			data-testid="streak-celebration"
			data-level={level}
			className="lh-toast-in pointer-events-auto relative flex w-full max-w-md items-center gap-4 rounded-lg border border-primary bg-primary p-5 text-primary-foreground shadow-xl"
		>
			<Flame level={level} size={72} flicker />
			<div className="min-w-0 flex-1 pr-4">
				<p className="font-ui text-[11px] font-semibold uppercase tracking-widest text-gold">Nytt nivå</p>
				<p className="mt-1 font-title text-xl font-semibold tracking-tight">{celebrationTitle(days, level)}</p>
			</div>
			<button
				type="button"
				onClick={onClose}
				aria-label="Lukk"
				className="absolute right-2.5 top-2.5 cursor-pointer rounded-sm p-1 text-primary-foreground/70 outline-none hover:text-primary-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
			>
				<XIcon className="size-4" aria-hidden="true" />
			</button>
		</div>
	);
}

/** Mounted once (the app shell): a level reached and not celebrated yet
 *  shows once; closing it (or 20 seconds) marks it celebrated. */
export function StreakCelebration() {
	const streak = useStreak();
	const level = streak?.celebrate ?? null;
	const [dismissed, setDismissed] = useState<string | null>(null);
	const markedRef = useRef<string | null>(null);
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
	if (!streak || !level || dismissed === level) return null;
	const close = () => done(level);
	return (
		<div className="pointer-events-none fixed inset-x-0 top-6 z-50 flex justify-center px-4">
			<CelebrationCard days={streak.current} level={level} onClose={close} />
		</div>
	);
}
