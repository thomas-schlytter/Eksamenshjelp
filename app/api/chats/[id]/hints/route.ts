/**
 * POST { toolCallId } → { hints } — the Hint button on a task (owner,
 * 2026-11-23). Authored hints come back as they are; a task without them
 * gets a ladder made once and cached (src/server/task-hints.ts). No turn,
 * no transcript write.
 */
import { taskHints } from "@/src/server";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	const body = (await req.json().catch(() => null)) as { toolCallId?: unknown } | null;
	const toolCallId = typeof body?.toolCallId === "string" ? body.toolCallId : "";
	const outcome = await taskHints(id, toolCallId);
	if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
	return Response.json({ hints: outcome.hints, generated: outcome.generated });
}
