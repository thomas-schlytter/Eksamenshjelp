/**
 * DELETE /api/courses/[code]/sources/[id] — remove one source from the
 * course. Files on disk are never touched.
 */
import { courseFailureResponse, removeCourseSource } from "@/src/server";

export async function DELETE(_req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
	const { code, id } = await params;
	const outcome = removeCourseSource(code, id);
	if (!outcome.ok) return courseFailureResponse(outcome);
	return Response.json({ course: outcome.course, plan: outcome.plan });
}
