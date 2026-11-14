/**
 * POST /api/import/legacy/preview { path } → what an import from that folder
 * would add (ImportPreview, src/core/data-import.ts). Reads only. Key
 * VALUES never appear here: only the variable names.
 */
import { legacyImportPreviewResponse } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	return legacyImportPreviewResponse(await request.json().catch(() => null));
}
