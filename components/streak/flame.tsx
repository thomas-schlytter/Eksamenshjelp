import type { FlameLevelId } from "@/src/core";
import { cn } from "@/lib/utils";

/**
 * THE FLAME (fase 7b): one SVG per level, the shapes and colours of the
 * approved sketch (Flamme-og-lockin). Every colour is a token
 * (--flame-<level>… in app/globals.css), so both modes carry their own.
 *
 *   level null  → an unlit flame (no streak yet)
 *   variant "today" → the dashed outline for today when it is not done
 *
 * Decorative by default (aria-hidden); pass `label` to make it an image.
 */

type Path = { d: string; fill: string };
interface FlameArt {
	halo?: { cx: number; cy: number; r: number; fill: string; opacity: number };
	paths: Path[];
}

const OUTER = {
	spark: "M20 14C22 21 29 24 29 34A9 9 0 0 1 11 34C11 29 14 27 16 24C16 28 17 30 19 31C18 26 17 20 20 14Z",
	flame: "M20 6C23 14 32 18 32 32A12 12 0 0 1 8 32C8 25 11 22 15 18C15 23 16 26 19 27C18 20 17 13 20 6Z",
	hot: "M20 2C23 12 34 17 34 32A14 14 0 0 1 6 32C6 24 10 20 14 16C14 22 16 25 19 26C18 18 16 10 20 2Z",
	inferno: "M20 1C24 11 36 16 36 32A16 16 0 0 1 4 32C4 23 9 18 13 14C13 21 15 24 18 25C17 16 15 9 20 1Z",
	blue: "M20 0C25 10 37 15 37 32A17 17 0 0 1 3 32C3 22 8 17 12 13C12 20 14 23 17 24C16 15 14 8 20 0Z",
} as const;

const ART: Record<FlameLevelId, FlameArt> = {
	spark: {
		paths: [
			{ d: OUTER.spark, fill: "var(--flame-spark)" },
			{ d: "M20 30C21 34 24 35 24 39A4 4 0 0 1 16 39C16 36 18 34 20 30Z", fill: "var(--flame-spark-core)" },
		],
	},
	flame: {
		paths: [
			{ d: OUTER.flame, fill: "var(--flame-flame)" },
			{ d: "M20 25C22 31 26 32 26 38A6 6 0 0 1 14 38C14 34 17 31 20 25Z", fill: "var(--flame-flame-core)" },
		],
	},
	hot: {
		halo: { cx: 20, cy: 34, r: 19, fill: "var(--flame-hot)", opacity: 0.12 },
		paths: [
			{ d: OUTER.hot, fill: "var(--flame-hot)" },
			{ d: "M20 22C22 29 28 31 28 38A8 8 0 0 1 12 38C12 33 17 30 20 22Z", fill: "var(--flame-hot-core)" },
		],
	},
	inferno: {
		halo: { cx: 20, cy: 32, r: 20, fill: "var(--flame-inferno)", opacity: 0.16 },
		paths: [
			{ d: OUTER.inferno, fill: "var(--flame-inferno)" },
			{ d: "M20 18C23 26 30 29 30 37A10 10 0 0 1 10 37C10 31 16 27 20 18Z", fill: "var(--flame-inferno-mid)" },
			{ d: "M20 30C21 34 24 35 24 39A4 4 0 0 1 16 39C16 36 18 34 20 30Z", fill: "var(--flame-inferno-core)" },
		],
	},
	blue: {
		halo: { cx: 20, cy: 31, r: 21, fill: "var(--flame-blue)", opacity: 0.18 },
		paths: [
			{ d: OUTER.blue, fill: "var(--flame-blue)" },
			{ d: "M20 16C24 25 31 28 31 37A11 11 0 0 1 9 37C9 30 15 26 20 16Z", fill: "var(--flame-blue-mid)" },
			{ d: "M20 28C22 33 26 34 26 39A6 6 0 0 1 14 39C14 35 17 33 20 28Z", fill: "var(--flame-blue-core)" },
		],
	},
};

/** The level's solid colour (small week flames, rings, chips). */
export const FLAME_FILL: Record<FlameLevelId, string> = {
	spark: "var(--flame-spark)",
	flame: "var(--flame-flame)",
	hot: "var(--flame-hot)",
	inferno: "var(--flame-inferno)",
	blue: "var(--flame-blue)",
};

/** Text on canvas/card in the level's colour. */
export const FLAME_INK: Record<FlameLevelId, string> = {
	spark: "text-flame-spark-ink",
	flame: "text-flame-flame-ink",
	hot: "text-flame-hot-ink",
	inferno: "text-flame-inferno-ink",
	blue: "text-flame-blue-ink",
};

export function Flame({ level, size = 24, variant = "full", halo = true, flicker = false, label, className }: {
	level: FlameLevelId | null;
	/** The height in px; the width follows the 40×52 artboard. */
	size?: number;
	/** "full" = the level's art; "solid" = one fill (small icons);
	 *  "today" = the dashed outline for a day not done yet. */
	variant?: "full" | "solid" | "today";
	halo?: boolean;
	/** A gentle flicker (honours prefers-reduced-motion). */
	flicker?: boolean;
	label?: string;
	className?: string;
}) {
	const width = Math.round((size * 40) / 52);
	const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
	const shape = level ? OUTER[level] : OUTER.flame;
	return (
		<svg
			width={width}
			height={size}
			viewBox="0 0 40 52"
			className={cn("shrink-0", flicker && level && "lh-flame-flicker", className)}
			data-level={level ?? "none"}
			{...a11y}
		>
			{variant === "today" ? (
				<path d={OUTER.hot} fill="none" stroke={level ? FLAME_FILL[level] : "var(--flame-off)"} strokeWidth={3} strokeDasharray="4 3" />
			) : !level ? (
				<path d={shape} fill="var(--flame-off)" />
			) : variant === "solid" ? (
				<path d={OUTER.hot} fill={FLAME_FILL[level]} />
			) : (
				<>
					{halo && ART[level].halo && (
						<circle
							cx={ART[level].halo!.cx}
							cy={ART[level].halo!.cy}
							r={ART[level].halo!.r}
							fill={ART[level].halo!.fill}
							fillOpacity={ART[level].halo!.opacity}
						/>
					)}
					{ART[level].paths.map((p) => <path key={p.d} d={p.d} fill={p.fill} />)}
				</>
			)}
		</svg>
	);
}
