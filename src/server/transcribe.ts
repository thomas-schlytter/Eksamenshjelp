/**
 * Screenshot → LaTeX ("Les av skjermbilde"). The learner pastes, drops or
 * picks an image of handwritten or typeset work; one vision call writes it
 * out as the app's own markdown + LaTeX (`$…$` inline, `$$` display), and
 * the review window lets him check it against the image before it enters
 * the composer.
 *
 * The image is never stored: it rides the request, goes to the model and
 * is gone. The reader is VERBATIM by default (mistakes in the work are the
 * teacher's to judge, not the reader's to hide); `fix` asks it to correct
 * obvious errors and to list every change so the learner can go over them.
 *
 * Model: the `transcriber` role — its own override in Agent settings, else
 * the vision slot (ROLE_SLOT).
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { resolveRoleSpec } from "../core/settings-resolution.ts";
import { ROLE_SLOT } from "../core/settings.ts";
import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { runSubagent } from "../agent/subagents/pi-run.ts";
import { withBgLlmSlot } from "../agent/subagents/bg-llm-semaphore.ts";
import { detectSupportedImageMimeType, processImage } from "../agent/image-processing/index.ts";
import { settingsStore } from "../store/settings.ts";
import { providerKeyPresent } from "./keys.ts";

/** The decoded image ceiling. Screenshots are far below this; the cap only
 *  keeps a stray huge file from riding a JSON body into memory. */
export const TRANSCRIBE_MAX_BYTES = 12 * 1024 * 1024;
const TRANSCRIBE_TIMEOUT_MS = 120_000;

/** What the reader writes where it cannot make the image out. */
export const UNREADABLE_MARK = "[uleselig]";
/** The line that separates the transcription from the list of changes. */
export const CHANGES_MARK = "===RETTELSER===";

export interface TranscribeFailure {
	ok: false;
	status: 400 | 413 | 502 | 503;
	code: string;
	error: string;
}
export type TranscribeOutcome = { ok: true; latex: string; changes: string[] } | TranscribeFailure;

const fail = (status: TranscribeFailure["status"], code: string, error: string): TranscribeFailure => ({ ok: false, status, code, error });

export function transcribeFailureResponse(failure: TranscribeFailure): Response {
	return Response.json({ error: failure.error, code: failure.code }, { status: failure.status });
}

const BASE_PROMPT = `You transcribe an image of a student's mathematical work (handwritten or typeset) into markdown with LaTeX.

Output format — the app renders markdown with KaTeX:
- Inline math: $...$. Display math: $$ on its own line above and below the formula.
- One formula per display block; keep the order and the line breaks of the work.
- Plain text stays plain text in the language it is written in (usually Norwegian). Task labels such as "a)" become a short markdown heading (### a) …).
- Decimal commas are written {,} inside math (3{,}136).
- No code fences, no preamble, no closing remarks: output only the transcription.
- Where you cannot read something, write ${UNREADABLE_MARK} in its place. Never guess.
- Ignore spell-check underlines, grid lines and other artefacts of the screenshot.`;

const VERBATIM_PROMPT = `${BASE_PROMPT}

Transcribe EXACTLY what is written. Do not correct anything: a wrong sign, a wrong number, a wrong inequality or a misspelling is copied as it stands. The student's teacher needs to see the work as it is.`;

const FIX_PROMPT = `${BASE_PROMPT}

Correct OBVIOUS errors only: slips of the pen, arithmetic that does not follow from the line above, a symbol that is plainly the wrong one, misspellings. Do not rewrite, restructure or improve the method.

After the transcription, output a line containing only ${CHANGES_MARK} and then one markdown bullet per change you made, in Norwegian bokmål, each naming what stood in the image and what you wrote instead (use $...$ for math). If you changed nothing, output the marker line and nothing after it.`;

export function transcribeSystemPrompt(fix: boolean): string {
	return fix ? FIX_PROMPT : VERBATIM_PROMPT;
}

/** Split the model's text into the transcription and the change list.
 *  A wrapping code fence (a common weak-model habit) is peeled off. Pure. */
export function parseTranscription(text: string): { latex: string; changes: string[] } {
	const [body = "", ...rest] = text.split(CHANGES_MARK);
	let latex = body.trim();
	const fenced = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(latex);
	if (fenced?.[1] !== undefined) latex = fenced[1].trim();
	const changes = rest
		.join("\n")
		.split("\n")
		.map((line) => line.trim().replace(/^[-*•]\s+/, ""))
		.filter((line) => line.length > 0);
	return { latex, changes };
}

// ─── Seams (tests swap these; production uses the defaults) ──────────────────

export const transcribeSeams: {
	/** The reader's engine; undefined = no model or no key. */
	engine: () => PiEngine | undefined;
} = {
	engine: resolveTranscribeEngine,
};

function resolveTranscribeEngine(): PiEngine | undefined {
	try {
		const spec = resolveRoleSpec("transcriber", settingsStore.readSettings());
		if (!spec || !providerKeyPresent(spec.provider)) return undefined;
		return piEngineForSpec(spec, true, undefined, () => settingsStore.readSettings()?.models?.[ROLE_SLOT.transcriber]?.cacheRetention);
	} catch (err) {
		console.info("[transcribe] no usable model:", err instanceof Error ? err.message : err);
		return undefined;
	}
}

/** `{ image: <base64 or data URL>, fix?: boolean }` → the transcription. */
export async function transcribeImage(body: unknown, signal?: AbortSignal): Promise<TranscribeOutcome> {
	const input = (typeof body === "object" && body !== null ? body : {}) as { image?: unknown; fix?: unknown };
	if (typeof input.image !== "string" || input.image.length === 0) {
		return fail(400, "image_required", "Fant ikke noe bilde. Lim inn eller velg et skjermbilde.");
	}
	const base64 = input.image.replace(/^data:[^;,]*;base64,/, "");
	// 4 base64 characters carry 3 bytes — refuse before decoding.
	if (base64.length > Math.ceil(TRANSCRIBE_MAX_BYTES / 3) * 4) {
		return fail(413, "image_too_large", "Bildet er for stort. Ta et mindre utsnitt og prøv igjen.");
	}
	const bytes = Buffer.from(base64, "base64");
	const mimeType = detectSupportedImageMimeType(bytes);
	if (!mimeType) {
		return fail(400, "image_unsupported", "Dette bildeformatet kan ikke leses. Bruk PNG, JPEG, GIF, WebP eller BMP.");
	}
	const engine = transcribeSeams.engine();
	if (!engine) {
		return fail(503, "models_not_configured", "Ingen modell er satt opp for avlesning. Velg en bilde-modell under Innstillinger → Agent.");
	}
	if (!engine.model.input.includes("image")) {
		return fail(503, "model_without_vision", "Modellen som er valgt for avlesning, kan ikke lese bilder. Velg en annen under Innstillinger → Agent.");
	}
	const image = await processImage(bytes, mimeType, { resizeOptions: engine.model.inputLimits?.images?.resize });
	if (!image.ok) return fail(400, "image_unreadable", "Klarte ikke å åpne bildet. Prøv et nytt skjermbilde.");

	const fix = input.fix === true;
	const messages: AgentMessage[] = [{
		role: "user",
		content: [
			{ type: "text", text: [fix ? "Transcribe this image and correct obvious errors." : "Transcribe this image exactly as written.", ...image.hints].join("\n") },
			{ type: "image", data: image.data, mimeType: image.mimeType },
		],
		timestamp: Date.now(),
	}];
	try {
		const timeout = AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS);
		const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
		const result = await withBgLlmSlot(combined, () =>
			runSubagent([], {
				role: "transcriber",
				engine,
				systemPrompt: transcribeSystemPrompt(fix),
				messages,
				maxTurns: 1,
				abortSignal: combined,
			}),
		);
		const parsed = parseTranscription(result.text);
		if (!parsed.latex) return fail(502, "empty_transcription", "Modellen ga ikke noe svar. Prøv igjen.");
		return { ok: true, latex: parsed.latex, changes: fix ? parsed.changes : [] };
	} catch (err) {
		console.error("[transcribe] failed:", err instanceof Error ? err.message : err);
		return fail(502, "transcription_failed", "Avlesningen feilet. Prøv igjen om litt.");
	}
}
