/**
 * GET  /api/streak — the flame: days in a row with a real answer, today's
 *                    state, the best streak, the week row and a level to
 *                    celebrate (fase 7b).
 * POST /api/streak — { celebrated: "<level id>" }: «Nytt nivå» was shown.
 */
import { installStreakWatcher, markStreakCelebrated, readStreak } from "@/src/server";

export const dynamic = "force-dynamic";

export function GET(): Response {
	installStreakWatcher();
	return Response.json(readStreak());
}

export async function POST(req: Request): Promise<Response> {
	let body: unknown = null;
	try {
		body = await req.json();
	} catch { /* reported below */ }
	const level = (body as { celebrated?: unknown } | null)?.celebrated;
	if (!markStreakCelebrated(level)) {
		return Response.json({ error: "Ukjent nivå.", code: "invalid_level" }, { status: 400 });
	}
	return Response.json(readStreak());
}
