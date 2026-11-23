/**
 * «Legg inn besvarelse» for files that have no path of their own: an image
 * pasted from the clipboard (or, in a browser build, a picked file the page
 * cannot resolve to a path). The bytes are saved under the data folder and
 * the absolute path goes back to the composer as an ordinary path chip, so
 * the agent reads it with `read` like any other file of the learner's.
 *
 * Only images and PDFs, recognized by their bytes (never the claimed type);
 * the file name is generated here, never taken from the request.
 */
import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { detectSupportedImageMimeType } from "../agent/image-processing/index.ts";

/** A phone photo of a page or an exported answer PDF fits well under this. */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/** Where saved attachments live: the app's data folder, beside the chats
 *  that reference them. */
export function attachmentsDir(): string {
	return path.join(PATHS.data, "vedlegg");
}

export type AttachmentOutcome =
	| { ok: true; path: string }
	| { ok: false; status: 400 | 413; code: string; error: string };

const EXTENSION: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/bmp": "bmp",
	"application/pdf": "pdf",
};

function detectType(bytes: Uint8Array): string | null {
	const image = detectSupportedImageMimeType(bytes);
	if (image) return image;
	const head = Buffer.from(bytes.subarray(0, 1024));
	return head.includes("%PDF-") ? "application/pdf" : null;
}

/** besvarelse-20261123-142501-a1b2c3.png: sortable, never colliding. */
function fileName(extension: string, now: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	return `besvarelse-${stamp}-${randomBytes(3).toString("hex")}.${extension}`;
}

export async function saveAttachment(bytes: Uint8Array, now = new Date()): Promise<AttachmentOutcome> {
	if (bytes.byteLength === 0) return { ok: false, status: 400, code: "file_required", error: "Fant ingen fil å legge ved." };
	if (bytes.byteLength > ATTACHMENT_MAX_BYTES) {
		return { ok: false, status: 413, code: "file_too_large", error: "Filen er for stor. Største størrelse er 25 MB." };
	}
	const type = detectType(bytes);
	if (!type) {
		return { ok: false, status: 400, code: "file_unsupported", error: "Bare bilder (PNG, JPEG, GIF, WebP, BMP) og PDF kan legges ved." };
	}
	const dir = attachmentsDir();
	await fs.mkdir(dir, { recursive: true });
	const target = path.join(dir, fileName(EXTENSION[type]!, now));
	await fs.writeFile(target, bytes, { flag: "wx" });
	return { ok: true, path: target };
}

export function attachmentFailureResponse(failure: Extract<AttachmentOutcome, { ok: false }>): Response {
	return Response.json({ code: failure.code, error: failure.error }, { status: failure.status });
}
