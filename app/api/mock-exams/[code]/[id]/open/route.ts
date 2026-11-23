/**
 * POST /api/mock-exams/[code]/[id]/open — «Åpne PDF»: opens the paper in the
 * system's PDF viewer.
 */
import { mockExamFailureResponse, openMockExamPdf } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
	const { code, id } = await params;
	const outcome = openMockExamPdf(code, id);
	if (!outcome.ok) return mockExamFailureResponse(outcome);
	return Response.json({ ok: true });
}
