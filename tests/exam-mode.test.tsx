/**
 * Exam mode (2026-11-12): emner (mermaid subgraphs) on the plan map, the
 * plan_status tool (red / yellow / green, green gated on an answered
 * explain), mastery derived from the transcript, the exam prompt overlay,
 * and the column layout + colors in the plan popup.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlanTree } from "../src/core/contracts.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
import type { PopupMessage } from "../components/plan-block.tsx";

// ── the seam, BEFORE any config-loading import: never the repo's data/ ──────
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-exam-mode-"));
process.env.LH_DATA_DIR = TMP_DATA;
after(() => fs.rmSync(TMP_DATA, { recursive: true, force: true }));

const { derivePlanMastery, derivePlanMasteryLh, explainAnsweredNodesLh, foldMastery } = await import("../src/core/contracts.ts");
const { createTree } = await import("../src/core/plan-tree.ts");
const { parseMermaidPlan } = await import("../src/agent/tools/mermaid-plan.ts");
const { planTools } = await import("../src/agent/tools/plan.ts");
const { composeInstructions } = await import("../src/agent/teacher-agent.ts");
const { isValidSegmentPath } = await import("../src/core/prompt-segments.ts");
const { allSegmentPaths } = await import("../src/agent/prompt-segments.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { PlanBlock, PlanPopup, groupedLayout, planLayout, MAX_ROW_W, MASTERY_BOX, MASTERY_LABEL, MASTERY_SWATCH } = await import("../components/plan-block.tsx");
const { PlanMarginalia } = await import("../components/plan-window.tsx");
const { TOPIC_STATUS_LABEL } = await import("../src/core/courses.ts");
const { STATUS_STYLE } = await import("../components/courses/course-format.ts");
const { toolActivityLabel } = await import("../src/core/pending.ts");

const EXAM_MERMAID = [
	"graph TD",
	"  subgraph komplekse-tall[Komplekse tall]",
	"    enhetssirkel[Enhetssirkelen] --> polar[Eulers formel]",
	"    polar --> rotter[n-te røtter]",
	"  end",
	'  subgraph analyse["Analyse"]',
	"    deriverbarhet[Deriverbarhet] --> eulermetode[Eulers metode]",
	"    folger[Følger]",
	"  end",
	"  subgraph linalg [Lineær algebra]",
	"    radred[Radreduksjon] --> lu[LU]",
	"  end",
	"  enhetssirkel --> eulermetode",
	"  loose[Uten emne]",
].join("\n");

// ─── parser ──────────────────────────────────────────────────────────────────

describe("mermaid subgraphs → emner", () => {
	it("groups every node by the subgraph it first appears in, keeps order and titles", () => {
		const res = parseMermaidPlan(EXAM_MERMAID);
		assert.equal(res.ok, true, res.problems.join("\n"));
		const plan = res.plan!;
		assert.deepEqual(plan.groups, [
			{ id: "komplekse-tall", title: "Komplekse tall" },
			{ id: "analyse", title: "Analyse" },
			{ id: "linalg", title: "Lineær algebra" },
		]);
		const g = Object.fromEntries(plan.nodes.map((n) => [n.id, n.group ?? null]));
		assert.deepEqual(g, {
			enhetssirkel: "komplekse-tall",
			polar: "komplekse-tall",
			rotter: "komplekse-tall",
			deriverbarhet: "analyse",
			eulermetode: "analyse",
			folger: "analyse",
			radred: "linalg",
			lu: "linalg",
			loose: null,
		});
		// The cross-emne edge after the blocks is a normal edge.
		assert.ok(plan.edges.some((e) => e.from === "enhetssirkel" && e.to === "eulermetode"));
	});

	it("a plan without subgraphs has no groups (teach plans are unchanged)", () => {
		const res = parseMermaidPlan("graph TD\n  a[A] --> b[B]\n");
		assert.equal(res.ok, true);
		assert.equal(res.plan!.groups, undefined);
		assert.ok(res.plan!.nodes.every((n) => n.group === undefined));
	});

	it("rejects nesting, unclosed blocks, stray end, bad slugs and duplicate ids", () => {
		const nested = parseMermaidPlan("graph TD\n subgraph a[A]\n subgraph b[B]\n x\n end\n end\n");
		assert.equal(nested.ok, false);
		assert.ok(nested.problems.some((p) => /can't nest/.test(p)));

		const unclosed = parseMermaidPlan("graph TD\n subgraph a[A]\n x\n");
		assert.ok(unclosed.problems.some((p) => /never closed/.test(p)));

		const stray = parseMermaidPlan("graph TD\n x\n end\n");
		assert.ok(stray.problems.some((p) => /without an open subgraph/.test(p)));

		const badSlug = parseMermaidPlan("graph TD\n subgraph Komplekse tall\n x\n end\n");
		assert.ok(badSlug.problems.some((p) => /subgraph|can't read/.test(p)), badSlug.problems.join("\n"));

		const dup = parseMermaidPlan("graph TD\n subgraph a[A]\n x\n end\n subgraph a[A]\n y\n end\n");
		assert.ok(dup.problems.some((p) => /declared twice/.test(p)));

		const clash = parseMermaidPlan("graph TD\n subgraph x[X]\n x\n end\n");
		assert.ok(clash.problems.some((p) => /also a node id/.test(p)));
	});

	it("createTree keeps only groups that nodes use and drops undeclared group refs", () => {
		const t = createTree(
			[
				{ id: "a", title: "A", group: "g1" },
				{ id: "b", title: "B", group: "ghost" },
			],
			[],
			[
				{ id: "g1", title: "G1" },
				{ id: "empty", title: "Empty" },
			],
		);
		assert.deepEqual(t.groups, [{ id: "g1", title: "G1" }]);
		assert.equal(t.nodes[1]!.group, undefined);
		const plain = createTree([{ id: "a", title: "A" }], []);
		assert.equal(plain.groups, undefined);
	});
});

// ─── plan_status tool ────────────────────────────────────────────────────────

function newChat(kind?: "exam"): string {
	return chatStore.createChat("Eksamen", kind).id;
}

async function exec(tools: ReturnType<typeof planTools>, name: string, input: unknown) {
	const t = tools[name];
	assert.ok(t, `${name} must exist`);
	const r = await t.execute("call-1", input);
	return r.details as { ok: boolean; error?: string; tree?: PlanTree; updated?: number };
}

/** A native explain call on `nodeId` + (optionally) its answered result. */
function explainExchange(id: string, nodeId: string, answered: boolean): LhMessage[] {
	const call = {
		role: "assistant",
		content: [{ type: "toolCall", id, name: "explain", arguments: { nodeId, type: "check", question: "Løs", correctAnswer: "x" } }],
	} as unknown as LhMessage;
	if (!answered) return [call];
	const result = {
		role: "toolResult",
		toolCallId: id,
		toolName: "explain",
		isError: false,
		content: [{ type: "text", text: "{}" }],
		details: { kind: "explain", questionText: "Løs", dontKnow: false, answers: [], text: "mitt svar", answeredAt: "2026-11-12T10:00:00Z" },
	} as unknown as LhMessage;
	return [call, result];
}

describe("plan_status — exam sessions only", () => {
	it("teach sessions don't get the tool; exam sessions do, and plan_init documents emner", () => {
		const teach = planTools({ chatId: newChat(), chatStore });
		assert.deepEqual(Object.keys(teach), ["plan_init"]);
		assert.doesNotMatch(teach.plan_init!.description, /EXAM SESSION/);
		const exam = planTools({ chatId: newChat("exam"), chatStore });
		assert.deepEqual(Object.keys(exam).sort(), ["plan_init", "plan_status"]);
		assert.match(exam.plan_init!.description, /subgraph/);
	});

	it("plan_init persists emner on the tree", async () => {
		const chatId = newChat("exam");
		const tools = planTools({ chatId, chatStore });
		const res = await exec(tools, "plan_init", { mermaid: EXAM_MERMAID });
		assert.equal(res.ok, true, res.error);
		assert.equal(chatStore.getChat(chatId)!.tree!.groups!.length, 3);
	});

	it("refuses unknown nodes and green without an answered explain — all or nothing", async () => {
		const chatId = newChat("exam");
		const tools = planTools({ chatId, chatStore });
		await exec(tools, "plan_init", { mermaid: EXAM_MERMAID });
		const bad = await exec(tools, "plan_status", {
			updates: [
				{ nodeId: "polar", status: "yellow", reason: "halvveis" },
				{ nodeId: "nope", status: "red", reason: "x" },
				{ nodeId: "lu", status: "green", reason: "y" },
			],
		});
		assert.equal(bad.ok, false);
		assert.match(bad.error!, /Nothing was applied/);
		assert.match(bad.error!, /"nope"/);
		assert.match(bad.error!, /"lu" can't be green/);

		const fine = await exec(tools, "plan_status", {
			updates: [
				{ nodeId: "polar", status: "yellow", reason: "halvveis" },
				{ nodeId: "lu", status: "red", reason: "bytter L og U" },
			],
		});
		assert.deepEqual(fine, { ok: true, updated: 2 });
	});

	it("green passes once the node has an ANSWERED explain (a posed-but-unanswered one is not enough)", async () => {
		const chatId = newChat("exam");
		const tools = planTools({ chatId, chatStore });
		await exec(tools, "plan_init", { mermaid: EXAM_MERMAID });
		chatStore.saveMessages(chatId, [...explainExchange("e1", "lu", false)]);
		const early = await exec(tools, "plan_status", { updates: [{ nodeId: "lu", status: "green", reason: "ok" }] });
		assert.equal(early.ok, false);
		chatStore.saveMessages(chatId, [...explainExchange("e1", "lu", true)]);
		const now = await exec(tools, "plan_status", { updates: [{ nodeId: "lu", status: "green", reason: "full utregning riktig" }] });
		assert.equal(now.ok, true);
	});

	it("a dismissed explain does not unlock green", () => {
		const msgs = explainExchange("e2", "lu", true);
		(msgs[1] as unknown as { details: { dismissed: boolean } }).details.dismissed = true;
		assert.equal(explainAnsweredNodesLh(msgs).has("lu"), false);
	});
});

// ─── mastery derivation ──────────────────────────────────────────────────────

const TREE: PlanTree = createTree(parseMermaidPlan(EXAM_MERMAID).plan!.nodes, [], parseMermaidPlan(EXAM_MERMAID).plan!.groups);

describe("mastery derives from the transcript", () => {
	it("latest entry per node wins; unknown ids and bad statuses are ignored", () => {
		const m = foldMastery(TREE, [
			{ updates: [{ nodeId: "lu", status: "red", reason: "a" }, { nodeId: "ghost", status: "green" }] },
			{ updates: [{ nodeId: "lu", status: "yellow", reason: "b" }, { nodeId: "polar", status: "purple" }] },
		]);
		assert.deepEqual([...m.entries()], [["lu", { status: "yellow", reason: "b" }]]);
	});

	it("UI fold reads only plan_status calls whose output is ok", () => {
		const msgs: PopupMessage[] = [
			{
				parts: [
					{ type: "tool-plan_status", state: "output-available", input: { updates: [{ nodeId: "lu", status: "red", reason: "r" }] }, output: { ok: true } },
					{ type: "tool-plan_status", state: "output-available", input: { updates: [{ nodeId: "lu", status: "green", reason: "g" }] }, output: { ok: false, error: "x" } },
					{ type: "tool-plan_status", state: "input-available", input: { updates: [{ nodeId: "polar", status: "green" }] } },
				],
			},
		];
		const m = derivePlanMastery(TREE, msgs as unknown as Parameters<typeof derivePlanMastery>[1]);
		assert.equal(m.get("lu")?.status, "red");
		assert.equal(m.has("polar"), false);
	});

	it("native fold pairs calls with ok results", () => {
		const msgs = [
			{ role: "assistant", content: [{ type: "toolCall", id: "s1", name: "plan_status", arguments: { updates: [{ nodeId: "rotter", status: "yellow", reason: "y" }] } }] },
			{ role: "toolResult", toolCallId: "s1", toolName: "plan_status", details: { ok: true } },
			{ role: "assistant", content: [{ type: "toolCall", id: "s2", name: "plan_status", arguments: { updates: [{ nodeId: "rotter", status: "green" }] } }] },
			{ role: "toolResult", toolCallId: "s2", toolName: "plan_status", details: { ok: false } },
		] as unknown as LhMessage[];
		assert.equal(derivePlanMasteryLh(TREE, msgs).get("rotter")?.status, "yellow");
	});
});

// ─── prompt overlay ──────────────────────────────────────────────────────────

describe("exam prompt overlay", () => {
	it("composes exam-teacher/ and exam-prober/ only for exam sessions", () => {
		const teach = composeInstructions("teacher");
		const examTeacher = composeInstructions("teacher", {}, { exam: true });
		assert.doesNotMatch(teach, /Exam session — plan and teach for the exam/);
		assert.match(examTeacher, /Exam session — plan and teach for the exam/);
		assert.match(examTeacher, /plan_status/);
		// The overlay sits after the teacher doctrine and before the shared appendix.
		assert.ok(examTeacher.startsWith(teach.slice(0, 200)));
		const examProber = composeInstructions("prober", {}, { exam: true });
		assert.match(examProber, /Exam session — the probe maps the pensum/);
		assert.doesNotMatch(composeInstructions("prober"), /maps the pensum/);
		// Practice never composes an exam overlay.
		assert.equal(composeInstructions("practice", {}, { exam: true }), composeInstructions("practice"));
	});

	it("the question model is fixed in every prompt: quiz along the way, explain approves, no setting to switch on", () => {
		const teach = composeInstructions("teacher");
		const examTeacher = composeInstructions("teacher", {}, { exam: true });
		const prober = composeInstructions("prober");
		for (const text of [teach, examTeacher]) {
			assert.match(text, /## Approving a node — `explain`/);
			assert.match(text, /never spend `explain` on a routine check/);
			assert.match(text, /Every `quiz` and `explain` call carries `nodeId` AND `type`/);
		}
		assert.match(examTeacher, /approve it the exam way/);
		assert.match(prober, /`probe`, always multiple choice/);
		for (const text of [teach, examTeacher, prober, composeInstructions("prober", {}, { exam: true })]) {
			for (const stale of [/switched on in settings/, /mechanic the learner chose/, /whichever the learner/, /free-recall tool if you have one/, /`recall`/]) {
				assert.doesNotMatch(text, stale);
			}
		}
	});

	it("exam overlay segments are valid, overridable segment paths", () => {
		assert.ok(isValidSegmentPath("exam-teacher/10-exam.md"));
		assert.ok(isValidSegmentPath("exam-prober/10-exam-probe.md"));
		assert.ok(allSegmentPaths().includes("exam-teacher/10-exam.md"));
	});
});

// ─── layout + rendering ──────────────────────────────────────────────────────

describe("exam plan map: columns per emne", () => {
	it("one column per emne (+ Annet), nodes in a column stacked vertically, no cross-emne edge routed", () => {
		const parsed = parseMermaidPlan(EXAM_MERMAID).plan!;
		const layout = groupedLayout(parsed.nodes, parsed.edges, parsed.groups!);
		assert.deepEqual(
			layout.columns!.map((c) => c.title),
			["Komplekse tall", "Analyse", "Lineær algebra", "Annet"],
		);
		// Analyse holds deriverbarhet→eulermetode and an independent folger:
		// chain mode stacks all three (distinct y), same box width.
		const ys = ["deriverbarhet", "eulermetode", "folger"].map((id) => layout.y.get(id)!);
		assert.equal(new Set(ys).size, 3);
		const ws = ["deriverbarhet", "eulermetode", "folger"].map((id) => layout.nodeW.get(id)!);
		assert.equal(new Set(ws).size, 1);
		assert.ok(layout.edgePts.has("deriverbarhet->eulermetode"));
		assert.equal(layout.edgePts.has("enhetssirkel->eulermetode"), false);
		// planLayout picks columns only when the tree has emner.
		assert.equal(planLayout(parsed.nodes, parsed.edges, null).columns, undefined);
	});

	it("wraps columns into rows past MAX_ROW_W", () => {
		const groups = Array.from({ length: 12 }, (_, i) => ({ id: `g${i}`, title: `Emne nummer ${i}` }));
		const nodes = groups.map((g, i) => ({ id: `n${i}`, title: `En ganske lang nodetittel ${i}`, group: g.id }));
		const layout = groupedLayout(nodes, [], groups);
		assert.ok(layout.width <= MAX_ROW_W);
		assert.ok(new Set(layout.columns!.map((c) => c.y)).size > 1);
	});

	function messages(): PopupMessage[] {
		const tree = createTree(parseMermaidPlan(EXAM_MERMAID).plan!.nodes, parseMermaidPlan(EXAM_MERMAID).plan!.edges, parseMermaidPlan(EXAM_MERMAID).plan!.groups);
		return [
			{ parts: [{ type: "tool-plan_init", state: "output-available", input: {}, output: { ok: true, tree } }] },
			{
				parts: [
					{
						type: "tool-plan_status",
						state: "output-available",
						input: {
							updates: [
								{ nodeId: "lu", status: "red", reason: "bytter L og U" },
								{ nodeId: "polar", status: "yellow", reason: "usikker" },
								{ nodeId: "radred", status: "green", reason: "full utregning" },
							],
						},
						output: { ok: true, updated: 3 },
					},
				],
			},
			{ parts: [{ type: "tool-quiz", state: "input-available", input: { nodeId: "polar" } }] },
		];
	}

	it("exam popup: summary, colored nodes with hover reasons, thick outline instead of the yellow glow", () => {
		const html = renderToStaticMarkup(<PlanPopup messages={messages()} onClose={() => {}} exam />);
		// «Eksamenskart», never «Eksamensplan»: that name belongs to the fag
		// page's day-by-day plan.
		assert.match(html, /Eksamenskart/);
		assert.doesNotMatch(html, /Eksamensplan/);
		assert.match(html, /1 av 9 kan du/);
		assert.match(html, /data-testid="plan-mastery-count-red"[^>]*>.*?1 kan ikke ennå/);
		assert.match(html, /data-testid="plan-mastery-count-yellow"[^>]*>.*?1 usikker/);
		assert.match(html, /data-testid="plan-mastery-count-green"[^>]*>.*?1 kan dette/);
		assert.match(html, /6 ikke kartlagt/);
		assert.match(html, /data-testid="plan-node-lu" data-status="upcoming" data-mastery="red"/);
		assert.match(html, /data-testid="plan-node-radred" data-status="upcoming" data-mastery="green"/);
		assert.match(html, /data-mastery="unassessed"/);
		assert.match(html, /<title>Kan ikke ennå: bytter L og U<\/title>/);
		assert.match(html, /<title>Usikker: usikker<\/title>/);
		assert.match(html, /<title>Kan dette: full utregning<\/title>/);
		assert.match(html, /<title>Ikke kartlagt<\/title>/);
		assert.match(html, /fill-status-red\/15 stroke-status-red/);
		assert.match(html, /data-testid="plan-current-outline"/);
		assert.doesNotMatch(html, /fill-gold\/25/);
		assert.match(html, /data-testid="plan-column-komplekse-tall"/);
		assert.match(html, /KOMPLEKSE TALL · 0\/3/);
		assert.match(html, /LINEÆR ALGEBRA · 1\/2/);
		assert.doesNotMatch(html, /statusene følger resultatene dine/);
	});

	it("before any color: nodes he has worked on keep the white position look, untouched ones are gray", () => {
		const msgs = messages().filter((m) => !m.parts.some((p) => p.type === "tool-plan_status"));
		msgs.splice(1, 0, { parts: [{ type: "tool-quiz", state: "output-available", input: { nodeId: "lu" }, output: { correct: true } }] });
		const html = renderToStaticMarkup(<PlanPopup messages={msgs} onClose={() => {}} exam />);
		// lu visited, polar current: white outline (fill-background/50 stroke-foreground).
		assert.match(html, /data-testid="plan-node-lu" data-status="visited" data-mastery="unassessed"[^]*?<rect[^>]*class="fill-background\/50 stroke-foreground"/);
		assert.match(html, /data-testid="plan-node-polar" data-status="current" data-mastery="unassessed"[^]*?<rect[^>]*class="fill-background\/50 stroke-foreground"/);
		// rotter untouched: gray.
		assert.match(html, /data-testid="plan-node-rotter" data-status="upcoming" data-mastery="unassessed"[^]*?<rect[^>]*class="fill-card stroke-border"/);
		assert.match(html, /9 ikke kartlagt/);
		assert.match(html, /0 av 9 kan du/);
	});

	it("teach popup is unchanged by the exam machinery", () => {
		const html = renderToStaticMarkup(<PlanPopup messages={messages()} onClose={() => {}} />);
		assert.match(html, />Planen</);
		assert.match(html, /statusene følger resultatene dine/);
		assert.doesNotMatch(html, /Eksamenskart/);
		assert.doesNotMatch(html, /plan-mastery-summary/);
		assert.doesNotMatch(html, /data-mastery=/);
		assert.match(html, /fill-gold\/25/);
	});

	it("marginalia colors in exam sessions; the in-chat block stays monochrome but uses columns", () => {
		const margin = renderToStaticMarkup(<PlanMarginalia messages={messages()} exam />);
		assert.match(margin, /data-mastery="red"/);
		const tree = (messages()[0]!.parts[0]!.output as { tree: PlanTree }).tree;
		const block = renderToStaticMarkup(
			<PlanBlock
				data={{
					kind: "full",
					at: "2026-11-12T00:00:00Z",
					current: null,
					nodes: tree.nodes.map((n) => ({ id: n.id, title: n.title, status: "upcoming" as const, ...(n.group ? { group: n.group } : {}) })),
					edges: tree.edges,
					groups: tree.groups,
				}}
				onOpen={() => {}}
			/>,
		);
		assert.match(block, /data-testid="plan-column-analyse"/);
		assert.doesNotMatch(block, /data-mastery=/);
	});
});

// ─── Norwegian + one palette with the fag page ───────────────────────────────

describe("exam map speaks the fag page's language", () => {
	it("the four colors carry the fag page's labels and swatches", () => {
		assert.deepEqual(MASTERY_LABEL, {
			red: TOPIC_STATUS_LABEL.red,
			yellow: TOPIC_STATUS_LABEL.yellow,
			green: TOPIC_STATUS_LABEL.green,
			unassessed: TOPIC_STATUS_LABEL.unknown,
		});
		assert.deepEqual(MASTERY_LABEL, { red: "Kan ikke ennå", yellow: "Usikker", green: "Kan dette", unassessed: "Ikke kartlagt" });
		assert.equal(MASTERY_SWATCH.red, STATUS_STYLE.red.dot);
		assert.equal(MASTERY_SWATCH.yellow, STATUS_STYLE.yellow.dot);
		assert.equal(MASTERY_SWATCH.green, STATUS_STYLE.green.dot);
		assert.equal(MASTERY_SWATCH.unassessed, STATUS_STYLE.unknown.dot);
	});

	it("the node boxes use the same status token as the topic colors (light and dark come from the token)", () => {
		for (const status of ["red", "yellow", "green"] as const) {
			const token = STATUS_STYLE[status].dot.match(/^bg-(status-[a-z]+)$/)![1]!;
			assert.ok(MASTERY_BOX[status].includes(`stroke-${token}`), `${status}: stroke ${token}`);
		}
	});

	it("plan_status has a Norwegian activity label", () => {
		assert.equal(toolActivityLabel("plan_status"), "Fargelegger planen…");
	});
});
