import { Type, type Static } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import type { JobRecord } from "../../core/contracts.ts";
import type { JobStore } from "../../core/ports.ts";
import { awaitJobResult } from "../subagents/awaited-jobs.ts";

/**
 * Async sub-agent job tools (vision §2.5; W2/W6 kinds + the pi-model
 * protocol). SERVER-EXECUTED: each call creates the job record, fires the
 * background runner (via the injected spawn seam — the agent layer never
 * imports one), and resolves IMMEDIATELY with a fire-and-forget ack. The
 * teacher's turn does NOT end at the call; the result arrives later as a
 * steer message that wakes the teacher in a new turn. See contracts.ts
 * "THE ASYNC PROTOCOL". The one exception (fase 4): `visual` with
 * `wait: true` holds the call until the figure is done (waitForVisual).
 */

/** What the job tools need at execute time (injected by the composition root). */
export interface JobToolContext {
	chatId: string;
	/** Creates the job record (deduped by toolCallId). */
	jobStore: JobStore;
	/** Fire the background runner for a fresh job — fire-and-forget. The
	 *  input rides along because the spawn happens MID-STREAM, before
	 *  onFinish persists the tool part — a transcript scan would race it. */
	spawn: (job: JobRecord, input: ResearchInput | DemoInput | VisualInput | PdfInput) => void;
	/** Search-provider availability, retained for existing composition seams.
	 *  Research dispatch does not depend on it: web_fetch is keyless and
	 *  web_search reports a missing provider as a recoverable tool result. */
	searchAvailable?: () => boolean;
}

export const researchInputSchema = Type.Object({
	question: Type.String({
		description: "The single research question to answer. Make it specific — the researcher sees nothing else of the lesson.",
	}),
	context: Type.Optional(
		Type.String({
			description: "Why you need this / what the lesson needs it for — focuses the brief. One or two sentences.",
		}),
	),
});

export const demoInputSchema = Type.Object({
	title: Type.String({ description: "Short title for the demo card, e.g. 'Damped harmonic oscillator'." }),
	brief: Type.String({
		description:
			"Precise brief for the builder: the concept, the parameters/controls and what each does, the interactions, and the visual style. " +
			"The builder sees NOTHING else of the lesson — include everything it needs, including necessary formulas and constants.",
	}),
});

export const visualInputSchema = Type.Object({
	brief: Type.String({
		description:
			"Precise brief for ONE static figure: exactly what it must show — coordinates, labels, proportions, orientation. " +
			"The maker sees NOTHING else of the lesson; a wrong or vague brief produces a wrong figure.",
	}),
	wait: Type.Optional(
		Type.Boolean({
			description:
				"Set true when the figure belongs to a task or question you are about to pose: the call then WAITS until the " +
				"figure is finished (the learner sees «Læreren genererer figurer til oppgaven …» meanwhile), the figure renders right here, and the " +
				"result gives you its figure id to pass as `figure` on the question. Omit for figures that illustrate teaching.",
		}),
	),
});

export const pdfInputSchema = Type.Object({
	path: Type.String({ description: "Path to the learner's PDF (relative or absolute), exactly as they gave it." }),
	question: Type.String({
		description:
			"What you need from the document — the specific content, explanation, or answer to extract and brief. " +
			"The reader sees NOTHING else of the lesson.",
	}),
});

/**
 * The per-call dispatch: create the job (idempotent by toolCallId), fire the
 * runner, and return the ack. Shared by all three tools — only kind differs.
 */
function dispatch(
	ctx: JobToolContext,
	kind: JobRecord["kind"],
	toolCallId: string,
	ack: string,
	input: ResearchInput | DemoInput | VisualInput | PdfInput,
): string {
	const existing = ctx.jobStore.findJobByToolCallId(ctx.chatId, toolCallId);
	const job = existing ?? ctx.jobStore.createJob({ kind, chatId: ctx.chatId, toolCallId, input });
	if (!existing) ctx.spawn(job, input);
	return `Dispatched (job ${job.id}). ${ack}`;
}

const RESEARCH_ACK =
	"This call is fire-and-forget: continue your turn and keep teaching — do not wait, poll, or mention waiting. " +
	"The researched brief arrives as a new message when ready and the lesson resumes from it; cite its sources when you use them.";
const DEMO_ACK =
	"This call is fire-and-forget: continue your turn and keep teaching — do not wait, poll, or mention waiting. " +
	"The tested demo arrives as a new message when ready and is rendered in the lesson; teach with it then.";
const VISUAL_ACK =
	"This call is fire-and-forget: continue your turn and keep teaching — do not wait, poll, or mention waiting. " +
	"The verified figure arrives as a new message when ready and is rendered in the lesson; reference it then.";
const PDF_ACK =
	"This call is fire-and-forget: continue your turn and keep teaching — do not wait, poll, or mention waiting. " +
	"The document brief arrives as a new message when ready; weave it into the lesson and cite its pages.";

const RESEARCH_DESCRIPTION =
	"Dispatch a background web-research agent: fact verification, current data, or niche specifics you are not certain about. " +
	"The call is ASYNC and fire-and-forget — it resolves immediately and your turn continues; the research brief arrives later " +
	"as a new message and the lesson resumes from it. Cite the brief's sources when you use them. " +
	"NEVER use it for things you know cold, internal reasoning, or math.";
const DEMO_DESCRIPTION =
	"Dispatch a background sub-agent that BUILDS and headlessly TESTS an interactive teaching instrument — a single-file HTML " +
	"demo (parameter sweep, simulation, animation, sampling) rendered live in the lesson. Use it when the concept is DYNAMIC: " +
	"something to sweep, animate, or sample is better experienced than described. " +
	"The call is ASYNC and fire-and-forget — it resolves immediately and your turn continues; the tested demo arrives later " +
	"as a new message. Write a precise brief: concept, controls, interactions, style.";
const VISUAL_DESCRIPTION =
	"Dispatch a background sub-agent that hand-authors ONE precise SVG figure, renders it, LOOKS at the render, and iterates " +
	"until correct. Use it for exact spatial pictures auto-layout diagrams can't do: coordinate geometry, number lines, vectors, " +
	"function plots, physical layouts. For flows/relations/taxonomies write mermaid inline instead. " +
	"By default the call is ASYNC and fire-and-forget — it resolves immediately and your turn continues; the verified figure " +
	"arrives later as a new message. With wait: true (a figure for a task you are about to pose) the call blocks until the " +
	"figure is done and returns its figure id — then pose the question with figure set to that id.";

/** How long a waited visual may take before the call gives up (fase 4).
 *  Test seam, like toolTimeoutMs. */
export const visualWaitMs = { current: 5 * 60_000 };
/** How often the waiting call re-reads the job (learner abort, a finish
 *  that somehow bypassed the hand-over). */
const VISUAL_WAIT_POLL_MS = 1_000;

/** Resolves after `ms`, or as soon as `signal` aborts. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) return resolve();
		const timer = setTimeout(done, ms);
		function done() {
			clearTimeout(timer);
			signal?.removeEventListener("abort", done);
			resolve();
		}
		signal?.addEventListener("abort", done, { once: true });
	});
}

/** The waited visual's inline result (fase 4): the model reads the text;
 *  `details` carries the figure for the transcript card and the dock
 *  (figureSvgOf reads details.inline + jobId + result). */
function inlineVisualResult(jobId: string, result: unknown): { text: string; details: unknown } {
	const r = result as { svg?: unknown; notes?: unknown } | null | undefined;
	const svg = typeof r?.svg === "string" ? r.svg : "";
	const notes = typeof r?.notes === "string" && r.notes ? r.notes : "(none)";
	const details = { inline: true, jobId, kind: "visual", result };
	if (svg.length === 0) {
		return {
			text:
				`The figure could not be made: ${notes}. No figure is shown. Pose the task without it (state the setup in words), ` +
				"or re-call visual with wait: true and a tighter brief.",
			details,
		};
	}
	return {
		text:
			`Figure ready — figure id "${jobId}". It is rendered in the lesson right here, before what you write next. ` +
			`Now pose the question and set figure: "${jobId}" so the figure also sits above the question. Maker notes: ${notes}`,
		details,
	};
}

/**
 * The WAITED visual (fase 4, 2026-11 — figures before the task): the job
 * is created and spawned exactly like a dispatch, but the call holds until
 * the runner hands the result over (awaited-jobs), so the figure renders at
 * the call site, before the question. Three honest exits besides success:
 * the learner aborted the job (no figure), the turn was stopped (the job
 * keeps running and delivers asynchronously), or the wait timed out (same:
 * the figure arrives later as its own message, with its figure id).
 */
async function waitForVisual(
	ctx: JobToolContext,
	toolCallId: string,
	input: VisualInput,
	signal: AbortSignal | undefined,
): Promise<string | { text: string; details: unknown }> {
	const existing = ctx.jobStore.findJobByToolCallId(ctx.chatId, toolCallId);
	if (existing && existing.status !== "running" && existing.result !== undefined) {
		return inlineVisualResult(existing.id, existing.result);
	}
	const job = existing ?? ctx.jobStore.createJob({ kind: "visual", chatId: ctx.chatId, toolCallId, input });
	// Register BEFORE the spawn: a fast finish must find the waiter.
	const waiter = awaitJobResult(job.id);
	if (!existing) ctx.spawn(job, input);
	const deadline = Date.now() + visualWaitMs.current;
	let claimed: { result: unknown } | undefined;
	void waiter.promise.then((result) => {
		claimed = { result };
	});
	for (;;) {
		if (claimed) return inlineVisualResult(job.id, claimed.result);
		const late = (): { text: string; details: unknown } | null => {
			const result = waiter.release();
			return result !== undefined ? inlineVisualResult(job.id, result) : null;
		};
		if (signal?.aborted) {
			const got = late();
			if (got) return got;
			throw new Error("Operation aborted");
		}
		const record = ctx.jobStore.getJob(job.id);
		if (record && record.status !== "running") {
			const got = late();
			if (got) return got;
			// Finished without the hand-over: a learner abort (no result), or a
			// result written outside the runner's finish path.
			if (record.result !== undefined) return inlineVisualResult(job.id, record.result);
			return "The figure job was aborted by the learner — no figure is coming. Pose the task without it, or re-call visual with wait: true if he wants the figure.";
		}
		if (Date.now() >= deadline) {
			const got = late();
			if (got) return got;
			const minutes = Math.max(1, Math.round(visualWaitMs.current / 60_000));
			return (
				`The figure was not finished within ${minutes} min. It is still being drawn and will arrive later as its own ` +
				`message (figure id "${job.id}"). Do not pose a task that needs it yet: tell the learner in one short line that ` +
				`the task comes as soon as the figure is ready, and end your turn. When it arrives, pose the task with figure: "${job.id}".`
			);
		}
		await Promise.race([waiter.promise, pause(VISUAL_WAIT_POLL_MS, signal)]);
	}
}

// ─── a question waits for the figure or demo made for it (2026-11) ───────────

/** How long a question waits for a figure or demo started in the same turn
 *  before it is posed without it. Test seam. */
export const questionJobWaitMs = { current: 5 * 60_000 };
/** The kinds a question waits for: what the learner must SEE before it. */
const SHOWN_BEFORE_QUESTION: ReadonlySet<JobRecord["kind"]> = new Set(["visual", "demo"]);

/** The figure and demo jobs a question posed now would wait for: started
 *  at or after `since` (the turn's start) and still running. */
function runningTurnJobs(ctx: Pick<JobToolContext, "chatId" | "jobStore">, since: number): JobRecord[] {
	return ctx.jobStore
		.listJobs(ctx.chatId)
		.filter((job) => SHOWN_BEFORE_QUESTION.has(job.kind) && job.status === "running" && Date.parse(job.createdAt) >= since);
}

/** Would a question posed now wait (waitForTurnJobs)? The held-question
 *  re-pose (server/chat-handler) asks before it holds the turn open. */
export function turnJobsRunning(ctx: Pick<JobToolContext, "chatId" | "jobStore">, since: number): boolean {
	return runningTurnJobs(ctx, since).length > 0;
}

/**
 * THE QUESTION WAIT (owner, 2026-11 — «figurene genereres før spørsmålet»):
 * a question posed while a `visual` or `demo` job dispatched in the SAME
 * turn (created at or after `since`) is still running holds until that job
 * is done, so the learner sees the figure or demo first. Deterministic, not
 * doctrine: the teacher may forget `wait: true`, the learner still never
 * gets a task before its figure.
 *
 * Each job is marked `forQuestion` while waited (the transcript shows
 * «Læreren genererer figurer til oppgaven …» / «Læreren har bestemt at du
 * skal se en interaktiv demo»). A success is claimed from the runner
 * (awaited-jobs) — no steer follows; the result renders at its dispatch
 * card, and a figure is attached to the question (the dock finds it by
 * `forQuestion`, core attachedFigureId). A failure, the timeout,
 * or a learner abort releases the job: it delivers the ordinary way later,
 * and the question goes ahead without it.
 */
export async function waitForTurnJobs(
	ctx: Pick<JobToolContext, "chatId" | "jobStore">,
	since: number,
	questionToolCallId: string,
	signal: AbortSignal | undefined,
): Promise<void> {
	const pending = runningTurnJobs(ctx, since);
	if (pending.length === 0) return;
	const waiters = new Map(pending.map((job) => {
		ctx.jobStore.updateJob(job.id, { forQuestion: questionToolCallId });
		return [job.id, { waiter: awaitJobResult(job.id, { takesFailures: false }), claimed: undefined as { result: unknown } | undefined }];
	}));
	for (const entry of waiters.values()) {
		void entry.waiter.promise.then((result) => {
			entry.claimed = { result };
		});
	}
	const settle = (id: string, shown: boolean) => {
		waiters.delete(id);
		// Not shown with the question: it delivers on its own later.
		if (!shown) ctx.jobStore.updateJob(id, { forQuestion: undefined });
	};
	const deadline = Date.now() + questionJobWaitMs.current;
	for (;;) {
		for (const [id, entry] of [...waiters]) {
			if (entry.claimed) { settle(id, true); continue; }
			const record = ctx.jobStore.getJob(id);
			if (record && record.status !== "running") {
				// Finished without the hand-over (a failure, an abort): release.
				const late = entry.waiter.release();
				settle(id, late !== undefined);
			}
		}
		if (waiters.size === 0) return;
		if (signal?.aborted || Date.now() >= deadline) {
			for (const [id, entry] of [...waiters]) settle(id, entry.waiter.release() !== undefined);
			if (signal?.aborted) throw new Error("Operation aborted");
			return;
		}
		await Promise.race([...[...waiters.values()].map((e) => e.waiter.promise), pause(VISUAL_WAIT_POLL_MS, signal)]);
	}
}

const PDF_DESCRIPTION =
	"Dispatch a background sub-agent that READS a learner-provided PDF on your behalf (triage, targeted extraction, visual page " +
	"reading for equations and diagrams) and returns a brief with page citations. The read tool already reads PDFs directly " +
	"(page text plus page images, in the same turn) — use read for the learner's answers and for any document you need now. " +
	"Dispatch this only for a LONG document where you need one targeted answer and no page-by-page reading. The call is ASYNC " +
	"and fire-and-forget — it resolves immediately and your turn continues; the brief arrives later as a new message.";

/**
 * Per-request job tool registry: each tool closes over the composition root's
 * context (chatId + jobStore + the spawn seam), so concurrent chats never
 * share state. chat-handler wires it each turn; tests wire their own.
 *
 * Research remains available without a search-provider key; the role's
 * existing user-toggle filtering still applies outside this registry.
 */
export function jobTools(ctx: JobToolContext): Record<string, AgentTool<any>> {
	return {
		research: {
			name: "research",
			label: "research",
			description: RESEARCH_DESCRIPTION,
			parameters: researchInputSchema,
			execute: serverExecute("research", researchInputSchema, (input, { toolCallId }) =>
				dispatch(ctx, "research", toolCallId, RESEARCH_ACK, input),
			),
		},
		demo: {
			name: "demo",
			label: "demo",
			description: DEMO_DESCRIPTION,
			parameters: demoInputSchema,
			execute: serverExecute("demo", demoInputSchema, (input, { toolCallId }) => dispatch(ctx, "demo", toolCallId, DEMO_ACK, input)),
		},
		visual: {
			name: "visual",
			label: "visual",
			description: VISUAL_DESCRIPTION,
			parameters: visualInputSchema,
			execute: serverExecute(
				"visual",
				visualInputSchema,
				(input, { toolCallId, signal }) =>
					input.wait === true
						? waitForVisual(ctx, toolCallId, input, signal)
						: dispatch(ctx, "visual", toolCallId, VISUAL_ACK, input),
				// The waited call runs for minutes by design: its own deadline
				// decides, the guard only backstops it.
				(input) => (input.wait === true ? visualWaitMs.current + 30_000 : undefined),
			),
		},
		pdf: {
			name: "pdf",
			label: "pdf",
			description: PDF_DESCRIPTION,
			parameters: pdfInputSchema,
			execute: serverExecute("pdf", pdfInputSchema, (input, { toolCallId }) => dispatch(ctx, "pdf", toolCallId, PDF_ACK, input)),
		},
	};
}

export type ResearchInput = Static<typeof researchInputSchema>;
export type DemoInput = Static<typeof demoInputSchema>;
export type VisualInput = Static<typeof visualInputSchema>;
export type PdfInput = Static<typeof pdfInputSchema>;
