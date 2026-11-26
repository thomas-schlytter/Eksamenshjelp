/**
 * GET /api/subscription-tier — the connected Claude/ChatGPT plan (pro, max,
 * plus or unknown) and the models the setup dialog recommends for it.
 */
import { subscriptionTier } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
	return Response.json(await subscriptionTier(), { headers: { "Cache-Control": "no-store" } });
}
