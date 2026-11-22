/**
 * POST /api/chats/[id]/wrap/complete — end the økt: the quiz draft becomes
 * the «Økt avsluttet» marker at the transcript's tail (409 while a turn,
 * a compaction or a pending question holds the chat — retryable).
 */
import { completeSessionWrap, wrapFailureResponse } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const outcome = completeSessionWrap((await params).id);
	if (!outcome.ok) return wrapFailureResponse(outcome);
	return Response.json({ markerId: outcome.markerId });
}
