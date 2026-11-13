/**
 * The help search engine (NTNU round): one pure ranking function behind both
 * the global search palette and the help centre's search field.
 *
 * Built for how students actually type:
 * - Norwegian-friendly: «mørk», «mork» and «MØRK» are the same word, so are
 *   «nøkkel»/«nokkel» and «økt»/«okt» (æ→ae, ø→o, å→a, accents stripped).
 * - Whole questions work: filler words («hvordan», «jeg», «kan») are dropped
 *   and a long question still matches when most of its real words hit.
 * - Light stemming («legger» finds «legg», «modellene» finds «modell») and a
 *   one-letter typo allowance on longer words.
 * - Title beats keywords beats body text; an exact phrase beats loose words.
 *
 * No dependencies and no DOM, so the ranking is unit-tested directly.
 */

export interface SearchDoc<T> {
	item: T;
	title: string;
	/** Synonyms and alternative spellings. Scored just below the title. */
	keywords?: readonly string[];
	/** Long text (descriptions, answers). Scored lowest. */
	body?: string;
}

export interface IndexedDoc<T> {
	item: T;
	title: string;
	titleWords: string[];
	keywordPhrases: string[];
	keywordWords: string[];
	bodyWords: string[];
}

export interface SearchHit<T> {
	item: T;
	score: number;
}

/** Lowercase, fold Norwegian letters and accents, keep letters/digits only. */
export function normalizeText(text: string): string {
	return text
		.toLowerCase()
		.replace(/æ/g, "ae")
		.replace(/ø/g, "o")
		.replace(/å/g, "a")
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function words(text: string): string[] {
	const normalized = normalizeText(text);
	return normalized ? normalized.split(" ") : [];
}

/** Words that carry no search intent in a typed question (normalized). */
const STOPWORDS = new Set(
	[
		"hvordan", "hva", "hvor", "hvorfor", "hvilke", "hvilken", "hvilket", "nar", "kan", "ma", "skal", "vil", "bor",
		"far", "jeg", "meg", "min", "mitt", "mine", "du", "deg", "man", "vi", "er", "var", "blir", "en", "et", "ei",
		"den", "det", "de", "i", "pa", "til", "for", "fra", "av", "med", "om", "og", "eller", "a", "at", "som", "ikke",
		"noe", "noen", "seg", "sin", "gjor", "gjore", "the", "to", "how", "do", "is", "my",
	],
);

/** Strip the commonest Norwegian endings so inflected forms meet. Crude on
 *  purpose: it only has to make «legger»/«legg» and «fagene»/«fag» agree. */
export function stem(word: string): string {
	for (const ending of ["ene", "ane", "ers", "er", "en", "et", "ar", "e", "a", "s"]) {
		if (word.length - ending.length >= 3 && word.endsWith(ending)) return word.slice(0, -ending.length);
	}
	return word;
}

/** True when the two words are within ONE edit (insert, delete, replace). */
export function withinOneEdit(a: string, b: string): boolean {
	if (a === b) return true;
	const [short, long] = a.length <= b.length ? [a, b] : [b, a];
	if (long.length - short.length > 1) return false;
	let i = 0;
	let j = 0;
	let edits = 0;
	while (i < short.length && j < long.length) {
		if (short[i] === long[j]) {
			i++;
			j++;
			continue;
		}
		if (++edits > 1) return false;
		if (short.length === long.length) i++;
		j++;
	}
	return edits + (long.length - j) + (short.length - i) <= 1;
}

export function buildIndex<T>(docs: readonly SearchDoc<T>[]): IndexedDoc<T>[] {
	return docs.map((doc) => {
		const keywordPhrases = (doc.keywords ?? []).map(normalizeText).filter(Boolean);
		return {
			item: doc.item,
			title: normalizeText(doc.title),
			titleWords: words(doc.title),
			keywordPhrases,
			keywordWords: keywordPhrases.flatMap((phrase) => phrase.split(" ")),
			bodyWords: [...new Set(words(doc.body ?? ""))],
		};
	});
}

/** Best points one query token earns against one list of words. */
function wordScore(token: string, list: readonly string[], exact: number, prefix: number, inside: number, typo: number): number {
	const tokenStem = stem(token);
	let best = 0;
	for (const word of list) {
		if (word === token) return exact;
		if (word.startsWith(token)) best = Math.max(best, prefix);
		// «legger» → «legg»: the inflected query still finds the base form.
		else if (tokenStem.length >= 3 && (word.startsWith(tokenStem) || stem(word) === tokenStem)) best = Math.max(best, prefix - 10);
		else if (token.length >= 3 && word.includes(token)) best = Math.max(best, inside);
		else if (typo > 0 && token.length >= 5 && word.length >= 5 && withinOneEdit(token, word)) best = Math.max(best, typo);
	}
	return best;
}

/** The significant tokens of a query: stopwords out, unless nothing is left. */
export function queryTokens(query: string): string[] {
	const all = words(query);
	const significant = all.filter((token) => !STOPWORDS.has(token));
	return significant.length ? significant : all;
}

/** Score one document, or null when it does not match well enough. */
export function scoreDoc<T>(doc: IndexedDoc<T>, query: string): number | null {
	const tokens = queryTokens(query);
	if (tokens.length === 0) return null;
	let total = 0;
	let matched = 0;
	for (const token of tokens) {
		const best = Math.max(
			wordScore(token, doc.titleWords, 100, 70, 40, 30),
			wordScore(token, doc.keywordWords, 85, 60, 35, 25),
			wordScore(token, doc.bodyWords, 30, 20, 10, 0),
		);
		if (best > 0) {
			matched++;
			total += best;
		} else {
			total -= 15;
		}
	}
	// Short queries must match fully; a typed-out question may miss a word or two.
	const needed = tokens.length <= 2 ? tokens.length : Math.ceil(tokens.length * 0.6);
	if (matched < needed) return null;
	const phrase = tokens.join(" ");
	if (doc.title === phrase) total += 120;
	else if (doc.title.startsWith(phrase)) total += 80;
	else if (doc.title.includes(phrase)) total += 50;
	if (doc.keywordPhrases.includes(phrase)) total += 90;
	else if (doc.keywordPhrases.some((keyword) => keyword.includes(phrase))) total += 40;
	return total;
}

/** Rank the index against a query. Empty query = no hits (callers decide
 *  what to show before the user has typed). Ties keep the index order. */
export function search<T>(index: readonly IndexedDoc<T>[], query: string, limit = 50): SearchHit<T>[] {
	if (!normalizeText(query)) return [];
	const hits: SearchHit<T>[] = [];
	for (const doc of index) {
		const score = scoreDoc(doc, query);
		if (score !== null && score > 0) hits.push({ item: doc.item, score });
	}
	hits.sort((a, b) => b.score - a.score);
	return hits.slice(0, limit);
}
