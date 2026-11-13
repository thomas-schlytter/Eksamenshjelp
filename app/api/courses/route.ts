/**
 * /api/courses — the learner's courses ("fag", exam mode).
 *
 * GET lists the course cards (summaries); POST adds a course: `{ code }`
 * fetches it from NTNU, `{ code, name, custom: true }` creates it by hand.
 * An existing course is returned as it is (200), never duplicated.
 */
import { courseFailureResponse, createCourse, listCourseSummaries, warmCourseSearch } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	// Whoever opens the course list is about to search: fetch NTNU's list
	// in the background (cached a week) so the first search is instant.
	warmCourseSearch();
	return Response.json({ courses: listCourseSummaries() });
}

export async function POST(req: Request) {
	const outcome = await createCourse(await req.json().catch(() => null));
	if (!outcome.ok) return courseFailureResponse(outcome);
	return Response.json({ course: outcome.course, plan: outcome.plan });
}
