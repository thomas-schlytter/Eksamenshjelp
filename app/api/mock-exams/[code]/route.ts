/**
 * GET /api/mock-exams/[code] — the course's prøveeksamener (id, title,
 * date) and every graded result, oldest first: the read API for a score
 * curve on the course page.
 */
import { listCourseMockExams, mockExamFailureResponse } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
	const outcome = listCourseMockExams((await params).code);
	if (!outcome.ok) return mockExamFailureResponse(outcome);
	return Response.json({ exams: outcome.exams, results: outcome.results });
}
