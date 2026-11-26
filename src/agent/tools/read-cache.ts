import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../../config.ts";

/**
 * The read tool's RENDER CACHE (2026-11, token/time saving): a PDF's page
 * text and its rendered, tiled, model-ready page images — and a picture
 * file's tiles — are kept on disk per FILE CONTENT HASH, so the same PDF
 * is never parsed or rendered twice. Keyed by content (sha256), not path
 * or mtime: an edited file is a new key, a moved file still hits.
 *
 * Layout: <dir>/<sha256>/<entry>.json, one JSON per entry. Entries are
 * plain data (base64 images included) written atomically; a corrupt or
 * unreadable entry is a miss, never an error. The directory is pruned to
 * MAX_CACHE_BYTES, oldest file content first.
 *
 * Off in tests unless a test points `readCacheDir.current` at a temp dir.
 */

export const readCacheDir: { current: string | null } = {
	current: process.env.NODE_ENV === "test" ? null : path.join(PATHS.data, "cache", "read"),
};

/** Bump when the stored shape or the rendering/tiling rules change. */
export const READ_CACHE_VERSION = 1;
const MAX_CACHE_BYTES = 512 * 1024 * 1024;
const PRUNE_EVERY_MS = 10 * 60_000;
let lastPrune = 0;

export function contentHash(buffer: Uint8Array): string {
	return createHash("sha256").update(buffer).digest("hex");
}

function entryPath(hash: string, key: string): string | null {
	const dir = readCacheDir.current;
	if (!dir) return null;
	return path.join(dir, hash, `${key.replace(/[^A-Za-z0-9_.-]/g, "_")}.json`);
}

export function readCacheGet<T>(hash: string, key: string): T | null {
	const file = entryPath(hash, key);
	if (!file) return null;
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as { v?: unknown; value?: T };
		return parsed.v === READ_CACHE_VERSION && parsed.value !== undefined ? parsed.value : null;
	} catch {
		return null;
	}
}

export function readCacheSet(hash: string, key: string, value: unknown): void {
	const file = entryPath(hash, key);
	if (!file) return;
	try {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const tmp = `${file}.${process.pid}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify({ v: READ_CACHE_VERSION, value }));
		fs.renameSync(tmp, file);
		// The hash dir's mtime is its "last used" for pruning.
		const now = new Date();
		fs.utimesSync(path.dirname(file), now, now);
	} catch {
		return; // a cache that cannot write is just a cache that misses
	}
	pruneReadCache();
}

/** Keep the cache under its byte cap: whole file-content dirs go, least
 *  recently written first. Throttled; never throws. */
export function pruneReadCache(force = false): void {
	const dir = readCacheDir.current;
	if (!dir) return;
	const now = Date.now();
	if (!force && now - lastPrune < PRUNE_EVERY_MS) return;
	lastPrune = now;
	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => {
			const full = path.join(dir, e.name);
			let bytes = 0;
			for (const f of fs.readdirSync(full)) {
				try {
					bytes += fs.statSync(path.join(full, f)).size;
				} catch {
					/* raced with a write — skip */
				}
			}
			return { full, bytes, mtime: fs.statSync(full).mtimeMs };
		});
		let total = entries.reduce((sum, e) => sum + e.bytes, 0);
		for (const entry of entries.sort((a, b) => a.mtime - b.mtime)) {
			if (total <= MAX_CACHE_BYTES) break;
			fs.rmSync(entry.full, { recursive: true, force: true });
			total -= entry.bytes;
		}
	} catch {
		/* best effort */
	}
}
