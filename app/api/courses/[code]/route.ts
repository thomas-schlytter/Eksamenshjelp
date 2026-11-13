/**
 * /api/courses/[code] — one course: read, edit (name, exam facts, minutes
 * per day) and delete. Deleting keeps the sessions started from it.
 */
import { courseFailureResponse, patchCourse, readCourse, removeCourse } from "@/src/server";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ code: string }> };

export async function GET(_req: Request, { params }: Context) {
	const outcome = readCourse((await params).code);
	if (!outcome.ok) return courseFailureResponse(outcome);
	return Response.json({ course: outcome.course, plan: outcome.plan });
}

export async function PATCH(req: Request, { params }: Context) {
	const outcome = patchCourse((await params).code, await req.json().catch(() => null));
	if (!outcome.ok) return courseFailureResponse(outcome);
	return Response.json({ course: outcome.course, plan: outcome.plan });
}

export async function DELETE(_req: Request, { params }: Context) {
	const outcome = removeCourse((await params).code);
	if (!outcome.ok) return courseFailureResponse(outcome);
	return Response.json({ ok: true });
}
