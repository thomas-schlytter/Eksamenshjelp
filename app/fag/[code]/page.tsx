import { CourseNotFound, CoursePage } from "@/components/courses/course-page";
import { readCourse, readSettingsRecord } from "@/src/server";
import { slotsConfigured } from "@/src/core";

// Dynamic: the fag is read per navigation (statuses change during
// sessions; dynamic routes aren't cached client-side).
export const dynamic = "force-dynamic";

/**
 * THE FAG PAGE (/fag/[code]): the fag and its exam plan are read here, on
 * the server, so the first frame already shows the real plan. An unknown
 * fagkode renders the «Fant ikke faget» page (with the way home) instead
 * of a bare 404.
 */
export default async function CourseRoute({ params }: { params: Promise<{ code: string }> }) {
	const { code } = await params;
	let wanted = code;
	try {
		wanted = decodeURIComponent(code);
	} catch { /* a malformed escape is just an unknown fag */ }
	const outcome = readCourse(wanted);
	if (!outcome.ok) return <CourseNotFound code={wanted.slice(0, 24)} />;
	return (
		<CoursePage
			// A fresh page per fag: no state leaks between two fag.
			key={outcome.course.code}
			initial={{ course: outcome.course, plan: outcome.plan }}
			initialConfigured={slotsConfigured(readSettingsRecord()?.models)}
		/>
	);
}
