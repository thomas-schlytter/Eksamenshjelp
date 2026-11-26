/**
 * «Oppdater nå» (owner 2026-11-26): one click downloads the newest release
 * for this machine, checks it against the release's own sha512 list, and
 * installs it.
 *
 *   macOS arm64  Eksamenshjelp-<v>-arm64-mac.zip (the .dmg is the reserve),
 *                checked against latest-mac.yml, unpacked with ditto. A
 *                detached /bin/sh helper waits for this process to exit,
 *                swaps the .app bundle (old one kept as a backup and put
 *                back if anything fails), clears quarantine and opens the
 *                new app.
 *   Windows x64  Eksamenshjelp-<v>-x64-setup.exe, checked against
 *                latest.yml, started silently and detached with the same
 *                arguments electron-updater's NsisUpdater uses
 *                (--updated /S --force-run): the one-click NSIS installer
 *                closes the old app, replaces the files and starts it again.
 *   Everything else (Linux, dev, unpackaged): no install; the renderer keeps
 *                «Last ned», which opens the release page.
 *
 * The same file choice as site/install.sh and site/install.ps1. User data
 * lives in userData, outside the bundle and the install folder; nothing here
 * touches it. Any failure before the hand-off leaves the app unchanged and
 * reports a short Norwegian message (the renderer adds «Last ned selv»).
 *
 * No Electron in this file: electron/main.cjs passes app/quit/report in,
 * and tests drive every step with fakes.
 */

const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { Readable, Transform } = require("node:stream");
const { RELEASES_REPO, isNewerVersion } = require("./release-check.cjs");

const APP_NAME = "Eksamenshjelp";
const DOWNLOAD_PREFIX = `https://github.com/${RELEASES_REPO}/releases/download/`;
/** One fixed scratch folder under the OS temp dir: emptied before each
 * install and at startup, so an interrupted update never piles up. */
const WORK_DIR_NAME = "eksamenshjelp-update";
const HELPER_LOG_NAME = "eksamenshjelp-update.log";
/** electron-updater NsisUpdater.doInstall with isSilent + isForceRunAfter.
 * app-builder-lib's NSIS template reads them as flags: --updated (skip the
 * "app is running" prompt, let the old app exit), /S (silent), --force-run
 * (start the app again after a silent one-click install). */
const WINDOWS_INSTALLER_ARGS = Object.freeze(["--updated", "/S", "--force-run"]);
const DOWNLOAD_IDLE_TIMEOUT_MS = 60 * 1000;
const API_TIMEOUT_MS = 15 * 1000;

const MESSAGES = Object.freeze({
	api: "Fikk ikke kontakt med GitHub. Prøv igjen senere.",
	noNewer: "Fant ingen nyere versjon å installere.",
	noFile: "Den nye versjonen har ingen fil for denne maskinen.",
	notWritable: "Appen kan ikke oppdatere seg selv i mappen den ligger i.",
	network: "Nedlastingen stoppet. Sjekk nettforbindelsen.",
	noChecksum: "Kunne ikke kontrollere nedlastingen, så den ble ikke installert.",
	checksum: "Nedlastingen stemte ikke med utgivelsen, så den ble ikke installert.",
	generic: "Oppdateringen stoppet. Appen er uendret.",
});

/** A failure with the message the user sees; `detail` goes to the log only. */
class UpdateFailure extends Error {
	constructor(userMessage, detail) {
		super(detail ?? userMessage);
		this.userMessage = userMessage;
	}
}

/** "mac" | "win" | null. Only the builds electron-builder.yml ships, and
 * only a packaged app outside the dev shell. */
function installTargetFor({ platform, arch, packaged, devUrl }) {
	if (!packaged || devUrl) return null;
	if (platform === "darwin" && arch === "arm64") return "mac";
	if (platform === "win32" && arch === "x64") return "win";
	return null;
}

const ASSET_PATTERNS = {
	mac: [
		{ kind: "zip", pattern: new RegExp(`^${APP_NAME}-[^/]*-arm64-mac\\.zip$`) },
		{ kind: "dmg", pattern: new RegExp(`^${APP_NAME}-[^/]*-arm64\\.dmg$`) },
	],
	win: [{ kind: "exe", pattern: new RegExp(`^${APP_NAME}-[^/]*-x64-setup\\.exe$`) }],
};
const CHECKSUM_FILES = { mac: "latest-mac.yml", win: "latest.yml" };

/** Only this repo's release downloads (or, in the LH_UPDATE_FEED drill,
 * the feed's own origin). The API is trusted for names, not for hosts. */
function isAllowedDownload(url, feedUrl) {
	if (typeof url !== "string") return false;
	if (url.startsWith(DOWNLOAD_PREFIX)) return true;
	if (!feedUrl) return false;
	try {
		return new URL(url).origin === new URL(feedUrl).origin;
	} catch {
		return false;
	}
}

function usableAssets(assets, feedUrl) {
	if (!Array.isArray(assets)) return [];
	return assets.filter((asset) =>
		asset && typeof asset.name === "string" && !asset.name.includes("/") && !asset.name.includes("\\")
		&& isAllowedDownload(asset.browser_download_url, feedUrl));
}

/** The file for this machine: { name, url, size, kind } or null. */
function pickAsset(assets, target, feedUrl) {
	const usable = usableAssets(assets, feedUrl);
	for (const { kind, pattern } of ASSET_PATTERNS[target] ?? []) {
		const asset = usable.find((candidate) => pattern.test(candidate.name));
		if (asset) {
			return { name: asset.name, url: asset.browser_download_url, size: Number.isFinite(asset.size) ? asset.size : null, kind };
		}
	}
	return null;
}

/** latest-mac.yml / latest.yml from the same release, or null. */
function pickChecksumAsset(assets, target, feedUrl) {
	const asset = usableAssets(assets, feedUrl).find((candidate) => candidate.name === CHECKSUM_FILES[target]);
	return asset ? { name: asset.name, url: asset.browser_download_url } : null;
}

function unquote(value) {
	const trimmed = value.trim();
	if (trimmed.length >= 2 && ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"')))) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

/**
 * The `files:` list of electron-builder's update info (latest*.yml):
 *   files:
 *     - url: Eksamenshjelp-0.7.0-arm64-mac.zip
 *       sha512: <base64>
 *       size: 123
 * A narrow reader for exactly that shape (no YAML dependency). Returns
 * [{ url, sha512, size }]; the legacy top-level path/sha512 is ignored.
 */
function parseUpdateInfo(text) {
	if (typeof text !== "string") return [];
	const files = [];
	let inFiles = false;
	let current = null;
	for (const raw of text.split(/\r?\n/)) {
		if (!raw.trim() || raw.trim().startsWith("#")) continue;
		if (/^\S/.test(raw)) {
			inFiles = /^files:\s*$/.test(raw);
			current = null;
			continue;
		}
		if (!inFiles) continue;
		const item = /^\s*-\s+(\w+):\s*(.*)$/.exec(raw);
		const field = item ?? /^\s+(\w+):\s*(.*)$/.exec(raw);
		if (!field) continue;
		if (item) {
			current = {};
			files.push(current);
		}
		if (!current) continue;
		const [, key, value] = field;
		if (key === "url" || key === "sha512") current[key] = unquote(value);
		else if (key === "size") current.size = Number(unquote(value));
	}
	return files.filter((file) => typeof file.url === "string" && typeof file.sha512 === "string");
}

/** The base64 sha512 the update info lists for `fileName`, or null. */
function expectedSha512(files, fileName) {
	const entry = files.find((file) => {
		try {
			return decodeURIComponent(path.posix.basename(file.url)) === fileName;
		} catch {
			return false;
		}
	});
	return entry && /^[A-Za-z0-9+/]{86}==$/.test(entry.sha512) ? entry.sha512 : null;
}

function sha512Matches(actual, expected) {
	if (typeof actual !== "string" || typeof expected !== "string") return false;
	const a = Buffer.from(actual);
	const b = Buffer.from(expected);
	return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Stream `url` to `dest`, hashing as it goes. onProgress gets whole
 * percents (only on change), or null when the size is unknown. A stall of
 * DOWNLOAD_IDLE_TIMEOUT_MS aborts. Returns { sha512, size }.
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {string} dest
 * @param {{ expectedSize?: number | null, onProgress?: (percent: number | null) => void, headers?: Record<string, string>, idleTimeoutMs?: number }} [options]
 * @returns {Promise<{ sha512: string, size: number }>} */
async function downloadFile(fetchImpl, url, dest, { expectedSize = null, onProgress = () => {}, headers = {}, idleTimeoutMs = DOWNLOAD_IDLE_TIMEOUT_MS } = {}) {
	const controller = new AbortController();
	let idle = null;
	const touch = () => {
		clearTimeout(idle);
		idle = setTimeout(() => controller.abort(new Error("download stalled")), idleTimeoutMs);
	};
	touch();
	try {
		const response = await fetchImpl(url, { headers, redirect: "follow", signal: controller.signal });
		if (!response.ok || !response.body) throw new Error(`download: HTTP ${response.status}`);
		const length = Number(response.headers?.get?.("content-length"));
		const total = Number.isFinite(length) && length > 0 ? length : expectedSize;
		const hash = crypto.createHash("sha512");
		let received = 0;
		let lastPercent = -1;
		onProgress(total ? 0 : null);
		const meter = new Transform({
			transform(chunk, _encoding, callback) {
				touch();
				hash.update(chunk);
				received += chunk.length;
				if (total) {
					const percent = Math.min(100, Math.floor((received * 100) / total));
					if (percent !== lastPercent) {
						lastPercent = percent;
						onProgress(percent);
					}
				}
				callback(null, chunk);
			},
		});
		await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(dest), { signal: controller.signal });
		return { sha512: hash.digest("base64"), size: received };
	} finally {
		clearTimeout(idle);
	}
}

/** <bundle>.app from <bundle>.app/Contents/MacOS/<exe>, or null. */
function macBundleFromExecPath(execPath) {
	if (typeof execPath !== "string" || !path.isAbsolute(execPath)) return null;
	const macos = path.dirname(execPath);
	const contents = path.dirname(macos);
	const bundle = path.dirname(contents);
	if (path.basename(macos) !== "MacOS" || path.basename(contents) !== "Contents" || !bundle.endsWith(".app")) return null;
	return bundle;
}

/** The swap needs to rename the bundle inside its folder. A translocated
 * (read-only, randomized) copy or a folder this user cannot write fails. */
function macBundleWritable(bundle, fsImpl = fs) {
	if (!bundle || bundle.includes("/AppTranslocation/")) return false;
	try {
		fsImpl.accessSync(path.dirname(bundle), fs.constants.W_OK);
		fsImpl.accessSync(bundle, fs.constants.W_OK);
		return true;
	} catch {
		return false;
	}
}

/** Single-quote for /bin/sh. */
function shellQuote(value) {
	return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function assertSafePath(value, label) {
	if (typeof value !== "string" || !path.isAbsolute(value) || path.resolve(value) !== value || value === "/" || /[\0\n\r]/.test(value)) {
		throw new Error(`unsafe ${label}: ${value}`);
	}
}

/**
 * The macOS helper. Waits (up to 2 minutes) for `pid` to exit, then:
 *   mv target → backup (same folder, so a rename), mv staged → target,
 *   checks the new executable exists, clears quarantine, removes the backup
 *   and the work folder, opens the new app.
 * If the new app cannot be put in place, it removes what landed, moves the
 * backup back and opens the old app. If the app never exits, nothing moves.
 */
function macSwapScript({ pid, target, staged, backup, workDir, executable }) {
	if (!Number.isInteger(pid) || pid <= 0) throw new Error(`invalid pid: ${pid}`);
	for (const [label, value] of [["target", target], ["staged", staged], ["backup", backup], ["workDir", workDir]]) assertSafePath(value, label);
	if (!target.endsWith(".app") || !staged.endsWith(".app")) throw new Error("target and staged must be .app bundles");
	if (path.dirname(backup) !== path.dirname(target) || backup === target) throw new Error("backup must sit beside the target");
	if (!staged.startsWith(`${workDir}/`)) throw new Error("staged app must be inside the work folder");
	if (typeof executable !== "string" || !executable || executable.includes("/")) throw new Error(`invalid executable: ${executable}`);
	return `#!/bin/sh
# Eksamenshjelp: «Oppdater nå». Written by the app; runs after it quits.
PID=${pid}
TARGET=${shellQuote(target)}
STAGED=${shellQuote(staged)}
BACKUP=${shellQuote(backup)}
WORK=${shellQuote(workDir)}
EXE=${shellQuote(executable)}

finish() {
	rm -rf "$WORK"
	open "$TARGET"
	exit "$1"
}

i=0
while kill -0 "$PID" 2>/dev/null; do
	i=$((i + 1))
	if [ "$i" -gt 240 ]; then
		echo "the app did not quit; nothing was changed"
		rm -rf "$WORK"
		exit 1
	fi
	sleep 0.5
done
# Let the app's child processes finish exiting.
sleep 1

if ! mv "$TARGET" "$BACKUP"; then
	echo "could not move the old app aside; nothing was changed"
	finish 1
fi

if mv "$STAGED" "$TARGET" && [ -x "$TARGET/Contents/MacOS/$EXE" ]; then
	xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true
	rm -rf "$BACKUP"
	echo "updated"
	finish 0
fi

echo "the new app could not be put in place; restoring the old one"
rm -rf "$TARGET"
if ! mv "$BACKUP" "$TARGET"; then
	echo "restore failed; the old app is at $BACKUP"
	rm -rf "$WORK"
	exit 1
fi
finish 1
`;
}

function execFileAsync(execFileImpl, file, args) {
	return new Promise((resolve, reject) => {
		execFileImpl(file, args, (err) => (err ? reject(err) : resolve()));
	});
}

/** Spawn detached and resolve once the OS has started it (or reject). */
function spawnDetached(spawnImpl, file, args, options = {}) {
	return new Promise((resolve, reject) => {
		let child;
		try {
			child = spawnImpl(file, args, { detached: true, stdio: "ignore", ...options });
		} catch (err) {
			reject(err);
			return;
		}
		child.once("error", reject);
		child.once("spawn", () => {
			child.unref();
			resolve(child);
		});
	});
}

/**
 * The installer. Dependencies are injected so tests can fake them; main.cjs
 * passes the real modules. install() never rejects: every outcome is a
 * report() call ({ phase: "downloading", percent } → { phase: "installing" }
 * → quit, or { phase: "failed", message }).
 */
function createUpdateInstaller({
	target,
	currentVersion,
	apiUrl,
	feedUrl = null,
	userAgent,
	tmpRoot,
	execPath,
	pid,
	report,
	quit,
	log = () => {},
	fetchImpl = fetch,
	spawnImpl = childProcess.spawn,
	execFileImpl = childProcess.execFile,
	fsImpl = fs,
}) {
	const workDir = path.join(tmpRoot, WORK_DIR_NAME);
	let running = null;

	const clearWorkDir = () => {
		try {
			fsImpl.rmSync(workDir, { recursive: true, force: true });
		} catch (err) {
			log(`update: could not clear ${workDir}: ${err?.message ?? err}`);
		}
	};

	async function fetchJSON(url) {
		let response;
		try {
			response = await fetchImpl(url, {
				headers: { Accept: "application/vnd.github+json", "User-Agent": userAgent },
				signal: AbortSignal.timeout(API_TIMEOUT_MS),
			});
		} catch (err) {
			throw new UpdateFailure(MESSAGES.api, `release lookup: ${err?.message ?? err}`);
		}
		if (!response.ok) throw new UpdateFailure(MESSAGES.api, `release lookup: HTTP ${response.status}`);
		try {
			return await response.json();
		} catch {
			throw new UpdateFailure(MESSAGES.api, "release lookup: unreadable body");
		}
	}

	async function fetchText(url) {
		try {
			const response = await fetchImpl(url, { headers: { "User-Agent": userAgent }, redirect: "follow", signal: AbortSignal.timeout(API_TIMEOUT_MS) });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return await response.text();
		} catch (err) {
			throw new UpdateFailure(MESSAGES.noChecksum, `checksum file: ${err?.message ?? err}`);
		}
	}

	async function unpackMac(file, kind) {
		const out = path.join(workDir, "ut");
		fsImpl.mkdirSync(out, { recursive: true });
		const staged = path.join(out, `${APP_NAME}.app`);
		if (kind === "zip") {
			await execFileAsync(execFileImpl, "/usr/bin/ditto", ["-x", "-k", file, out]);
		} else {
			const mount = path.join(workDir, "mnt");
			fsImpl.mkdirSync(mount, { recursive: true });
			await execFileAsync(execFileImpl, "/usr/bin/hdiutil", ["attach", "-nobrowse", "-readonly", "-quiet", "-mountpoint", mount, file]);
			try {
				await execFileAsync(execFileImpl, "/usr/bin/ditto", [path.join(mount, `${APP_NAME}.app`), staged]);
			} finally {
				await execFileAsync(execFileImpl, "/usr/bin/hdiutil", ["detach", "-quiet", mount]).catch(() => {});
			}
		}
		const executable = path.basename(execPath);
		if (!fsImpl.existsSync(path.join(staged, "Contents", "MacOS", executable))) {
			throw new Error(`unpacked app has no Contents/MacOS/${executable}`);
		}
		return staged;
	}

	async function handOffMac(bundle, staged) {
		const stamp = Date.now();
		const script = macSwapScript({
			pid,
			target: bundle,
			staged,
			backup: path.join(path.dirname(bundle), `.${path.basename(bundle)}.old-${stamp}`),
			workDir,
			executable: path.basename(execPath),
		});
		const scriptPath = path.join(workDir, "swap.sh");
		fsImpl.writeFileSync(scriptPath, script, { mode: 0o700 });
		const logFd = fsImpl.openSync(path.join(tmpRoot, HELPER_LOG_NAME), "w");
		try {
			await spawnDetached(spawnImpl, "/bin/sh", [scriptPath], { stdio: ["ignore", logFd, logFd] });
		} finally {
			try { fsImpl.closeSync(logFd); } catch { /* the child holds its own copy */ }
		}
	}

	async function run() {
		report({ phase: "downloading", percent: null });
		try {
			if (!target) throw new UpdateFailure(MESSAGES.noFile, "no install target for this machine");
			const bundle = target === "mac" ? macBundleFromExecPath(execPath) : null;
			if (target === "mac" && !macBundleWritable(bundle, fsImpl)) {
				throw new UpdateFailure(MESSAGES.notWritable, `bundle not writable: ${bundle ?? execPath}`);
			}

			const release = await fetchJSON(apiUrl);
			const tag = typeof release?.tag_name === "string" ? release.tag_name : null;
			if (!tag || !isNewerVersion(tag, currentVersion)) throw new UpdateFailure(MESSAGES.noNewer, `latest is ${tag}`);
			const asset = pickAsset(release.assets, target, feedUrl);
			if (!asset) throw new UpdateFailure(MESSAGES.noFile, `no ${target} asset in ${tag}`);
			const sums = pickChecksumAsset(release.assets, target, feedUrl);
			if (!sums) throw new UpdateFailure(MESSAGES.noChecksum, `no ${CHECKSUM_FILES[target]} in ${tag}`);
			const expected = expectedSha512(parseUpdateInfo(await fetchText(sums.url)), asset.name);
			if (!expected) throw new UpdateFailure(MESSAGES.noChecksum, `${sums.name} lists no sha512 for ${asset.name}`);

			clearWorkDir();
			fsImpl.mkdirSync(workDir, { recursive: true });
			const file = path.join(workDir, asset.name);
			log(`update: downloading ${asset.name} (${tag})`);
			let downloaded;
			try {
				downloaded = await downloadFile(fetchImpl, asset.url, file, {
					expectedSize: asset.size,
					headers: { "User-Agent": userAgent },
					onProgress: (percent) => report({ phase: "downloading", percent }),
				});
			} catch (err) {
				throw new UpdateFailure(MESSAGES.network, `download: ${err?.message ?? err}`);
			}
			if (!sha512Matches(downloaded.sha512, expected)) {
				throw new UpdateFailure(MESSAGES.checksum, `sha512 mismatch for ${asset.name}`);
			}

			report({ phase: "installing" });
			if (target === "mac") {
				const staged = await unpackMac(file, asset.kind);
				await handOffMac(bundle, staged);
			} else {
				await spawnDetached(spawnImpl, file, [...WINDOWS_INSTALLER_ARGS]);
			}
			log(`update: ${tag} handed off; quitting`);
			quit();
		} catch (err) {
			log(`update failed: ${err?.message ?? err}`);
			clearWorkDir();
			report({ phase: "failed", message: err instanceof UpdateFailure ? err.userMessage : MESSAGES.generic });
		}
	}

	return {
		workDir,
		/** Shares one run; a second click while it runs is the same promise. */
		install() {
			if (!running) running = run().finally(() => { running = null; });
			return running;
		},
		/** Startup: remove what an earlier update left behind. */
		cleanup: clearWorkDir,
	};
}

module.exports = {
	APP_NAME,
	DOWNLOAD_PREFIX,
	WORK_DIR_NAME,
	WINDOWS_INSTALLER_ARGS,
	MESSAGES,
	installTargetFor,
	isAllowedDownload,
	pickAsset,
	pickChecksumAsset,
	parseUpdateInfo,
	expectedSha512,
	sha512Matches,
	downloadFile,
	macBundleFromExecPath,
	macBundleWritable,
	shellQuote,
	macSwapScript,
	createUpdateInstaller,
};
