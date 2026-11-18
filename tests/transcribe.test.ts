/**
 * /api/transcribe («Les av skjermbilde»): the route driven directly with
 * the reader's engine replaced through transcribeSeams. Pins the request
 * and response shapes, the refusals, and the verbatim/fix split.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";

// ── the seam, BEFORE any config-loading import ──────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-transcribe-"));
process.env.LH_DATA_DIR = path.join(TMP, "data");
process.env.LH_AUTH_FILE = path.join(TMP, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");

const { transcribeSeams, parseTranscription, transcribeSystemPrompt, CHANGES_MARK, UNREADABLE_MARK } = await import("../src/server/transcribe.ts");
const route = await import("../app/api/transcribe/route.ts");
const { ROLE_SLOT, BACKGROUND_MODEL_ROLES } = await import("../src/core/settings.ts");
const { resolveRoleSpec } = await import("../src/core/settings-resolution.ts");

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

/** A 1×1 PNG. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const faux = createFauxCore({});
const seen: { system: string | undefined; hasImage: boolean }[] = [];
function engine(vision = true): PiEngine {
	const model = { ...faux.getModel(), input: vision ? ["text", "image"] : ["text"] };
	return {
		model,
		streamFn: ((m: unknown, context: { systemPrompt?: string; messages: { content: unknown }[] }, options: unknown) => {
			seen.push({
				// The system prompt rides the transcript as its leading message.
				system: context.systemPrompt ?? JSON.stringify(context.messages.find((msg) => (msg as { role?: string }).role === "system") ?? ""),
				hasImage: context.messages.some((msg) => Array.isArray(msg.content) && msg.content.some((c: { type?: string }) => c.type === "image")),
			});
			return (faux.streamSimple as (...args: unknown[]) => unknown)(m, context, options);
		}) as never,
	} as unknown as PiEngine;
}

const post = (body: unknown) =>
	route.POST(new Request("http://lh.test/api/transcribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
	seen.length = 0;
	transcribeSeams.engine = () => engine();
});

describe("the transcriber role", () => {
	it("is a background role on the vision slot, with its own override first", () => {
		assert.ok((BACKGROUND_MODEL_ROLES as readonly string[]).includes("transcriber"));
		assert.equal(ROLE_SLOT.transcriber, "vision");
		const slotOnly = resolveRoleSpec("transcriber", { version: 1, models: { vision: { model: { provider: "zai", id: "v" } } } });
		assert.deepEqual({ provider: slotOnly?.provider, id: slotOnly?.id }, { provider: "zai", id: "v" });
		const own = resolveRoleSpec("transcriber", {
			version: 1,
			models: { vision: { model: { provider: "zai", id: "v" } } },
			agent: { models: { transcriber: { model: { provider: "openrouter", id: "own" } } } },
		});
		assert.deepEqual({ provider: own?.provider, id: own?.id }, { provider: "openrouter", id: "own" });
	});
});

describe("parseTranscription", () => {
	it("splits the change list off and peels a wrapping code fence", () => {
		assert.deepEqual(parseTranscription("```markdown\n$$x^2$$\n```"), { latex: "$$x^2$$", changes: [] });
		assert.deepEqual(parseTranscription(`$$a \\leq b$$\n${CHANGES_MARK}\n- $\\geq$ ble til $\\leq$\n* to\n`), {
			latex: "$$a \\leq b$$",
			changes: ["$\\geq$ ble til $\\leq$", "to"],
		});
	});
	it("the two prompts differ exactly where it matters", () => {
		assert.match(transcribeSystemPrompt(false), /Do not correct anything/);
		assert.doesNotMatch(transcribeSystemPrompt(false), new RegExp(CHANGES_MARK));
		assert.match(transcribeSystemPrompt(true), new RegExp(CHANGES_MARK));
		for (const fix of [true, false]) assert.ok(transcribeSystemPrompt(fix).includes(UNREADABLE_MARK));
	});
});

describe("POST /api/transcribe", () => {
	it("reads verbatim by default: the image reaches the model, no changes come back", async () => {
		faux.setResponses([fauxAssistantMessage([fauxText("$$|E_n| \\geq 1$$")])]);
		const res = await post({ image: `data:image/png;base64,${PNG}` });
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), { latex: "$$|E_n| \\geq 1$$", changes: [] });
		assert.equal(seen.length, 1);
		assert.equal(seen[0]!.hasImage, true);
		assert.match(seen[0]!.system ?? "", /Do not correct anything/);
	});

	it("fix: true uses the correcting prompt and returns the change list", async () => {
		faux.setResponses([fauxAssistantMessage([fauxText(`$$|E_n| \\leq 1$$\n${CHANGES_MARK}\n- $\\geq$ rettet til $\\leq$`)])]);
		const res = await post({ image: PNG, fix: true });
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), { latex: "$$|E_n| \\leq 1$$", changes: ["$\\geq$ rettet til $\\leq$"] });
		assert.match(seen[0]!.system ?? "", /Correct OBVIOUS errors only/);
	});

	it("refuses a missing image, a non-image, a missing model and a model without vision", async () => {
		const cases: [unknown, number, string][] = [
			[{}, 400, "image_required"],
			[null, 400, "image_required"],
			[{ image: Buffer.from("not an image at all").toString("base64") }, 400, "image_unsupported"],
		];
		for (const [body, status, code] of cases) {
			const res = await post(body);
			assert.equal(res.status, status);
			assert.equal((await res.json()).code, code);
		}
		transcribeSeams.engine = () => undefined;
		let res = await post({ image: PNG });
		assert.equal(res.status, 503);
		assert.equal((await res.json()).code, "models_not_configured");
		transcribeSeams.engine = () => engine(false);
		res = await post({ image: PNG });
		assert.equal(res.status, 503);
		assert.equal((await res.json()).code, "model_without_vision");
		assert.equal(seen.length, 0, "no model call on any refusal");
	});

	it("an empty model answer is a 502, not an empty window", async () => {
		faux.setResponses([fauxAssistantMessage([fauxText("   ")])]);
		const res = await post({ image: PNG });
		assert.equal(res.status, 502);
		assert.equal((await res.json()).code, "empty_transcription");
	});
});
