/**
 * GET /api/mock-exams/[code]/[id] — the public paper (no key), the learner's
 * saved answers, the latest graded result, and whether the PDF exists.
 * PUT — save the draft: `{ answers, timerStartedAt? }` (409 once handed in).
 */
import { getMockExamView, mockExamFailureResponse, saveMockExamDraft } from "@/src/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ code: string; id: string }> };

export async function GET(_req: Request, { params }: Params) {
	const { code, id } = await params;
	const outcome = getMockExamView(code, id);
	if (!outcome.ok) return mockExamFailureResponse(outcome);
	return Response.json({ exam: outcome.exam, answers: outcome.answers, result: outcome.result, hasPdf: outcome.hasPdf });
}

export async function PUT(req: Request, { params }: Params) {
	const { code, id } = await params;
	const outcome = saveMockExamDraft(code, id, await req.json().catch(() => null));
	if (!outcome.ok) return mockExamFailureResponse(outcome);
	return Response.json({ answers: outcome.answers });
}
