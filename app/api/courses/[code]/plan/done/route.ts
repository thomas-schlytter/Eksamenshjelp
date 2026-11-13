/**
 * POST /api/courses/[code]/plan/done — check an exam-plan item on or off
 * (`{ key, done }`; the key is the plan item's own).
 */
import { courseFailureResponse, setPlanItemDone } from "@/src/server";

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
	const outcome = setPlanItemDone((await params).code, await req.json().catch(() => null));
	if (!outcome.ok) return courseFailureResponse(outcome);
	return Response.json({ course: outcome.course, plan: outcome.plan });
}
