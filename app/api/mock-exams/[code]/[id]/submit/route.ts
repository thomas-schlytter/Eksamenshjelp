/**
 * POST /api/mock-exams/[code]/[id]/submit — «Lever»: save the final answers
 * (`{ answers }`) and freeze them. The grading itself starts in the fag-chat.
 */
import { mockExamFailureResponse, submitMockExam } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
	const { code, id } = await params;
	const outcome = submitMockExam(code, id, await req.json().catch(() => null));
	if (!outcome.ok) return mockExamFailureResponse(outcome);
	return Response.json({ answers: outcome.answers });
}
