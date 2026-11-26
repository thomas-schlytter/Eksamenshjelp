/**
 * The website's install scripts (site/install.sh, site/install.ps1) and the
 * setup prompts on site/index.html. Offline: the scripts run in dry-run mode
 * against a stored GitHub API answer (tests/fixtures/eksamenshjelp-release-latest.json,
 * asset names as electron-builder.yml emits them — see scripts/verify-release.ts),
 * and only their file choice and messages are checked. The PowerShell cases
 * need pwsh (present on GitHub's ubuntu runners) and are skipped without it.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { fillIndex, renderAll, renderPrompt } from "../scripts/build-site.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const installSh = path.join(repoRoot, "site", "install.sh");
const installPs1 = path.join(repoRoot, "site", "install.ps1");
const fixture = path.join(repoRoot, "tests", "fixtures", "eksamenshjelp-release-latest.json");
const DOWNLOAD = "https://github.com/thomas030505/Eksamenshjelp/releases/download/v0.7.0/";

type Release = { tag_name: string; assets: Array<{ name: string; browser_download_url: string }> };

function tempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "eksamenshjelp-install-"));
}

/** A copy of the fixture with only the assets `keep` accepts. */
function releaseFile(dir: string, keep: (name: string) => boolean, pretty = true): string {
	const release = JSON.parse(fs.readFileSync(fixture, "utf8")) as Release;
	release.assets = release.assets.filter((asset) => keep(asset.name));
	const file = path.join(dir, "release.json");
	fs.writeFileSync(file, pretty ? JSON.stringify(release, null, 2) : JSON.stringify(release));
	return file;
}

function runSh(env: Record<string, string>, home: string) {
	return spawnSync("bash", [installSh], {
		encoding: "utf8",
		env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", HOME: home, EKSAMENSHJELP_DRY_RUN: "1", ...env },
	});
}

describe("site/install.sh", () => {
	it("parses (bash -n)", () => {
		const result = spawnSync("bash", ["-n", installSh], { encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
	});

	it("picks the arm64 mac zip from the stored API answer", () => {
		const home = tempDir();
		const result = runSh({ EKSAMENSHJELP_OS: "Darwin", EKSAMENSHJELP_ARCH: "arm64", EKSAMENSHJELP_RELEASE_JSON: fixture }, home);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /Tørrkjøring/);
		assert.ok(result.stdout.includes(`Ville lastet ned: ${DOWNLOAD}Eksamenshjelp-0.7.0-arm64-mac.zip\n`), result.stdout);
		assert.match(result.stdout, /Versjon: 0\.7\.0\n/);
		assert.ok(result.stdout.includes(`Ville laget mappen: ${home}/Documents/Eksamenshjelp`), result.stdout);
		// A dry run changes nothing.
		assert.equal(fs.existsSync(path.join(home, "Documents")), false);
	});

	it("reads a minified API answer too", () => {
		const dir = tempDir();
		const file = releaseFile(dir, () => true, false);
		const result = runSh({ EKSAMENSHJELP_OS: "Darwin", EKSAMENSHJELP_ARCH: "arm64", EKSAMENSHJELP_RELEASE_JSON: file }, dir);
		assert.equal(result.status, 0, result.stderr);
		assert.ok(result.stdout.includes(`${DOWNLOAD}Eksamenshjelp-0.7.0-arm64-mac.zip\n`), result.stdout);
	});

	it("falls back to the dmg when the release has no zip", () => {
		const dir = tempDir();
		const file = releaseFile(dir, (name) => !name.includes("-mac.zip"));
		const result = runSh({ EKSAMENSHJELP_OS: "Darwin", EKSAMENSHJELP_ARCH: "arm64", EKSAMENSHJELP_RELEASE_JSON: file }, dir);
		assert.equal(result.status, 0, result.stderr);
		assert.ok(result.stdout.includes(`Ville lastet ned: ${DOWNLOAD}Eksamenshjelp-0.7.0-arm64.dmg\n`), result.stdout);
	});

	it("explains when the release has no mac file", () => {
		const dir = tempDir();
		const file = releaseFile(dir, (name) => name.endsWith(".exe"));
		const result = runSh({ EKSAMENSHJELP_OS: "Darwin", EKSAMENSHJELP_ARCH: "arm64", EKSAMENSHJELP_RELEASE_JSON: file }, dir);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Feil: Den siste utgivelsen \(0\.7\.0\) har ingen Mac-fil/);
	});

	it("refuses an Intel Mac with an honest message", () => {
		const home = tempDir();
		const result = runSh({ EKSAMENSHJELP_OS: "Darwin", EKSAMENSHJELP_ARCH: "x86_64", EKSAMENSHJELP_RELEASE_JSON: fixture }, home);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Feil: Denne Macen har Intel-prosessor/);
		assert.match(result.stderr, /Apple-brikke/);
	});

	it("points Windows and Linux users elsewhere", () => {
		const home = tempDir();
		const result = runSh({ EKSAMENSHJELP_OS: "Linux", EKSAMENSHJELP_RELEASE_JSON: fixture }, home);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Dette skriptet er for Mac/);
		assert.match(result.stderr, /install\.ps1/);
	});
});

const pwsh = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"], { encoding: "utf8" });
const hasPwsh = pwsh.status === 0;

function runPs1(env: Record<string, string>, home: string) {
	return spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", installPs1], {
		encoding: "utf8",
		env: {
			NODE_ENV: "test",
			PATH: process.env.PATH ?? "",
			HOME: home,
			USERPROFILE: home,
			LOCALAPPDATA: path.join(home, "AppData", "Local"),
			TEMP: home,
			EKSAMENSHJELP_DRY_RUN: "1",
			...env,
		},
	});
}

describe("site/install.ps1", { skip: hasPwsh ? false : "pwsh is not installed" }, () => {
	it("picks the x64 NSIS installer from the stored API answer", () => {
		const home = tempDir();
		const result = runPs1({ EKSAMENSHJELP_OS: "Windows", EKSAMENSHJELP_ARCH: "AMD64", EKSAMENSHJELP_RELEASE_JSON: fixture }, home);
		assert.equal(result.status, 0, result.stderr);
		assert.ok(result.stdout.includes(`Ville lastet ned: ${DOWNLOAD}Eksamenshjelp-0.7.0-x64-setup.exe`), result.stdout);
		assert.match(result.stdout, /Versjon: 0\.7\.0/);
		assert.doesNotMatch(result.stdout, /Feil:/);
	});

	it("refuses 32-bit Windows", () => {
		const home = tempDir();
		const result = runPs1({ EKSAMENSHJELP_OS: "Windows", EKSAMENSHJELP_ARCH: "x86", EKSAMENSHJELP_RELEASE_JSON: fixture }, home);
		assert.match(result.stdout, /Feil: Denne PC-en har 32-bits Windows/);
	});

	it("explains when the release has no Windows file", () => {
		const dir = tempDir();
		const file = releaseFile(dir, (name) => !name.endsWith(".exe"));
		const result = runPs1({ EKSAMENSHJELP_OS: "Windows", EKSAMENSHJELP_ARCH: "AMD64", EKSAMENSHJELP_RELEASE_JSON: file }, dir);
		assert.match(result.stdout, /Feil: Den siste utgivelsen \(0\.7\.0\) har ingen Windows-fil/);
	});
});

describe("site/install.ps1 text", () => {
	it("is plain ASCII (irm decodes GitHub Pages' answer without a charset)", () => {
		const bytes = fs.readFileSync(installPs1);
		const offending = [...bytes].findIndex((byte) => byte > 0x7e || (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d));
		assert.equal(offending, -1, `non-ASCII byte at offset ${offending}`);
	});
});

describe("setup prompts (site/prompts → site/index.html)", () => {
	it("index.html carries exactly the rendered prompts", () => {
		const html = fs.readFileSync(path.join(repoRoot, "site", "index.html"), "utf8");
		assert.equal(fillIndex(html, renderAll()), html, "run: node scripts/build-site.mjs");
	});

	it("each prompt runs exactly the one install command per OS", () => {
		const prompts = renderAll();
		assert.deepEqual(Object.keys(prompts).sort(), ["claude", "codex"]);
		for (const text of Object.values(prompts)) {
			assert.ok(text.includes("curl -fsSL https://thomas030505.github.io/Eksamenshjelp/install.sh | bash"));
			assert.ok(text.includes("irm https://thomas030505.github.io/Eksamenshjelp/install.ps1 | iex"));
			assert.doesNotMatch(text, /\{\{|\}\}/);
			assert.doesNotMatch(text, /git clone|npm /);
		}
	});

	it("rejects missing and unused template values", () => {
		assert.throws(() => renderPrompt("Hei {{navn}}", {}), /no value for \{\{navn\}\}/);
		assert.throws(() => renderPrompt("Hei", { navn: "x" }), /never used/);
		assert.equal(renderPrompt("Hei {{navn}}\n", { navn: "Kari" }), "Hei Kari");
	});
});
