/**
 * POST /api/flashcards/[code]/reset — «Nullstill fremgang»: the cards stay,
 * every right/wrong count goes.
 */
import { flashcardFailureResponse, resetFlashcards } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ code: string }> }) {
	const outcome = resetFlashcards((await params).code);
	if (!outcome.ok) return flashcardFailureResponse(outcome);
	return Response.json(outcome.view);
}
