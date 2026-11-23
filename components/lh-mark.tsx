/**
 * LhMark — the Eksamenshjelp logo (profile D, 2026-11-23): a marine square
 * with three bars forming an «E» (long, short, long) and a gold dot beside
 * the short middle bar. Inlined as JSX so it rides along with the
 * components (no network fetch, crisp at any size) and follows the theme
 * tokens: --primary square, --primary-foreground bars, --gold dot. 34×34
 * viewBox, no padding: sizing is the consumer's job.
 *
 * The same drawing, in fixed light-mode colors, is build/icon-flat.svg (the
 * Windows/Linux app icon source for scripts/make-icons.mjs).
 */
export function LhMark({ className = "" }: { className?: string }) {
	return (
		<svg viewBox="0 0 34 34" className={className} aria-hidden="true">
			<rect width="34" height="34" rx="6" style={{ fill: "var(--primary)" }} />
			<rect x="9" y="9" width="16" height="3.4" rx="1.7" style={{ fill: "var(--primary-foreground)" }} />
			<rect x="9" y="15.3" width="11" height="3.4" rx="1.7" style={{ fill: "var(--primary-foreground)" }} />
			<rect x="9" y="21.6" width="16" height="3.4" rx="1.7" style={{ fill: "var(--primary-foreground)" }} />
			<circle cx="24" cy="17" r="2.4" style={{ fill: "var(--gold)" }} />
		</svg>
	);
}
