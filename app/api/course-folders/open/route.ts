/**
 * POST /api/course-folders/open — «Åpne fagmappen»: the fagmappe, or one
 * course's folder (`{ code }`), in Finder or Explorer.
 */
import { openCourseFolder } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
	const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
	const outcome = openCourseFolder(body?.code);
	if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
	return Response.json({ ok: true, path: outcome.path });
}
