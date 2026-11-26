/**
 * THE FAGMAPPE CONVENTION and the setup prompts (innføringen, 2026-11).
 *
 * One folder per course under the learner's documents folder:
 *   Mac:     ~/Documents/Eksamenshjelp/<FAGKODE>/
 *   Windows: %USERPROFILE%\Documents\Eksamenshjelp\<FAGKODE>\
 * The app watches it (src/server/course-folders.ts): a folder named after a
 * course code becomes that course, and every file in it is the course's
 * material. A setup AI (Claude Code or Codex) fills it with earlier exams and
 * solutions, named `<FAGKODE>/<år><sesong>_<eksamen|LF>.pdf` (sesong: var, host
 * or kont) — the same convention as the website's setup prompt
 * (site/prompts/oppsett.txt).
 *
 * This module is the ONE source of that convention and of the Canvas prompt
 * text. The website and the install scripts reuse it (same folder, same
 * prompt), so keep it pure and dependency-free: browser-safe, no node imports.
 */

import { normalizeCourseCode } from "./courses.ts";

/** The folder's name inside the documents folder. */
export const COURSE_FOLDER_NAME = "Eksamenshjelp";

/** How the folder is written for a learner on each platform. */
export const COURSE_FOLDER_DISPLAY = {
	mac: "~/Documents/Eksamenshjelp",
	windows: "%USERPROFILE%\\Documents\\Eksamenshjelp",
} as const;

/** The README.txt the app writes into an empty fagmappe. */
export const COURSE_FOLDER_README = [
	"Eksamenshjelp: fagmappen din",
	"",
	"Denne mappen er til fagene du øver på i Eksamenshjelp.",
	"",
	"- Lag én mappe per fag, og gi den fagkoden som navn, for eksempel TTK4100.",
	"  Appen legger da til faget av seg selv, med fakta fra NTNU.",
	"- Legg tidligere eksamener og løsningsforslag i fagets mappe, for eksempel",
	"  TTK4100/2023host_eksamen.pdf og TTK4100/2023host_LF.pdf (sesong: var, host eller kont).",
	"- Du kan også legge inn egne notater, øvinger og bilder.",
	"",
	"Alt som ligger her, blir med når du øver. Ingenting lastes opp før du starter en økt.",
	"",
].join("\n");

/** The course code a folder name stands for, or null. NTNU codes always
 *  carry a digit; requiring one keeps folders like «Notater» or «Gammelt»
 *  from becoming courses. Pure; exported for the tests. */
export function courseCodeFromFolderName(name: string): string | null {
	if (name.startsWith(".")) return null;
	const code = normalizeCourseCode(name);
	return code && /\d/.test(code) ? code : null;
}

/** What the files in one fagmappe say about earlier exams. */
export interface ExamFileCounts {
	exams: number;
	solutions: number;
}

const SOLUTION = /(^|[^a-zæøå])(lf|losning|løsning|losningsforslag|løsningsforslag|fasit|solution|solutions|sol)([^a-zæøå]|$)/i;
const EXAM = /(^|[^a-zæøå])(eksamen|exam|konte|kont|kontinuasjon)([^a-zæøå]|$)/i;

/** Count earlier exams and solutions among a folder's files (relative
 *  paths). Only PDFs count; a solution is never also an exam. Pure. */
export function classifyExamFiles(files: readonly string[]): ExamFileCounts {
	let exams = 0;
	let solutions = 0;
	for (const file of files) {
		const base = file.split(/[\\/]/).pop() ?? file;
		if (!/\.pdf$/i.test(base)) continue;
		const stem = base.slice(0, -4).replace(/[_\s.-]+/g, " ");
		if (SOLUTION.test(stem)) solutions++;
		else if (EXAM.test(stem)) exams++;
	}
	return { exams, solutions };
}

/** The Norwegian prompt a learner pastes into Claude Code or Codex to fetch
 *  earlier exams into the fagmappe. `folder` is the real path when the app
 *  knows it; without it the prompt names both platform conventions. */
export function canvasPrompt(opts: { codes: readonly string[]; folder?: string }): string {
	const codes = [...new Set(opts.codes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
	const example = codes[0] ?? "TTK4100";
	const sep = opts.folder && opts.folder.includes("\\") && !opts.folder.includes("/") ? "\\" : "/";
	const where = opts.folder
		? `Fagmappen min er ${opts.folder}. Hvert fag har en egen undermappe med fagkoden som navn, for eksempel ${opts.folder}${sep}${example}.`
		: `Fagmappen min er ${COURSE_FOLDER_DISPLAY.mac} på Mac eller ${COURSE_FOLDER_DISPLAY.windows} på Windows. Hvert fag har en egen undermappe med fagkoden som navn, for eksempel ${COURSE_FOLDER_DISPLAY.mac}/${example}.`;
	return [
		"Hei! Jeg studerer ved NTNU og øver til eksamen med appen Eksamenshjelp. Hjelp meg å hente tidligere eksamener og løsningsforslag til fagmappen min.",
		"",
		codes.length > 0 ? `Fagene mine: ${codes.join(", ")}.` : "Spør meg først hvilke fag jeg tar (fagkodene, for eksempel TTK4100).",
		where,
		"",
		"Slik gjør du det:",
		"1. Bruk nettleseren der jeg allerede er logget inn (Canvas, Innsida og NTNUs nettsider). Skriv aldri inn et passord, og spør meg aldri om passordet mitt. Kommer du til en innloggingsside, stopp og be meg logge inn selv.",
		"2. Let etter tidligere eksamener og løsningsforslag for hvert fag: i fagets rom i Canvas (Filer, Moduler og Sider), på emnesiden hos NTNU og på fagets wiki eller nettside.",
		`3. Last ned PDF-ene og lagre dem i fagets mappe som <FAGKODE>/<år><sesong>_eksamen.pdf og <FAGKODE>/<år><sesong>_LF.pdf, der sesong er var, host eller kont, for eksempel ${example}/2023host_eksamen.pdf og ${example}/2023host_LF.pdf. Ta de nyeste først, og høyst ti eksamener per fag. Lag mappen hvis den ikke finnes.`,
		"4. Lagre bare eksamener og løsningsforslag. Ikke endre eller slett filer som allerede ligger i mappen, og ikke last ned den samme filen to ganger.",
		"5. Er noe uklart, for eksempel hvilket fag eller år en fil hører til, eller om den faktisk er en eksamen, så spør meg før du fortsetter.",
		"6. Gi meg til slutt en kort liste per fag over hva du lagret og hva du ikke fant.",
	].join("\n");
}
