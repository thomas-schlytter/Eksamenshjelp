/**
 * What the learner calls the agents (innføringen, 2026-11, Thomas):
 * the internal role ids (config.ts ModelRole) and model slots
 * (settings.ts MODEL_SLOTS) never change; this is the one table of the
 * names and one-line explanations the UI shows for them. Browser-safe.
 */

import type { ModelRole } from "../../config.ts";
import type { JobKind } from "./contracts.ts";
import type { ModelSlotName } from "./settings.ts";

export interface DisplayName {
	/** The name, as a noun in definite form: «Læreren». */
	name: string;
	/** One plain line: what it does for the learner. */
	description: string;
}

export const ROLE_DISPLAY: Readonly<Record<ModelRole, DisplayName>> = {
	prober: { name: "Kartleggeren", description: "finner ut hva du allerede kan" },
	teacher: { name: "Læreren", description: "den du snakker med i chatten" },
	researcher: { name: "Kildesøk", description: "leter etter stoff på nettet og i kildene dine" },
	demoBuilder: { name: "Demo-lageren", description: "lager små demoer du kan prøve selv" },
	extractor: { name: "Notatskriveren", description: "lager temalister, sammendrag og notater fra øktene" },
	auditor: { name: "Kvalitetskontrollen", description: "sjekker at notatene stemmer" },
	visualMaker: { name: "Figurtegneren", description: "tegner figurer og diagrammer" },
	pdfReader: { name: "PDF-leseren", description: "leser PDF-er og bilder for deg" },
};

export const SLOT_DISPLAY: Readonly<Record<ModelSlotName, DisplayName>> = {
	strong: { name: "Kraftig modell", description: "brukes der svaret må være best" },
	cheap: { name: "Rask og billig modell", description: "brukes til arbeidet i bakgrunnen" },
	vision: { name: "Modell som ser bilder", description: "brukes til figurer, bilder og PDF-er" },
};

/** The roles in the order the settings list them, grouped by slot. */
export const ROLES_BY_SLOT: Readonly<Record<ModelSlotName, readonly ModelRole[]>> = {
	strong: ["teacher", "prober"],
	cheap: ["researcher", "demoBuilder", "extractor", "auditor"],
	vision: ["visualMaker", "pdfReader"],
};

/** «Læreren: den du snakker med i chatten». */
export function roleLine(role: ModelRole): string {
	const { name, description } = ROLE_DISPLAY[role];
	return `${name}: ${description}`;
}

/** «Læreren og Kartleggeren» / «Kildesøk, Demo-lageren og …». */
export function joinNames(names: readonly string[]): string {
	if (names.length <= 1) return names[0] ?? "";
	return `${names.slice(0, -1).join(", ")} og ${names[names.length - 1]}`;
}

/** The role behind a background job (the activity dock and the job cards).
 *  Mock exams are written and graded by the teacher role. */
export const JOB_KIND_ROLE: Readonly<Record<JobKind, ModelRole>> = {
	research: "researcher",
	demo: "demoBuilder",
	visual: "visualMaker",
	pdf: "pdfReader",
	mockExam: "teacher",
	mockGrade: "teacher",
};
