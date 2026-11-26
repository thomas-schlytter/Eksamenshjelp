/**
 * GET /api/flashcards/[code] — the course's spørsmålskort: the deck (cards
 * and progress), the counts, the topics missed a lot, and whether a
 * generation is running (or just failed).
 */
import { flashcardFailureResponse, readFlashcards } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
	const outcome = readFlashcards((await params).code);
	if (!outcome.ok) return flashcardFailureResponse(outcome);
	return Response.json(outcome.view);
}
