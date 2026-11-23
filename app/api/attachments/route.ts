/**
 * POST /api/attachments — save a pasted image (or a picked file without a
 * path of its own) under the data folder. Body: the raw file bytes.
 * Answers `{ path }`: the absolute path the composer attaches as a chip.
 */
import { ATTACHMENT_MAX_BYTES, attachmentFailureResponse, saveAttachment } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const declared = Number(req.headers.get("content-length") ?? "0");
	if (declared > ATTACHMENT_MAX_BYTES) {
		return attachmentFailureResponse({ ok: false, status: 413, code: "file_too_large", error: "Filen er for stor. Største størrelse er 25 MB." });
	}
	const outcome = await saveAttachment(new Uint8Array(await req.arrayBuffer()));
	if (!outcome.ok) return attachmentFailureResponse(outcome);
	return Response.json({ path: outcome.path });
}
