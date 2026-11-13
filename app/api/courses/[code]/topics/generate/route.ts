/**
 * POST /api/courses/[code]/topics/generate — build the topic list: a
 * model when one is set up, otherwise the deterministic reserve from the
 * learning outcomes. Topics that keep their id keep their status.
 */
import { courseFailureResponse, generateCourseTopics } from "@/src/server";

export async function POST(_req: Request, { params }: { params: Promise<{ code: string }> }) {
	const outcome = await generateCourseTopics((await params).code);
	if (!outcome.ok) return courseFailureResponse(outcome);
	return Response.json({ course: outcome.course, plan: outcome.plan, generatedBy: outcome.generatedBy });
}
