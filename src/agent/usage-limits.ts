/**
 * BRUK on disk (2026-11-26): the last known 5-hour and weekly numbers per
 * subscription, in data/usage-limits.json, so the sidebar has them after a
 * restart too. The provider streams report here (the Claude CLI's
 * rate_limit_event, ChatGPT's rate-limit headers); a change is written
 * atomically and announced as `usage-limits-changed`. Parsing and merging
 * are pure, in core/usage-limits.ts.
 *
 * Never throws: a limit reading must not break a teaching turn.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../../config.ts";
import { emit } from "../core/events.ts";
import {
	EMPTY_USAGE,
	mergeUsageLimits,
	normalizeUsageSnapshot,
	parseCodexRateLimitHeaders,
	type UsageLimitsSnapshot,
	type UsageProvider,
	type UsageWindows,
} from "../core/usage-limits.ts";

const usageFile = () => path.join(PATHS.data, "usage-limits.json");

/** The last known numbers (empty when nothing was ever reported). */
export function readUsageLimits(): UsageLimitsSnapshot {
	try {
		return normalizeUsageSnapshot(JSON.parse(fs.readFileSync(usageFile(), "utf-8")));
	} catch {
		return EMPTY_USAGE;
	}
}

/** A provider reported its windows: merge, write when something moved,
 *  announce. */
export function recordUsageLimits(provider: UsageProvider, windows: UsageWindows, now = Date.now()): void {
	try {
		const { snapshot, changed } = mergeUsageLimits(readUsageLimits(), provider, windows, now);
		if (!changed) return;
		const file = usageFile();
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const tmp = `${file}.${randomUUID()}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(snapshot) + "\n");
		fs.renameSync(tmp, file);
		emit("usage-limits-changed", {});
	} catch (err) {
		console.error("usage limits: could not record", err);
	}
}

/** ChatGPT: the response's rate-limit headers, when it has any. */
export function recordChatGPTRateLimitHeaders(headers: Pick<Headers, "get"> | undefined, now = Date.now()): void {
	if (typeof headers?.get !== "function") return;
	try {
		const windows = parseCodexRateLimitHeaders((name) => headers.get(name), now);
		if (windows) recordUsageLimits("chatgpt", windows, now);
	} catch (err) {
		console.error("usage limits: could not read the ChatGPT headers", err);
	}
}
