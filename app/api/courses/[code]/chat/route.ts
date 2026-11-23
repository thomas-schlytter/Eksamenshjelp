/**
 * POST /api/courses/[code]/chat — the fag's fag-chat (fase 2: one chat per
 * fag). Returns the existing one, or creates it the first time. `empty`
 * tells the caller the chat has no conversation yet.
 */
import { openCourseChat } from "@/src/server";

export async function POST(_req: Request, { params }: { params: Promise<{ code: string }> }) {
	const outcome = openCourseChat((await params).code);
	if (!outcome.ok) return Response.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
	return Response.json({ id: outcome.id, created: outcome.created, empty: outcome.empty });
}
