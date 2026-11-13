/**
 * What the search palette shows (NTNU round): pure, so the grouping and
 * ranking are unit-tested without a DOM. The palette component only renders
 * these groups and runs the chosen item's action.
 */

import { HELP_ARTICLES, HELP_CATEGORIES } from "./content.ts";
import { FEATURES } from "./features.ts";
import { buildIndex, search, type IndexedDoc } from "./search.ts";
import { TOURS } from "./tours.ts";
import type { FeatureEntry, HelpAction, HelpArticle, Tour } from "./types.ts";

export type PaletteGroupId = "features" | "articles" | "tours" | "courses" | "chats";

export const PALETTE_GROUP_LABEL: Record<PaletteGroupId, string> = {
	features: "Funksjoner",
	articles: "Spørsmål og svar",
	tours: "Veivisere",
	courses: "Fag",
	chats: "Økter",
};

/** Canonical order: also the tie-break when two groups score the same. */
const GROUP_ORDER: readonly PaletteGroupId[] = ["features", "articles", "tours", "courses", "chats"];

export interface PaletteItem {
	/** Unique across the whole palette (`<group>:<id>`). */
	key: string;
	group: PaletteGroupId;
	title: string;
	subtitle?: string;
	action: HelpAction;
}

export interface PaletteGroup {
	id: PaletteGroupId;
	label: string;
	items: PaletteItem[];
}

/** The slices of the server lists the palette needs. */
export interface PaletteCourse {
	code: string;
	name: string;
}
export interface PaletteChat {
	id: string;
	title: string;
}

const featureIndex = buildIndex(
	FEATURES.map((feature) => ({ item: feature, title: feature.title, keywords: feature.keywords, body: feature.description })),
);

export const articleIndex: readonly IndexedDoc<HelpArticle>[] = buildIndex(
	HELP_ARTICLES.map((article) => ({
		item: article,
		title: article.question,
		keywords: article.keywords,
		body: [...article.answer, ...(article.steps ?? [])].join(" "),
	})),
);

export const tourIndex: readonly IndexedDoc<Tour>[] = buildIndex(
	TOURS.map((tour) => ({
		item: tour,
		title: tour.title,
		keywords: tour.keywords,
		body: `${tour.description} ${tour.steps.map((step) => step.title).join(" ")}`,
	})),
);

const categoryTitle = new Map(HELP_CATEGORIES.map((category) => [category.id, category.title]));

function featureItem(feature: FeatureEntry): PaletteItem {
	return { key: `features:${feature.id}`, group: "features", title: feature.title, subtitle: feature.description, action: feature.action };
}

function articleItem(article: HelpArticle): PaletteItem {
	return {
		key: `articles:${article.id}`,
		group: "articles",
		title: article.question,
		subtitle: categoryTitle.get(article.category),
		action: { kind: "article", id: article.id },
	};
}

function tourItem(tour: Tour): PaletteItem {
	return {
		key: `tours:${tour.id}`,
		group: "tours",
		title: `Veiviser: ${tour.title}`,
		subtitle: tour.description,
		action: { kind: "tour", id: tour.id },
	};
}

function courseItem(course: PaletteCourse): PaletteItem {
	return {
		key: `courses:${course.code}`,
		group: "courses",
		title: `${course.code} ${course.name}`.trim(),
		subtitle: "Åpne faget",
		action: { kind: "route", href: `/fag/${encodeURIComponent(course.code)}` },
	};
}

function chatItem(chat: PaletteChat): PaletteItem {
	return {
		key: `chats:${chat.id}`,
		group: "chats",
		title: chat.title || "Økt uten navn",
		subtitle: "Åpne økta",
		action: { kind: "route", href: `/chat/${encodeURIComponent(chat.id)}` },
	};
}

/** How many rows each group may show while searching. */
const LIMIT: Record<PaletteGroupId, number> = { features: 6, articles: 5, tours: 3, courses: 5, chats: 5 };

/** The groups for a query. Empty query = a calm starting menu (suggested
 *  features, the featured tours, the learner's courses and latest sessions).
 *  With a query, groups are ordered by their best hit so Enter opens the
 *  best match overall; empty groups are dropped. */
export function buildPaletteGroups(
	query: string,
	data: { courses: readonly PaletteCourse[]; chats: readonly PaletteChat[] },
): PaletteGroup[] {
	const group = (id: PaletteGroupId, items: PaletteItem[]): PaletteGroup => ({ id, label: PALETTE_GROUP_LABEL[id], items });
	if (!query.trim()) {
		return [
			group("features", FEATURES.filter((feature) => feature.suggested).map(featureItem)),
			group("tours", TOURS.filter((tour) => tour.featured).map(tourItem)),
			group("courses", data.courses.slice(0, LIMIT.courses).map(courseItem)),
			group("chats", data.chats.slice(0, LIMIT.chats).map(chatItem)),
		].filter((entry) => entry.items.length > 0);
	}
	const courseHits = search(
		buildIndex(data.courses.map((course) => ({ item: course, title: `${course.code} ${course.name}`, keywords: [course.code] }))),
		query,
		LIMIT.courses,
	);
	const chatHits = search(buildIndex(data.chats.map((chat) => ({ item: chat, title: chat.title }))), query, LIMIT.chats);
	const featureHits = search(featureIndex, query, LIMIT.features);
	const articleHits = search(articleIndex, query, LIMIT.articles);
	const tourHits = search(tourIndex, query, LIMIT.tours);
	const scored: { group: PaletteGroup; best: number }[] = [
		{ group: group("features", featureHits.map((hit) => featureItem(hit.item))), best: featureHits[0]?.score ?? 0 },
		{ group: group("articles", articleHits.map((hit) => articleItem(hit.item))), best: articleHits[0]?.score ?? 0 },
		{ group: group("tours", tourHits.map((hit) => tourItem(hit.item))), best: tourHits[0]?.score ?? 0 },
		{ group: group("courses", courseHits.map((hit) => courseItem(hit.item))), best: courseHits[0]?.score ?? 0 },
		{ group: group("chats", chatHits.map((hit) => chatItem(hit.item))), best: chatHits[0]?.score ?? 0 },
	];
	return scored
		.filter((entry) => entry.group.items.length > 0)
		.sort((a, b) => b.best - a.best || GROUP_ORDER.indexOf(a.group.id) - GROUP_ORDER.indexOf(b.group.id))
		.map((entry) => entry.group);
}

/** The flat walk order (arrow keys) for a set of groups. */
export function flattenGroups(groups: readonly PaletteGroup[]): PaletteItem[] {
	return groups.flatMap((entry) => entry.items);
}

/** Tolerant readers for the two list endpoints: anything unexpected = empty. */
export function readCourses(body: unknown): PaletteCourse[] {
	const list = (body as { courses?: unknown } | null)?.courses;
	if (!Array.isArray(list)) return [];
	return list
		.filter((row): row is PaletteCourse => !!row && typeof (row as PaletteCourse).code === "string")
		.map((row) => ({ code: row.code, name: typeof row.name === "string" ? row.name : "" }));
}

export function readChats(body: unknown): PaletteChat[] {
	const list = (body as { chats?: unknown } | null)?.chats;
	if (!Array.isArray(list)) return [];
	return list
		.filter((row): row is PaletteChat => !!row && typeof (row as PaletteChat).id === "string")
		.map((row) => ({ id: row.id, title: typeof row.title === "string" ? row.title : "" }));
}
