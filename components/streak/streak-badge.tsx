"use client";

import { flameLevelById, nextLevelLabel, type StreakSummary } from "@/src/core";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";
import { Flame, FLAME_INK } from "./flame";
import { useStreak } from "./use-streak";

/** The tooltip: the number in words, today's state, the next level. */
export function streakHint(s: StreakSummary): string {
	const days = `${s.current} ${s.current === 1 ? "dag" : "dager"} på rad`;
	const level = flameLevelById(s.level);
	const parts = [level ? `${days} · ${level.name}` : "Ingen flamme ennå"];
	parts.push(s.todayDone ? "I dag er gjort" : "I dag er ikke gjort ennå");
	if (s.current > 0) parts.push(nextLevelLabel(s.current));
	return parts.join(". ");
}

/** The small flame and the number (the sidebar, by the logo). Pure. */
export function StreakBadgeView({ streak }: { streak: StreakSummary }) {
	return (
		<span
			data-testid="streak-badge"
			data-level={streak.level ?? "none"}
			className={cn(
				"inline-flex items-center gap-1 font-title text-[13px] font-bold tabular-nums",
				streak.level ? FLAME_INK[streak.level] : "text-muted-foreground",
			)}
		>
			<Flame level={streak.level} variant={streak.level ? "solid" : "full"} size={15} />
			{streak.current}
			<span className="sr-only">{streak.current === 1 ? " dag" : " dager"} på rad</span>
		</span>
	);
}

export function StreakBadge() {
	const streak = useStreak();
	if (!streak) return null;
	return (
		<Hint label={streakHint(streak)} side="bottom">
			<span className="lh-no-drag inline-flex shrink-0 cursor-default items-center rounded-sm px-1 py-0.5" tabIndex={0}>
				<StreakBadgeView streak={streak} />
			</span>
		</Hint>
	);
}
