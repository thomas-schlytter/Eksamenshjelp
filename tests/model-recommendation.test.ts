import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { join } from "node:path";
import {
	claudeTierFromConfig,
	newestOfFamily,
	planLabel,
	recommendChatGPTModels,
	recommendClaudeModels,
	type RecommendationModel,
} from "../src/core/model-recommendation.ts";
import { claudeConfigPath, readClaudeTier, recommendationFor } from "../src/server/subscription-tier.ts";

const LEVELS = ["low", "medium", "high", "xhigh", "max"] as RecommendationModel["supportedLevels"];
const claude = (id: string): RecommendationModel => ({ provider: "claude-code", id, input: ["text", "image"], supportedLevels: LEVELS });
const CLAUDE_CODE = [claude("opus"), claude("sonnet"), claude("haiku")];
const gpt = (id: string, referenceCost: number | null, input: ("text" | "image")[] = ["text", "image"]): RecommendationModel => ({
	provider: "chatgpt", id, input, supportedLevels: ["minimal", "low", "medium", "high"], referenceCost,
});

describe("claudeTierFromConfig (~/.claude.json)", () => {
	it("Max from organizationType", () => {
		assert.equal(claudeTierFromConfig({ oauthAccount: { organizationType: "claude_max", organizationRateLimitTier: "default_claude_max_5x", billingType: "stripe_subscription" } }), "max");
	});
	it("Pro from organizationType", () => {
		assert.equal(claudeTierFromConfig({ oauthAccount: { organizationType: "claude_pro" } }), "pro");
	});
	it("falls back to the rate-limit tier", () => {
		assert.equal(claudeTierFromConfig({ oauthAccount: { organizationRateLimitTier: "default_claude_max_20x" } }), "max");
	});
	it("missing account, wrong shapes and unknown plans are unknown", () => {
		for (const config of [undefined, null, "text", 42, {}, { oauthAccount: null }, { oauthAccount: "x" }, { oauthAccount: { organizationType: 7 } }, { oauthAccount: { organizationType: "claude_team", organizationRateLimitTier: "default_raven" } }]) {
			assert.equal(claudeTierFromConfig(config), "unknown", JSON.stringify(config));
		}
	});
});

describe("readClaudeTier", () => {
	it("reads the file Claude Code reads, CLAUDE_CONFIG_DIR first", () => {
		assert.equal(claudeConfigPath({}, "/home/elev"), join("/home/elev", ".claude.json"));
		assert.equal(claudeConfigPath({ CLAUDE_CONFIG_DIR: "/cfg" }, "/home/elev"), join("/cfg", ".claude.json"));
		assert.equal(claudeConfigPath({ CLAUDE_CONFIG_DIR: "  " }, "/home/elev"), join("/home/elev", ".claude.json"));
	});
	it("pro, max, missing, invalid and unknown", async () => {
		const file = (body: string) => async () => body;
		assert.equal(await readClaudeTier("/x", file(JSON.stringify({ oauthAccount: { organizationType: "claude_pro", emailAddress: "a@b.no" } }))), "pro");
		assert.equal(await readClaudeTier("/x", file(JSON.stringify({ oauthAccount: { organizationType: "claude_max" } }))), "max");
		assert.equal(await readClaudeTier("/x", async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }), "unknown");
		assert.equal(await readClaudeTier("/x", file("{not json")), "unknown");
		assert.equal(await readClaudeTier("/x", file(JSON.stringify({ oauthAccount: { organizationType: "something_new" } }))), "unknown");
	});
	it("asks for exactly the given path", async () => {
		const asked: string[] = [];
		await readClaudeTier("/cfg/.claude.json", async (p) => { asked.push(p); return "{}"; });
		assert.deepEqual(asked, ["/cfg/.claude.json"]);
	});
});

describe("recommendClaudeModels", () => {
	it("Pro: Sonnet strong, Haiku cheap, Sonnet vision", () => {
		assert.deepEqual(recommendClaudeModels("pro", CLAUDE_CODE), {
			strong: { provider: "claude-code", id: "sonnet", thinkingLevel: "medium" },
			cheap: { provider: "claude-code", id: "haiku", thinkingLevel: "low" },
			vision: { provider: "claude-code", id: "sonnet", thinkingLevel: "medium" },
		});
	});
	it("Max: Opus strong on high", () => {
		const slots = recommendClaudeModels("max", CLAUDE_CODE);
		assert.deepEqual(slots.strong, { provider: "claude-code", id: "opus", thinkingLevel: "high" });
		assert.equal(slots.cheap?.id, "haiku");
		assert.equal(slots.vision?.id, "sonnet");
	});
	it("unknown is Pro (safest for the quota)", () => {
		assert.deepEqual(recommendClaudeModels("unknown", CLAUDE_CODE), recommendClaudeModels("pro", CLAUDE_CODE));
	});
	it("only Claude Code models, only what the catalog has", () => {
		const other = { ...claude("claude-opus-5-5"), provider: "anthropic" };
		assert.deepEqual(recommendClaudeModels("max", [other]), {});
		assert.deepEqual(Object.keys(recommendClaudeModels("max", [claude("haiku")])), ["cheap"]);
	});
	it("newest of a family: the alias, else the highest version, undated first", () => {
		const anthropic = (id: string) => ({ ...claude(id), provider: "anthropic" });
		const models = ["claude-sonnet-4-5-20250929", "claude-sonnet-5-5", "claude-sonnet-4-6", "claude-sonnet-5"].map(anthropic);
		assert.equal(newestOfFamily(models, "anthropic", "sonnet")?.id, "claude-sonnet-5-5");
		assert.equal(newestOfFamily(["claude-haiku-4-5-20251001", "claude-haiku-4-5"].map(anthropic), "anthropic", "haiku")?.id, "claude-haiku-4-5");
		assert.equal(newestOfFamily([claude("sonnet"), claude("sonnet-2")], "claude-code", "sonnet")?.id, "sonnet");
		assert.equal(newestOfFamily(models, "anthropic", "opus"), undefined);
	});
	it("a level the model lacks clamps to the nearest supported", () => {
		const slots = recommendClaudeModels("pro", [{ ...claude("sonnet"), supportedLevels: ["low", "high"] }, claude("haiku")]);
		assert.equal(slots.strong?.thinkingLevel, "low");
	});
});

describe("recommendChatGPTModels", () => {
	const account = [gpt("gpt-5.5", 30), gpt("gpt-5.4", 15), gpt("gpt-5.4-mini", 4.5), gpt("gpt-5.3-codex", 14), gpt("gpt-5.5-pro", 180), gpt("gpt-5.4-nano", 1.25, ["text"])];
	it("Plus: a mid model strong, the cheapest cheap, a mid image model for vision", () => {
		assert.deepEqual(recommendChatGPTModels("plus", account), {
			strong: { provider: "chatgpt", id: "gpt-5.4", thinkingLevel: "medium" },
			cheap: { provider: "chatgpt", id: "gpt-5.4-nano", thinkingLevel: "low" },
			vision: { provider: "chatgpt", id: "gpt-5.4", thinkingLevel: "medium" },
		});
	});
	it("Pro: the strongest general model (no codex, no slow pro run)", () => {
		const slots = recommendChatGPTModels("pro", account);
		assert.deepEqual(slots.strong, { provider: "chatgpt", id: "gpt-5.5", thinkingLevel: "high" });
		assert.equal(slots.cheap?.id, "gpt-5.4-nano");
	});
	it("unknown is Plus", () => {
		assert.deepEqual(recommendChatGPTModels("unknown", account), recommendChatGPTModels("plus", account));
	});
	it("equal prices pick the newest; unpriced or other providers are ignored", () => {
		const slots = recommendChatGPTModels("pro", [gpt("gpt-6-sol", 10), gpt("gpt-6.1-sol", 10), gpt("gpt-x", null), { ...gpt("gpt-9", 99), provider: "openai" }]);
		assert.equal(slots.strong?.id, "gpt-6.1-sol");
		assert.deepEqual(recommendChatGPTModels("plus", [gpt("gpt-x", null)]), {});
	});
	it("one model fills every slot", () => {
		const slots = recommendChatGPTModels("plus", [gpt("gpt-5.4", 15)]);
		assert.deepEqual([slots.strong?.id, slots.cheap?.id, slots.vision?.id], ["gpt-5.4", "gpt-5.4", "gpt-5.4"]);
	});
});

describe("recommendationFor (server wiring)", () => {
	const providers = (ids: string[]) => ids.map((id) => ({ id, envVar: "", keyPresent: true }));
	const entries = (models: RecommendationModel[]) => models.map((m) => ({ ...m, name: m.id, reasoning: true, cost: null, contextWindow: null, maxTokens: null }));
	it("Claude first when both are connected", () => {
		const rec = recommendationFor({ providers: providers(["claude-code", "chatgpt"]), models: entries([...CLAUDE_CODE, gpt("gpt-5.4", null)]) }, { claude: "max", chatgpt: "unknown" }, () => 15);
		assert.equal(rec?.subscription, "claude");
		assert.equal(rec?.slots.strong?.id, "opus");
	});
	it("ChatGPT ranks by the OpenAI list price of the same id", () => {
		const prices: Record<string, number> = { "gpt-5.5": 30, "gpt-5.4": 15, "gpt-5.4-mini": 4.5 };
		const rec = recommendationFor({ providers: providers(["chatgpt"]), models: entries([gpt("gpt-5.5", null), gpt("gpt-5.4", null), gpt("gpt-5.4-mini", null)]) }, { claude: "unknown", chatgpt: "unknown" }, (id) => prices[id] ?? null);
		assert.equal(rec?.subscription, "chatgpt");
		assert.equal(rec?.slots.strong?.id, "gpt-5.4");
		assert.equal(rec?.slots.cheap?.id, "gpt-5.4-mini");
	});
	it("nothing connected (or a disconnected provider's models): no recommendation", () => {
		assert.equal(recommendationFor({ providers: [{ id: "claude-code", envVar: "", keyPresent: false }], models: entries(CLAUDE_CODE) }, { claude: "pro", chatgpt: "unknown" }, () => null), null);
		assert.equal(recommendationFor({ providers: providers(["openrouter"]), models: [] }, { claude: "unknown", chatgpt: "unknown" }, () => null), null);
	});
});

describe("planLabel", () => {
	it("names the plan, or just the service when unknown", () => {
		assert.equal(planLabel({ subscription: "claude", tier: "max" }), "Claude Max");
		assert.equal(planLabel({ subscription: "claude", tier: "pro" }), "Claude Pro");
		assert.equal(planLabel({ subscription: "claude", tier: "unknown" }), "Claude");
		assert.equal(planLabel({ subscription: "chatgpt", tier: "plus" }), "ChatGPT Plus");
		assert.equal(planLabel({ subscription: "chatgpt", tier: "unknown" }), "ChatGPT");
	});
});
