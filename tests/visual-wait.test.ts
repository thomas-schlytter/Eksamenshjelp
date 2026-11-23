/**
 * Fase 4 (2026-11) — figures before the task: `visual` with `wait: true`
 * holds its call until the figure is done, returns it inline (rendered at
 * the call site, before the question), and the async delivery never also
 * arrives as a duplicate. No network, no model: the runner's hand-over is
 * driven directly, or through the real runner's refusal path.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { jobTools, visualWaitMs } from "../src/agent/tools/jobs.ts";
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
afterEach(() => {
	visualWaitMs.current = defaultWait;
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
