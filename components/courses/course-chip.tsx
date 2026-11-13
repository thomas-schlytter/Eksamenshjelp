import Link from "next/link";
import { ChevronDownIcon, GraduationCapIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The small fag selector beside a start box: «Fag: Ingen / TTK4100 …».
 * A native <select> on purpose: keyboard, screen reader and touch
 * behaviour come for free, and it can never open off-screen. Renders
 * nothing when the student has no fag (there is nothing to choose).
 */
export function CourseSelectChip({ courses, value, onChange }: {
	courses: readonly { code: string; name: string }[];
	/** The linked fagkode, or "" for a free session. */
	value: string;
	onChange: (code: string) => void;
}) {
	if (courses.length === 0) return null;
	return (
		<label
			data-testid="course-select-chip"
			className="relative flex h-6 shrink-0 items-center gap-1 rounded-md border border-border/60 bg-background pl-1.5 pr-5 font-ui text-[11px] text-muted-foreground transition-colors focus-within:ring-[3px] focus-within:ring-ring/50 hover:text-foreground"
		>
			<GraduationCapIcon className="size-3 shrink-0" aria-hidden="true" />
			<span>Fag:</span>
			<select
				value={value}
				onChange={(e) => onChange(e.target.value)}
				aria-label="Koble økta til et fag"
				className="max-w-28 cursor-pointer appearance-none truncate bg-transparent text-foreground outline-none"
			>
				<option value="">Ingen</option>
				{courses.map((course) => (
					<option key={course.code} value={course.code}>{course.code}</option>
				))}
			</select>
			<ChevronDownIcon className="pointer-events-none absolute right-1 size-3" aria-hidden="true" />
		</label>
	);
}

/** A fagkode as a small link to its fag page (the session top bar, the
 *  draft view). `lh-no-drag` is implied: links are carved natively. */
export function CourseLinkChip({ code, className }: { code: string; className?: string }) {
	return (
		<Link
			href={`/fag/${encodeURIComponent(code)}`}
			data-testid="course-link-chip"
			aria-label={`Gå til faget ${code}`}
			title={`Gå til faget ${code}`}
			className={cn(
				"flex h-6 shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2 font-ui text-xs font-medium tabular-nums text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
				className,
			)}
		>
			<GraduationCapIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
			{code}
		</Link>
	);
}
