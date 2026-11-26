/**
 * Fase 4 (2026-11) — figures before the task: `visual` with `wait: true`
 * holds its call until the figure is done, returns it inline (rendered at
 * the call site, before the question), and the async delivery never also
 * arrives as a duplicate. No network, no model: the runner's hand-over is
 * driven directly, or through the real runner's refusal path.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { jobTools, questionJobWaitMs, visualWaitMs } from "../src/agent/tools/jobs.ts";
import { waitsForTurnJobs } from "../src/agent/tools.ts";
import { invalidInputResult, questionResult } from "../src/agent/tool-execute.ts";
import { attachedFigureId, jobFigureSvg } from "../src/core/native-messages.ts";
import { claimAwaited, isAwaited } from "../src/agent/subagents/awaited-jobs.ts";
import { createJobRunner } from "../src/agent/subagents/runner.ts";
import type { ChatStore, JobStore } from "../src/core/ports.ts";
import type { JobRecord, SteerMessage } from "../src/core/contracts.ts";

function fakeJobStore(): JobStore {
	const jobs = new Map<string, JobRecord>();
	return {
		createJob(init) {
			const job = {
				id: `job_${jobs.size + 1}`,
				kind: init.kind,
				chatId: init.chatId,
				toolCallId: init.toolCallId,
				input: init.input,
				status: "running",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				activity: "",
			} as JobRecord;
			jobs.set(job.id, job);
			return job;
		},
		getJob: (id) => jobs.get(id) ?? null,
		updateJob: (id, patch) => {
			const job = jobs.get(id);
			return job ? Object.assign(job, patch) : null;
		},
		listJobs: () => [...jobs.values()],
		findJobByToolCallId: (_chat, callId) => [...jobs.values()].find((j) => j.toolCallId === callId) ?? null,
		deleteJobsForChat: () => 0,
	};
}

const defaultWait = visualWaitMs.current;
const defaultQuestionWait = questionJobWaitMs.current;
afterEach(() => {
	visualWaitMs.current = defaultWait;
	questionJobWaitMs.current = defaultQuestionWait;
});

describe("visual with wait: true", () => {
	it("holds the call until the figure is handed over, then returns it inline with its figure id", async () => {
		const jobStore = fakeJobStore();
		const tools = jobTools({
			chatId: "c1",
			jobStore,
			spawn: (job) => {
				assert.ok(isAwaited(job.id), "the waiter is registered before the spawn");
				setTimeout(() => claimAwaited(job.id, { svg: "<svg>fig</svg>", notes: "ok" }), 20);
			},
		});
		const out = await tools.visual!.execute!("v-call", { brief: "a triangle", wait: true });
		const details = out.details as { inline?: boolean; jobId?: string; result?: { svg?: string } };
		assert.equal(details.inline, true);
		assert.equal(details.jobId, "job_1");
		assert.equal(details.result?.svg, "<svg>fig</svg>");
		const text = (out.content[0] as { text: string }).text;
		assert.match(text, /figure id "job_1"/);
		assert.match(text, /figure: "job_1"/, "the model is told to pass the id on the question");
		assert.ok(!text.includes("<svg"), "the svg never reaches the model");
	});

	it("the real runner's finish hands the result to the waiter and queues NO steer (no duplicate)", async () => {
		const jobStore = fakeJobStore();
		const delivered: SteerMessage[] = [];
		const chatStore = { getChat: () => null } as unknown as ChatStore;
		// No engine configured → the runner refuses and finishes with the
		// failure shape: the same finishJob seam a success takes.
		const runner = createJobRunner({ chatStore, jobStore, deliver: async (s) => { delivered.push(s); } });
		const tools = jobTools({ chatId: "c1", jobStore, spawn: (job) => { void runner.runJob(job.id); } });
		const out = await tools.visual!.execute!("v-call", { brief: "a triangle", wait: true });
		assert.equal((out.details as { inline?: boolean }).inline, true);
		assert.match((out.content[0] as { text: string }).text, /could not be made/);
		assert.equal(delivered.length, 0, "the async delivery never also fires");
		assert.equal(jobStore.getJob("job_1")?.delivery?.status, "delivered");
	});

	it("a timeout gives up honestly and leaves the job to deliver asynchronously later", async () => {
		visualWaitMs.current = 30;
		const jobStore = fakeJobStore();
		const tools = jobTools({ chatId: "c1", jobStore, spawn: () => {} });
		const out = await tools.visual!.execute!("v-call", { brief: "a triangle", wait: true });
		assert.match(String(out.details), /not finished within/);
		assert.match(String(out.details), /figure id "job_1"/);
		assert.equal(isAwaited("job_1"), false, "released: the runner's finish delivers the ordinary way");
		assert.equal(claimAwaited("job_1", { svg: "<svg/>" }), false);
	});

	it("a learner abort (job ends without a result) says no figure is coming", async () => {
		const jobStore = fakeJobStore();
		const tools = jobTools({
			chatId: "c1",
			jobStore,
			spawn: (job) => {
				setTimeout(() => jobStore.updateJob(job.id, { status: "error", error: "Aborted by learner" }), 20);
			},
		});
		const out = await tools.visual!.execute!("v-call", { brief: "a triangle", wait: true });
		assert.match(String(out.details), /aborted by the learner/);
		assert.equal(isAwaited("job_1"), false);
	});

	it("without wait the call is the unchanged fire-and-forget dispatch", async () => {
		const jobStore = fakeJobStore();
		let spawned = 0;
		const tools = jobTools({ chatId: "c1", jobStore, spawn: () => { spawned++; } });
		const out = await tools.visual!.execute!("v-call", { brief: "a triangle" });
		assert.match(String(out.details), /^Dispatched \(job job_1\)\./);
		assert.equal(spawned, 1);
		assert.equal(isAwaited("job_1"), false);
	});
});

describe("a question waits for the figure or demo of its own turn (2026-11)", () => {
	/** The runner's finish seam, verbatim in shape: a waiter that takes the
	 *  outcome claims it (delivered, no steer); otherwise a steer queues. */
	function finish(jobStore: JobStore, id: string, result: unknown, failed: boolean, delivered: string[]) {
		const status = failed ? "error" : "done";
		if (isAwaited(id, failed)) {
			jobStore.updateJob(id, { result, status, delivery: { kind: "result", status: "delivered" } });
			claimAwaited(id, result);
			return;
		}
		jobStore.updateJob(id, { result, status, delivery: { kind: "result", status: "pending" } });
		delivered.push(id);
	}
	const fakeQuestion = (invalid = false): AgentTool<any> => ({
		name: "quiz",
		label: "quiz",
		description: "",
		parameters: Type.Object({}),
		execute: async () => (invalid ? invalidInputResult("quiz", ["nodeId is wrong"]) : questionResult()),
	});
	const tick = () => new Promise((r) => setTimeout(r, 5));

	it("holds the question until the same-turn figure is done, claims it (no steer) and attaches it", async () => {
		const jobStore = fakeJobStore();
		const delivered: string[] = [];
		const since = Date.now();
		const tools = jobTools({ chatId: "c1", jobStore, spawn: () => {} });
		await tools.visual!.execute!("v1", { brief: "a circuit" });
		const quiz = waitsForTurnJobs(fakeQuestion(), { chatId: "c1", jobStore }, since);
		let posed = false;
		const pose = quiz.execute("q1", {}).then((r) => { posed = true; return r; });
		await tick();
		assert.equal(posed, false, "the question waits");
		assert.equal(jobStore.getJob("job_1")?.forQuestion, "q1", "the transcript can say what the learner waits for");
		finish(jobStore, "job_1", { svg: "<svg>circuit</svg>", notes: "" }, false, delivered);
		const result = await pose;
		assert.equal(result.terminate, true, "then posed as usual");
		assert.deepEqual(delivered, [], "no steer: the figure is shown with the question");
		const jobs = jobStore.listJobs("c1");
		assert.equal(attachedFigureId(jobs, "q1"), "job_1", "attached although the question named no figure");
		assert.equal(jobFigureSvg(jobs, attachedFigureId(jobs, "q1")), "<svg>circuit</svg>");
	});

	it("waits for a demo the same way", async () => {
		const jobStore = fakeJobStore();
		const delivered: string[] = [];
		const since = Date.now();
		const tools = jobTools({ chatId: "c1", jobStore, spawn: () => {} });
		await tools.demo!.execute!("d1", { title: "RC-krets", brief: "charge a capacitor" });
		const pose = waitsForTurnJobs(fakeQuestion(), { chatId: "c1", jobStore }, since).execute("q1", {});
		await tick();
		assert.equal(jobStore.getJob("job_1")?.forQuestion, "q1");
		finish(jobStore, "job_1", { title: "RC-krets", html: "<html></html>" }, false, delivered);
		await pose;
		assert.deepEqual(delivered, []);
		assert.equal(attachedFigureId(jobStore.listJobs("c1"), "q1"), undefined, "a demo is not a figure");
	});

	it("a failed figure is not claimed: the teacher still hears of it, the question goes ahead without it", async () => {
		const jobStore = fakeJobStore();
		const delivered: string[] = [];
		const since = Date.now();
		const tools = jobTools({ chatId: "c1", jobStore, spawn: () => {} });
		await tools.visual!.execute!("v1", { brief: "a circuit" });
		const pose = waitsForTurnJobs(fakeQuestion(), { chatId: "c1", jobStore }, since).execute("q1", {});
		await tick();
		finish(jobStore, "job_1", { svg: "", notes: "could not draw" }, true, delivered);
		await pose;
		assert.deepEqual(delivered, ["job_1"], "the failure delivers the ordinary way");
		assert.equal(jobStore.getJob("job_1")?.forQuestion, undefined);
		assert.equal(attachedFigureId(jobStore.listJobs("c1"), "q1"), undefined);
	});

	it("gives up after the time limit, poses the question and lets the job deliver later", async () => {
		questionJobWaitMs.current = 30;
		const jobStore = fakeJobStore();
		const since = Date.now();
		const tools = jobTools({ chatId: "c1", jobStore, spawn: () => {} });
		await tools.visual!.execute!("v1", { brief: "a circuit" });
		const result = await waitsForTurnJobs(fakeQuestion(), { chatId: "c1", jobStore }, since).execute("q1", {});
		assert.equal(result.terminate, true);
		assert.equal(isAwaited("job_1"), false, "released");
		assert.equal(jobStore.getJob("job_1")?.forQuestion, undefined);
	});

	it("never waits for a job from an earlier turn, nor on a question that fails validation", async () => {
		const jobStore = fakeJobStore();
		const tools = jobTools({ chatId: "c1", jobStore, spawn: () => {} });
		await tools.visual!.execute!("v1", { brief: "an older figure" });
		const later = Date.now() + 1_000;
		await waitsForTurnJobs(fakeQuestion(), { chatId: "c1", jobStore }, later).execute("q1", {});
		assert.equal(jobStore.getJob("job_1")?.forQuestion, undefined);
		const invalid = await waitsForTurnJobs(fakeQuestion(true), { chatId: "c1", jobStore }, 0).execute("q2", {});
		assert.equal(invalid.isError, true, "a malformed question bounces at once");
		assert.equal(jobStore.getJob("job_1")?.forQuestion, undefined);
	});

	it("a stopped turn stops the wait and releases the job", async () => {
		const jobStore = fakeJobStore();
		const since = Date.now();
		const tools = jobTools({ chatId: "c1", jobStore, spawn: () => {} });
		await tools.visual!.execute!("v1", { brief: "a circuit" });
		const controller = new AbortController();
		const pose = waitsForTurnJobs(fakeQuestion(), { chatId: "c1", jobStore }, since).execute("q1", {}, controller.signal);
		await tick();
		controller.abort();
		await assert.rejects(pose, /Operation aborted/);
		assert.equal(isAwaited("job_1"), false);
		assert.equal(jobStore.getJob("job_1")?.forQuestion, undefined);
	});
});
