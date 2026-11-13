/**
 * Search ranking for the palette and the help centre: Norwegian-friendly
 * normalization, synonyms, whole questions, typos, and the palette grouping.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { articleIndex, buildPaletteGroups, flattenGroups, readChats, readCourses, tourIndex } from "../components/help/palette-model.ts";
import { buildIndex, normalizeText, queryTokens, search, stem, withinOneEdit } from "../components/help/search.ts";

const NONE = { courses: [], chats: [] };

function topOf(query: string, group: string): string | undefined {
	return buildPaletteGroups(query, NONE).find((entry) => entry.id === group)?.items[0]?.key;
}

describe("normalizeText", () => {
	it("folds case, Norwegian letters and punctuation", () => {
		assert.equal(normalizeText("Mørk modus!"), "mork modus");
		assert.equal(normalizeText("API-nøkkel"), "api nokkel");
		assert.equal(normalizeText("  Økt   på Ærlig  "), "okt pa aerlig");
		assert.equal(normalizeText("café"), "cafe");
		assert.equal(normalizeText("?!"), "");
	});
});

describe("query helpers", () => {
	it("drops filler words but never the whole query", () => {
		assert.deepEqual(queryTokens("Hvordan legger jeg til et fag?"), ["legger", "fag"]);
		assert.deepEqual(queryTokens("hva er det"), ["hva", "er", "det"]);
	});

	it("stems the commonest endings", () => {
		assert.equal(stem("legger"), "legg");
		assert.equal(stem("fagene"), "fag");
		assert.equal(stem("fag"), "fag");
	});

	it("allows exactly one edit", () => {
		assert.ok(withinOneEdit("diktering", "dikterng"));
		assert.ok(withinOneEdit("modell", "modelll"));
		assert.ok(withinOneEdit("eksamen", "eksamem"));
		assert.ok(!withinOneEdit("eksamen", "eksempel"));
		assert.ok(!withinOneEdit("plan", "pensum"));
	});
});

describe("search ranking", () => {
	const index = buildIndex([
		{ item: "title", title: "Eksamensplan" },
		{ item: "keyword", title: "Noe annet", keywords: ["eksamensplan"] },
		{ item: "body", title: "Helt annet", body: "Her nevnes eksamensplan i teksten." },
		{ item: "none", title: "Kunnskapskart" },
	]);

	it("title beats keyword beats body, and non-matches are dropped", () => {
		assert.deepEqual(search(index, "eksamensplan").map((hit) => hit.item), ["title", "keyword", "body"]);
	});

	it("an empty query returns nothing", () => {
		assert.deepEqual(search(index, "   "), []);
	});

	it("short queries need every word; unknown words find nothing", () => {
		assert.deepEqual(search(index, "eksamensplan banan"), []);
		assert.deepEqual(search(index, "xyzzy"), []);
	});
});

describe("the palette finds features the way students type", () => {
	it("mørk modus, with or without ø, and in English", () => {
		for (const query of ["mørk modus", "mork modus", "MØRK", "dark mode", "nattmodus"]) {
			assert.equal(topOf(query, "features"), "features:tema-mork", query);
		}
		assert.equal(topOf("lys modus", "features"), "features:tema-lys");
	});

	it("nøkkel / api land on the providers section", () => {
		for (const query of ["nøkkel", "nokkel", "api", "api-nøkkel", "api key"]) {
			assert.equal(topOf(query, "features"), "features:innstillinger-leverandorer", query);
		}
	});

	it("everyday words reach the right feature", () => {
		assert.equal(topOf("legg til fag", "features"), "features:legg-til-fag");
		assert.equal(topOf("fagkode", "features"), "features:legg-til-fag");
		assert.equal(topOf("ny økt", "features"), "features:ny-okt");
		assert.equal(topOf("hurtigtaster", "features"), "features:innstillinger-tastatur");
		assert.equal(topOf("mikrofon", "features"), "features:innstillinger-diktering");
		assert.equal(topOf("oppdatering", "features"), "features:innstillinger-oppdateringer");
		assert.equal(topOf("sidemeny", "features"), "features:sidemeny");
		assert.equal(topOf("kart", "features"), "features:kunnskapskart");
		assert.equal(topOf("hjelp", "features"), "features:hjelpesenter");
	});

	it("a typo still finds diktering", () => {
		assert.equal(topOf("dikterng", "features"), "features:innstillinger-diktering");
	});

	it("eksamen surfaces the exam tour and the exam answers", () => {
		const groups = buildPaletteGroups("eksamen", NONE);
		assert.equal(groups.find((entry) => entry.id === "tours")?.items[0]?.key, "tours:eksamensmodus");
		const answers = groups.find((entry) => entry.id === "articles")?.items.map((item) => item.key) ?? [];
		assert.ok(answers.includes("articles:hva-er-eksamensmodus"), answers.join(", "));
	});

	it("hopp over finds its answer and its tour", () => {
		assert.equal(topOf("hopp over", "articles"), "articles:hopp-over");
		assert.equal(topOf("hopp over", "tours"), "tours:sporsmal-i-okta");
	});

	it("nonsense finds nothing at all", () => {
		assert.deepEqual(buildPaletteGroups("qwertyuiopasdf", NONE), []);
	});
});

describe("question search (the help centre field)", () => {
	const first = (query: string) => search(articleIndex, query)[0]?.item.id;

	it("whole questions match their answer", () => {
		assert.equal(first("Hvordan legger jeg til et fag?"), "legge-til-fag");
		assert.equal(first("hva betyr fargene"), "fargene");
		assert.equal(first("koster det noe"), "koster-det-noe");
		assert.equal(first("hvor lagres dataene mine"), "hvor-lagres-data");
		assert.equal(first("canvas"), "canvas-og-blackboard");
		assert.equal(first("vet ikke"), "vet-ikke");
		assert.equal(first("forskjellen på lær og øv"), "laer-eller-ov");
	});

	it("tours are searchable too", () => {
		assert.equal(search(tourIndex, "omvisning")[0]?.item.id, "kom-i-gang");
		assert.equal(search(tourIndex, "tidligere eksamener")[0]?.item.id, "egen-kontekst");
		assert.equal(search(tourIndex, "api-nøkkel")[0]?.item.id, "sett-opp-modeller");
	});
});

describe("palette groups", () => {
	const data = {
		courses: [{ code: "TTK4100", name: "Kybernetikk introduksjon" }, { code: "TMA4100", name: "Matematikk 1" }],
		chats: [{ id: "abc", title: "Laplacetransformasjon" }, { id: "def", title: "" }],
	};

	it("empty query: a calm starting menu in the canonical order", () => {
		const groups = buildPaletteGroups("", data);
		assert.deepEqual(groups.map((entry) => entry.id), ["features", "tours", "courses", "chats"]);
		assert.equal(groups[2]!.items[0]!.title, "TTK4100 Kybernetikk introduksjon");
		assert.equal(groups[3]!.items[1]!.title, "Økt uten navn");
	});

	it("empty lists simply leave their group out", () => {
		assert.deepEqual(buildPaletteGroups("", NONE).map((entry) => entry.id), ["features", "tours"]);
	});

	it("a course code puts the course first, so Enter opens it", () => {
		const first = flattenGroups(buildPaletteGroups("ttk4100", data))[0]!;
		assert.equal(first.key, "courses:TTK4100");
		assert.deepEqual(first.action, { kind: "route", href: "/fag/TTK4100" });
	});

	it("course names and session titles are searchable", () => {
		assert.equal(flattenGroups(buildPaletteGroups("matematikk", data))[0]!.key, "courses:TMA4100");
		const session = flattenGroups(buildPaletteGroups("laplace", data))[0]!;
		assert.equal(session.key, "chats:abc");
		assert.deepEqual(session.action, { kind: "route", href: "/chat/abc" });
	});

	it("keys are unique across the palette", () => {
		const keys = flattenGroups(buildPaletteGroups("fag", data)).map((item) => item.key);
		assert.equal(new Set(keys).size, keys.length);
	});

	it("tolerates missing or broken list endpoints", () => {
		assert.deepEqual(readCourses(null), []);
		assert.deepEqual(readCourses({ error: "nope" }), []);
		assert.deepEqual(readCourses({ courses: [{ code: "X1", name: 3 }, { nope: true }, null] }), [{ code: "X1", name: "" }]);
		assert.deepEqual(readChats(undefined), []);
		assert.deepEqual(readChats({ chats: [{ id: "a", title: "T", busy: true }, "x"] }), [{ id: "a", title: "T" }]);
	});
});
