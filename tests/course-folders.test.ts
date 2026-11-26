/**
 * The fagmappe the app follows (innføringen): a temporary documents folder,
 * an isolated LH_DATA_DIR and a fake NTNU. Pins: new course-code folders
 * become courses (NTNU data, like «Legg til fag»), existing courses get the
 * folder as an extra source, new files refresh the source and announce
 * courses-changed, bad names are ignored, the watcher debounces, and the
 * shared convention (codes, exam files, the Canvas prompt) holds.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { after, beforeEach, describe, it } from "node:test";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-course-folders-"));
process.env.LH_DATA_DIR = path.join(TMP, "data");
process.env.LH_AUTH_FILE = path.join(TMP, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");

const { courseSeams, createCourse, addCourseSource } = await import("../src/server/courses.ts");
const folders = await import("../src/server/course-folders.ts");
const { NtnuUnreachableError, parseNtnuCoursePage } = await import("../src/server/ntnu.ts");
const { subscribe } = await import("../src/core/events.ts");
const { courseStore } = await import("../src/store/courses.ts");
const { canvasPrompt, classifyExamFiles, courseCodeFromFolderName, COURSE_FOLDER_README } = await import("../src/core/setup-prompts.ts");
const foldersRoute = await import("../app/api/course-folders/route.ts");
const openRoute = await import("../app/api/course-folders/open/route.ts");

after(() => {
	folders.resetCourseFolderState();
	fs.rmSync(TMP, { recursive: true, force: true });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = fs.readFileSync(path.join(here, "fixtures", "ntnu", "TTK4100.html"), "utf8");

/** The fake NTNU: knows TTK4100 only; switchable outage; call log. */
const ntnu = { down: false, pageCalls: [] as string[] };
courseSeams.today = () => "2026-11-13";
courseSeams.topicEngine = () => undefined;
courseSeams.ntnu = {
	coursePage: async (code, today) => {
		ntnu.pageCalls.push(code);
		if (ntnu.down) throw new NtnuUnreachableError("down");
		return code === "TTK4100" ? parseNtnuCoursePage(PAGE, today) : null;
	},
	courseList: async () => [],
	search: async () => [],
	examDate: async () => undefined,
};

const ROOT = path.join(TMP, "Documents", "Eksamenshjelp");
folders.courseFolderSeams.root = () => ROOT;
folders.courseFolderSeams.debounceMs = 30;
const opened: string[] = [];
folders.courseFolderSeams.open = (dir) => { opened.push(dir); };

function touch(rel: string, text = "x"): void {
	const file = path.join(ROOT, rel);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, text);
}

function folderSources(code: string) {
	return courseStore.getCourse(code)?.sources.filter((s) => s.kind === "folder") ?? [];
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
	folders.resetCourseFolderState();
	fs.rmSync(path.join(TMP, "data", "courses"), { recursive: true, force: true });
	fs.rmSync(ROOT, { recursive: true, force: true });
	Object.assign(ntnu, { down: false, pageCalls: [] });
	opened.length = 0;
});

describe("the fagmappe convention (core)", () => {
	it("a folder name is a course code only when NTNU could mean it", () => {
		assert.equal(courseCodeFromFolderName("TTK4100"), "TTK4100");
		assert.equal(courseCodeFromFolderName("ttk4100"), "TTK4100");
		assert.equal(courseCodeFromFolderName("Notater"), null, "no digit, no course");
		assert.equal(courseCodeFromFolderName(".git"), null);
		assert.equal(courseCodeFromFolderName("TTK 4100"), null, "spaces are not a code");
		assert.equal(courseCodeFromFolderName("Eksamen 2023"), null);
	});

	it("counts exams and solutions, PDFs only", () => {
		assert.deepEqual(
			classifyExamFiles([
				"2023_eksamen.pdf", "2023_LF.pdf", "2022_eksamen_2.pdf", "2022_lf_2.pdf",
				"Eksamen-H2021.PDF", "losningsforslag 2021.pdf", "sub/exam_2019.pdf",
				"notater.pdf", "2023_eksamen.txt", "forelesning.pdf",
				// The website prompt's names: <år><sesong>_<eksamen|LF>.pdf.
				"2024host_eksamen.pdf", "2024kont_LF.pdf", "2025var_eksamen.pdf",
			]),
			{ exams: 6, solutions: 4 },
		);
	});

	it("the Canvas prompt names the codes, the folder, the file names and the rules", () => {
		const text = canvasPrompt({ codes: ["ttk4100", "TMA4100", "TTK4100"], folder: "/Users/eva/Documents/Eksamenshjelp" });
		assert.match(text, /Fagene mine: TTK4100, TMA4100\./);
		assert.match(text, /\/Users\/eva\/Documents\/Eksamenshjelp\/TTK4100/);
		// The same names as the website's setup prompt (site/prompts/oppsett.txt).
		assert.match(text, /<FAGKODE>\/<år><sesong>_eksamen\.pdf og <FAGKODE>\/<år><sesong>_LF\.pdf/);
		assert.match(text, /var, host eller kont/);
		assert.match(text, /nettleseren der jeg allerede er logget inn/);
		assert.match(text, /Skriv aldri inn et passord/);
		assert.match(text, /spør meg/);
		const generic = canvasPrompt({ codes: [] });
		assert.match(generic, /~\/Documents\/Eksamenshjelp/);
		assert.match(generic, /%USERPROFILE%\\Documents\\Eksamenshjelp/);
		assert.match(generic, /Spør meg først hvilke fag/);
		const windows = canvasPrompt({ codes: ["TTK4100"], folder: "C:\\Users\\eva\\Documents\\Eksamenshjelp" });
		assert.match(windows, /Eksamenshjelp\\TTK4100/);
	});

	it("the documents folder: the shell's path wins, else ~/Documents, else a real «Dokumenter»", () => {
		const home = "/home/eva";
		assert.equal(folders.documentsDir({ LH_DOCUMENTS_DIR: "/Volumes/x/Docs" }, home, () => false), "/Volumes/x/Docs");
		assert.equal(folders.documentsDir({}, home, (p) => p === "/home/eva/Documents"), path.join(home, "Documents"));
		assert.equal(folders.documentsDir({}, home, (p) => p === "/home/eva/Dokumenter"), path.join(home, "Dokumenter"));
		assert.equal(folders.documentsDir({}, home, () => false), path.join(home, "Documents"), "nothing yet: the English name");
		assert.equal(folders.documentsDir({ LH_DOCUMENTS_DIR: "relative" }, home, () => false), path.join(home, "Documents"));
	});
});

describe("scanning the fagmappe", () => {
	it("creates the folder with a README the first time", async () => {
		const scan = await folders.scanCourseFolders();
		assert.equal(scan.available, true);
		assert.equal(scan.root, ROOT);
		assert.equal(fs.readFileSync(path.join(ROOT, "README.txt"), "utf8"), COURSE_FOLDER_README);
		fs.writeFileSync(path.join(ROOT, "README.txt"), "mine");
		await folders.scanCourseFolders();
		assert.equal(fs.readFileSync(path.join(ROOT, "README.txt"), "utf8"), "mine", "an existing README is left alone");
	});

	it("a new course-code folder becomes the course, from NTNU, with the folder as a source", async () => {
		touch("ttk4100/2023_eksamen.pdf");
		touch("ttk4100/2023_LF.pdf");
		const events: unknown[] = [];
		const off = subscribe((e) => { if (e.type === "courses-changed") events.push(e); });
		const scan = await folders.scanCourseFolders();
		off();
		const course = courseStore.getCourse("TTK4100");
		assert.ok(course, "the course exists");
		assert.equal(course.name, "Kybernetikk, introduksjon");
		assert.equal(course.custom, false);
		assert.deepEqual(course.sources.map((s) => s.kind), ["ntnu", "link", "folder"]);
		const folder = folderSources("TTK4100")[0]!;
		assert.equal(folder.path, path.join(ROOT, "ttk4100"));
		assert.equal(folder.fileCount, 2);
		assert.ok(events.length >= 1, "courses-changed announced");
		assert.deepEqual(scan.courses, [{ code: "TTK4100", name: "Kybernetikk, introduksjon", folder: path.join(ROOT, "ttk4100"), fileCount: 2, exams: 1, solutions: 1 }]);
		assert.deepEqual(scan.unknown, []);
	});

	it("a folder for an existing course is linked once, as an extra source", async () => {
		const created = await createCourse({ code: "TTK4100" });
		assert.ok(created.ok);
		const notes = path.join(TMP, "notes");
		fs.mkdirSync(notes, { recursive: true });
		assert.ok(addCourseSource("TTK4100", { kind: "folder", path: notes }).ok);
		touch("TTK4100/a.pdf");
		await folders.scanCourseFolders();
		await folders.scanCourseFolders();
		assert.deepEqual(folderSources("TTK4100").map((s) => s.path), [notes, path.join(ROOT, "TTK4100")], "kept, then added once");
		assert.equal(ntnu.pageCalls.length, 1, "NTNU is asked only by the original «Legg til fag»");
	});

	it("a new file refreshes the folder source and announces it; an unchanged folder writes nothing", async () => {
		touch("TTK4100/2023_eksamen.pdf");
		await folders.scanCourseFolders();
		const before = courseStore.getCourse("TTK4100")!.updatedAt;
		let events = 0;
		const off = subscribe((e) => { if (e.type === "courses-changed") events++; });
		await folders.scanCourseFolders();
		assert.equal(events, 0, "nothing changed, nothing announced");
		assert.equal(courseStore.getCourse("TTK4100")!.updatedAt, before);
		touch("TTK4100/2022_eksamen.pdf");
		const scan = await folders.scanCourseFolders();
		off();
		assert.equal(events, 1);
		assert.equal(folderSources("TTK4100")[0]!.fileCount, 2);
		assert.equal(scan.courses[0]!.exams, 2);
	});

	it("names that are no course code are ignored; NTNU's unknown codes are not invented", async () => {
		touch("Notater/x.pdf");
		touch("XYZ9999/x.pdf");
		touch("løs.pdf");
		const scan = await folders.scanCourseFolders();
		assert.deepEqual(courseStore.listCourses(), []);
		assert.deepEqual(scan.unknown, ["XYZ9999"]);
		await folders.scanCourseFolders();
		assert.deepEqual(ntnu.pageCalls, ["XYZ9999"], "an unknown code is not asked about on every tick");
	});

	it("NTNU down: no course now, retried after the wait", async () => {
		ntnu.down = true;
		touch("TTK4100/x.pdf");
		assert.deepEqual((await folders.scanCourseFolders()).unknown, ["TTK4100"]);
		ntnu.down = false;
		await folders.scanCourseFolders();
		assert.ok(!courseStore.getCourse("TTK4100"), "still waiting");
		const saved = folders.courseFolderSeams.retryUnreachableMs;
		folders.courseFolderSeams.retryUnreachableMs = 0;
		try {
			ntnu.down = true;
			folders.resetCourseFolderState();
			await folders.scanCourseFolders(); // down again, but with no wait this time
			ntnu.down = false;
			await folders.scanCourseFolders();
		} finally {
			folders.courseFolderSeams.retryUnreachableMs = saved;
		}
		assert.ok(courseStore.getCourse("TTK4100"));
	});

	it("concurrent scans share one run (no duplicate course, one NTNU call)", async () => {
		touch("TTK4100/x.pdf");
		const [a, b] = await Promise.all([folders.scanCourseFolders(), folders.scanCourseFolders()]);
		assert.equal(a, b);
		await wait(20); // the queued rerun
		assert.equal(ntnu.pageCalls.length, 1);
		assert.equal(folderSources("TTK4100").length, 1);
	});

	it("GET /api/course-folders is the scan", async () => {
		touch("TTK4100/2023_eksamen.pdf");
		const res = await foldersRoute.GET();
		assert.equal(res.status, 200);
		const body = (await res.json()) as { root: string; courses: { code: string; exams: number }[] };
		assert.equal(body.root, ROOT);
		assert.deepEqual(body.courses.map((c) => [c.code, c.exams]), [["TTK4100", 1]]);
	});
});

describe("the watcher", () => {
	it("a new folder while the app runs becomes a course (debounced)", async () => {
		const saved = folders.courseFolderSeams.enabled;
		folders.courseFolderSeams.enabled = () => true;
		try {
			folders.installCourseFolderWatcher();
			await wait(100); // the first scan creates and starts watching the root
			assert.ok(fs.existsSync(path.join(ROOT, "README.txt")));
			touch("TTK4100/2023_eksamen.pdf");
			touch("TTK4100/2023_LF.pdf");
			for (let i = 0; i < 60 && folderSources("TTK4100")[0]?.fileCount !== 2; i++) await wait(50);
			assert.equal(folderSources("TTK4100")[0]?.fileCount, 2);
			assert.equal(ntnu.pageCalls.length, 1, "a burst of files is one scan's worth of NTNU");
		} finally {
			folders.courseFolderSeams.enabled = saved;
			folders.resetCourseFolderState();
		}
	});

	it("is off under npm test unless a test turns it on", () => {
		folders.installCourseFolderWatcher();
		assert.equal(fs.existsSync(ROOT), false, "nothing created");
	});
});

describe("«Åpne fagmappen»", () => {
	it("opens the root, or one course's folder (created under its code)", async () => {
		const root = await openRoute.POST(new Request("http://t/x", { method: "POST", body: "{}" }));
		assert.equal(root.status, 200);
		touch("ttk4100/x.pdf");
		const course = await openRoute.POST(new Request("http://t/x", { method: "POST", body: JSON.stringify({ code: "TTK4100" }) }));
		assert.equal(course.status, 200);
		const fresh = await openRoute.POST(new Request("http://t/x", { method: "POST", body: JSON.stringify({ code: "tma4100" }) }));
		assert.equal(fresh.status, 200);
		assert.deepEqual(opened, [ROOT, path.join(ROOT, "ttk4100"), path.join(ROOT, "TMA4100")]);
		assert.ok(fs.statSync(path.join(ROOT, "TMA4100")).isDirectory());
		const bad = await openRoute.POST(new Request("http://t/x", { method: "POST", body: JSON.stringify({ code: "!!" }) }));
		assert.equal(bad.status, 400);
	});
});
