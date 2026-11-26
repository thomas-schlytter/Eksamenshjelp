/**
 * POST /api/flashcards/[code]/generate — { mode: "new" | "more" | "replace" }:
 * start making the deck, 15 more cards, or a new deck, in the background.
 * Answers 202 with the view (generating set); `flashcards-changed` follows
 * when the cards are in.
 */
import { flashcardFailureResponse, startFlashcardGeneration } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
	let body: unknown = null;
	try {
		body = await req.json();
	} catch { /* no body = a first deck */ }
	const outcome = startFlashcardGeneration((await params).code, body);
	if (!outcome.ok) return flashcardFailureResponse(outcome);
	return Response.json(outcome.view, { status: 202 });
}
