/**
 * POST /api/chats/[id]/wrap/complete — end the økt: the «Økt avsluttet»
 * marker at the transcript's tail. No body: from the quiz draft (409
 * without one). `{ mode: "end" }`: «Bare avslutt», no quiz. A running turn
 * is stopped and an open question closed first (src/server/session-wrap.ts).
 */
import { completeSessionWrap, wrapFailureResponse } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const outcome = await completeSessionWrap((await params).id, await req.json().catch(() => null));
	if (!outcome.ok) return wrapFailureResponse(outcome);
	return Response.json({ markerId: outcome.markerId });
}
