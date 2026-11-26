"use client";

import { useCallback, useEffect, useState } from "react";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";
import {
	EMPTY_USAGE,
	normalizeUsageSnapshot,
	usageHint,
	usageView,
	type UsageLimitsSnapshot,
	type UsageTone,
} from "@/src/core";

/**
 * BRUK in the sidebar (2026-11-26): per subscription with data, two thin
 * bars, «5 timer» and «Uke», with the percent and when it resets. Yellow
 * over 75 %, red over 90 %. Nothing at all when no provider has reported.
 */

const BAR_TONE: Record<UsageTone, string> = {
	normal: "bg-primary",
	warn: "bg-status-yellow",
	high: "bg-status-red",
};

/** The block. Pure: the snapshot and the clock in, markup out. */
export function UsageLimitsView({ snapshot, now }: { snapshot: UsageLimitsSnapshot; now: number }) {
	const providers = usageView(snapshot, now);
	if (providers.length === 0) return null;
	return (
		<section aria-label="Bruk" data-testid="usage-limits" className="mx-3 mb-1 flex flex-col gap-2.5 px-2">
			{providers.map((p) => (
				<Hint key={p.provider} label={usageHint(p.provider)} side="right">
					<div
						tabIndex={0}
						data-testid="usage-provider"
						data-provider={p.provider}
						className="flex flex-col gap-1.5 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
					>
						<span className="font-ui text-xs font-semibold text-foreground">{p.label}</span>
						{p.rows.map((row) => (
							<div key={row.id} data-testid="usage-row" data-window={row.id} data-tone={row.tone} className="flex flex-col gap-1">
								<div className="flex items-baseline gap-2 font-ui text-[11px] leading-none text-muted-foreground">
									<span className="shrink-0 text-foreground">{row.label}</span>
									{row.resetLabel && <span className="min-w-0 truncate">{row.resetLabel}</span>}
									<span className="ml-auto shrink-0 tabular-nums">{row.percent} %</span>
								</div>
								<div
									role="meter"
									aria-label={`${p.label}, ${row.label}`}
									aria-valuemin={0}
									aria-valuemax={100}
									aria-valuenow={row.percent}
									className="h-1 overflow-hidden rounded-full bg-muted"
								>
									<div className={cn("h-full rounded-full", BAR_TONE[row.tone])} style={{ width: `${row.percent}%` }} />
								</div>
							</div>
						))}
					</div>
				</Hint>
			))}
		</section>
	);
}

/** The live block: fetched on mount, on `usage-limits-changed` and on
 *  reconnect; the clock ticks each minute, so a passed reset reads 0 %. */
export function UsageLimits() {
	const [snapshot, setSnapshot] = useState<UsageLimitsSnapshot>(EMPTY_USAGE);
	const [now, setNow] = useState(() => Date.now());
	const load = useCallback(async () => {
		try {
			const res = await fetch("/api/usage-limits", { cache: "no-store" });
			if (res.ok) setSnapshot(normalizeUsageSnapshot(await res.json()));
		} catch { /* offline: keep what we have */ }
		setNow(Date.now());
	}, []);
	useEffect(() => {
		void load();
		const timer = window.setInterval(() => setNow(Date.now()), 60_000);
		return () => window.clearInterval(timer);
	}, [load]);
	useServerEvent("usage-limits-changed", () => void load());
	useServerResync(() => void load());
	return <UsageLimitsView snapshot={snapshot} now={now} />;
}
