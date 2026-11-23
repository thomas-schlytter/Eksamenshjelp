/**
 * Hints on request (owner, 2026-11-23): the Hint button is ALWAYS on a task,
 * as in the approved design. A task the agent authored hints for (fase 4)
 * steps through those. A task without them — an older one, or one the agent
 * posed without — gets its hint ladder made here the first time the learner
 * presses «Hint»: one call on the strong slot (hints must be right),
 * 3 hints from vague to concrete, never the answer. The ladder is cached
 * per chat (data/task-hints/<chatId>.json, keyed by toolCallId) and never
 * written into the transcript, so provider replay is untouched and a second
 * press is instant.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "typebox";
import { PATHS } from "../../config.ts";
import { normalizeHints, type LhMessage } from "../core/index.ts";
import { resolveRoleSpec } from "../core/settings-resolution.ts";
import { ROLE_SLOT } from "../core/settings.ts";
import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { runSubmitAgent } from "../agent/subagents/submit-agent.ts";
import { providerKeyPresent } from "./keys.ts";
import { stores } from "./stores.ts";

const HINTS_TIMEOUT_MS = 90_000;
const SAFE_ID = /^[A-Za-z0-9_.-]{1,200}$/;

export type TaskHintsOutcome =
	| { ok: true; hints: string[]; generated: boolean }
	| { ok: false; status: number; error: string };

const hintsSchema = Type.Object({
	hints: Type.Array(Type.String(), {
		minItems: 3,
		maxItems: 3,
		description:
			"Exactly 3 hints in Norwegian bokmål, from vague to concrete: 1) a gentle nudge about what kind of problem this is or what to think about, 2) where to start (the method or the first step), 3) the next concrete step after that. Never the final answer, never a full solution. Math in $…$ LaTeX.",
	}),
});

const SYSTEM_PROMPT = [
	"You write hints for one exam task a university student is working on, exactly as a good teaching assistant would at the desk.",
	"The student pressed «Hint» and will open the hints one at a time, so they must form a ladder from vague to concrete:",
	"1. A gentle nudge: what kind of problem this is, or what to look at first. No method named yet if that gives it away.",
	"2. Where to start: the method, formula or first step.",
	"3. The next concrete step after the start.",
	"",
	"Rules:",
	"- Never give the final answer, a numeric result, or the whole solution. The student must still do the work.",
	"- Each hint is one or two short sentences in Norwegian bokmål. Math in $…$ LaTeX.",
	"- If the task has several parts, aim the hints at the first part the student has to solve.",
	"- Use the reference answer, if given, only to make sure the hints point the right way. Never reveal it.",
	"",
	"Submit with the tool. Nothing else.",
].join("\n");

// ─── Cache ───────────────────────────────────────────────────────────────────

function cacheFile(chatId: string): string {
	return path.join(PATHS.data, "task-hints", `${chatId}.json`);
}

function readCache(chatId: string): Record<string, string[]> {
	try {
		const raw = JSON.parse(fs.readFileSync(cacheFile(chatId), "utf-8")) as unknown;
		return raw && typeof raw === "object" ? (raw as Record<string, string[]>) : {};
	} catch {
		return {};
	}
}

function writeCache(chatId: string, cache: Record<string, string[]>): void {
	const file = cacheFile(chatId);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(cache, null, "\t"));
	fs.renameSync(tmp, file);
}

// ─── The task ────────────────────────────────────────────────────────────────

/** The question call by id: its text, reference answer and authored hints. */
export function findTaskCall(messages: readonly LhMessage[], toolCallId: string): { question: string; reference: string; hints: string[] } | null {
	for (const m of messages) {
		if (m.role !== "assistant") continue;
		for (const part of m.content) {
			if (part.type !== "toolCall" || part.id !== toolCallId) continue;
			const args = (part.arguments ?? {}) as { question?: unknown; details?: unknown; correctAnswer?: unknown; hints?: unknown };
			const question = [args.question, args.details].filter((x): x is string => typeof x === "string" && x.trim().length > 0).join("\n\n");
			return {
				question,
				reference: typeof args.correctAnswer === "string" ? args.correctAnswer : "",
				hints: normalizeHints(args.hints),
			};
		}
	}
	return null;
}

// ─── Seams (tests swap these) ────────────────────────────────────────────────

export const taskHintSeams: {
	engine: () => PiEngine | undefined;
	generate: (input: { engine: PiEngine; prompt: string }) => Promise<string[]>;
} = {
	engine: resolveHintEngine,
	generate: submitHints,
};

function resolveHintEngine(): PiEngine | undefined {
	try {
		const settings = stores.settingsStore.readSettings();
		const spec = resolveRoleSpec("teacher", settings);
		if (!spec || !providerKeyPresent(spec.provider)) return undefined;
		return piEngineForSpec(spec, true, undefined, () => stores.settingsStore.readSettings()?.models?.[ROLE_SLOT.teacher]?.cacheRetention);
	} catch (err) {
		console.info("[task hints] no usable model:", err instanceof Error ? err.message : err);
		return undefined;
	}
}

async function submitHints(input: { engine: PiEngine; prompt: string }): Promise<string[]> {
	const submission = await runSubmitAgent<{ hints: string[] }>({
		role: "teacher",
		engine: input.engine,
		toolName: "submit_hints",
		toolDescription: "Submit the 3 hints, from vague to concrete.",
		parameters: hintsSchema,
		fill: (raw: { hints?: string[] }) => ({ hints: (raw.hints ?? []).map((h) => String(h).trim()) }),
		validate: (value) => (value.hints.length === 3 && value.hints.every((h) => h.length > 0) ? null : "submit exactly 3 non-empty hints"),
		systemPrompt: SYSTEM_PROMPT,
		prompt: input.prompt,
		signal: AbortSignal.timeout(HINTS_TIMEOUT_MS),
		onStep: () => {},
		neverSubmitted: "the model never submitted hints",
	});
	return submission.hints;
}

/**
 * The hints for a task: authored ones first, then the cache, then a fresh
 * ladder. Never throws; failures come back as { ok:false }.
 */
export async function taskHints(chatId: string, toolCallId: string): Promise<TaskHintsOutcome> {
	if (!SAFE_ID.test(chatId) || !SAFE_ID.test(toolCallId)) return { ok: false, status: 400, error: "Ugyldig oppgave." };
	const record = stores.chatStore.getChat(chatId);
	if (!record) return { ok: false, status: 404, error: "Fant ikke chatten." };
	const task = findTaskCall(record.messages, toolCallId);
	if (!task || !task.question) return { ok: false, status: 404, error: "Fant ikke oppgaven." };
	if (task.hints.length > 0) return { ok: true, hints: task.hints, generated: false };

	const cache = readCache(chatId);
	const cached = normalizeHints(cache[toolCallId]);
	if (cached.length > 0) return { ok: true, hints: cached, generated: false };

	const engine = taskHintSeams.engine();
	if (!engine) return { ok: false, status: 409, error: "Ingen modell er satt opp for hint." };
	try {
		const prompt = [
			`The task:\n\n${task.question}`,
			...(task.reference ? ["", `Reference answer (for you only, never reveal it):\n\n${task.reference}`] : []),
			"",
			"Submit the 3 hints now.",
		].join("\n");
		const hints = normalizeHints(await taskHintSeams.generate({ engine, prompt }));
		if (hints.length === 0) return { ok: false, status: 502, error: "Klarte ikke å lage hint." };
		writeCache(chatId, { ...readCache(chatId), [toolCallId]: hints });
		return { ok: true, hints, generated: true };
	} catch (err) {
		console.error(`[task hints] chat ${chatId}:`, err instanceof Error ? err.message : err);
		return { ok: false, status: 502, error: "Klarte ikke å lage hint. Prøv igjen." };
	}
}
