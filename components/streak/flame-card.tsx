"use client";

import { flameLevelById, nextLevelLabel, type StreakSummary } from "@/src/core";
import { cn } from "@/lib/utils";
import { Flame, FLAME_INK } from "./flame";
import { useStreak } from "./use-streak";

const CARD = "flex flex-col gap-3 rounded-lg border bg-card p-5";

/**
 * The fag page's flame card (sketch Main): the big flame, the number and
 * the level, «N dager til <neste nivå>», the week with a small flame per
 * done day (dashed for today when not done), and the nudge only while
 * today is not done. Pure: the summary in, markup out.
 */
export function FlameCardView({ streak }: { streak: StreakSummary }) {
	const level = flameLevelById(streak.level);
	const ink = streak.level ? FLAME_INK[streak.level] : "text-muted-foreground";
	return (
		<section data-testid="flame-card" data-level={streak.level ?? "none"} aria-label="Dager på rad" className={CARD}>
			<div className="flex items-center gap-3.5">
				<Flame
					level={streak.level}
					size={60}
					flicker
					label={level ? `${level.name}, nivå ${level.rank} av 5` : "Ingen flamme ennå"}
				/>
				<div className="flex min-w-0 flex-col">
					<div className="flex items-baseline gap-2">
						<span className={cn("font-title text-4xl font-bold leading-none tabular-nums", ink)} data-testid="flame-count">{streak.current}</span>
						<span className="font-ui text-sm font-semibold">{streak.current === 1 ? "dag på rad" : "dager på rad"}</span>
					</div>
					<span className={cn("mt-1 font-ui text-xs font-semibold", ink)} data-testid="flame-level">
						{level ? `${level.name} · ${nextLevelLabel(streak.current)}` : "Ingen flamme ennå"}
					</span>
				</div>
			</div>
			<ol className="grid grid-cols-7 gap-1 text-center" aria-label="Siste sju dager">
				{streak.week.map((day) => (
					<li key={day.date} data-testid="flame-day" data-done={day.done || undefined} className="flex flex-col items-center gap-0.5">
						{day.done ? (
							<Flame level={streak.level ?? "spark"} variant="solid" size={22} />
						) : day.today ? (
							<Flame level={streak.level} variant="today" size={22} />
						) : (
							<Flame level={null} size={22} />
						)}
						<span className={cn("font-ui text-[10px]", day.today ? "font-bold text-foreground" : "text-muted-foreground")}>
							{day.label}
						</span>
						<span className="sr-only">{day.done ? "gjort" : day.today ? "ikke gjort ennå" : "ikke gjort"}</span>
					</li>
				))}
			</ol>
			{!streak.todayDone && (
				<p className="font-ui text-xs text-muted-foreground" data-testid="flame-nudge">
					{streak.current > 0 ? "Løs ett spørsmål i dag for å holde flammen." : "Løs ett spørsmål i dag for å tenne flammen."}
				</p>
			)}
		</section>
	);
}

/** The card with the live flame; a quiet placeholder until it loads. */
export function FlameCard() {
	const streak = useStreak();
	if (!streak) return <section aria-label="Dager på rad" aria-busy="true" className={cn(CARD, "min-h-44")} data-testid="flame-card" />;
	return <FlameCardView streak={streak} />;
}
