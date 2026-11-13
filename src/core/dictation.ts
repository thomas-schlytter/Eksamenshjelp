/** Nova-3 monolingual language codes, including documented locale aliases.
 * Each row: Norwegian display name, codes, English name (search alias only).
 * Source: https://developers.deepgram.com/docs/models-languages-overview
 * Multilingual is a separate mode; its supported language set differs.
 */
const NOVA_3_LANGUAGES = [
	["Afrikaans", ["af", "af-ZA"], "Afrikaans"],
	["Arabisk", ["ar", "ar-AE", "ar-SA", "ar-QA", "ar-KW", "ar-SY", "ar-LB", "ar-PS", "ar-JO", "ar-EG", "ar-SD", "ar-TD", "ar-MA", "ar-DZ", "ar-TN", "ar-IQ", "ar-IR"], "Arabic"],
	["Armensk", ["hy"], "Armenian"],
	["Assamesisk", ["as", "as-IN"], "Assamese"],
	["Belarusisk", ["be"], "Belarusian"],
	["Bengali", ["bn"], "Bengali"],
	["Bosnisk", ["bs"], "Bosnian"],
	["Bulgarsk", ["bg"], "Bulgarian"],
	["Katalansk", ["ca"], "Catalan"],
	["Kinesisk (kantonesisk, tradisjonell)", ["zh-HK"], "Chinese (Cantonese, Traditional)"],
	["Kinesisk (mandarin, forenklet)", ["zh", "zh-CN", "zh-Hans"], "Chinese (Mandarin, Simplified)"],
	["Kinesisk (mandarin, tradisjonell)", ["zh-TW", "zh-Hant"], "Chinese (Mandarin, Traditional)"],
	["Kroatisk", ["hr"], "Croatian"],
	["Tsjekkisk", ["cs", "cs-CZ"], "Czech"],
	["Dansk", ["da", "da-DK"], "Danish"],
	["Nederlandsk", ["nl"], "Dutch"],
	["Engelsk", ["en", "en-US", "en-AU", "en-GB", "en-IN", "en-NZ"], "English"],
	["Estisk", ["et"], "Estonian"],
	["Finsk", ["fi"], "Finnish"],
	["Flamsk", ["nl-BE"], "Flemish"],
	["Fransk", ["fr", "fr-CA"], "French"],
	["Georgisk", ["ka", "ka-GE"], "Georgian"],
	["Tysk", ["de"], "German"],
	["Tysk (Sveits)", ["de-CH"], "German (Switzerland)"],
	["Gresk", ["el"], "Greek"],
	["Gujarati", ["gu", "gu-IN"], "Gujarati"],
	["Hebraisk", ["he"], "Hebrew"],
	["Hindi", ["hi"], "Hindi"],
	["Ungarsk", ["hu"], "Hungarian"],
	["Indonesisk", ["id"], "Indonesian"],
	["Italiensk", ["it"], "Italian"],
	["Japansk", ["ja"], "Japanese"],
	["Kannada", ["kn"], "Kannada"],
	["Kasakhisk", ["kk", "kk-KZ"], "Kazakh"],
	["Koreansk", ["ko", "ko-KR"], "Korean"],
	["Latvisk", ["lv"], "Latvian"],
	["Litauisk", ["lt"], "Lithuanian"],
	["Makedonsk", ["mk"], "Macedonian"],
	["Malayisk", ["ms"], "Malay"],
	["Marathi", ["mr"], "Marathi"],
	["Mongolsk", ["mn"], "Mongolian"],
	["Nepali", ["ne"], "Nepali"],
	["Norsk", ["no"], "Norwegian"],
	["Pashto", ["ps", "ps-AF"], "Pashto"],
	["Persisk", ["fa"], "Persian"],
	["Polsk", ["pl"], "Polish"],
	["Portugisisk", ["pt", "pt-BR", "pt-PT"], "Portuguese"],
	["Punjabi", ["pa", "pa-IN"], "Punjabi"],
	["Rumensk", ["ro"], "Romanian"],
	["Russisk", ["ru"], "Russian"],
	["Serbisk", ["sr"], "Serbian"],
	["Slovakisk", ["sk"], "Slovak"],
	["Slovensk", ["sl"], "Slovenian"],
	["Spansk", ["es", "es-419"], "Spanish"],
	["Svensk", ["sv", "sv-SE"], "Swedish"],
	["Tagalog", ["tl"], "Tagalog"],
	["Tamil", ["ta"], "Tamil"],
	["Telugu", ["te"], "Telugu"],
	["Thai", ["th", "th-TH"], "Thai"],
	["Tyrkisk", ["tr", "tr-TR"], "Turkish"],
	["Ukrainsk", ["uk"], "Ukrainian"],
	["Urdu", ["ur"], "Urdu"],
	["Vietnamesisk", ["vi"], "Vietnamese"],
] as const;

export type DictationLanguage = "multi" | (typeof NOVA_3_LANGUAGES)[number][1][number];

/** `label` is what the picker shows (Norwegian). `english` is never shown:
 *  it is a search alias, so «Polish» and «German» still find their rows. */
export const DICTATION_LANGUAGES: readonly { code: DictationLanguage; label: string; english: string }[] = [
	{ code: "multi", label: "Flerspråklig", english: "Multilingual" },
	...NOVA_3_LANGUAGES.flatMap(([name, codes, english]) =>
		codes.map((code, i) => ({ code, label: i === 0 ? name : `${name} (${code})`, english })),
	).sort((a, b) => a.label.localeCompare(b.label, "nb")),
];

/** What the picker's search matches for one row: code, Norwegian name, English name. */
export function dictationLanguageSearchTerms(item: { code: string; label: string; english: string }): string[] {
	return [item.code, item.label, item.english];
}

export function isDictationLanguage(value: unknown): value is DictationLanguage {
	return DICTATION_LANGUAGES.some(({ code }) => code === value);
}

/** Only language varies. Keep the owner's tuned streaming parameters. */
export function deepgramListenUrl(language: DictationLanguage): string {
	return "wss://api.deepgram.com/v1/listen" +
		"?model=nova-3&encoding=linear16&sample_rate=16000&channels=1" +
		"&smart_format=true&punctuate=true&endpointing=300" +
		`&language=${encodeURIComponent(language)}`;
}
