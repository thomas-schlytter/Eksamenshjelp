import { CoursesHome } from "@/components/courses/courses-home";
import { listCourseSummaries, readSettingsRecord } from "@/src/server";
import { slotsConfigured } from "@/src/core";

// Dynamic: the configured state is server-rendered into the page (the
// setup CTA's truth on the first frame), and every navigation re-reads
// the record (dynamic routes aren't cached client-side).
export const dynamic = "force-dynamic";

/**
 * HOME is «Mine fag» (NTNU round): the student's fag, «Legg til fag», and
 * a start box for a free session. The knowledge map that used to be the
 * home view lives at /kart.
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<{ leggtil?: string }> }) {
	// `?leggtil=1` (the sidebar's «Legg til fag»): arrive with the search open.
	const { leggtil } = await searchParams;
	// First-run gate (model-slots wave): sessions cannot start until the
	// user has picked all three slots; the start box shows the CTA while
	// the raw record's models section lacks any slot pin.
	return (
		<CoursesHome
			initialConfigured={slotsConfigured(readSettingsRecord()?.models)}
			initialAdding={leggtil === "1"}
			// Server-read: the first frame shows the real cards (or the real
			// welcome), never a flash of the other.
			initialCourses={listCourseSummaries()}
		/>
	);
}
