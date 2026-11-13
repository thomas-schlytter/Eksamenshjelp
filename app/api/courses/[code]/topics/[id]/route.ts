/**
 * PATCH /api/courses/[code]/topics/[id] — edit one topic. A status set
 * here is the learner's own call (statusSource "self").
 */
import { courseFailureResponse, patchCourseTopic } from "@/src/server";

export async function PATCH(req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
	const { code, id } = await params;
	const outcome = patchCourseTopic(code, id, await req.json().catch(() => null));
	if (!outcome.ok) return courseFailureResponse(outcome);
	return Response.json({ course: outcome.course, plan: outcome.plan });
}
