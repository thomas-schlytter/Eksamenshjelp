/**
 * POST /api/courses/[code]/refresh — fetch the course's NTNU data again.
 * The learner's own exam date and own sources are left alone.
 */
import { courseFailureResponse, refreshCourse } from "@/src/server";

export async function POST(_req: Request, { params }: { params: Promise<{ code: string }> }) {
	const outcome = await refreshCourse((await params).code);
	if (!outcome.ok) return courseFailureResponse(outcome);
	return Response.json({ course: outcome.course, plan: outcome.plan });
}
