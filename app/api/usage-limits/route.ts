/**
 * GET /api/usage-limits — the last known 5-hour and weekly limits per
 * subscription (Claude Code CLI, ChatGPT), as the providers last reported
 * them (2026-11-26). `usage-limits-changed` announces a new report.
 */
import { readUsageLimits } from "@/src/server";

export const dynamic = "force-dynamic";

export function GET(): Response {
	return Response.json(readUsageLimits());
}
