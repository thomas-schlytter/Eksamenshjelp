import Link from "next/link";
import { GraduationCapIcon } from "lucide-react";

/**
 * The course-context line (exam mode, 2026-11): the transcript's face of
 * the `course-context` marker a course-bound session starts with. The
 * model reads the marker's own text; the student only needs to see WHICH
 * course, topic and material this session is working from. So: one quiet
 * line at the top of the session, linking back to the course page. Never
 * a card with a body, never a bubble (scaffolding, like the graph pick).
 */

/** The marker's `details` (the contract: core/courses.ts
 *  CourseContextDetails). Declared locally and GUARDED below: the part
 *  arrives as untyped `data`, and a record written by an older or newer
 *  build must render nothing rather than crash the transcript. */
export interface CourseContextData {
	code: string;
	name: string;
	topicId?: string;
	topicTitle?: string;
	mode?: "learn" | "practice" | "mapping" | "exam" | "sub";
	sourceCount: number;
}

/** Fase 2 (one chat per fag): the fag's main chat reads «Fag-chat», every
 *  other linked chat «Underchat» — the retired Lær/Øv/Kartlegging starts
 *  on old records included, so those words are gone from the UI. */
const MODE_LABEL: Record<NonNullable<CourseContextData["mode"]>, string> = {
	learn: "Underchat",
	practice: "Underchat",
	mapping: "Underchat",
	sub: "Underchat",
	exam: "Fag-chat",
};

/** Parse, don't cast: the fields the line needs, or null. */
export function parseCourseContext(data: unknown): CourseContextData | null {
	if (typeof data !== "object" || data === null) return null;
	const d = data as Record<string, unknown>;
	if (typeof d.code !== "string" || d.code.trim().length === 0) return null;
	const mode = d.mode === "learn" || d.mode === "practice" || d.mode === "mapping" || d.mode === "exam" || d.mode === "sub" ? d.mode : undefined;
	return {
		code: d.code.trim(),
		name: typeof d.name === "string" ? d.name.trim() : "",
		topicId: typeof d.topicId === "string" && d.topicId.length > 0 ? d.topicId : undefined,
		topicTitle: typeof d.topicTitle === "string" && d.topicTitle.trim().length > 0 ? d.topicTitle.trim() : undefined,
		mode,
		sourceCount:
			typeof d.sourceCount === "number" && Number.isFinite(d.sourceCount) ? Math.max(0, Math.round(d.sourceCount)) : 0,
	};
}

/** The line's text segments after the course itself, in reading order.
 *  Pure, exported for tests. */
export function courseContextSegments(data: CourseContextData): string[] {
	const out: string[] = [];
	if (data.mode) out.push(MODE_LABEL[data.mode]);
	if (data.topicTitle) out.push(`Tema: ${data.topicTitle}`);
	out.push(data.sourceCount === 0 ? "Ingen kilder" : `${data.sourceCount} ${data.sourceCount === 1 ? "kilde" : "kilder"}`);
	return out;
}

export function CourseContextCard({ data }: { data: unknown }) {
	const course = parseCourseContext(data);
	if (!course) return null;
	return (
		<div
			data-testid="course-context-card"
			className="my-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
		>
			<GraduationCapIcon aria-hidden="true" className="size-3.5 shrink-0" />
			<Link
				href={`/fag/${encodeURIComponent(course.code)}`}
				data-testid="course-context-link"
				title="Åpne fagsiden"
				className="min-w-0 shrink truncate font-medium text-foreground/80 underline-offset-4 transition-colors hover:text-foreground hover:underline"
			>
				{course.code}
				{course.name ? ` ${course.name}` : ""}
			</Link>
			{courseContextSegments(course).map((segment) => (
				<span key={segment} className="shrink-0 whitespace-nowrap">
					<span aria-hidden="true">· </span>
					{segment}
				</span>
			))}
		</div>
	);
}
