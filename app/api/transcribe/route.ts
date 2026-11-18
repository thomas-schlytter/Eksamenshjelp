/**
 * POST /api/transcribe — read a screenshot of mathematical work into
 * markdown + LaTeX. Body: `{ image: <base64 or data URL>, fix?: boolean }`.
 * The image is not stored anywhere.
 */
import { transcribeFailureResponse, transcribeImage } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const outcome = await transcribeImage(await req.json().catch(() => null), req.signal);
	if (!outcome.ok) return transcribeFailureResponse(outcome);
	return Response.json({ latex: outcome.latex, changes: outcome.changes });
}
