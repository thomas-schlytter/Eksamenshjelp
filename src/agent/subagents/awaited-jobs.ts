/**
 * AWAITED JOBS (fase 4, 2026-11 — figures before the task): a `visual`
 * call made with `wait: true` blocks its tool call until the figure is
 * done, so the figure renders where the call was made — before the task
 * text — instead of arriving later as a steer message under it.
 *
 * The waiting tool registers here BEFORE the spawn; the runner's finish
 * path asks `claimAwaited` first: a live waiter takes the result inline
 * (and the runner marks the delivery done, so the async steer never also
 * appears as a duplicate). A waiter that gives up (timeout, turn abort)
 * releases its entry; a later finish then delivers the ordinary way.
 * In-memory on purpose: after a process restart no waiter exists, so a
 * respawned job always delivers — nothing is lost silently.
 *
 * globalThis, not a module-level Map: the tool (built per turn) and the
 * runner meet across Next dev's per-route module instances (aborts.ts's
 * reason).
 */

interface Waiter {
	resolve: (result: unknown) => void;
	/** False for a waiter that only wants a SUCCESS (a question held for its
	 *  figure or demo): a failed job then delivers the ordinary way, so the
	 *  teacher still hears that it failed. */
	takesFailures: boolean;
}

interface LhAwaitGlobal {
	__lhAwaitedJobs?: Map<string, Waiter>;
}

function registry(): Map<string, Waiter> {
	const g = globalThis as typeof globalThis & LhAwaitGlobal;
	return (g.__lhAwaitedJobs ??= new Map());
}

export interface AwaitedJob {
	/** Resolves with the job's result when the runner hands it over. */
	promise: Promise<unknown>;
	/** Stop waiting. Returns the result if it was claimed in the meantime
	 *  (the caller then still owns it), else undefined (the runner will
	 *  deliver it asynchronously when it finishes). */
	release: () => unknown;
}

/** Register a waiter for a job (one per job; a re-registration replaces). */
export function awaitJobResult(jobId: string, options: { takesFailures?: boolean } = {}): AwaitedJob {
	let claimed: { result: unknown } | undefined;
	let resolve!: (result: unknown) => void;
	const promise = new Promise<unknown>((res) => {
		resolve = res;
	});
	const waiter: Waiter = {
		resolve: (result) => {
			claimed = { result };
			resolve(result);
		},
		takesFailures: options.takesFailures ?? true,
	};
	registry().set(jobId, waiter);
	return {
		promise,
		release: () => {
			if (registry().get(jobId) === waiter) registry().delete(jobId);
			return claimed?.result;
		},
	};
}

/** Is someone waiting for this job's outcome right now? (the runner's
 *  finish check; `failed` — a waiter that only takes successes says no) */
export function isAwaited(jobId: string, failed = false): boolean {
	const waiter = registry().get(jobId);
	return waiter !== undefined && (!failed || waiter.takesFailures);
}

/** The runner's hand-over: resolves the live waiter with the result and
 *  returns true, or returns false when nobody waits (deliver as usual). */
export function claimAwaited(jobId: string, result: unknown): boolean {
	const waiter = registry().get(jobId);
	if (!waiter) return false;
	registry().delete(jobId);
	waiter.resolve(result);
	return true;
}
