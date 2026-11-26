/**
 * BRUK (2026-11-26): the subscriptions' 5-hour and weekly limits. Pins the
 * parsing of the Claude CLI's rate_limit_event (also incomplete and
 * «allowed»-only lines), the ChatGPT rate-limit headers, the merge and the
 * data file with its event and route, and the sidebar block.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-usage-"));
process.env.LH_DATA_DIR = path.join(TMP, "data");

const {
	mergeUsageLimits, normalizeUsageSnapshot, parseClaudeRateLimitEvent, parseCodexRateLimitHeaders,
	usageResetLabel, usageTone, usageView, EMPTY_USAGE, SERVER_EVENT_TYPES,
} = await import("../src/core/index.ts");
const { parseCliLine } = await import("../src/agent/claude-code/cli-events.ts");
const { readUsageLimits, recordUsageLimits, recordChatGPTRateLimitHeaders } = await import("../src/agent/usage-limits.ts");
const { subscribe } = await import("../src/core/events.ts");
const route = await import("../app/api/usage-limits/route.ts");
const { UsageLimitsView } = await import("../components/usage-limits.tsx");

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function dom(node: React.ReactNode) {
	return parseHTML(`<html><body>${renderToStaticMarkup(node)}</body></html>`).document;
}

// The real line from Thomas' log (the 5-hour limit passed).
const REJECTED = `{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1795174800,"rateLimitType":"five_hour","overageStatus":"rejected","isUsingOverage":false,"unifiedWindows":{"five_hour":{"utilization":1.01,"resetsAt":1795174800,"status":"rejected","surpassedThreshold":1},"seven_day":{"utilization":0.47,"resetsAt":1795683600,"status":"allowed"}}}}`;

describe("the Claude CLI's rate_limit_event", () => {
	it("both windows, with the reset in milliseconds", () => {
		assert.deepEqual(parseClaudeRateLimitEvent(JSON.parse(REJECTED)), {
			five_hour: { utilization: 1.01, resetsAt: 1795174800_000 },
			seven_day: { utilization: 0.47, resetsAt: 1795683600_000 },
		});
	});

	it("parseCliLine turns it into a rateLimits event, outside the turn's events", () => {
		const event = parseCliLine(REJECTED);
		assert.equal(event?.type, "rateLimits");
		assert.equal(event?.type === "rateLimits" && event.windows.seven_day?.utilization, 0.47);
	});

	it("«allowed»-only and incomplete lines carry nothing", () => {
		assert.equal(parseCliLine(`{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}`), null);
		assert.equal(parseClaudeRateLimitEvent({ type: "rate_limit_event" }), null);
		assert.equal(parseClaudeRateLimitEvent({ type: "rate_limit_event", rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.2 } } } }), null, "no reset: dropped");
		assert.equal(parseClaudeRateLimitEvent({ type: "rate_limit_event", rate_limit_info: { unifiedWindows: { five_hour: { utilization: "lots", resetsAt: 1 } } } }), null);
		assert.equal(parseClaudeRateLimitEvent({ type: "assistant", rate_limit_info: {} }), null, "another line type");
		assert.equal(parseClaudeRateLimitEvent(null), null);
	});

	it("one window only (the other is kept from before by the merge)", () => {
		const line = { type: "rate_limit_event", rate_limit_info: { status: "allowed", unifiedWindows: { seven_day: { utilization: 0, resetsAt: 1795078800, status: "allowed" } } } };
		assert.deepEqual(parseClaudeRateLimitEvent(line), { seven_day: { utilization: 0, resetsAt: 1795078800_000 } });
	});

	it("a line without the window map still counts when it names its window with numbers", () => {
		const line = { type: "rate_limit_event", rate_limit_info: { rateLimitType: "five_hour", utilization: 0.8, resetsAt: 1795174800 } };
		assert.deepEqual(parseClaudeRateLimitEvent(line), { five_hour: { utilization: 0.8, resetsAt: 1795174800_000 } });
	});
});

describe("ChatGPT's rate-limit headers", () => {
	const NOW = Date.parse("2026-11-26T10:00:00Z");
	const headers = (h: Record<string, string>) => (name: string) => h[name] ?? null;

	it("primary is the 5-hour window, secondary the week; reset-at or reset-after", () => {
		assert.deepEqual(parseCodexRateLimitHeaders(headers({
			"x-codex-primary-used-percent": "42",
			"x-codex-primary-window-minutes": "300",
			"x-codex-primary-reset-after-seconds": "600",
			"x-codex-secondary-used-percent": "12.5",
			"x-codex-secondary-window-minutes": "10080",
			"x-codex-secondary-reset-at": "1795683600",
		}), NOW), {
			five_hour: { utilization: 0.42, resetsAt: NOW + 600_000 },
			seven_day: { utilization: 0.125, resetsAt: 1795683600_000 },
		});
	});

	it("no headers, a missing reset or junk: nothing", () => {
		assert.equal(parseCodexRateLimitHeaders(headers({}), NOW), null);
		assert.equal(parseCodexRateLimitHeaders(headers({ "x-codex-primary-used-percent": "40" }), NOW), null);
		assert.equal(parseCodexRateLimitHeaders(headers({ "x-codex-primary-used-percent": "abc", "x-codex-primary-reset-at": "1795683600" }), NOW), null);
	});

	it("the window length wins over the position", () => {
		const parsed = parseCodexRateLimitHeaders(headers({
			"x-codex-primary-used-percent": "5", "x-codex-primary-window-minutes": "10080", "x-codex-primary-reset-at": "1795683600",
		}), NOW);
		assert.deepEqual(Object.keys(parsed ?? {}), ["seven_day"]);
	});
});

describe("merge, the file, the event and the route", () => {
	it("a report replaces its windows and keeps the others; no change, no write", () => {
		const first = mergeUsageLimits(EMPTY_USAGE, "claude", { five_hour: { utilization: 0.5, resetsAt: 2 }, seven_day: { utilization: 0.1, resetsAt: 9 } }, 1);
		assert.equal(first.changed, true);
		const second = mergeUsageLimits(first.snapshot, "claude", { seven_day: { utilization: 0.2, resetsAt: 9 } }, 2);
		assert.deepEqual(second.snapshot.providers.claude?.windows, { five_hour: { utilization: 0.5, resetsAt: 2 }, seven_day: { utilization: 0.2, resetsAt: 9 } });
		assert.equal(mergeUsageLimits(second.snapshot, "claude", { seven_day: { utilization: 0.2, resetsAt: 9 } }, 3).changed, false);
	});

	it("malformed data from disk is dropped, not trusted", () => {
		assert.deepEqual(normalizeUsageSnapshot({ providers: { claude: { updatedAt: 1, windows: { five_hour: { utilization: -1, resetsAt: 5 } } }, other: {} } }), { providers: {} });
		assert.deepEqual(normalizeUsageSnapshot("nope"), { providers: {} });
	});

	it("recording writes the data file, announces it once, and the route serves it", async () => {
		const events: string[] = [];
		const off = subscribe((e) => events.push(e.type));
		assert.deepEqual(readUsageLimits(), { providers: {} }, "nothing reported yet");
		recordUsageLimits("claude", { five_hour: { utilization: 0.3, resetsAt: 1795174800_000 } }, 100);
		recordUsageLimits("claude", { five_hour: { utilization: 0.3, resetsAt: 1795174800_000 } }, 200);
		recordChatGPTRateLimitHeaders(new Headers({ "x-codex-primary-used-percent": "80", "x-codex-primary-reset-at": "1795174800" }), 300);
		recordChatGPTRateLimitHeaders(new Headers({ "content-type": "text/event-stream" }), 400);
		recordChatGPTRateLimitHeaders(undefined);
		off();
		assert.deepEqual(events.filter((t) => t === "usage-limits-changed").length, 2);
		assert.ok(fs.existsSync(path.join(process.env.LH_DATA_DIR!, "usage-limits.json")));
		const body = await route.GET().json();
		assert.equal(body.providers.claude.windows.five_hour.utilization, 0.3);
		assert.equal(body.providers.chatgpt.windows.five_hour.utilization, 0.8);
		assert.ok((SERVER_EVENT_TYPES as readonly string[]).includes("usage-limits-changed"));
	});
});

describe("the view", () => {
	const at = (h: number, m = 0, day = 26) => new Date(2026, 10, day, h, m).getTime(); // local time
	const NOW = at(10);

	it("tones: yellow over 75 %, red over 90 %", () => {
		assert.deepEqual([0, 75, 76, 90, 91, 100].map(usageTone), ["normal", "normal", "warn", "warn", "high", "high"]);
	});

	it("reset labels in the local clock: the time for 5 hours, the weekday for the week", () => {
		assert.equal(usageResetLabel("five_hour", at(14, 5)), "nullstilles kl. 14.05");
		// 2026-11-30 is a Monday.
		assert.equal(usageResetLabel("seven_day", at(9, 0, 30)), "nullstilles man. 09.00");
	});

	it("rows per provider in order; a passed reset reads 0 % without a time; over 100 shows 100", () => {
		const view = usageView({ providers: {
			chatgpt: { updatedAt: 1, windows: { seven_day: { utilization: 0.5, resetsAt: at(9, 0, 30) } } },
			claude: { updatedAt: 1, windows: { five_hour: { utilization: 1.01, resetsAt: at(14) }, seven_day: { utilization: 0.47, resetsAt: at(8) } } },
		} }, NOW);
		assert.deepEqual(view.map((p) => p.label), ["Claude", "ChatGPT"]);
		assert.deepEqual(view[0]!.rows, [
			{ id: "five_hour", label: "5 timer", percent: 100, tone: "high", resetLabel: "nullstilles kl. 14.00" },
			{ id: "seven_day", label: "Uke", percent: 0, tone: "normal", resetLabel: null },
		]);
		assert.deepEqual(usageView(EMPTY_USAGE, NOW), []);
	});

	it("the block: name, «5 timer» and «Uke», percent, reset and a coloured bar; nothing without data", () => {
		const document = dom(<UsageLimitsView now={NOW} snapshot={{ providers: {
			claude: { updatedAt: 1, windows: { five_hour: { utilization: 0.8, resetsAt: at(14, 30) }, seven_day: { utilization: 0.95, resetsAt: at(9, 0, 30) } } },
		} }} />);
		const block = document.querySelector('[data-testid="usage-limits"]')!;
		assert.equal(block.getAttribute("aria-label"), "Bruk");
		assert.equal(document.querySelectorAll('[data-testid="usage-provider"]').length, 1);
		assert.match(block.textContent!, /^Claude/);
		const rows = Array.from(document.querySelectorAll('[data-testid="usage-row"]'));
		assert.deepEqual(rows.map((r) => r.getAttribute("data-tone")), ["warn", "high"]);
		assert.match(rows[0]!.textContent!, /5 timer.*nullstilles kl\. 14\.30.*80 %/);
		assert.match(rows[1]!.textContent!, /Uke.*nullstilles man\. 09\.00.*95 %/);
		const meters = Array.from(document.querySelectorAll('[role="meter"]'));
		assert.deepEqual(meters.map((m) => m.getAttribute("aria-valuenow")), ["80", "95"]);
		assert.match(meters[0]!.innerHTML, /bg-status-yellow/);
		assert.match(meters[1]!.innerHTML, /bg-status-red/);
		assert.equal(renderToStaticMarkup(<UsageLimitsView now={NOW} snapshot={EMPTY_USAGE} />), "");
	});
});
