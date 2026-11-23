/**
 * THE SERVER-SIDE SURFACE — the only src module (besides the core barrel)
 * that app/ may import. Route handlers and server components come through
 * here; nothing under app/ touches src/store or src/agent directly.
 */

export * from "./chat-handler.ts";
export * from "./events-stream.ts";
export * from "./chats.ts";
export * from "./graph.ts";
export * from "./source-organization.ts";
export * from "./source-deletion.ts";
export { NotesImportError } from "../agent/subagents/extraction.ts";
export { convertPdf } from "../agent/subagents/pdf-ops.ts";
export { joinPages } from "../agent/subagents/pdf-markdown.ts";
export * from "./commit-positions.ts";
export * from "./jobs.ts";
export * from "./stores.ts";
export { readRenderSettings, writeRenderSettings } from "../store/render-settings.ts";
// The settings record + prompt overrides (settings-storage wave, 2026-09-19).
// The *Record aliases keep the app/api/settings routes explicit about which
// seam they touch (the raw record, not the chat-section convenience view).
export {
	readSettings as readSettingsRecord,
	writeSettings as writeSettingsRecord,
	settingsStore,
} from "../store/settings.ts";
export { promptOverrides } from "../store/prompt-overrides.ts";
export { isValidSegmentPath } from "../core/prompt-segments.ts";
// The canonical segment discovery/resolution lives in the agent layer
// (composition is an agent concern); the barrel re-exports it for the
// routes — server→agent is the lawful direction (chat-handler precedent).
export { effectivePromptSegments, allSegmentPaths, readPromptOverride } from "../agent/prompt-segments.ts";

// The auth/keys composition (auth-keys wave, 2026-09-19): the curated
// key catalog + the env-reflecting store behind GET/PUT/DELETE /api/keys.
// Importing this module runs the idempotent boot fill-gap — every consumer
// keeps its plain process.env reads (that seam is the point).
export * from "./keys.ts";
export * from "./search.ts";
export { authStore } from "../store/auth.ts";
export * from "./settings-body.ts";
export * from "./turn-liveness.ts";
export * from "./turn-runs.ts";
export * from "./dismissal-park.ts";
export * from "./compaction.ts";
export { runPiTurn, piTurnResponse, type PiTurnHandle, type PiTurnSpec } from "./pi/ui-stream.ts";
export * from "./observability.ts";
export * from "./model-catalog.ts";
export { subscriptionControlsResponse, subscriptionBrowserResponse } from "./web-subscription-http.ts";
export { sessionCost } from "./pricing.ts";
export { claudeCodeInstallationResponse } from "./claude-code.ts";
// The custom endpoint module (registers into piModels() + probes for models).
// No import side effects; the boot sync lives in stores.ts.
export * from "./custom-provider.ts";
export { customProviderGet, customProviderMutation } from "./custom-provider-http.ts";
// Courses ("fag", exam mode): the /api/courses service + the NTNU fetch.
export * from "./courses.ts";
// «Avslutt økt»: the /api/chats/[id]/wrap service (end the økt, summary +
// recall quiz) and the course-topic update that follows it.
export * from "./session-wrap.ts";
export * from "./session-topics.ts";
// «Legg inn besvarelse»: the /api/attachments service (pasted images → files).
export * from "./attachments.ts";
// Prøveeksamen (fase 6): the /api/mock-exams service and the results read API.
export {
	getMockExamView, saveMockExamDraft, submitMockExam, openMockExamPdf, listCourseMockExams,
	listMockExamResults, mockExamFailureResponse, mockExamSeams,
} from "./mock-exams.ts";
export { NtnuUnreachableError, createNtnuClient, parseNtnuCoursePage } from "./ntnu.ts";
// "Importer fra LearnHarness": additive import of another data folder.
export {
	DataImportError, importSeams, legacyDataCandidates, previewImport, runImport,
	legacyImportCandidatesResponse, legacyImportPreviewResponse, legacyImportRunResponse,
} from "./data-import.ts";
