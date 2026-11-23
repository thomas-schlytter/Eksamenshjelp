/**
 * PUT /api/chats/[id]/course — «Flytt til fag…» (fase 2). Body: { code }.
 * The loose session becomes an underchat of the fag; the course-context
 * marker is written the way creation writes it.
 */
import { moveChatToCourse } from "@/src/server";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
	const outcome = moveChatToCourse(id, body?.code);
	if (!outcome.ok) return Response.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
	return Response.json({ course: outcome.course });
}
