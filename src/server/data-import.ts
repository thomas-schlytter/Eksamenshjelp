/**
 * "Importer fra LearnHarness" — bring an existing LearnHarness data folder
 * (the desktop app's userData, a dev checkout's data/, or a folder copied
 * from another machine) into THIS app's data directory.
 *
 * THE LAWS:
 *  - ADDITIVE ONLY. Sessions, jobs, prompt files and keys are copied only
 *    where the target has none; ledgers gain only lines they lack; JSON
 *    maps gain only missing keys. Nothing in the target is overwritten or
 *    deleted, and the source is only ever READ.
 *  - ONE SYNC BLOCK. runImport contains no await: the gate (no turn, no
 *    live worker, no extraction) and every read-merge-write share one
 *    stretch of the event loop, so no extraction append or turn persist
 *    can interleave (the same atomicity argument as chat deletion in
 *    server/chats.ts). It is not crash-atomic: an I/O failure can leave a
 *    partial import, which a re-run completes (the import is idempotent).
 *  - ORDER. Sessions first, graph after, coverage last: a crash in between
 *    leaves sessions that can simply be extracted again, never coverage
 *    claiming knowledge the graph does not hold.
 *  - SOURCE DISCIPLINE. Only the known file names are read, and nothing is
 *    followed out of the chosen folder through a symlink.
 *  - Secrets: key VALUES never appear in a preview, a result, or a log.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	LEDGER_FILES,
	PATHS,
	RENDER_SETTINGS_FILE,
	SETTINGS_FILE,
	SOURCE_ORGANIZATION_FILE,
	SOURCES_FILE,
} from "../../config.ts";
import { extractionStatuses } from "../agent/subagents/extraction.ts";
import { isJobLive } from "../agent/subagents/aborts.ts";
import { CURRENT_CHAT_VERSION, CURRENT_GRAPH_FORMAT_VERSION, isSubagentFailure } from "../core/contracts.ts";
import type { GraphChain, GraphNode, JobRecord, Position } from "../core/contracts.ts";
import {
	defaultImportInclude,
	parseImportInclude,
	type ImportCandidate,
	type ImportInclude,
	type ImportPreview,
	type ImportResult,
	type ImportSkipped,
} from "../core/data-import.ts";
import { emit } from "../core/events.ts";
import { deriveView, getGraph } from "../core/graph.ts";
import { settleGraphLayout } from "../core/layout-settle.ts";
import { isValidSegmentPath } from "../core/prompt-segments.ts";
import { sanitizeUserSettings, type UserSettings } from "../core/settings.ts";
import { parseSourceOrganization, type SourceOrganization } from "../core/source-organization.ts";
import { assertGraphFormat, ensureGraphFormat } from "../store/graph-format.ts";
import {
	isCheckpoint,
	isCoverageEntry,
	isGraphChain,
	isGraphNode,
	isNotesSource,
	isPosition,
} from "../store/graph.ts";
import { promptOverrides } from "../store/prompt-overrides.ts";
import { readRenderSettings, writeRenderSettings } from "../store/render-settings.ts";
import { authStore } from "../store/auth.ts";
import { graphRevision } from "./graph.ts";
import { isWritableAuthKey, saveKey } from "./keys.ts";
import { stores } from "./stores.ts";
import { isTurnRunning } from "./turn-liveness.ts";

/** A refusal the routes map straight to HTTP: `{ error, code }` + status. */
export class DataImportError extends Error {
	readonly status: number;
	readonly code: string;
	constructor(status: number, code: string, message: string) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

/** Test seam: replaces the per-platform userData search roots. */
export const importSeams: { userDataRoots: string[] | null } = { userDataRoots: null };

const ID_RE = /^[A-Za-z0-9_-]+$/;
const JOBS_DIR = path.join(PATHS.data, "jobs");
const MAX_PREVIEW_TITLES = 50;

// ─── locating and validating the source ─────────────────────────────────────

function isDirectory(dir: string): boolean {
	try {
		return fs.statSync(dir).isDirectory();
	} catch {
		return false;
	}
}

function realpathOr(dir: string): string {
	try {
		return fs.realpathSync(dir);
	} catch {
		return path.resolve(dir);
	}
}

const within = (root: string, target: string): boolean => target === root || target.startsWith(root + path.sep);

const looksLikeDataDir = (dir: string): boolean => isDirectory(path.join(dir, "chats")) || isDirectory(path.join(dir, "graph"));

function expandUserPath(input: string): string {
	let value = input.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
	if (value === "~") return os.homedir();
	if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(os.homedir(), value.slice(2));
	if (/^%APPDATA%/i.test(value) && process.env.APPDATA) value = process.env.APPDATA + value.slice("%APPDATA%".length);
	return value;
}

interface ImportSource {
	/** Realpath of the folder holding chats/ and graph/. */
	dataDir: string;
	/** Realpath of the folder above it, where auth.json lives. */
	parentDir: string;
}

/** Accepts the data folder itself or the userData folder above it. */
function locateSource(input: unknown): ImportSource {
	if (typeof input !== "string" || input.trim().length === 0) {
		throw new DataImportError(400, "invalid_path", "Skriv inn stien til mappen du vil importere fra.");
	}
	const expanded = expandUserPath(input);
	if (expanded.includes("\0") || !path.isAbsolute(expanded)) {
		throw new DataImportError(400, "invalid_path", "Stien må være en fullstendig sti til en mappe, for eksempel ~/Library/Application Support/LearnHarness.");
	}
	let real: string;
	try {
		real = fs.realpathSync(expanded);
	} catch {
		throw new DataImportError(404, "not_found", "Fant ikke mappen. Sjekk at stien er riktig.");
	}
	if (!isDirectory(real)) {
		throw new DataImportError(400, "not_directory", "Stien peker på en fil. Velg mappen som inneholder LearnHarness-dataene.");
	}
	let dataDir: string | null = null;
	if (looksLikeDataDir(real)) dataDir = real;
	else {
		// The userData folder: find data/ ourselves, but never through a
		// symlink that leaves the chosen folder.
		const nested = realpathOr(path.join(real, "data"));
		if (within(real, nested) && looksLikeDataDir(nested)) dataDir = nested;
	}
	if (dataDir === null) {
		throw new DataImportError(400, "not_learnharness", "Dette ser ikke ut som en LearnHarness-datamappe. Mappen skal inneholde «chats» eller «graph», eller en «data»-mappe med dem.");
	}
	return { dataDir, parentDir: path.dirname(dataDir) };
}

const isCurrentDataDir = (dataDir: string): boolean => realpathOr(dataDir) === realpathOr(PATHS.data);

function assertNotCurrent(source: ImportSource): void {
	if (isCurrentDataDir(source.dataDir)) {
		throw new DataImportError(409, "same_directory", "Dette er mappen appen allerede bruker. Det er ingenting å importere.");
	}
}

/** A regular file under `root`, by realpath; null when absent, not a file,
 *  or reached through a symlink that leaves `root`. */
function sourceFile(root: string, ...segments: string[]): string | null {
	try {
		const real = fs.realpathSync(path.join(root, ...segments));
		return within(root, real) && fs.statSync(real).isFile() ? real : null;
	} catch {
		return null;
	}
}

function readSourceText(root: string, ...segments: string[]): string | null {
	const file = sourceFile(root, ...segments);
	if (file === null) return null;
	try {
		return fs.readFileSync(file, "utf-8");
	} catch {
		return null;
	}
}

function readSourceJson(root: string, ...segments: string[]): unknown {
	const text = readSourceText(root, ...segments);
	if (text === null) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** `<id>.json` names in one source subfolder (ids pass the store's own filename guard). */
function sourceRecordIds(root: string, sub: string): string[] {
	const dir = realpathOr(path.join(root, sub));
	if (!within(root, dir)) return [];
	try {
		return fs
			.readdirSync(dir)
			.filter((name) => name.endsWith(".json") && ID_RE.test(name.slice(0, -5)))
			.map((name) => name.slice(0, -5))
			.sort();
	} catch {
		return [];
	}
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// ─── reading the source ─────────────────────────────────────────────────────

interface SourceChat {
	id: string;
	title: string;
	text: string;
}

interface SourceChats {
	readable: SourceChat[];
	newer: number;
	preNative: number;
	corrupt: number;
}

function readSourceChats(source: ImportSource): SourceChats {
	const out: SourceChats = { readable: [], newer: 0, preNative: 0, corrupt: 0 };
	for (const id of sourceRecordIds(source.dataDir, "chats")) {
		const text = readSourceText(source.dataDir, "chats", `${id}.json`);
		if (text === null) continue; // not a regular file inside the folder: not ours to read
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = undefined;
		}
		if (!isRecord(parsed) || parsed.id !== id || !Array.isArray(parsed.messages)) {
			out.corrupt++;
			continue;
		}
		// The same honest refusal as the chat store's read guard: a record
		// stamped newer than this build is never copied in half-understood.
		if (typeof parsed.version === "number" && parsed.version > CURRENT_CHAT_VERSION) {
			out.newer++;
			continue;
		}
		// Pre-native transcripts (UIMessage `parts`) are a different dialect
		// this app cannot replay.
		if (parsed.messages.some((m) => isRecord(m) && Array.isArray(m.parts) && m.content === undefined)) {
			out.preNative++;
			continue;
		}
		const title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title : "Økt uten navn";
		out.readable.push({ id, title, text });
	}
	return out;
}

const JOB_STATUSES = new Set(["running", "done", "error"]);

function readSourceJobs(source: ImportSource): { job: JobRecord; text: string }[] {
	const out: { job: JobRecord; text: string }[] = [];
	for (const id of sourceRecordIds(source.dataDir, "jobs")) {
		const text = readSourceText(source.dataDir, "jobs", `${id}.json`);
		if (text === null) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			continue;
		}
		if (
			!isRecord(parsed) || parsed.id !== id || typeof parsed.chatId !== "string" || typeof parsed.kind !== "string" ||
			typeof parsed.toolCallId !== "string" || typeof parsed.status !== "string" || !JOB_STATUSES.has(parsed.status)
		) continue;
		out.push({ job: parsed as unknown as JobRecord, text });
	}
	return out;
}

interface LedgerRead<T> {
	records: { key: string; value: T }[];
	corrupt: number;
}

/** One source ledger: valid lines in order with their canonical dedup key
 *  (the JSON re-serialization, exactly what the store's append writes). */
function readSourceLedger<T>(source: ImportSource, name: string, isValid: (v: unknown) => v is T): LedgerRead<T> {
	const out: LedgerRead<T> = { records: [], corrupt: 0 };
	const text = readSourceText(source.dataDir, "graph", name);
	if (text === null) return out;
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			out.corrupt++;
			continue;
		}
		if (!isValid(parsed)) {
			out.corrupt++;
			continue;
		}
		out.records.push({ key: JSON.stringify(parsed), value: parsed });
	}
	return out;
}

function sourceGraphBlock(source: ImportSource): string | null {
	const stamp = readSourceJson(source.dataDir, "graph", "format.json");
	const version = isRecord(stamp) && typeof stamp.version === "number" && Number.isInteger(stamp.version) ? stamp.version : null;
	if (version !== null && version > CURRENT_GRAPH_FORMAT_VERSION) {
		return `Kunnskapskartet i mappen er lagret i et nyere format (versjon ${version}) enn denne appen forstår (versjon ${CURRENT_GRAPH_FORMAT_VERSION}). Oppdater appen før du importerer kartet.`;
	}
	return null;
}

function readSourceNotesSources(source: ImportSource): Record<string, unknown> {
	const parsed = readSourceJson(source.dataDir, "graph", "sources.json");
	if (!isRecord(parsed)) return {};
	return Object.fromEntries(Object.entries(parsed).filter(([, value]) => isNotesSource(value)));
}

function readSourceSettings(source: ImportSource): UserSettings | null {
	const settings = sanitizeUserSettings(readSourceJson(source.dataDir, "settings.json"));
	if (!settings) return null;
	// The custom endpoint's credential binding lives in auth.json and is
	// never imported, so its settings half would arrive unusable.
	delete settings.customProvider;
	return settings;
}

const settingsSections = (settings: UserSettings): string[] => Object.keys(settings).filter((key) => key !== "version");

/** The source's importable key variables: name → value. Callers expose names only. */
function readSourceKeys(source: ImportSource): { importable: Map<string, string>; other: number } {
	const importable = new Map<string, string>();
	let other = 0;
	const parsed = readSourceJson(source.parentDir, "auth.json");
	if (isRecord(parsed)) {
		for (const [name, value] of Object.entries(parsed)) {
			if (typeof value === "string" && value.trim() && isWritableAuthKey(name)) importable.set(name, value);
			else other++;
		}
	}
	return { importable, other };
}

/** Override files under the source's prompts/ mirror (root file + one level). */
function readSourcePrompts(source: ImportSource): string[] {
	const root = realpathOr(path.join(source.dataDir, "prompts"));
	if (!within(source.dataDir, root)) return [];
	const out: string[] = [];
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(root, { withFileTypes: true });
	} catch {
		return [];
	}
	for (const entry of entries) {
		if (entry.isFile() && isValidSegmentPath(entry.name)) out.push(entry.name);
		else if (entry.isDirectory()) {
			let files: string[] = [];
			try {
				files = fs.readdirSync(path.join(root, entry.name));
			} catch {
				/* unreadable folder: nothing to offer */
			}
			for (const file of files) if (isValidSegmentPath(`${entry.name}/${file}`)) out.push(`${entry.name}/${file}`);
		}
	}
	return out.filter((segment) => sourceFile(source.dataDir, "prompts", ...segment.split("/")) !== null).sort();
}

// ─── reading the target ─────────────────────────────────────────────────────

function targetRecordIds(dir: string): Set<string> {
	try {
		return new Set(fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5)));
	} catch {
		return new Set();
	}
}

const chainKey = (chain: GraphChain): string => `${[...chain.premises].sort().join("+")}>${chain.conclusion}`;

/** Guarded target graph read: a target stamped newer than this build refuses. */
function assertTargetGraph(): void {
	try {
		assertGraphFormat();
	} catch {
		throw new DataImportError(409, "graph_format_newer", "Kunnskapskartet i denne appen er lagret i et nyere format enn appen forstår. Oppdater appen før du importerer.");
	}
}

// ─── candidates and preview ─────────────────────────────────────────────────

function defaultUserDataRoots(): string[] {
	const home = os.homedir();
	const base = process.platform === "darwin"
		? path.join(home, "Library", "Application Support")
		: process.platform === "win32"
			? process.env.APPDATA ?? path.join(home, "AppData", "Roaming")
			: process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
	return ["LearnHarness", "LearnHarness-dev"].map((name) => path.join(base, name));
}

/** The desktop app's standard data locations on this machine that hold
 *  LearnHarness data. A candidate that IS this app's data directory is
 *  listed as `current` and offers no import. */
export function legacyDataCandidates(): ImportCandidate[] {
	const out: ImportCandidate[] = [];
	const seen = new Set<string>();
	for (const root of importSeams.userDataRoots ?? defaultUserDataRoots()) {
		let source: ImportSource;
		try {
			source = locateSource(root);
		} catch {
			continue; // absent or not a LearnHarness folder
		}
		if (seen.has(source.dataDir)) continue;
		seen.add(source.dataDir);
		const current = isCurrentDataDir(source.dataDir);
		const candidate: ImportCandidate = {
			path: root,
			label: path.basename(root).endsWith("-dev") ? "LearnHarness (utviklerbygg)" : "LearnHarness (skrivebordsappen)",
			current,
		};
		if (!current) {
			try {
				candidate.preview = buildPreview(source);
			} catch {
				/* listed without numbers; the preview call reports why */
			}
		}
		out.push(candidate);
	}
	return out;
}

/** What an import from `dir` would bring. Reads only; writes nothing. */
export function previewImport(dir: unknown): ImportPreview {
	const source = locateSource(dir);
	assertNotCurrent(source);
	return buildPreview(source);
}

function buildPreview(source: ImportSource): ImportPreview {
	assertTargetGraph();
	const chats = readSourceChats(source);
	const targetChats = targetRecordIds(PATHS.chats);
	const newChats = chats.readable.filter((chat) => !targetChats.has(chat.id));
	const chatsAfter = new Set([...targetChats, ...newChats.map((chat) => chat.id)]);
	const unsupported = chats.newer + chats.preNative + chats.corrupt;

	const jobs = readSourceJobs(source);
	const targetJobs = targetRecordIds(JOBS_DIR);

	const blocked = sourceGraphBlock(source);
	const nodes = readSourceLedger(source, "nodes.jsonl", isGraphNode);
	const chains = readSourceLedger(source, "chains.jsonl", isGraphChain);
	const notesSources = readSourceNotesSources(source);
	const targetNodeIds = new Set(stores.graphStore.readNodes().map((node) => node.id));
	const targetChainKeys = new Set(stores.graphStore.readChains().map(chainKey));
	const targetSourceIds = new Set(stores.graphStore.readSources().map((s) => s.id));
	const nodeIds = new Set(nodes.records.map((r) => r.value.id));
	const chainKeys = new Set(chains.records.map((r) => chainKey(r.value)));
	const sourceIds = Object.keys(notesSources);

	const settings = readSourceSettings(source);
	const keys = readSourceKeys(source);
	const targetKeys = authStore.authVars();
	const prompts = readSourcePrompts(source);

	const notes: string[] = [];
	if (chats.newer > 0) notes.push(`${chats.newer} ${chats.newer === 1 ? "økt er lagret" : "økter er lagret"} i et nyere format enn denne appen forstår og hoppes over.`);
	if (chats.preNative > 0) notes.push(`${chats.preNative} ${chats.preNative === 1 ? "økt er" : "økter er"} i et eldre format som ikke støttes og hoppes over.`);
	if (chats.corrupt > 0) notes.push(`${chats.corrupt} ${chats.corrupt === 1 ? "øktfil" : "øktfiler"} kan ikke leses og hoppes over.`);
	if (blocked) notes.push(blocked);
	const corruptLines = nodes.corrupt + chains.corrupt;
	if (corruptLines > 0) notes.push(`${corruptLines} ${corruptLines === 1 ? "skadet linje" : "skadde linjer"} i kunnskapskartet hoppes over.`);

	const preview: Omit<ImportPreview, "defaults"> = {
		dataDir: source.dataDir,
		chats: {
			total: chats.readable.length + unsupported,
			new: newChats.length,
			existing: chats.readable.length - newChats.length,
			unsupported,
			newTitles: newChats.slice(0, MAX_PREVIEW_TITLES).map((chat) => chat.title),
		},
		jobs: {
			total: jobs.length,
			new: jobs.filter(({ job }) => !targetJobs.has(job.id) && chatsAfter.has(job.chatId)).length,
		},
		graph: {
			present: nodeIds.size > 0 || chainKeys.size > 0 || sourceIds.length > 0,
			blocked,
			propositions: { total: nodeIds.size, new: [...nodeIds].filter((id) => !targetNodeIds.has(id)).length },
			chains: { total: chainKeys.size, new: [...chainKeys].filter((key) => !targetChainKeys.has(key)).length },
			sources: { total: sourceIds.length, new: sourceIds.filter((id) => !targetSourceIds.has(id)).length },
		},
		settings: { present: settings !== null, targetHasSettings: stores.settingsStore.readSettings() !== null },
		keys: {
			present: keys.importable.size > 0,
			variables: [...keys.importable.keys()].sort(),
			newVariables: [...keys.importable.keys()].filter((name) => targetKeys[name] === undefined).sort(),
		},
		prompts: { total: prompts.length, new: prompts.filter((segment) => promptOverrides.readOverride(segment) === null).length },
		notes,
	};
	return { ...preview, defaults: defaultImportInclude(preview) };
}

// ─── the import ─────────────────────────────────────────────────────────────

/** Why an import cannot start right now, or null. Live work only: a turn
 *  in flight, an executing background worker, or a registered extraction. */
function runningWorkReason(): string | null {
	if (extractionStatuses().length > 0) return "Et uttrekk til kunnskapskartet pågår. Prøv igjen når det er ferdig.";
	for (const id of targetRecordIds(PATHS.chats)) {
		if (isTurnRunning(id)) return "En økt holder på å svare. Prøv igjen når den er ferdig.";
	}
	for (const id of targetRecordIds(JOBS_DIR)) {
		if (isJobLive(id)) return "En bakgrunnsjobb kjører. Prøv igjen når den er ferdig.";
	}
	return null;
}

function writeAtomic(file: string, data: string | Buffer, mode?: number): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp-${crypto.randomUUID().slice(0, 8)}`;
	try {
		fs.writeFileSync(tmp, data, mode === undefined ? "utf-8" : { encoding: "utf-8", mode });
		fs.renameSync(tmp, file);
	} catch (err) {
		fs.rmSync(tmp, { force: true });
		throw err;
	}
}

/** The pre-import safety copy, taken lazily before the FIRST write so an
 *  import that changes nothing leaves no folder behind. */
function lazyBackup(): { ensure(): void; dir(): string | null } {
	let done = false;
	let dir: string | null = null;
	return {
		ensure() {
			if (done) return;
			done = true;
			const hasGraph = isDirectory(PATHS.graph);
			const hasSettings = fs.existsSync(SETTINGS_FILE);
			if (!hasGraph && !hasSettings) return;
			const stamp = new Date().toISOString().replace(/[:.]/g, "-");
			let target = path.join(PATHS.data, "backups", `import-${stamp}`);
			for (let n = 2; fs.existsSync(target); n++) target = path.join(PATHS.data, "backups", `import-${stamp}-${n}`);
			fs.mkdirSync(target, { recursive: true });
			if (hasGraph) fs.cpSync(PATHS.graph, path.join(target, "graph"), { recursive: true });
			if (hasSettings) fs.copyFileSync(SETTINGS_FILE, path.join(target, "settings.json"));
			dir = target;
		},
		dir: () => dir,
	};
}

/** Append the source lines the target ledger lacks (exact content dedup),
 *  as ONE temp-file + rename so a torn write can never truncate a ledger. */
function mergeLedger<T>(file: string, source: LedgerRead<T>, accept: (value: T) => boolean, beforeWrite: () => void): T[] {
	let existing = "";
	try {
		existing = fs.readFileSync(file, "utf-8");
	} catch {
		/* no ledger yet */
	}
	const have = new Set<string>();
	for (const line of existing.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		try {
			have.add(JSON.stringify(JSON.parse(trimmed)));
		} catch {
			/* a corrupt target line stays where it is, untouched */
		}
	}
	const added: T[] = [];
	const lines: string[] = [];
	for (const record of source.records) {
		if (have.has(record.key) || !accept(record.value)) continue;
		have.add(record.key); // also dedups repeats inside the source
		lines.push(record.key);
		added.push(record.value);
	}
	if (lines.length === 0) return added;
	beforeWrite();
	fs.mkdirSync(path.dirname(file), { recursive: true });
	ensureGraphFormat();
	const joint = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
	writeAtomic(file, `${existing}${joint}${lines.join("\n")}\n`);
	return added;
}

/** A job copied from another data folder must never be resumed here: the
 *  stale-job sweep (server/jobs.ts recoverStaleJobs) would re-run a
 *  "running" worker on the user's models and wake a turn for a pending
 *  delivery. Close such records in an honest terminal state instead. */
function settleImportedJob(job: JobRecord): JobRecord | null {
	if (job.status === "running") {
		const { delivery: _delivery, ...rest } = job;
		if (job.result === undefined || job.result === null) {
			return { ...rest, status: "error", activity: "avbrutt", error: "Jobben var ikke ferdig da dataene ble importert, og ble ikke fullført." };
		}
		let failed = false;
		try {
			failed = isSubagentFailure(job.kind, job.result as never);
		} catch {
			failed = true; // an unreadable result is not a success
		}
		return { ...rest, status: failed ? "error" : "done", activity: failed ? "mislyktes" : "ferdig" };
	}
	if (job.delivery?.status === "pending") {
		// The result stays on the record; it is just never auto-delivered.
		const { delivery: _delivery, ...rest } = job;
		return rest;
	}
	return null;
}

function mergeSourceOrganization(source: ImportSource, backup: () => void, skipped: ImportSkipped[]): ImportResult["graph"]["organization"] {
	const raw = readSourceJson(source.dataDir, "graph", "source-organization.json");
	if (raw === undefined) return "none";
	let incoming: SourceOrganization;
	try {
		incoming = parseSourceOrganization(raw);
	} catch {
		skipped.push({ what: "Mapper og navn på kilder", reason: "Filen i kildemappen er ugyldig eller nyere enn denne appen." });
		return "skipped";
	}
	if (!fs.existsSync(SOURCE_ORGANIZATION_FILE)) {
		if (incoming.folders.length === 0 && Object.keys(incoming.placements).length === 0) return "none";
		backup();
		stores.sourceOrganizationStore.write(incoming);
		return "copied";
	}
	let target: SourceOrganization;
	try {
		target = stores.sourceOrganizationStore.read();
	} catch {
		skipped.push({ what: "Mapper og navn på kilder", reason: "Denne appens egen organisering kunne ikke leses, så den ble ikke rørt." });
		return "skipped";
	}
	// Folder ids are random and stable, so a union by id is safe; the
	// target's own folders and placements always win.
	const folderIds = new Set(target.folders.map((folder) => folder.id));
	const folders = [...target.folders, ...incoming.folders.filter((folder) => !folderIds.has(folder.id))];
	const allFolderIds = new Set(folders.map((folder) => folder.id));
	const placements = { ...target.placements };
	let added = folders.length - target.folders.length;
	for (const [id, placement] of Object.entries(incoming.placements)) {
		if (Object.hasOwn(placements, id)) continue;
		if (placement.folderId !== null && !allFolderIds.has(placement.folderId)) continue;
		placements[id] = placement;
		added++;
	}
	if (added === 0) return "unchanged";
	let merged: SourceOrganization;
	try {
		merged = parseSourceOrganization({ version: 1, folders, placements });
	} catch {
		skipped.push({ what: "Mapper og navn på kilder", reason: "Organiseringen i kildemappen lot seg ikke flette trygt med din." });
		return "skipped";
	}
	backup();
	stores.sourceOrganizationStore.write(merged);
	return "merged";
}

/**
 * Run the import. Synchronous by design (see the module laws). Throws
 * DataImportError for refusals; any other error is an I/O failure that may
 * have left a partial (re-runnable) import.
 */
export function runImport(dir: unknown, includeRaw: unknown): ImportResult {
	const include: ImportInclude = parseImportInclude(includeRaw);
	const source = locateSource(dir);
	assertNotCurrent(source);
	if (!Object.values(include).some(Boolean)) {
		throw new DataImportError(400, "nothing_selected", "Velg minst én ting å importere.");
	}
	const busy = runningWorkReason();
	if (busy) throw new DataImportError(409, "work_running", busy);
	assertTargetGraph();
	const blocked = sourceGraphBlock(source);
	if (include.graph && blocked) throw new DataImportError(422, "source_format_newer", blocked);

	// THE SYNC BLOCK: no await from the gate above to the return below.
	const backup = lazyBackup();
	const skipped: ImportSkipped[] = [];
	const result: ImportResult = {
		dataDir: source.dataDir,
		backupDir: null,
		chats: { imported: 0, existing: 0, unsupported: 0 },
		jobs: { imported: 0, settled: 0 },
		graph: {
			propositions: 0, nodeLines: 0, chains: 0, chainLines: 0, coverage: 0, checkpoints: 0,
			sources: 0, positions: 0, organization: "none", renderSettings: false, corruptLines: 0,
		},
		settings: { outcome: "none", sections: [] },
		keys: { imported: 0, variables: [] },
		prompts: { imported: 0 },
		skipped,
		graphRevision: 0,
	};

	// ── sessions and their background jobs ──
	if (include.chats) {
		const chats = readSourceChats(source);
		const targetChats = targetRecordIds(PATHS.chats);
		for (const chat of chats.readable) {
			if (targetChats.has(chat.id)) {
				result.chats.existing++;
				continue;
			}
			backup.ensure();
			writeAtomic(path.join(PATHS.chats, `${chat.id}.json`), chat.text); // verbatim: the record is the user's
			result.chats.imported++;
		}
		result.chats.unsupported = chats.newer + chats.preNative + chats.corrupt;
		if (chats.newer > 0) skipped.push({ what: `${chats.newer} ${chats.newer === 1 ? "økt" : "økter"}`, reason: "Lagret i et nyere format enn denne appen forstår." });
		if (chats.preNative > 0) skipped.push({ what: `${chats.preNative} ${chats.preNative === 1 ? "økt" : "økter"}`, reason: "Eldre øktformat som ikke støttes." });
		if (chats.corrupt > 0) skipped.push({ what: `${chats.corrupt} ${chats.corrupt === 1 ? "øktfil" : "øktfiler"}`, reason: "Filen kunne ikke leses." });
		if (result.chats.existing > 0) skipped.push({ what: `${result.chats.existing} ${result.chats.existing === 1 ? "økt" : "økter"}`, reason: "Finnes allerede her og ble ikke overskrevet." });

		const chatsAfter = targetRecordIds(PATHS.chats);
		const targetJobs = targetRecordIds(JOBS_DIR);
		let orphanJobs = 0;
		for (const { job, text } of readSourceJobs(source)) {
			if (targetJobs.has(job.id)) continue;
			if (!chatsAfter.has(job.chatId)) {
				orphanJobs++;
				continue;
			}
			const settled = settleImportedJob(job);
			backup.ensure();
			writeAtomic(path.join(JOBS_DIR, `${job.id}.json`), settled ? JSON.stringify(settled, null, "\t") : text);
			result.jobs.imported++;
			if (settled) result.jobs.settled++;
		}
		if (orphanJobs > 0) skipped.push({ what: `${orphanJobs} ${orphanJobs === 1 ? "bakgrunnsjobb" : "bakgrunnsjobber"}`, reason: "Økta de tilhører ble ikke importert." });
		if (result.jobs.settled > 0) skipped.push({ what: `${result.jobs.settled} ${result.jobs.settled === 1 ? "uferdig bakgrunnsjobb" : "uferdige bakgrunnsjobber"}`, reason: "Importert som avsluttet. De startes ikke på nytt." });
	}

	// ── the knowledge graph ──
	if (include.graph) {
		const chatsAfter = targetRecordIds(PATHS.chats);
		const nodes = readSourceLedger(source, "nodes.jsonl", isGraphNode);
		const chains = readSourceLedger(source, "chains.jsonl", isGraphChain);
		const coverage = readSourceLedger(source, "coverage.jsonl", isCoverageEntry);
		const checkpoints = readSourceLedger(source, "sessions.jsonl", isCheckpoint);
		result.graph.corruptLines = nodes.corrupt + chains.corrupt + coverage.corrupt + checkpoints.corrupt;
		if (result.graph.corruptLines > 0) {
			skipped.push({ what: `${result.graph.corruptLines} ${result.graph.corruptLines === 1 ? "linje" : "linjer"} i kunnskapskartet`, reason: "Skadet eller ugyldig innhold." });
		}

		const nodeIdsBefore = new Set(stores.graphStore.readNodes().map((node) => node.id));
		const chainKeysBefore = new Set(stores.graphStore.readChains().map(chainKey));

		// Propositions before the chains that connect them.
		const addedNodes: GraphNode[] = mergeLedger(LEDGER_FILES.nodes, nodes, () => true, backup.ensure);
		const addedChains: GraphChain[] = mergeLedger(LEDGER_FILES.chains, chains, () => true, backup.ensure);
		result.graph.nodeLines = addedNodes.length;
		result.graph.propositions = new Set(addedNodes.map((node) => node.id).filter((id) => !nodeIdsBefore.has(id))).size;
		result.graph.chainLines = addedChains.length;
		result.graph.chains = new Set(addedChains.map(chainKey).filter((key) => !chainKeysBefore.has(key))).size;

		// Imported-notes bookkeeping: only source ids the target lacks.
		const incomingSources = readSourceNotesSources(source);
		let targetSources: Record<string, unknown> = {};
		try {
			const parsed: unknown = JSON.parse(fs.readFileSync(SOURCES_FILE, "utf-8"));
			if (isRecord(parsed)) targetSources = parsed;
		} catch {
			/* no sources.json yet */
		}
		const newSourceIds = Object.keys(incomingSources).filter((id) => !Object.hasOwn(targetSources, id));
		if (newSourceIds.length > 0) {
			backup.ensure();
			ensureGraphFormat();
			writeAtomic(SOURCES_FILE, JSON.stringify({ ...targetSources, ...Object.fromEntries(newSourceIds.map((id) => [id, incomingSources[id]])) }, null, "\t"));
			result.graph.sources = newSourceIds.length;
		}
		const notesIds = new Set([...Object.keys(targetSources), ...newSourceIds]);

		// Coverage and checkpoints LAST, and only for sessions that exist
		// here: coverage for an absent session would be a claim about a
		// transcript this app does not hold.
		let coverageOrphans = 0;
		const addedCoverage = mergeLedger(LEDGER_FILES.coverage, coverage, (entry) => {
			if (chatsAfter.has(entry.chatId)) return true;
			coverageOrphans++;
			return false;
		}, backup.ensure);
		const addedCheckpoints = mergeLedger(LEDGER_FILES.sessions, checkpoints, (entry) => chatsAfter.has(entry.chatId) || notesIds.has(entry.chatId), backup.ensure);
		result.graph.coverage = addedCoverage.length;
		result.graph.checkpoints = addedCheckpoints.length;
		if (coverageOrphans > 0) {
			skipped.push({ what: "Uttrekksdekning for økter som ikke finnes her", reason: "Dekning importeres bare sammen med økta den gjelder." });
		}

		// Provenance may now point at sessions this app does not hold. That
		// is safe (the graph reads treat them as missing sources) but worth
		// saying out loud.
		const unnamed = new Set<string>();
		for (const node of addedNodes) for (const point of node.provenance) {
			if (!chatsAfter.has(point.chatId) && !notesIds.has(point.chatId)) unnamed.add(point.chatId);
		}
		if (unnamed.size > 0) {
			skipped.push({
				what: `Øktnavn for ${unnamed.size} ${unnamed.size === 1 ? "kilde" : "kilder"} i kartet`,
				reason: include.chats ? "Økta finnes ikke i kildemappen lenger. Påstandene vises uten øktnavn." : "Øktene ble ikke importert. Påstandene vises uten øktnavn til du importerer øktene også.",
			});
		}

		// Resting positions: only for nodes the canvas knows and the target
		// has not placed. Anything still unplaced settles like after a merge.
		const view = new Set(deriveView(getGraph(stores.graphStore)).nodes.map((node) => node.id));
		const positions = stores.graphStore.readPositions();
		const incoming = readSourceJson(source.dataDir, "graph", "positions.json");
		const incomingPositions: Record<string, Position> = {};
		if (isRecord(incoming) && isRecord(incoming.positions)) {
			for (const [id, value] of Object.entries(incoming.positions)) {
				if (view.has(id) && !Object.hasOwn(positions, id) && isPosition(value)) incomingPositions[id] = { x: value.x, y: value.y };
			}
		}
		result.graph.positions = Object.keys(incomingPositions).length;
		if (result.graph.positions > 0) {
			backup.ensure();
			stores.graphStore.writePositions({ ...positions, ...incomingPositions });
		}
		const placed = { ...positions, ...incomingPositions };
		if ([...view].some((id) => !Object.hasOwn(placed, id))) {
			backup.ensure();
			settleGraphLayout(stores.graphStore);
		}

		result.graph.organization = mergeSourceOrganization(source, backup.ensure, skipped);

		if (!fs.existsSync(RENDER_SETTINGS_FILE)) {
			const render = readSourceJson(source.dataDir, "graph", "render-settings.json");
			if (render !== undefined) {
				backup.ensure();
				writeRenderSettings(render);
				result.graph.renderSettings = readRenderSettings() !== null;
			}
		}
	}

	// ── settings: whole record into an app without one, else missing sections only ──
	if (include.settings) {
		const incoming = readSourceSettings(source);
		if (incoming) {
			const current = stores.settingsStore.readSettings();
			if (current === null) {
				backup.ensure();
				stores.settingsStore.writeSettings(incoming);
				result.settings = { outcome: "copied", sections: settingsSections(incoming) };
			} else {
				const missing = settingsSections(incoming).filter((section) => current[section] === undefined);
				if (missing.length === 0) result.settings = { outcome: "unchanged", sections: [] };
				else {
					backup.ensure();
					stores.settingsStore.writeSettings({ ...current, ...Object.fromEntries(missing.map((section) => [section, incoming[section]])) });
					result.settings = { outcome: "merged", sections: missing };
				}
				if (missing.length < settingsSections(incoming).length) {
					skipped.push({ what: "Innstillinger du allerede har satt", reason: "Dine egne valg ble beholdt." });
				}
			}
		}
	}

	// ── API keys: only variables this app lacks, through the key seam (0600, shape gate) ──
	if (include.keys) {
		const keys = readSourceKeys(source);
		const have = authStore.authVars();
		let rejected = 0;
		for (const [name, value] of keys.importable) {
			if (have[name] !== undefined) continue;
			backup.ensure();
			if (saveKey(name, value).ok) result.keys.variables.push(name);
			else rejected++;
		}
		result.keys.variables.sort();
		result.keys.imported = result.keys.variables.length;
		const kept = [...keys.importable.keys()].filter((name) => have[name] !== undefined).length;
		if (kept > 0) skipped.push({ what: `${kept} ${kept === 1 ? "API-nøkkel" : "API-nøkler"}`, reason: "Du har allerede en nøkkel for samme leverandør." });
		if (rejected > 0) skipped.push({ what: `${rejected} ${rejected === 1 ? "API-nøkkel" : "API-nøkler"}`, reason: "Nøkkelen hadde et ugyldig format." });
		if (keys.other > 0) skipped.push({ what: "Egendefinert endepunkt og andre oppføringer i nøkkelfilen", reason: "Kopieres ikke. Sett dem opp på nytt under Innstillinger." });
	}

	// ── prompt override files the target lacks ──
	if (include.prompts) {
		let kept = 0;
		for (const segment of readSourcePrompts(source)) {
			if (promptOverrides.readOverride(segment) !== null) {
				kept++;
				continue;
			}
			const text = readSourceText(source.dataDir, "prompts", ...segment.split("/"));
			if (text === null) continue;
			backup.ensure();
			promptOverrides.writeOverride(segment, text);
			result.prompts.imported++;
		}
		if (kept > 0) skipped.push({ what: `${kept} ${kept === 1 ? "systeminstruks" : "systeminstrukser"}`, reason: "Du har allerede en egen versjon." });
		if (result.prompts.imported > 0 && result.settings.outcome !== "copied") {
			skipped.push({ what: "Aktivering av systeminstruksene", reason: "Filene er kopiert, men ikke slått på. Slå dem på under Innstillinger → Agent." });
		}
	}

	result.backupDir = backup.dir();
	result.graphRevision = graphRevision();

	// Notify after the writes landed: the same events the ordinary writers
	// send, so open windows refetch lists, sources and the graph.
	if (result.chats.imported > 0) emit("chats-changed", {});
	if (result.jobs.imported > 0) emit("jobs-changed", {});
	if (include.graph) {
		emit("sources-changed", {});
		emit("activity-changed", {});
	}
	return result;
}

// ─── HTTP mapping (the /api/import/legacy routes are thin) ──────────────────

function failureResponse(error: unknown): Response {
	if (error instanceof DataImportError) {
		return Response.json({ error: error.message, code: error.code }, { status: error.status });
	}
	// Never echo a raw error: paths are fine, but keep the surface uniform.
	console.error("[import] failed:", error instanceof Error ? error.message : error);
	return Response.json(
		{ error: "Importen stoppet på grunn av en uventet feil. Ingenting er slettet. Prøv igjen; det som alt er importert hoppes over.", code: "import_failed" },
		{ status: 500 },
	);
}

export function legacyImportCandidatesResponse(): Response {
	try {
		return Response.json({ candidates: legacyDataCandidates() });
	} catch (error) {
		return failureResponse(error);
	}
}

export function legacyImportPreviewResponse(body: unknown): Response {
	try {
		return Response.json(previewImport(isRecord(body) ? body.path : undefined));
	} catch (error) {
		return failureResponse(error);
	}
}

export function legacyImportRunResponse(body: unknown): Response {
	try {
		const record = isRecord(body) ? body : {};
		return Response.json(runImport(record.path, record.include));
	} catch (error) {
		return failureResponse(error);
	}
}
