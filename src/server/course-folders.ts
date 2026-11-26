/**
 * THE FAGMAPPE the app follows (innføringen, 2026-11): one folder per course
 * under the learner's documents folder (src/core/setup-prompts.ts has the
 * convention). A setup AI or the learner drops a folder named after a
 * course code there, and the app
 *  - creates the course from NTNU, exactly like «Legg til fag» (createCourse),
 *    when it does not exist yet,
 *  - links the folder as a `folder` source (a second source when the course
 *    already has others),
 *  - keeps the folder source's file count fresh, so a new file is "in" at
 *    once: the folder IS the source, and the session context lists it.
 *
 * When it looks: at startup (the first window's events stream installs the
 * watcher, which scans once), on every change under the folder (fs.watch,
 * debounced), and when the window gets focus (POST /api/course-folders/scan).
 * Folder names that are no course code are ignored and logged; a code NTNU
 * does not know is retried later, never invented.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	COURSE_FOLDER_NAME,
	COURSE_FOLDER_README,
	classifyExamFiles,
	courseCodeFromFolderName,
} from "../core/setup-prompts.ts";
import { normalizeCourseCode } from "../core/courses.ts";
import { courseStore } from "../store/courses.ts";
import { createCourse, listSupportedFiles, syncCourseFolderSource } from "./courses.ts";
import { openCommand } from "./mock-exams.ts";
import { spawn } from "node:child_process";

// ─── Where the folder is ─────────────────────────────────────────────────────

/** The OS documents folder. The desktop shell passes Electron's own
 *  (app.getPath("documents"), which follows a moved or OneDrive-redirected
 *  folder on Windows) as LH_DOCUMENTS_DIR. Without it: ~/Documents. On a Mac
 *  set to Norwegian, Finder shows that folder as «Dokumenter», but the path
 *  stays ~/Documents; only a system that really names it Dokumenter (some
 *  Linux desktops) falls through to that. Pure over its inputs. */
export function documentsDir(
	env: Record<string, string | undefined> = process.env,
	home: string = os.homedir(),
	exists: (p: string) => boolean = fs.existsSync,
): string {
	const fromShell = env.LH_DOCUMENTS_DIR?.trim();
	if (fromShell && path.isAbsolute(fromShell)) return fromShell;
	const english = path.join(home, "Documents");
	if (exists(english)) return english;
	const norwegian = path.join(home, "Dokumenter");
	return exists(norwegian) ? norwegian : english;
}

/** Test seams; production uses the defaults. */
export const courseFolderSeams: {
	/** The fagmappe root (…/Documents/Eksamenshjelp). */
	root: () => string;
	/** Off under `npm test`, so no test ever touches the real documents folder. */
	enabled: () => boolean;
	/** The watcher's quiet period before a scan. */
	debounceMs: number;
	/** Replaces the OS folder opener. */
	open?: (dir: string) => void;
	/** How long to wait before asking NTNU again about a code (ms). */
	retryUnknownMs: number;
	retryUnreachableMs: number;
} = {
	root: () => path.join(documentsDir(), COURSE_FOLDER_NAME),
	enabled: () => process.env.NODE_ENV !== "test",
	debounceMs: 1_500,
	retryUnknownMs: 60 * 60 * 1000,
	retryUnreachableMs: 5 * 60 * 1000,
};

/** Create the root and its README.txt when missing. False = no folder
 *  (a read-only home, a permission prompt declined): the app runs on. */
export function ensureCourseFolderRoot(root: string = courseFolderSeams.root()): boolean {
	try {
		fs.mkdirSync(root, { recursive: true });
		const readme = path.join(root, "README.txt");
		if (!fs.existsSync(readme)) fs.writeFileSync(readme, COURSE_FOLDER_README, "utf-8");
		return true;
	} catch (err) {
		console.error(`[course-folders] could not create ${root}:`, err instanceof Error ? err.message : err);
		return false;
	}
}

// ─── Process state (one per process: Next duplicates modules per route) ──────

interface FolderState {
	running?: Promise<CourseFolderScan>;
	rerun?: boolean;
	watcher?: fs.FSWatcher;
	watchedRoot?: string;
	installed?: boolean;
	timer?: ReturnType<typeof setTimeout>;
	/** code → epoch ms before which NTNU is not asked again. */
	skip: Map<string, number>;
	/** Folder names already logged as ignored (log once, not every tick). */
	logged: Set<string>;
}

function state(): FolderState {
	const g = globalThis as typeof globalThis & { __lhCourseFolders?: FolderState };
	return (g.__lhCourseFolders ??= { skip: new Map(), logged: new Set() });
}

/** Tests: forget timers, watcher, skips. */
export function resetCourseFolderState(): void {
	const s = state();
	if (s.timer) clearTimeout(s.timer);
	s.watcher?.close();
	const g = globalThis as typeof globalThis & { __lhCourseFolders?: FolderState };
	g.__lhCourseFolders = { skip: new Map(), logged: new Set() };
}

// ─── The scan ────────────────────────────────────────────────────────────────

/** One course as the innføring shows it: its folder and what is in it. */
export interface CourseFolderEntry {
	code: string;
	name: string;
	/** The course's folder under the root, or null when it has none yet. */
	folder: string | null;
	fileCount: number;
	exams: number;
	solutions: number;
}

export interface CourseFolderScan {
	root: string;
	/** False when the root could not be created or read. */
	available: boolean;
	/** Every course the learner has, folder or not, in store order. */
	courses: CourseFolderEntry[];
	/** Course-code folders NTNU did not know (or could not be asked about). */
	unknown: string[];
}

function folderEntries(root: string): fs.Dirent[] | null {
	try {
		return fs.readdirSync(root, { withFileTypes: true });
	} catch {
		return null;
	}
}

async function linkFolder(code: string, dir: string, s: FolderState): Promise<"linked" | "unknown"> {
	if (!courseStore.getCourse(code)) {
		const until = s.skip.get(code);
		if (until !== undefined && until > Date.now()) return "unknown";
		const created = await createCourse({ code });
		if (!created.ok) {
			const unreachable = created.code === "ntnu_unreachable";
			s.skip.set(code, Date.now() + (unreachable ? courseFolderSeams.retryUnreachableMs : courseFolderSeams.retryUnknownMs));
			console.info(`[course-folders] ${path.basename(dir)}: ${unreachable ? "NTNU svarte ikke, prøver igjen senere" : `fant ikke ${code} hos NTNU, ignorert`}`);
			return "unknown";
		}
		s.skip.delete(code);
		console.info(`[course-folders] la til ${code} fra fagmappen`);
	}
	const synced = syncCourseFolderSource(code, dir);
	if (!synced.ok) console.error(`[course-folders] could not link ${dir} to ${code}: ${synced.error}`);
	return "linked";
}

async function runScan(): Promise<CourseFolderScan> {
	const s = state();
	const root = courseFolderSeams.root();
	const available = ensureCourseFolderRoot(root);
	const folders = new Map<string, string>(); // code → absolute folder path
	const unknown: string[] = [];
	for (const entry of (available ? folderEntries(root) : null) ?? []) {
		if (!entry.isDirectory()) continue;
		const code = courseCodeFromFolderName(entry.name);
		if (!code) {
			if (!entry.name.startsWith(".") && !s.logged.has(entry.name)) {
				s.logged.add(entry.name);
				console.info(`[course-folders] «${entry.name}» er ikke en fagkode, ignorert`);
			}
			continue;
		}
		if (folders.has(code)) continue; // «ttk4100» and «TTK4100»: the first one wins
		const dir = path.join(root, entry.name);
		folders.set(code, dir);
		if ((await linkFolder(code, dir, s)) === "unknown") unknown.push(code);
	}
	const courses = courseStore.listCourses().map((course): CourseFolderEntry => {
		const folder = folders.get(course.code) ?? null;
		const files = folder ? listSupportedFiles(folder) : [];
		return { code: course.code, name: course.name, folder, fileCount: files.length, ...classifyExamFiles(files) };
	});
	if (s.installed) ensureWatcher(root);
	return { root, available, courses, unknown };
}

/** Scan the fagmappe now. Single-flight: a call during a running scan
 *  gets that scan's result and queues exactly one more afterwards (the
 *  change it saw may have landed after the running scan read the folder). */
export function scanCourseFolders(): Promise<CourseFolderScan> {
	const s = state();
	if (s.running) {
		s.rerun = true;
		return s.running;
	}
	const run = runScan()
		.finally(() => {
			s.running = undefined;
			if (s.rerun) {
				s.rerun = false;
				void scanCourseFolders();
			}
		});
	s.running = run;
	return run;
}

// ─── The watcher ─────────────────────────────────────────────────────────────

function scheduleScan(): void {
	const s = state();
	if (s.timer) clearTimeout(s.timer);
	s.timer = setTimeout(() => {
		s.timer = undefined;
		void scanCourseFolders().catch((err) => console.error("[course-folders] scan failed:", err));
	}, courseFolderSeams.debounceMs);
}

function ensureWatcher(root: string): void {
	const s = state();
	if (s.watcher && s.watchedRoot === root) return;
	s.watcher?.close();
	s.watcher = undefined;
	try {
		// recursive: macOS and Windows natively, Linux since Node 20.
		const watcher = fs.watch(root, { recursive: true }, () => scheduleScan());
		watcher.on("error", (err) => {
			// The root was removed or became unreadable: drop the watcher; the
			// next scan (focus, startup) recreates the folder and watches again.
			console.info("[course-folders] watcher stopped:", err instanceof Error ? err.message : err);
			watcher.close();
			if (s.watcher === watcher) s.watcher = undefined;
		});
		s.watcher = watcher;
		s.watchedRoot = root;
	} catch (err) {
		console.info("[course-folders] could not watch the folder:", err instanceof Error ? err.message : err);
	}
}

/** Startup: create the folder, scan once and start watching. Idempotent
 *  (the events route calls it per window) and off under `npm test`. */
export function installCourseFolderWatcher(): void {
	if (!courseFolderSeams.enabled()) return;
	const s = state();
	if (s.installed) return;
	s.installed = true;
	void scanCourseFolders().catch((err) => console.error("[course-folders] first scan failed:", err));
}

// ─── «Åpne fagmappen» ────────────────────────────────────────────────────────

export type OpenCourseFolderOutcome = { ok: true; path: string } | { ok: false; status: 400 | 500; error: string };

/** Open the root, or one course's folder (created when missing, under the
 *  name the convention gives it), in Finder or Explorer. */
export function openCourseFolder(rawCode?: unknown): OpenCourseFolderOutcome {
	const root = courseFolderSeams.root();
	if (!ensureCourseFolderRoot(root)) return { ok: false, status: 500, error: "Fikk ikke laget fagmappen. Sjekk at appen har tilgang til Dokumenter." };
	let target = root;
	if (rawCode !== undefined && rawCode !== null && rawCode !== "") {
		const code = normalizeCourseCode(rawCode);
		if (!code) return { ok: false, status: 400, error: "Fagkoden ser ikke riktig ut." };
		const existing = (folderEntries(root) ?? []).find((e) => e.isDirectory() && courseCodeFromFolderName(e.name) === code);
		target = path.join(root, existing?.name ?? code);
		try {
			fs.mkdirSync(target, { recursive: true });
		} catch {
			return { ok: false, status: 500, error: "Fikk ikke laget mappen for faget." };
		}
	}
	try {
		if (courseFolderSeams.open) courseFolderSeams.open(target);
		else {
			const { command, args } = openCommand(process.platform, target);
			const child = spawn(command, args, { detached: true, stdio: "ignore" });
			child.on("error", (err) => console.error("[course-folders] open:", err));
			child.unref();
		}
	} catch (err) {
		return { ok: false, status: 500, error: `Klarte ikke å åpne mappen: ${err instanceof Error ? err.message : String(err)}` };
	}
	return { ok: true, path: target };
}
