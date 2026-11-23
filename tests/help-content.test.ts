/**
 * Help content integrity: unique ids, every category filled, every button
 * and tour step pointing at something that exists, and the house style.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { findArticle, HELP_ARTICLES, HELP_CATEGORIES } from "../components/help/content.ts";
import { FEATURES } from "../components/help/features.ts";
import { COURSE_ROUTE, findTour, TOURS, WELCOME_TOUR_ID } from "../components/help/tours.ts";
import { TOUR_ANCHORS } from "../components/help/types.ts";
import { assertActionValid, routeExists } from "./help-actions.ts";

const ROOT = join(import.meta.dirname, "..");

describe("questions and answers", () => {
	it("at least 35, with unique slug ids", () => {
		assert.ok(HELP_ARTICLES.length >= 35, `only ${HELP_ARTICLES.length} articles`);
		const ids = HELP_ARTICLES.map((article) => article.id);
		assert.equal(new Set(ids).size, ids.length, "duplicate article id");
		// Slugs are the deep-link hashes: ASCII, no spaces.
		for (const id of ids) assert.match(id, /^[a-z0-9-]+$/, id);
	});

	it("article ids never collide with the page's own element ids", () => {
		for (const article of HELP_ARTICLES) {
			assert.ok(!/^(kategori|tittel|svar|sporsmal|hjelp)-/.test(article.id), article.id);
		}
	});

	it("every article sits in a real category, and every category has answers", () => {
		const categories = new Set<string>(HELP_CATEGORIES.map((category) => category.id));
		assert.equal(categories.size, HELP_CATEGORIES.length);
		assert.equal(HELP_CATEGORIES.length, 9);
		for (const article of HELP_ARTICLES) assert.ok(categories.has(article.category), article.id);
		for (const category of HELP_CATEGORIES) {
			const count = HELP_ARTICLES.filter((article) => article.category === category.id).length;
			assert.ok(count >= 3, `${category.id} has only ${count} answers`);
		}
	});

	it("every article has a question, an answer and search words", () => {
		for (const article of HELP_ARTICLES) {
			assert.ok(article.question.trim().length > 5, article.id);
			assert.ok(article.answer.length > 0 && article.answer.every((paragraph) => paragraph.trim()), article.id);
			assert.ok(article.keywords.length > 0, article.id);
			// React keys: paragraphs and steps are unique within one answer.
			assert.equal(new Set(article.answer).size, article.answer.length, article.id);
			if (article.steps) assert.equal(new Set(article.steps).size, article.steps.length, article.id);
		}
	});

	it("every button does something real", () => {
		for (const article of HELP_ARTICLES) {
			const labels = (article.actions ?? []).map((entry) => entry.label);
			assert.equal(new Set(labels).size, labels.length, `${article.id}: duplicate button label`);
			for (const entry of article.actions ?? []) assertActionValid(entry.action, `article ${article.id} «${entry.label}»`);
		}
	});

	it("findArticle resolves ids and rejects unknown ones", () => {
		assert.equal(findArticle("fargene")?.category, "eksamensmodus");
		assert.equal(findArticle("finnes-ikke"), undefined);
	});

	it("states the facts the owner listed", () => {
		const text = (id: string) => findArticle(id)!.answer.join(" ");
		assert.match(text("koster-det-noe"), /gratis/);
		assert.match(text("koster-det-noe"), /AGPL-3\.0/);
		assert.match(text("canvas-og-blackboard"), /kan ikke logge inn i Canvas/);
		assert.match(text("hvor-lagres-data"), /lokalt på maskinen/);
		assert.match(text("hva-sendes-ut"), /Deepgram/);
		assert.match(text("hva-sendes-ut"), /Tavily eller Brave/);
		assert.match(text("hva-hentes-fra-ntnu"), /åpne emneside/);
		const colours = text("fargene");
		for (const label of ["Ikke kartlagt", "Kan ikke ennå", "Usikker", "Kan dette"]) assert.ok(colours.includes(label), label);
	});
});

describe("tours", () => {
	it("the five required tours exist, with unique ids", () => {
		const ids = TOURS.map((tour) => tour.id);
		assert.equal(new Set(ids).size, ids.length);
		for (const id of ["kom-i-gang", "eksamensmodus", "egen-kontekst", "sporsmal-i-okta", "sett-opp-modeller"]) {
			assert.ok(findTour(id), `missing tour ${id}`);
		}
		assert.ok(findTour(WELCOME_TOUR_ID), "the first-launch tour exists");
		assert.ok(TOURS.filter((tour) => tour.featured).length >= 3);
	});

	it("steps: unique ids, a title and a text each", () => {
		for (const tour of TOURS) {
			assert.ok(tour.steps.length >= 3, tour.id);
			const ids = tour.steps.map((step) => step.id);
			assert.equal(new Set(ids).size, ids.length, `${tour.id}: duplicate step id`);
			for (const step of tour.steps) {
				assert.ok(step.title.trim() && step.text.trim(), `${tour.id}/${step.id}`);
			}
		}
	});

	it("anchors come from the shared contract, and anchored steps have a fallback", () => {
		for (const tour of TOURS) {
			for (const step of tour.steps) {
				if (step.anchor) assert.ok((TOUR_ANCHORS as readonly string[]).includes(step.anchor), `${tour.id}/${step.id}: ${step.anchor}`);
				if (step.anchor || step.selector) assert.ok(step.fallback?.trim(), `${tour.id}/${step.id} needs a fallback text`);
				assert.ok(!(step.anchor && step.selector), `${tour.id}/${step.id}: anchor OR selector`);
			}
		}
	});

	it("raw selectors only use testids the settings dialog really renders", () => {
		const dialog = readFileSync(join(ROOT, "components/settings/settings-dialog.tsx"), "utf8");
		for (const tour of TOURS) {
			for (const step of tour.steps) {
				if (!step.selector) continue;
				const testid = /^\[data-testid="([a-z-]+)"\]$/.exec(step.selector)?.[1];
				assert.ok(testid, `${tour.id}/${step.id}: unexpected selector ${step.selector}`);
				assert.ok(dialog.includes(`"${testid}"`), `${tour.id}/${step.id}: ${testid} is not in the settings dialog`);
			}
		}
	});

	it("routes, tabs and pre-step actions are real", () => {
		assert.ok(routeExists(COURSE_ROUTE), "the course page exists");
		for (const tour of TOURS) {
			for (const step of tour.steps) {
				if (step.route) assert.ok(routeExists(step.route), `${tour.id}/${step.id}: ${step.route}`);
				if (step.openTab) {
					assert.ok(["Eksamensplan", "Alle temaer", "Kilder"].includes(step.openTab), `${tour.id}/${step.id}: ${step.openTab}`);
					assert.equal(step.route, COURSE_ROUTE, `${tour.id}/${step.id}: tabs live on the course page`);
				}
				if (step.before) assertActionValid(step.before, `tour ${tour.id}/${step.id}`);
			}
		}
	});

	it("the owner's tour outlines are covered", () => {
		const anchors = (id: string) => findTour(id)!.steps.map((step) => step.anchor).filter(Boolean);
		assert.deepEqual(anchors("kom-i-gang"), ["add-course", "course-card", "home-composer", "sidebar-courses", "sidebar-help", "sidebar-settings"]);
		assert.deepEqual([...new Set(anchors("eksamensmodus"))], ["exam-date", "course-tabs", "topic-board", "exam-plan", "course-chats"]);
		assert.ok(anchors("egen-kontekst").includes("course-sources"));
		assert.deepEqual(anchors("sporsmal-i-okta"), ["question-skip", "question-hold", "question-explain"]);
		const colours = findTour("eksamensmodus")!.steps.find((step) => step.anchor === "topic-board")!.text;
		for (const label of ["Ikke kartlagt", "Kan ikke ennå", "Usikker", "Kan dette"]) assert.ok(colours.includes(label), label);
	});
});

describe("house style", () => {
	it("no em dash in any user-facing help text", () => {
		const texts: string[] = [];
		for (const article of HELP_ARTICLES) {
			texts.push(article.question, ...article.answer, ...(article.steps ?? []), ...(article.actions ?? []).map((entry) => entry.label));
		}
		for (const category of HELP_CATEGORIES) texts.push(category.title, category.blurb);
		for (const feature of FEATURES) texts.push(feature.title, feature.description);
		for (const tour of TOURS) {
			texts.push(tour.title, tour.description);
			for (const step of tour.steps) texts.push(step.title, step.text, step.fallback ?? "");
		}
		for (const text of texts) assert.ok(!text.includes("—"), text);
	});
});
