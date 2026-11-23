/**
 * «Avslutt økt» → «Oppsummering med quiz» (2026-11-22; 2026-11-23).
 *
 * POST  — stop a running turn and close an open question, then generate
 *         the økt's summary + 3-10 question recall quiz with the chat's
 *         own model (or return the draft already in progress).
 * PATCH — `{ index, choice }`: record one quiz answer on the draft.
 *
 * See src/server/session-wrap.ts for the gates and the record writes.
 */
import { answerSessionWrap, generateSessionWrap, wrapFailureResponse } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const outcome = await generateSessionWrap((await params).id);
	if (!outcome.ok) return wrapFailureResponse(outcome);
	return Response.json({ draft: outcome.draft });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const outcome = answerSessionWrap((await params).id, await req.json().catch(() => null));
	if (!outcome.ok) return wrapFailureResponse(outcome);
	return Response.json({ draft: outcome.draft });
}
