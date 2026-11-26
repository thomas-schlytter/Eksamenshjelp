/**
 * Anbefalte modeller per abonnement (2026-11, Thomas: «De som har Pro skal
 * bruke Sonnet som standard»). The setup dialog opens with these picked in
 * the EMPTY slots, so a new learner can just continue. Pure: the server
 * reads the subscription tier and the catalog, this module decides.
 *
 *   Claude Pro / unknown  strong Sonnet, cheap Haiku, vision Sonnet
 *   Claude Max            strong Opus,   cheap Haiku, vision Sonnet
 *   ChatGPT Plus/unknown  strong a mid model, cheap the cheapest, vision mid
 *   ChatGPT Pro           strong the strongest, cheap the cheapest, vision mid
 *
 * Unknown is treated like the smaller plan: the safest for the quota.
 * Models are found in the live catalog (the newest of a family, the
 * account's own ChatGPT list), never hardcoded versions.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ModelCatalogEntry } from "./contracts/models.ts";
import { CLAUDE_CODE_PROVIDER } from "./contracts/claude-code.ts";
import type { ModelSlotName } from "./settings.ts";

export type ClaudeTier = "pro" | "max" | "unknown";
export type ChatGPTTier = "plus" | "pro" | "unknown";

/** Claude Code's `~/.claude.json` → the plan. Reads ONLY the plan fields of
 *  `oauthAccount` (organizationType, organizationRateLimitTier); never the
 *  e-mail, name or any token. Anything missing or unfamiliar is unknown. */
export function claudeTierFromConfig(config: unknown): ClaudeTier {
	if (!config || typeof config !== "object") return "unknown";
	const account = (config as { oauthAccount?: unknown }).oauthAccount;
	if (!account || typeof account !== "object") return "unknown";
	const { organizationType, organizationRateLimitTier } = account as { organizationType?: unknown; organizationRateLimitTier?: unknown };
	const plan = (value: unknown): ClaudeTier | null => {
		if (typeof value !== "string") return null;
		if (/claude_max/i.test(value)) return "max";
		if (/claude_pro/i.test(value)) return "pro";
		return null;
	};
	return plan(organizationType) ?? plan(organizationRateLimitTier) ?? "unknown";
}

/** One recommended slot pick. */
export interface RecommendedPick {
	provider: string;
	id: string;
	thinkingLevel?: ThinkingLevel;
}
export type RecommendedSlots = Partial<Record<ModelSlotName, RecommendedPick>>;

export type SubscriptionRecommendation =
	| { subscription: "claude"; tier: ClaudeTier; slots: RecommendedSlots }
	| { subscription: "chatgpt"; tier: ChatGPTTier; slots: RecommendedSlots };

/** GET /api/subscription-tier. `recommendation` is null when neither Claude
 *  nor ChatGPT is connected (or their catalog is empty). */
export interface SubscriptionTierResponse {
	claude: ClaudeTier;
	chatgpt: ChatGPTTier;
	recommendation: SubscriptionRecommendation | null;
}

/** The catalog fields a recommendation needs. `referenceCost` is the
 *  list price (USD per million output tokens) used to rank ChatGPT
 *  models: the account catalog itself carries no prices. */
export type RecommendationModel = Pick<ModelCatalogEntry, "provider" | "id" | "input" | "supportedLevels"> & { referenceCost?: number | null };

const LEVEL_LADDER: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** The wanted level, or the nearest one the model supports (lower on a tie). */
function nearestLevel(wanted: ThinkingLevel, supported: readonly ThinkingLevel[]): ThinkingLevel | undefined {
	if (supported.includes(wanted)) return wanted;
	const at = LEVEL_LADDER.indexOf(wanted);
	let best: ThinkingLevel | undefined;
	let distance = Infinity;
	for (const level of supported) {
		const d = Math.abs(LEVEL_LADDER.indexOf(level) - at);
		if (d < distance || (d === distance && best !== undefined && LEVEL_LADDER.indexOf(level) < LEVEL_LADDER.indexOf(best))) {
			best = level;
			distance = d;
		}
	}
	return best;
}

function pick(model: RecommendationModel | undefined, level: ThinkingLevel): RecommendedPick | undefined {
	if (!model) return undefined;
	const thinkingLevel = nearestLevel(level, model.supportedLevels);
	return { provider: model.provider, id: model.id, ...(thinkingLevel ? { thinkingLevel } : {}) };
}

/** Version numbers in an id, without date stamps (claude-sonnet-4-5-20250929 → [4, 5]). */
function version(id: string): number[] {
	return (id.match(/\d+/g) ?? []).filter((part) => part.length < 8).map(Number);
}
const dated = (id: string) => /\d{8}/.test(id);

/** Newer first: higher version, then the undated alias. */
function newer(a: RecommendationModel, b: RecommendationModel): number {
	const va = version(a.id);
	const vb = version(b.id);
	for (let i = 0; i < Math.max(va.length, vb.length); i++) {
		const d = (vb[i] ?? -1) - (va[i] ?? -1);
		if (d !== 0) return d;
	}
	return Number(dated(a.id)) - Number(dated(b.id));
}

/** The newest model of a family (`sonnet`) from one provider. An id that
 *  IS the family (Claude Code's alias, always the newest) wins. */
export function newestOfFamily(models: readonly RecommendationModel[], provider: string, family: string): RecommendationModel | undefined {
	const word = new RegExp(`(^|[-_.])${family}($|[-_.])`, "i");
	const candidates = models.filter((m) => m.provider === provider && word.test(m.id));
	return candidates.find((m) => m.id.toLowerCase() === family) ?? [...candidates].sort(newer)[0];
}

const seesImages = (m: RecommendationModel | undefined) => !!m && m.input.includes("image");

export function recommendClaudeModels(tier: ClaudeTier, models: readonly RecommendationModel[]): RecommendedSlots {
	const opus = newestOfFamily(models, CLAUDE_CODE_PROVIDER, "opus");
	const sonnet = newestOfFamily(models, CLAUDE_CODE_PROVIDER, "sonnet");
	const haiku = newestOfFamily(models, CLAUDE_CODE_PROVIDER, "haiku");
	const slots: RecommendedSlots = {};
	const strong = tier === "max" ? pick(opus, "high") : pick(sonnet, "medium");
	const cheap = pick(haiku, "low");
	const vision = seesImages(sonnet) ? pick(sonnet, "medium") : undefined;
	if (strong) slots.strong = strong;
	if (cheap) slots.cheap = cheap;
	if (vision) slots.vision = vision;
	return slots;
}

/** Specialist ChatGPT variants a tutor should not default to: coding,
 *  realtime/audio, the non-reasoning chat alias and the slow «pro» runs. */
const SPECIALIST = /codex|realtime|audio|search|transcribe|tts|chat-latest|(^|-)pro($|-)/i;

export function recommendChatGPTModels(tier: ChatGPTTier, models: readonly RecommendationModel[]): RecommendedSlots {
	const priced = models.filter((m): m is RecommendationModel & { referenceCost: number } =>
		m.provider === "chatgpt" && !SPECIALIST.test(m.id) && typeof m.referenceCost === "number" && Number.isFinite(m.referenceCost));
	if (!priced.length) return {};
	// Dearest first; among equals, the newest.
	const byCost = [...priced].sort((a, b) => b.referenceCost - a.referenceCost || newer(a, b));
	const strongest = byCost[0]!;
	// «Mellomsterk»: the dearest model at most half the price of the strongest.
	const mid = (list: typeof byCost) => list.find((m) => m.referenceCost <= list[0]!.referenceCost / 2) ?? list[0];
	const cheapest = [...priced].sort((a, b) => a.referenceCost - b.referenceCost || newer(a, b))[0];
	const visionList = byCost.filter((m) => seesImages(m));
	const slots: RecommendedSlots = {};
	const strong = tier === "pro" ? pick(strongest, "high") : pick(mid(byCost), "medium");
	const cheap = pick(cheapest, "low");
	const vision = visionList.length ? pick(mid(visionList), "medium") : undefined;
	if (strong) slots.strong = strong;
	if (cheap) slots.cheap = cheap;
	if (vision) slots.vision = vision;
	return slots;
}

/** «Claude Max», «ChatGPT Plus», or just «Claude» when the plan is unknown. */
export function planLabel(recommendation: Pick<SubscriptionRecommendation, "subscription" | "tier">): string {
	const name = recommendation.subscription === "claude" ? "Claude" : "ChatGPT";
	const tier = { pro: "Pro", max: "Max", plus: "Plus", unknown: "" }[recommendation.tier];
	return tier ? `${name} ${tier}` : name;
}
