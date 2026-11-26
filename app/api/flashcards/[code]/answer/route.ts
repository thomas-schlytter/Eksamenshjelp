/**
 * POST /api/flashcards/[code]/answer — { cardId, chosen: number[] | null }
 * (null = «Vet ikke»): scored from the stored card and recorded on it.
 */
import { answerFlashcard, flashcardFailureResponse } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
	let body: unknown = null;
	try {
		body = await req.json();
	} catch { /* refused below */ }
	const outcome = answerFlashcard((await params).code, body);
	if (!outcome.ok) return flashcardFailureResponse(outcome);
	return Response.json({ correct: outcome.correct, progress: outcome.progress, stats: outcome.stats });
}
