/**
 * Release check (owner 2026-11-23: «Varsel med nedlastingslenke»).
 *
 * The installed app is ad-hoc signed (no Apple Developer ID), so Squirrel
 * cannot install updates. Instead the shell asks GitHub's public API for
 * the latest release and, when its tag is newer than the running version,
 * offers a link to the release page. No token, no download, no install.
 *
 * Pure helpers only (no Electron): electron/main.cjs owns timing, state
 * and IPC; tests exercise these directly.
 */

const RELEASES_REPO = "thomas030505/Eksamenshjelp";
const LATEST_RELEASE_API = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${RELEASES_REPO}/releases`;

const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

/** "v0.5.0" and "0.5.0" both parse; anything else is null. */
function parseVersion(value) {
	if (typeof value !== "string") return null;
	const match = SEMVER.exec(value.trim());
	if (!match) return null;
	return {
		core: [Number(match[1]), Number(match[2]), Number(match[3])],
		pre: match[4] ? match[4].split(".") : [],
	};
}

/** Semver precedence: <0, 0 or >0. Build metadata is ignored. */
function compareVersions(a, b) {
	for (let i = 0; i < 3; i++) {
		if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
	}
	// A release outranks any prerelease of the same core version.
	if (!a.pre.length || !b.pre.length) return b.pre.length - a.pre.length;
	for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
		const x = a.pre[i];
		const y = b.pre[i];
		if (x === undefined) return -1;
		if (y === undefined) return 1;
		const xNum = /^\d+$/.test(x);
		const yNum = /^\d+$/.test(y);
		if (xNum && yNum) {
			if (Number(x) !== Number(y)) return Number(x) - Number(y);
		} else if (xNum !== yNum) {
			return xNum ? -1 : 1;
		} else if (x !== y) {
			return x < y ? -1 : 1;
		}
	}
	return 0;
}

/** True only when both parse and `candidate` is strictly newer. */
function isNewerVersion(candidate, current) {
	const a = parseVersion(candidate);
	const b = parseVersion(current);
	return !!a && !!b && compareVersions(a, b) > 0;
}

/** The release page is built from our own constant, never from the API's
 * URLs: the renderer only ever opens a github.com page for this repo. */
function releasePageFor(tag) {
	return `${RELEASES_PAGE}/tag/${encodeURIComponent(tag)}`;
}

/**
 * Interpret the API's /releases/latest answer.
 *  - 404: the repo has no published release yet → nothing newer.
 *  - any other non-2xx, unreadable body or unparseable tag → throws.
 * Returns { newer: false } or { newer: true, version, url }.
 */
async function readLatestRelease(response, currentVersion) {
	if (response.status === 404) return { newer: false };
	if (!response.ok) throw new Error(`release check: HTTP ${response.status}`);
	const body = await response.json();
	const tag = body && typeof body.tag_name === "string" ? body.tag_name : null;
	const parsed = parseVersion(tag);
	if (!parsed) throw new Error("release check: missing or invalid tag_name");
	if (!isNewerVersion(tag, currentVersion)) return { newer: false };
	return { newer: true, version: parsed.core.join(".") + (parsed.pre.length ? `-${parsed.pre.join(".")}` : ""), url: releasePageFor(tag) };
}

module.exports = {
	RELEASES_REPO,
	LATEST_RELEASE_API,
	RELEASES_PAGE,
	parseVersion,
	compareVersions,
	isNewerVersion,
	releasePageFor,
	readLatestRelease,
};
