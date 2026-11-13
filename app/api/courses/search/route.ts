/**
 * GET /api/courses/search?q= — search NTNU's courses by code or name
 * (at most 20 hits, from the cached course list).
 */
import { searchCourses } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	const outcome = await searchCourses(new URL(req.url).searchParams.get("q") ?? "");
	// `hits` stays present on failure so a list renderer never meets undefined.
	if (!outcome.ok) return Response.json({ hits: [], error: outcome.error, code: outcome.code }, { status: outcome.status });
	return Response.json({ hits: outcome.hits });
}
