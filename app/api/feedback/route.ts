/**
 * «Meld feil» (2026-11-26).
 * GET  /api/feedback — the technical info «Ta med teknisk info» adds
 *                      (version, system, AI, log tail), for the preview.
 * POST /api/feedback — { message, email?, includeDetails } → sent to the
 *                      website's /api/feil, which files a private issue.
 */
import { buildFeedbackPayload, collectFeedbackDetails, sendFeedback } from "@/src/server";

export const dynamic = "force-dynamic";

export function GET(): Response {
	return Response.json(collectFeedbackDetails());
}

export async function POST(req: Request): Promise<Response> {
	let body: unknown = null;
	try {
		body = await req.json();
	} catch { /* reported below */ }
	const built = buildFeedbackPayload((body ?? {}) as Record<string, unknown>);
	if (!built.ok) return Response.json({ error: built.error }, { status: 400 });
	const error = await sendFeedback(built.payload);
	if (error) return Response.json({ error }, { status: 502 });
	return Response.json({ ok: true });
}
