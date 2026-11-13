import { KnowledgeMap } from "@/components/home";
import { readSettingsRecord } from "@/src/server";
import { resolveSettings, slotsConfigured } from "@/src/core";

// Dynamic: the configured state and the rendering switch are read per
// navigation (dynamic routes aren't cached client-side).
export const dynamic = "force-dynamic";

/**
 * THE KNOWLEDGE MAP (/kart): what used to be the home screen before
 * «Mine fag» took `/`. Same view, same pick flow, same start box.
 */
export default function KnowledgeMapPage() {
	const record = readSettingsRecord();
	// GRAPH RENDERING (owner, 2026-10-06): off = the main view is the
	// quiet summary + chains view. Resolved through the one core resolver
	// (missing section / absent key → factory default on).
	const rendering = resolveSettings(record ?? null).graph.rendering;
	return <KnowledgeMap initialConfigured={slotsConfigured(record?.models)} rendering={rendering} />;
}
