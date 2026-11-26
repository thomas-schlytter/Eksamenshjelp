/**
 * GET /api/subscription-tier: which plan the connected Claude or ChatGPT
 * account has, and the models the setup dialog recommends for it
 * (src/core/model-recommendation.ts decides).
 *
 * Claude: Claude Code keeps account info without secrets in
 * `<CLAUDE_CONFIG_DIR or ~>/.claude.json` under `oauthAccount`. Only the
 * plan fields are read (claudeTierFromConfig), never the e-mail, the name,
 * a token or the OS keychain. The app's Claude Code runs inherit
 * CLAUDE_CONFIG_DIR (externalCliEnv), so the same file is the one they use.
 *
 * ChatGPT: the connection does not keep the id token's plan claim
 * (electron/chatgpt.cjs keeps only subject and e-mail), so the tier is
 * unknown and the recommendation uses the smaller plan's picks.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { externalCliEnv } from "../core/auth-env.ts";
import { CLAUDE_CODE_PROVIDER } from "../core/contracts/claude-code.ts";
import type { ModelCatalogResponse } from "../core/contracts/models.ts";
import {
	claudeTierFromConfig,
	recommendChatGPTModels,
	recommendClaudeModels,
	type ChatGPTTier,
	type ClaudeTier,
	type SubscriptionRecommendation,
	type SubscriptionTierResponse,
} from "../core/model-recommendation.ts";
import { piModels } from "../agent/models.ts";
import { modelCatalog } from "./model-catalog.ts";

/** The file Claude Code itself reads: CLAUDE_CONFIG_DIR moves it. */
export function claudeConfigPath(env: Record<string, string | undefined> = externalCliEnv(), home: string = homedir()): string {
	const dir = env.CLAUDE_CONFIG_DIR?.trim();
	return dir ? join(dir, ".claude.json") : join(home, ".claude.json");
}

/** Missing, unreadable or invalid file: unknown, never an error. */
export async function readClaudeTier(
	path: string = claudeConfigPath(),
	read: (path: string) => Promise<string> = (p) => readFile(p, "utf8"),
): Promise<ClaudeTier> {
	try {
		return claudeTierFromConfig(JSON.parse(await read(path)));
	} catch {
		return "unknown";
	}
}

export function readChatGPTTier(): ChatGPTTier {
	return "unknown";
}

const connected = (catalog: Pick<ModelCatalogResponse, "providers">, id: string) =>
	catalog.providers.some((p) => p.id === id && p.keyPresent);

/** Claude first when both are connected. Exported for tests. */
export function recommendationFor(
	catalog: Pick<ModelCatalogResponse, "providers" | "models">,
	tiers: { claude: ClaudeTier; chatgpt: ChatGPTTier },
	referenceCost: (id: string) => number | null,
): SubscriptionRecommendation | null {
	if (connected(catalog, CLAUDE_CODE_PROVIDER)) {
		const slots = recommendClaudeModels(tiers.claude, catalog.models);
		if (Object.keys(slots).length) return { subscription: "claude", tier: tiers.claude, slots };
	}
	if (connected(catalog, "chatgpt")) {
		const models = catalog.models.map((m) => (m.provider === "chatgpt" ? { ...m, referenceCost: referenceCost(m.id) } : m));
		const slots = recommendChatGPTModels(tiers.chatgpt, models);
		if (Object.keys(slots).length) return { subscription: "chatgpt", tier: tiers.chatgpt, slots };
	}
	return null;
}

/** The ChatGPT account list has no prices: rank by the same id's OpenAI list price. */
function openAIOutputPrice(id: string): number | null {
	const model = piModels().getModel("openai", id);
	return model ? model.cost.output : null;
}

export async function subscriptionTier(): Promise<SubscriptionTierResponse> {
	const catalog = modelCatalog();
	// A disabled or missing Claude Code is not read at all.
	const claude = connected(catalog, CLAUDE_CODE_PROVIDER) ? await readClaudeTier() : "unknown";
	const chatgpt = readChatGPTTier();
	return { claude, chatgpt, recommendation: recommendationFor(catalog, { claude, chatgpt }, openAIOutputPrice) };
}
