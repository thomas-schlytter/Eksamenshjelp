/**
 * PUT /api/courses/[code]/topics — replace the topic list (manual
 * editing). A topic that keeps its id keeps its status.
 */
import { courseFailureResponse, replaceCourseTopics } from "@/src/server";

export async function PUT(req: Request, { params }: { params: Promise<{ code: string }> }) {
	const outcome = replaceCourseTopics((await params).code, await req.json().catch(() => null));
	if (!outcome.ok) return courseFailureResponse(outcome);
	return Response.json({ course: outcome.course, plan: outcome.plan });
}
