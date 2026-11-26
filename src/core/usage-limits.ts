/**
 * BRUK: THE SUBSCRIPTION LIMITS (2026-11-26). The 5-hour limit and the
 * weekly limit of the learner's own subscriptions, as the providers report
 * them, for the small block in the sidebar.
 *
 *  - Claude (the Claude Code CLI): stream-json carries `rate_limit_event`
 *    lines; `rate_limit_info.unifiedWindows` holds one entry per window
 *    with `utilization` (0..1, above 1 when over) and `resetsAt` (unix
 *    seconds). Events with only `{"status":"allowed"}` carry no numbers
 *    and are ignored.
 *  - ChatGPT: the Codex backend's `x-codex-primary-*` / `x-codex-secondary-*`
 *    response headers, IF a response carries them (used-percent 0..100,
 *    the window's length in minutes, and the reset as unix seconds or
 *    seconds from now). No headers, no data, nothing shown.
 *
 * Pure: parsing, merging and the view's rows. The file and the event live
 * in src/agent/usage-limits.ts.
 */

export type UsageProvider = "claude" | "chatgpt";
export type UsageWindowId = "five_hour" | "seven_day";

export interface UsageWindow {
	/** Share used, 0..1 (above 1 when the limit is passed). */
	utilization: number;
	/** When the window resets, epoch milliseconds. */
	resetsAt: number;
}

export type UsageWindows = Partial<Record<UsageWindowId, UsageWindow>>;

export interface ProviderUsage {
	/** When the provider last reported, epoch milliseconds. */
	updatedAt: number;
	windows: UsageWindows;
}

/** What GET /api/usage-limits answers, and what the data file holds. */
export interface UsageLimitsSnapshot {
	providers: Partial<Record<UsageProvider, ProviderUsage>>;
}

export const USAGE_PROVIDERS: readonly UsageProvider[] = ["claude", "chatgpt"];
export const USAGE_WINDOWS: readonly UsageWindowId[] = ["five_hour", "seven_day"];
export const USAGE_PROVIDER_LABEL: Record<UsageProvider, string> = { claude: "Claude", chatgpt: "ChatGPT" };
export const USAGE_WINDOW_LABEL: Record<UsageWindowId, string> = { five_hour: "5 timer", seven_day: "Uke" };

export const EMPTY_USAGE: UsageLimitsSnapshot = { providers: {} };

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Unix seconds (the providers' unit) to epoch ms; a value already in ms
 *  is kept. */
function toMs(at: number): number {
	return at < 1e11 ? at * 1000 : at;
}

function toWindow(raw: unknown): UsageWindow | null {
	if (!raw || typeof raw !== "object") return null;
	const { utilization, resetsAt } = raw as { utilization?: unknown; resetsAt?: unknown };
	if (!finite(utilization) || utilization < 0 || !finite(resetsAt) || resetsAt <= 0) return null;
	return { utilization, resetsAt: toMs(resetsAt) };
}

const isWindowId = (v: unknown): v is UsageWindowId => v === "five_hour" || v === "seven_day";

/**
 * One parsed stream-json line from the Claude Code CLI. The windows it
 * reports, or null when it is no rate_limit_event or carries no numbers.
 */
export function parseClaudeRateLimitEvent(line: unknown): UsageWindows | null {
	if (!line || typeof line !== "object" || (line as { type?: unknown }).type !== "rate_limit_event") return null;
	const info = (line as { rate_limit_info?: unknown }).rate_limit_info;
	if (!info || typeof info !== "object") return null;
	const out: UsageWindows = {};
	const unified = (info as { unifiedWindows?: unknown }).unifiedWindows;
	if (unified && typeof unified === "object") {
		for (const id of USAGE_WINDOWS) {
			const window = toWindow((unified as Record<string, unknown>)[id]);
			if (window) out[id] = window;
		}
	}
	// A line without the window map can still name one window with its own
	// numbers (rateLimitType + utilization + resetsAt).
	const type = (info as { rateLimitType?: unknown }).rateLimitType;
	if (Object.keys(out).length === 0 && isWindowId(type)) {
		const window = toWindow(info);
		if (window) out[type] = window;
	}
	return Object.keys(out).length > 0 ? out : null;
}

/**
 * A ChatGPT response's headers (`get` is Headers.get). The windows they
 * report, or null when there are none. The primary window is the 5-hour
 * one and the secondary the weekly one, unless the window length says
 * otherwise. A window without a reset time is left out: it could never be
 * told stale.
 */
export function parseCodexRateLimitHeaders(get: (name: string) => string | null, now: number): UsageWindows | null {
	const num = (name: string): number | undefined => {
		const raw = get(name);
		if (raw === null || raw.trim() === "") return undefined;
		const n = Number(raw);
		return Number.isFinite(n) ? n : undefined;
	};
	const out: UsageWindows = {};
	for (const [prefix, fallback] of [["primary", "five_hour"], ["secondary", "seven_day"]] as const) {
		const used = num(`x-codex-${prefix}-used-percent`);
		if (used === undefined || used < 0) continue;
		const resetAt = num(`x-codex-${prefix}-reset-at`);
		const resetAfter = num(`x-codex-${prefix}-reset-after-seconds`);
		const resetsAt = resetAt !== undefined && resetAt > 0
			? toMs(resetAt)
			: resetAfter !== undefined && resetAfter >= 0 ? now + resetAfter * 1000 : undefined;
		if (resetsAt === undefined) continue;
		const minutes = num(`x-codex-${prefix}-window-minutes`);
		const id: UsageWindowId = minutes !== undefined && minutes > 0 ? (minutes >= 24 * 60 ? "seven_day" : "five_hour") : fallback;
		out[id] = { utilization: used / 100, resetsAt };
	}
	return Object.keys(out).length > 0 ? out : null;
}

/** Fold a new report into the snapshot: the reported windows replace the
 *  old ones, the others stay. `changed` is false when nothing moved. */
export function mergeUsageLimits(
	prev: UsageLimitsSnapshot,
	provider: UsageProvider,
	windows: UsageWindows,
	now: number,
): { snapshot: UsageLimitsSnapshot; changed: boolean } {
	const old = prev.providers[provider];
	const merged: UsageWindows = { ...old?.windows, ...windows };
	const changed = !old || USAGE_WINDOWS.some((id) => {
		const a = old.windows[id];
		const b = merged[id];
		return a?.utilization !== b?.utilization || a?.resetsAt !== b?.resetsAt;
	});
	return {
		snapshot: { providers: { ...prev.providers, [provider]: { updatedAt: now, windows: merged } } },
		changed,
	};
}

/** A snapshot read back from disk or the wire, with anything malformed
 *  dropped. */
export function normalizeUsageSnapshot(raw: unknown): UsageLimitsSnapshot {
	const providers: UsageLimitsSnapshot["providers"] = {};
	const source = raw && typeof raw === "object" ? (raw as { providers?: unknown }).providers : undefined;
	if (!source || typeof source !== "object") return { providers };
	for (const provider of USAGE_PROVIDERS) {
		const entry = (source as Record<string, unknown>)[provider];
		if (!entry || typeof entry !== "object") continue;
		const { updatedAt, windows } = entry as { updatedAt?: unknown; windows?: unknown };
		const clean: UsageWindows = {};
		for (const id of USAGE_WINDOWS) {
			const window = windows && typeof windows === "object" ? toWindow((windows as Record<string, unknown>)[id]) : null;
			if (window) clean[id] = window;
		}
		if (Object.keys(clean).length > 0) providers[provider] = { updatedAt: finite(updatedAt) ? updatedAt : 0, windows: clean };
	}
	return { providers };
}

// ─── the view ────────────────────────────────────────────────────────────────

export type UsageTone = "normal" | "warn" | "high";

export interface UsageRow {
	id: UsageWindowId;
	label: string;
	/** Whole percent, 0..100 (a limit passed shows 100). */
	percent: number;
	tone: UsageTone;
	/** «nullstilles kl. 14.00» / «nullstilles man. 09.00»; null once the
	 *  reset has passed (the old number no longer holds: 0 %). */
	resetLabel: string | null;
}

export interface UsageProviderView {
	provider: UsageProvider;
	label: string;
	rows: UsageRow[];
}

/** Yellow over 75 %, red over 90 %. */
export function usageTone(percent: number): UsageTone {
	if (percent > 90) return "high";
	if (percent > 75) return "warn";
	return "normal";
}

const WEEKDAYS = ["søn.", "man.", "tir.", "ons.", "tor.", "fre.", "lør."];
const pad = (n: number) => String(n).padStart(2, "0");

/** The reset in the learner's own clock: the 5-hour window by the time,
 *  the week by the weekday and the time. */
export function usageResetLabel(id: UsageWindowId, resetsAt: number): string {
	const at = new Date(resetsAt);
	const time = `${pad(at.getHours())}.${pad(at.getMinutes())}`;
	return id === "five_hour" ? `nullstilles kl. ${time}` : `nullstilles ${WEEKDAYS[at.getDay()]} ${time}`;
}

/** The block's content: providers with data, in a fixed order, each with
 *  its windows (5 timer, then Uke). A window whose reset has passed reads
 *  0 %. Empty when nothing is known. */
export function usageView(snapshot: UsageLimitsSnapshot, now: number): UsageProviderView[] {
	const out: UsageProviderView[] = [];
	for (const provider of USAGE_PROVIDERS) {
		const entry = snapshot.providers[provider];
		if (!entry) continue;
		const rows: UsageRow[] = [];
		for (const id of USAGE_WINDOWS) {
			const window = entry.windows[id];
			if (!window) continue;
			const stale = window.resetsAt <= now;
			const percent = stale ? 0 : Math.min(100, Math.max(0, Math.round(window.utilization * 100)));
			rows.push({
				id,
				label: USAGE_WINDOW_LABEL[id],
				percent,
				tone: usageTone(percent),
				resetLabel: stale ? null : usageResetLabel(id, window.resetsAt),
			});
		}
		if (rows.length > 0) out.push({ provider, label: USAGE_PROVIDER_LABEL[provider], rows });
	}
	return out;
}

/** The block's tooltip for one provider. */
export function usageHint(provider: UsageProvider): string {
	return `${USAGE_PROVIDER_LABEL[provider]}-abonnementet har to bruksgrenser: én som gjelder 5 timer om gangen, og én for uka. Strekene viser hvor mye du har brukt av hver. Ved nullstilling starter grensen på 0 igjen.`;
}
