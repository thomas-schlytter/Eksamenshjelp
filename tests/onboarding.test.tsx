/**
 * The innføring (components/onboarding): when it opens by itself, what the
 * AI step reports, the exam lines, and the static frame (progress «n/5»,
 * one title, the step's own buttons). Plus the agents' display names, the
 * one table every surface reads (src/core/role-names.ts).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ONBOARDING_STEPS,
	aiConnection,
	connectionName,
	examLine,
	isCourseFolderScan,
	onboardingDecision,
	stepLabel,
} from "../components/onboarding/onboarding-model.ts";
import { CourseList, MaterialList, OnboardingFrame } from "../components/onboarding/onboarding.tsx";
import { blobLabel } from "../components/activity-dock.tsx";
import { JOB_KIND_ROLE, ROLE_DISPLAY, ROLES_BY_SLOT, SLOT_DISPLAY, joinNames, roleLine } from "../src/core/role-names.ts";
import { MODEL_SLOTS, ROLE_SLOT, sanitizeUserSettings } from "../src/core/settings.ts";

const pin = (provider: string) => ({ model: { provider, id: "m" } });

describe("onboardingDecision", () => {
	it("opens for a new learner, stays shut once done, and retires itself for a set-up app", () => {
		assert.equal(onboardingDecision({ done: false, courseCount: 0, connected: false }), "show");
		assert.equal(onboardingDecision({ done: false, courseCount: 2, connected: false }), "show", "courses but no AI");
		assert.equal(onboardingDecision({ done: false, courseCount: 0, connected: true }), "show", "AI but no courses");
		assert.equal(onboardingDecision({ done: false, courseCount: 1, connected: true }), "mark-done");
		assert.equal(onboardingDecision({ done: true, courseCount: 0, connected: false }), "none");
	});
});

describe("settings.json onboarding", () => {
	it("keeps a boolean done, drops anything else, and is absent on older records", () => {
		assert.deepEqual(sanitizeUserSettings({ version: 1, onboarding: { done: true } })?.onboarding, { done: true });
		assert.deepEqual(sanitizeUserSettings({ version: 1, onboarding: { done: "yes" } })?.onboarding, {});
		assert.deepEqual(sanitizeUserSettings({ version: 1, onboarding: null })?.onboarding, {});
		assert.equal(sanitizeUserSettings({ version: 1 })?.onboarding, undefined);
	});
});

describe("aiConnection", () => {
	it("reads the catalog's own truth per provider", () => {
		const none = aiConnection(undefined);
		assert.deepEqual(none, { claude: false, chatgpt: false, other: false, connected: false, models: false });
		const claude = aiConnection({ providers: [{ id: "claude-code", envVar: "", keyPresent: true }, { id: "chatgpt", envVar: "", keyPresent: false }], slots: { strong: null, cheap: null, vision: null } });
		assert.equal(claude.claude, true);
		assert.equal(claude.chatgpt, false);
		assert.equal(claude.connected, true);
		assert.equal(claude.models, false);
		assert.equal(connectionName(claude), "Claude");
		const chatgpt = aiConnection({ providers: [], slots: { strong: pin("chatgpt"), cheap: pin("chatgpt"), vision: pin("chatgpt") } }, true);
		assert.equal(chatgpt.chatgpt, true, "the signed-in account counts before the catalog catches up");
		assert.equal(chatgpt.models, true);
		assert.equal(connectionName(chatgpt), "ChatGPT");
		const key = aiConnection({ providers: [{ id: "openrouter", envVar: "OPENROUTER_API_KEY", keyPresent: true }], slots: { strong: null, cheap: null, vision: null } });
		assert.equal(key.other, true);
		assert.equal(connectionName(key), "en annen AI");
	});
});

describe("examLine", () => {
	it("counts, with Norwegian plurals; says plainly when there is nothing yet", () => {
		assert.equal(examLine({ exams: 3, solutions: 2, folder: "/x" }), "3 eksamener · 2 løsningsforslag");
		assert.equal(examLine({ exams: 1, solutions: 0, folder: "/x" }), "1 eksamen");
		assert.equal(examLine({ exams: 0, solutions: 1, folder: "/x" }), "1 løsningsforslag");
		assert.equal(examLine({ exams: 0, solutions: 0, folder: "/x" }), "Ingen eksamener i mappen ennå");
		assert.equal(examLine({ exams: 0, solutions: 0, folder: null }), "Ingen mappe ennå");
	});
});

describe("the frame", () => {
	it("five steps, «n/5» on top, the title once, the step's own footer", () => {
		assert.deepEqual([...ONBOARDING_STEPS], ["welcome", "ai", "courses", "material", "ready"]);
		assert.equal(stepLabel("welcome"), "1/5");
		assert.equal(stepLabel("ready"), "5/5");
		const html = renderToStaticMarkup(
			<OnboardingFrame step="courses" title="Fagene dine" lead="Søk opp fagene dine." onSkip={() => {}} footer={<button type="button">Neste</button>}>
				<p>innhold</p>
			</OnboardingFrame>,
		);
		assert.match(html, /data-testid="onboarding"/);
		assert.match(html, /data-step="courses"/);
		assert.match(html, />3\/5</);
		assert.equal((html.match(/<h1/g) ?? []).length, 1);
		assert.match(html, />Fagene dine</);
		assert.match(html, /Hopp over innføringen/);
		assert.equal((html.match(/bg-primary/g) ?? []).length, 3, "three of five progress segments filled");
		assert.match(html, /aria-modal="true"/);
	});

	it("the course and material lists", () => {
		const courses = [
			{ code: "TTK4100", name: "Kybernetikk, introduksjon", folder: "/d/TTK4100", fileCount: 3, exams: 2, solutions: 1 },
			{ code: "TMA4100", name: "Matematikk 1", folder: null, fileCount: 0, exams: 0, solutions: 0 },
		];
		const list = renderToStaticMarkup(<CourseList courses={courses} />);
		assert.match(list, /TTK4100/);
		assert.equal((list.match(/i fagmappen/g) ?? []).length, 1);
		const material = renderToStaticMarkup(<MaterialList courses={courses} />);
		assert.match(material, /2 eksamener · 1 løsningsforslag/);
		assert.match(material, /Ingen mappe ennå/);
		assert.match(renderToStaticMarkup(<MaterialList courses={[]} />), /Legg til et fag først/);
	});

	it("isCourseFolderScan guards the wire shape", () => {
		assert.equal(isCourseFolderScan({ root: "/r", available: true, courses: [], unknown: [] }), true);
		assert.equal(isCourseFolderScan({ root: "/r" }), false);
		assert.equal(isCourseFolderScan(null), false);
	});
});

describe("the agents' display names", () => {
	it("Thomas' table, verbatim", () => {
		assert.deepEqual(
			Object.fromEntries(Object.entries(ROLE_DISPLAY).map(([role, d]) => [role, d.name])),
			{
				prober: "Kartleggeren",
				teacher: "Læreren",
				researcher: "Kildesøk",
				demoBuilder: "Demo-lageren",
				extractor: "Notatskriveren",
				auditor: "Kvalitetskontrollen",
				visualMaker: "Figurtegneren",
				pdfReader: "PDF-leseren",
			},
		);
		assert.equal(roleLine("teacher"), "Læreren: den du snakker med i chatten");
		assert.deepEqual(Object.fromEntries(MODEL_SLOTS.map((s) => [s, SLOT_DISPLAY[s].name])), {
			strong: "Kraftig modell",
			cheap: "Rask og billig modell",
			vision: "Modell som ser bilder",
		});
	});

	it("every role is listed once, under the slot it really draws from", () => {
		const listed = MODEL_SLOTS.flatMap((slot) => ROLES_BY_SLOT[slot].map((role) => [role, slot] as const));
		assert.equal(listed.length, Object.keys(ROLE_SLOT).length);
		for (const [role, slot] of listed) assert.equal(ROLE_SLOT[role], slot, role);
		assert.equal(joinNames(["A"]), "A");
		assert.equal(joinNames(["A", "B", "C"]), "A, B og C");
	});

	it("the activity dock names the agent at work", () => {
		assert.equal(blobLabel({ process: "job", jobKind: "research" }), "Kildesøk");
		assert.equal(blobLabel({ process: "job", jobKind: "visual" }), "Figurtegneren");
		assert.equal(blobLabel({ process: "job", jobKind: "pdf" }), "PDF-leseren");
		assert.equal(blobLabel({ process: "job", jobKind: "mockExam" }), "Prøveeksamen");
		assert.equal(blobLabel({ process: "extraction", phase: "auditing" }), "Kvalitetskontrollen: kontrollerer");
		assert.equal(blobLabel({ process: "extraction", phase: "extracting" }), "Notatskriveren: trekker ut");
		assert.equal(JOB_KIND_ROLE.demo, "demoBuilder");
	});
});
