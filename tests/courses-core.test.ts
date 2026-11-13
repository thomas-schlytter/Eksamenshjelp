/**
 * COURSES — the pure core (exam mode): course-code and id rules, topic
 * merging (status survives a regeneration), the deterministic topic
 * reserve, summaries, and the course-context marker with its three
 * projections (the model's text, the view part, the request cause).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	courseContextText,
	courseSummary,
	daysUntil,
	fallbackTopicDrafts,
	isIsoDate,
	mergeTopics,
	normalizeCourseCode,
	slugifyTopicId,
	TOPIC_STATUS_LABEL,
	topicCounts,
	type Course,
	type CourseTopic,
} from "../src/core/courses.ts";
import { nativeInputCause, newCourseContextMessage, newGraphContextMessage, toLlmMessages, type LhMessage } from "../src/core/native-messages.ts";
import { projectView } from "../src/core/view.ts";
import { SERVER_EVENT_TYPES } from "../src/core/events.ts";

const OUTCOME =
	"Kunnskap: Kunnskap om den generelle oppbygningen til et reguleringssystem. Kunnskap om modellering av fysiske systemer med første- og andreordens differensialligninger. " +
	"Kunnskap om virkemåten til regulatorer med P, I og D-virkning. Ferdighet: Kunne analysere et dynamisk system. Kunne designe en (PID)regulator for et slikt system. " +
	"Generell kompetanse: Kommunisere om faglige problemstillinger både med spesialister og allmennheten. Grunnleggende systemforståelse.";

function course(overrides: Partial<Course> = {}): Course {
	return {
		code: "TTK4100",
		name: "Kybernetikk, introduksjon",
		custom: false,
		credits: "7,5",
		content: "Reguleringsteknisk terminologi og sentrale elementære begreper. Innføring i differensialligninger.",
		learningOutcome: OUTCOME,
		exam: { date: "2026-12-10", form: "Skriftlig skoleeksamen", duration: "4 timer", aids: "Kode D" },
		minutesPerDay: 120,
		sources: [
			{ id: "s1", kind: "ntnu", title: "NTNU-emnesiden", url: "https://www.ntnu.no/studier/emner/TTK4100", auto: true, addedAt: "x" },
			{ id: "s2", kind: "folder", title: "Eksamener", path: "/Users/test/TTK4100/eksamener", fileCount: 12, auto: false, addedAt: "x" },
			{ id: "s3", kind: "file", title: "kompendium.pdf", path: "/Users/test/TTK4100/kompendium.pdf", auto: false, addedAt: "x" },
			{ id: "s4", kind: "link", title: "Øvinger", url: "https://example.org/ovinger", auto: false, addedAt: "x" },
			{ id: "s5", kind: "note", title: "Fra foreleser", text: "Eksamen legger vekt på PID.\nBlokkdiagram kommer alltid.", auto: false, addedAt: "x" },
		],
		topics: [
			{ id: "pid-regulator", title: "PID-regulator", description: "Velge og stille inn P, I og D.", weight: 3, status: "red", statusNote: "Blander I og D." },
			{ id: "blokkdiagram", title: "Blokkdiagram", weight: 2, status: "unknown" },
			{ id: "simulink", title: "Simulink", weight: 1, status: "green" },
		],
		planDone: [],
		createdAt: "2026-11-01T00:00:00.000Z",
		updatedAt: "2026-11-02T00:00:00.000Z",
		...overrides,
	};
}

describe("course rules", () => {
	it("normalizes course codes: upper case, trimmed, 2–12 of A–Å, digits and hyphen", () => {
		assert.equal(normalizeCourseCode(" ttk4100 "), "TTK4100");
		assert.equal(normalizeCourseCode("øko-1001"), "ØKO-1001");
		assert.equal(normalizeCourseCode("A"), null);
		assert.equal(normalizeCourseCode("TTK 4100"), null);
		assert.equal(normalizeCourseCode("../etc/passwd"), null);
		assert.equal(normalizeCourseCode("ABCDEFGHIJKLM"), null);
		assert.equal(normalizeCourseCode(4100), null);
		assert.equal(normalizeCourseCode("search"), null, "the search route's own word is reserved");
	});

	it("labels every status in Norwegian", () => {
		assert.deepEqual(TOPIC_STATUS_LABEL, { unknown: "Ikke kartlagt", red: "Kan ikke ennå", yellow: "Usikker", green: "Kan dette" });
	});

	it("slugs are ascii, stable and never empty", () => {
		assert.equal(slugifyTopicId("PID-regulator (P, I og D)"), "pid-regulator-p-i-og-d");
		assert.equal(slugifyTopicId("Første- og andreordens systemer"), "forste-og-andreordens-systemer");
		assert.equal(slugifyTopicId("Blåbærsyltetøy"), "blabaersyltetoy");
		assert.equal(slugifyTopicId("???"), "tema");
		assert.ok(slugifyTopicId("x".repeat(200)).length <= 48);
	});

	it("date helpers: strict ISO dates, signed day distance", () => {
		assert.equal(isIsoDate("2026-12-10"), true);
		assert.equal(isIsoDate("2026-02-30"), false);
		assert.equal(isIsoDate("10.12.2026"), false);
		assert.equal(daysUntil("2026-12-10", "2026-11-13"), 27);
		assert.equal(daysUntil("2026-11-10", "2026-11-13"), -3);
		assert.equal(daysUntil(undefined, "2026-11-13"), null);
		assert.equal(daysUntil("2027-03-29", "2027-03-27"), 2, "no drift across the DST change");
	});

	it("summaries count topics per status and days to the exam", () => {
		const summary = courseSummary(course(), "2026-11-13");
		assert.deepEqual(summary, {
			code: "TTK4100",
			name: "Kybernetikk, introduksjon",
			examDate: "2026-12-10",
			daysLeft: 27,
			counts: { unknown: 1, red: 1, yellow: 0, green: 1 },
			topicCount: 3,
			sourceCount: 5,
			updatedAt: "2026-11-02T00:00:00.000Z",
		});
		const undated = courseSummary(course({ exam: {} }), "2026-11-13");
		assert.equal(undated.daysLeft, null);
		assert.equal("examDate" in undated, false);
		assert.deepEqual(topicCounts([]), { unknown: 0, red: 0, yellow: 0, green: 0 });
	});
});

describe("mergeTopics", () => {
	const previous: CourseTopic[] = [
		{ id: "pid-regulator", title: "PID-regulator", weight: 3, status: "red", statusSource: "agent", statusNote: "Blander I og D.", updatedAt: "2026-11-10T10:00:00.000Z" },
		{ id: "blokkdiagram", title: "Blokkdiagram", weight: 2, status: "green", statusSource: "self", updatedAt: "2026-11-09T10:00:00.000Z" },
	];

	it("a topic with the same id keeps its status, source, note and timestamp", () => {
		const merged = mergeTopics(previous, [{ id: "pid-regulator", title: "PID-regulering", weight: 2 }], "2026-11-13T00:00:00.000Z");
		assert.deepEqual(merged, [
			{ id: "pid-regulator", title: "PID-regulering", weight: 2, status: "red", statusSource: "agent", statusNote: "Blander I og D.", updatedAt: "2026-11-10T10:00:00.000Z" },
		]);
	});

	it("an identical title keeps the status even under a new id, and keeps the old id", () => {
		const merged = mergeTopics(previous, [{ id: "block-diagrams", title: "blokkdiagram " }], "now");
		assert.equal(merged[0]!.id, "blokkdiagram");
		assert.equal(merged[0]!.status, "green");
	});

	it("new topics start unmapped with weight 2; ids come from the title and stay unique", () => {
		const merged = mergeTopics([], [{ title: "Stabilitet" }, { title: "Stabilitet" }, { title: "  " }, { title: "Generate" }], "now");
		assert.deepEqual(merged.map((t) => [t.id, t.status, t.weight]), [
			["stabilitet", "unknown", 2],
			["stabilitet-2", "unknown", 2],
			["generate-2", "unknown", 2],
		]);
	});

	it("an explicit status that differs is the learner's own call", () => {
		const merged = mergeTopics(previous, [{ id: "pid-regulator", title: "PID-regulator", status: "yellow" }], "2026-11-13T00:00:00.000Z");
		assert.equal(merged[0]!.status, "yellow");
		assert.equal(merged[0]!.statusSource, "self");
		assert.equal(merged[0]!.statusNote, undefined, "the agent's old note no longer applies");
		assert.equal(merged[0]!.updatedAt, "2026-11-13T00:00:00.000Z");
		const same = mergeTopics(previous, [{ id: "pid-regulator", title: "PID-regulator", status: "red" }], "later");
		assert.equal(same[0]!.statusSource, "agent", "an unchanged status keeps its history");
	});

	it("clamps odd weights to 2 and caps the list at 40", () => {
		assert.equal(mergeTopics([], [{ title: "A", weight: 7 }], "now")[0]!.weight, 2);
		assert.equal(mergeTopics([], Array.from({ length: 60 }, (_, i) => ({ title: `Tema ${i}` })), "now").length, 40);
	});
});

describe("fallbackTopicDrafts — the deterministic reserve", () => {
	it("one topic per learning-outcome sentence, without the section labels and lead-ins", () => {
		const drafts = fallbackTopicDrafts({ learningOutcome: OUTCOME });
		assert.deepEqual(
			drafts.map((d) => d.title),
			[
				"Den generelle oppbygningen til et reguleringssystem",
				"Modellering av fysiske systemer med første- og andreordens…",
				"Virkemåten til regulatorer med P, I og D-virkning",
				"Analysere et dynamisk system",
				"Designe en (PID)regulator for et slikt system",
			],
		);
		assert.ok(drafts.every((d) => !/kunnskap:|ferdighet:|generell kompetanse/i.test(`${d.title} ${d.description ?? ""}`)));
		assert.equal(drafts[1]!.description, "Kunnskap om modellering av fysiske systemer med første- og andreordens differensialligninger");
	});

	it("drops the general-competence section entirely", () => {
		const drafts = fallbackTopicDrafts({ learningOutcome: OUTCOME });
		assert.ok(!drafts.some((d) => /kommunisere|systemforståelse/i.test(d.title)));
	});

	it("tops up from the course content when the outcomes give fewer than eight", () => {
		const drafts = fallbackTopicDrafts({ learningOutcome: OUTCOME, content: "Reguleringsteknisk terminologi og sentrale elementære begreper. Innføring i differensialligninger. Modellering ved hjelp av blokkdiagrammer." });
		assert.ok(drafts.some((d) => d.title === "Reguleringsteknisk terminologi og sentrale elementære begreper"));
		assert.ok(drafts.some((d) => d.title === "Differensialligninger"));
		assert.ok(drafts.some((d) => d.title === "Modellering ved hjelp av blokkdiagrammer"));
	});

	it("handles English labels, caps at twenty, has unique ids, and is empty without text", () => {
		const english = fallbackTopicDrafts({ learningOutcome: "Knowledge: The student has knowledge of linear systems. Skills: The student can design observers. General competence: Works well in teams." });
		assert.deepEqual(english.map((d) => d.title), ["Linear systems", "Design observers"]);
		const many = fallbackTopicDrafts({ learningOutcome: Array.from({ length: 40 }, (_, i) => `Kunnskap om tema nummer ${i} i faget.`).join(" ") });
		assert.equal(many.length, 20);
		assert.equal(new Set(many.map((d) => d.id)).size, 20);
		assert.deepEqual(fallbackTopicDrafts({}), []);
	});
});

describe("the course-context marker", () => {
	const link = { code: "TTK4100", topicId: "pid-regulator", mode: "learn" as const };

	it("the model-facing text: bracketed preamble, course facts, topics with ids and status, focus, mode, sources", () => {
		const text = courseContextText(course(), link, "2026-11-13");
		assert.ok(text.startsWith("[Session context]"), "never reads as learner speech");
		assert.ok(text.includes("Course: TTK4100 Kybernetikk, introduksjon (7,5 credits)"));
		assert.ok(text.includes("Exam: 2026-12-10 (27 days from the start of this session); Skriftlig skoleeksamen; duration 4 timer; permitted aids: Kode D"));
		assert.ok(text.includes("Reguleringsteknisk terminologi"));
		assert.ok(text.includes("Learning outcomes:"));
		assert.ok(text.includes("- [pid-regulator] PID-regulator (relevance 3): red (cannot do this yet). Note: Blander I og D."));
		assert.ok(text.includes("- [blokkdiagram] Blokkdiagram (relevance 2): not mapped yet"));
		assert.ok(text.includes("Focus topic for this session: [pid-regulator] PID-regulator. Velge og stille inn P, I og D."));
		assert.ok(text.includes("Mode: LEARN."));
		assert.ok(text.includes("- Official NTNU course page: https://www.ntnu.no/studier/emner/TTK4100"));
		assert.ok(text.includes("- Folder, Eksamener (12 readable files): /Users/test/TTK4100/eksamener"));
		assert.ok(text.includes("- File, kompendium.pdf: /Users/test/TTK4100/kompendium.pdf"));
		assert.ok(text.includes("- Link, Øvinger: https://example.org/ovinger"));
		assert.ok(text.includes("    Eksamen legger vekt på PID.\n    Blokkdiagram kommer alltid."), "notes ride inline");
		assert.ok(/Read them when you need them instead of guessing/.test(text));
		assert.ok(/`topic_status`/.test(text) && /never one single answer/.test(text));
	});

	it("each mode carries its own instruction", () => {
		assert.ok(/Mode: PRACTICE\..*exam-style problems.*earlier exam papers/s.test(courseContextText(course(), { code: "TTK4100", mode: "practice" }, "2026-11-13")));
		const mapping = courseContextText(course(), { code: "TTK4100", mode: "mapping" }, "2026-11-13");
		assert.ok(/Mode: MAPPING\..*ALL the topics.*topic_status.*no probe_done/s.test(mapping));
		assert.ok(!mapping.includes("Focus topic"), "no focus topic was given");
		assert.ok(!courseContextText(course(), { code: "TTK4100" }, "2026-11-13").includes("Mode:"));
	});

	it("long notes are clipped, an unknown focus topic is ignored, and a bare course still reads well", () => {
		const long = course({ sources: [{ id: "n", kind: "note", title: "Lang", text: "x".repeat(20_000), auto: false, addedAt: "x" }] });
		const text = courseContextText(long, { code: "TTK4100", topicId: "finnes-ikke" }, "2026-11-13");
		assert.ok(text.includes("[…truncated]"));
		assert.ok(text.length < 12_000);
		assert.ok(!text.includes("Focus topic"));
		const bare = courseContextText(course({ custom: true, credits: undefined, content: undefined, learningOutcome: undefined, exam: {}, sources: [], topics: [] }), { code: "TTK4100" }, "2026-11-13");
		assert.ok(bare.includes("Exam: date not set"));
		assert.ok(bare.includes("No topic list exists for this course yet."));
		assert.ok(bare.includes("- (none added yet)"));
	});

	it("the marker: content for the model, details for the card", () => {
		const m = newCourseContextMessage(course(), link, "2026-11-13");
		assert.equal(m.role, "custom");
		assert.equal(m.customType, "course-context");
		assert.equal(m.content, courseContextText(course(), link, "2026-11-13"));
		assert.deepEqual(m.details, { code: "TTK4100", name: "Kybernetikk, introduksjon", topicId: "pid-regulator", topicTitle: "PID-regulator", mode: "learn", sourceCount: 5 });
		assert.deepEqual(newCourseContextMessage(course(), { code: "TTK4100" }, "2026-11-13").details, { code: "TTK4100", name: "Kybernetikk, introduksjon", sourceCount: 5 });
	});

	it("toLlmMessages flattens it to a user message, ahead of the map picks", () => {
		const cc = newCourseContextMessage(course(), link, "2026-11-13");
		const gc = newGraphContextMessage([{ id: "n_a", name: "A", statement: "S" }], []);
		const wire = toLlmMessages([cc, gc] as unknown as LhMessage[] as never);
		assert.equal(wire.length, 2);
		assert.equal(wire[0]!.role, "user");
		assert.ok(String((wire[0]!.content as { text?: string }[])[0]!.text).includes("Course: TTK4100"));
		assert.ok(String((wire[1]!.content as { text?: string }[])[0]!.text).includes("knowledge map"));
	});

	it("projectView: a user-side data-course-context part carrying the details, never a text bubble", () => {
		const m = newCourseContextMessage(course(), link, "2026-11-13");
		const view = projectView([m as unknown as LhMessage] as never);
		assert.equal(view.length, 1);
		assert.equal(view[0]!.role, "user");
		assert.equal(view[0]!.parts.length, 1);
		const part = view[0]!.parts[0] as { type: string; id: string; data: unknown };
		assert.equal(part.type, "data-course-context");
		assert.equal(part.id, `cc_${m.id}`);
		assert.deepEqual(part.data, m.details);
	});

	it("is a neutral input: it never starts or blames a turn", () => {
		const m = newCourseContextMessage(course(), link, "2026-11-13");
		assert.equal(nativeInputCause(m as never, []), "neutral");
	});
});

describe("the courses-changed event", () => {
	it("is part of the SSE vocabulary the browser wires listeners for", () => {
		assert.ok((SERVER_EVENT_TYPES as readonly string[]).includes("courses-changed"));
	});
});
