/**
 * POST /api/courses/[code]/sources — add the learner's own context: a
 * file or folder on this machine (by path), a link, or a pasted note.
 */
import { addCourseSource, courseFailureResponse } from "@/src/server";

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
	const outcome = addCourseSource((await params).code, await req.json().catch(() => null));
	if (!outcome.ok) return courseFailureResponse(outcome);
	return Response.json({ course: outcome.course, plan: outcome.plan });
}
