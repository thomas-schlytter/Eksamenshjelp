import { CheckIcon, CircleDashedIcon, CircleHelpIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { countsSummary, SELF_STATUSES, STATUS_BAR_ORDER, STATUS_STYLE, type SelfStatus } from "./course-format";
import { TOPIC_STATUS_LABEL, type TopicStatus } from "./course-types";

/** Status is never colour alone: each status also has its own glyph. */
const STATUS_ICON: Record<TopicStatus, typeof CheckIcon> = {
	green: CheckIcon,
	yellow: CircleHelpIcon,
	red: XIcon,
	unknown: CircleDashedIcon,
};

/** A status marker: coloured disc with the status glyph inside, plus the
 *  label for screen readers (or visibly, with `withLabel`). */
export function StatusDot({ status, withLabel = false, className }: { status: TopicStatus; withLabel?: boolean; className?: string }) {
	const Icon = STATUS_ICON[status];
	return (
		<span className={cn("inline-flex items-center gap-1.5", className)} data-status={status}>
			<span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full", STATUS_STYLE[status].dot)} aria-hidden="true">
				<Icon className={cn("size-2.5", status === "unknown" ? "text-background" : status === "yellow" ? "text-amber-950" : "text-white dark:text-black")} strokeWidth={3} />
			</span>
			<span className={withLabel ? cn("font-ui text-xs", STATUS_STYLE[status].text) : "sr-only"}>{TOPIC_STATUS_LABEL[status]}</span>
		</span>
	);
}

/**
 * The segmented progress line: one segment per status, widths by share.
 * The whole line is ONE image to assistive tech, described in words; with
 * `legend` the same numbers are also printed underneath for everyone.
 * Fixed height and a full-width track, so nothing jumps as counts change.
 */
export function TopicStatusBar({ counts, legend = false, className }: {
	counts: Record<TopicStatus, number>;
	legend?: boolean;
	className?: string;
}) {
	const total = STATUS_BAR_ORDER.reduce((sum, status) => sum + counts[status], 0);
	return (
		<div className={className} data-testid="topic-status-bar">
			<div
				role="img"
				aria-label={countsSummary(counts)}
				className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
			>
				{total > 0 && STATUS_BAR_ORDER.map((status) => counts[status] > 0 && (
					<span
						key={status}
						data-status={status}
						className={cn("h-full min-w-1.5", STATUS_STYLE[status].bar)}
						style={{ flexGrow: counts[status], flexBasis: 0 }}
					/>
				))}
			</div>
			{legend && (
				<ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1" aria-hidden="true">
					{STATUS_BAR_ORDER.map((status) => (
						<li key={status} className="flex items-center gap-1.5 font-ui text-xs text-muted-foreground">
							<span className={cn("size-2 rounded-full", STATUS_STYLE[status].dot)} />
							<span className="tabular-nums text-foreground">{counts[status]}</span>
							{TOPIC_STATUS_LABEL[status]}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

/**
 * The self-assessment: three plain buttons, one per answer. A radio group
 * in behaviour (exactly one pressed, or none while unmapped), buttons in
 * markup so each is one click and one Tab stop. `size="lg"` is the
 * wizard's big version.
 */
export function StatusButtons({ value, onChange, size = "sm", topicTitle, disabled = false }: {
	value: TopicStatus;
	onChange: (status: SelfStatus) => void;
	size?: "sm" | "lg";
	/** Names the group for screen readers ("Hvor godt kan du Laplace?"). */
	topicTitle: string;
	disabled?: boolean;
}) {
	return (
		<div
			role="group"
			aria-label={`Hvor godt kan du ${topicTitle}?`}
			// Never three equal columns: «Kan ikke ennå» is the longest label and
			// must always be readable in full. Each button takes its own text
			// width, the row shares what is left, and on a narrow card the
			// buttons wrap to a second row instead of clipping.
			className={cn("flex flex-wrap", size === "lg" ? "gap-2" : "gap-1")}
			data-testid="status-buttons"
		>
			{SELF_STATUSES.map((status) => {
				const Icon = STATUS_ICON[status];
				const pressed = value === status;
				return (
					<button
						key={status}
						type="button"
						disabled={disabled}
						aria-pressed={pressed}
						data-status={status}
						onClick={() => onChange(status)}
						className={cn(
							"flex flex-auto cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-ui font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-60",
							size === "lg" ? "min-h-11 px-3 py-2 text-sm" : "min-h-8 px-2 py-1 text-xs",
							pressed ? STATUS_STYLE[status].active : STATUS_STYLE[status].idle,
						)}
					>
						<Icon className={size === "lg" ? "size-4 shrink-0" : "size-3 shrink-0"} aria-hidden="true" strokeWidth={2.5} />
						<span>{TOPIC_STATUS_LABEL[status]}</span>
					</button>
				);
			})}
		</div>
	);
}
