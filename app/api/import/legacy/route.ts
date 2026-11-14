/**
 * /api/import/legacy — "Importer fra LearnHarness" (src/server/data-import.ts).
 *
 *   GET  → { candidates: [{ path, label, current, preview? }] }: the desktop
 *          app's standard data folders found on this machine.
 *   POST { path, include: { chats, graph, settings, keys, prompts } }
 *        → the import result (counts per category, what was skipped and
 *          why, the backup folder). Additive only; refuses with 409 while a
 *          turn, a background job or an extraction is running.
 *
 * Failures are `{ error (Norwegian), code }`.
 */
import { legacyImportCandidatesResponse, legacyImportRunResponse } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return legacyImportCandidatesResponse();
}

export async function POST(request: Request) {
	// The body is read BEFORE the import; the import itself is one
	// synchronous block (no await between its gate and its writes).
	return legacyImportRunResponse(await request.json().catch(() => null));
}
