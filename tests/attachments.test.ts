/**
 * /api/attachments («Legg inn besvarelse»): a pasted image (a file with no
 * path of its own) is saved under the data folder and its absolute path
 * comes back for the composer's chip. Bytes decide the type, never the
 * request's claim; the name is generated, never taken from the request.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

// ── the seam, BEFORE any config-loading import ──────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-attachments-"));
process.env.LH_DATA_DIR = path.join(TMP, "data");
process.env.LH_AUTH_FILE = path.join(TMP, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");

const { ATTACHMENT_MAX_BYTES, attachmentsDir, saveAttachment } = await import("../src/server/attachments.ts");
const route = await import("../app/api/attachments/route.ts");

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

/** A 1×1 PNG. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< >>\nendobj\ntrailer\n<< >>\n%%EOF\n");

const post = (body: Buffer, type = "image/png") =>
	route.POST(new Request("http://lh.test/api/attachments", { method: "POST", headers: { "content-type": type }, body: new Uint8Array(body) }));

describe("saveAttachment", () => {
	it("saves an image under the data folder with a generated, typed name", async () => {
		const outcome = await saveAttachment(PNG, new Date(2026, 10, 23, 14, 25, 1));
		assert.ok(outcome.ok);
		assert.equal(path.dirname(outcome.path), attachmentsDir());
		assert.equal(attachmentsDir(), path.join(TMP, "data", "vedlegg"));
		assert.match(path.basename(outcome.path), /^besvarelse-20261123-142501-[0-9a-f]{6}\.png$/);
		assert.deepEqual(fs.readFileSync(outcome.path), PNG);
	});

	it("recognizes a PDF by its bytes", async () => {
		const outcome = await saveAttachment(PDF);
		assert.ok(outcome.ok);
		assert.match(outcome.path, /\.pdf$/);
	});

	it("two saves in the same second never collide", async () => {
		const now = new Date(2026, 10, 23, 9, 0, 0);
		const [a, b] = await Promise.all([saveAttachment(PNG, now), saveAttachment(PNG, now)]);
		assert.ok(a.ok && b.ok);
		assert.notEqual(a.path, b.path);
	});

	it("refuses empty, oversized and non-image/PDF bytes with Norwegian messages", async () => {
		const empty = await saveAttachment(new Uint8Array());
		assert.ok(!empty.ok);
		assert.equal(empty.status, 400);
		assert.equal(empty.code, "file_required");
		const text = await saveAttachment(Buffer.from("just text, claimed to be a png"));
		assert.ok(!text.ok);
		assert.equal(text.code, "file_unsupported");
		assert.match(text.error, /Bare bilder/);
		const huge = await saveAttachment(new Uint8Array(ATTACHMENT_MAX_BYTES + 1));
		assert.ok(!huge.ok);
		assert.equal(huge.status, 413);
	});
});

describe("POST /api/attachments", () => {
	it("answers { path } for raw image bytes", async () => {
		const res = await post(PNG);
		assert.equal(res.status, 200);
		const body = (await res.json()) as { path: string };
		assert.ok(path.isAbsolute(body.path));
		assert.ok(body.path.startsWith(attachmentsDir()));
		assert.ok(fs.existsSync(body.path));
	});

	it("the claimed type does not matter: text sent as image/png is refused", async () => {
		const res = await post(Buffer.from("hello"), "image/png");
		assert.equal(res.status, 400);
		assert.equal(((await res.json()) as { code: string }).code, "file_unsupported");
	});
});
