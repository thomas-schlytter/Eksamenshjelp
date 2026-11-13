/**
 * Static render of the help centre page body. Effects do not run under
 * renderToStaticMarkup, so this is the first-paint state: every question
 * listed and collapsed, the tours as cards, the search field on top.
 * Same tsx classic-JSX shim as the other render tests.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HELP_ARTICLES, HELP_CATEGORIES } from "../components/help/content.ts";
import { HelpCenter } from "../components/help/help-center.tsx";
import { HelpContext } from "../components/help/help-context.ts";
import { TOURS } from "../components/help/tours.ts";

function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

describe("HelpCenter (static render)", () => {
	const html = renderToStaticMarkup(<HelpCenter />);

	it("renders without the provider (the default help API is a no-op)", () => {
		assert.ok(html.includes('data-testid="help-center"'));
		assert.ok(html.includes("<h1"));
		assert.ok(html.includes("Hjelpesenter"));
	});

	it("has the search field on top", () => {
		assert.ok(html.includes('data-testid="help-search"'));
		assert.ok(html.includes('aria-label="Søk i hjelpesenteret"'));
		assert.ok(html.indexOf('data-testid="help-search"') < html.indexOf('data-testid="help-tour-card"'));
	});

	it("lists every tour as a card with a Start button", () => {
		assert.equal(html.split('data-testid="help-tour-card"').length - 1, TOURS.length);
		for (const tour of TOURS) {
			assert.ok(html.includes(`data-testid="help-tour-start-${tour.id}"`), tour.id);
			assert.ok(html.includes(escapeHtml(tour.title)), tour.title);
		}
		assert.ok(html.includes(">Start</button>"));
		assert.ok(!html.includes("Fullført"), "nothing is completed before the device state loads");
	});

	it("lists every category and every question, collapsed", () => {
		for (const category of HELP_CATEGORIES) {
			assert.ok(html.includes(`id="kategori-${category.id}"`), category.id);
			assert.ok(html.includes(`href="#kategori-${category.id}"`), category.id);
			assert.ok(html.includes(escapeHtml(category.title)), category.title);
		}
		assert.equal(html.split('data-testid="help-article"').length - 1, HELP_ARTICLES.length);
		for (const article of HELP_ARTICLES) {
			assert.ok(html.includes(`id="${article.id}"`), `deep-link target ${article.id}`);
			assert.ok(html.includes(escapeHtml(article.question)), article.question);
		}
		assert.ok(!html.includes('aria-expanded="true"'));
		assert.ok(!html.includes('role="region"'), "answers render only when opened");
	});

	it("marks finished tours when the provider says so", () => {
		const done = renderToStaticMarkup(
			<HelpContext.Provider value={{ run: () => {}, openSearch: () => {}, startTour: () => {}, completedTours: ["kom-i-gang"] }}>
				<HelpCenter />
			</HelpContext.Provider>,
		);
		assert.ok(done.includes("Fullført"));
		assert.ok(done.includes("Start på nytt"));
	});
});
