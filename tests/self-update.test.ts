/**
 * «Oppdater nå» (electron/self-update.cjs): file choice, latest*.yml
 * parsing, sha512 control, the macOS swap helper (run for real with sh in
 * temp folders, with `open`/`xattr` stubbed on PATH), the Windows installer
 * arguments, and the whole install flow with fake network/spawn. No
 * Electron, no network, nothing outside os.tmpdir() is touched.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, after } from "node:test";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const selfUpdate = require("../electron/self-update.cjs") as typeof import("../electron/self-update.cjs");
const releaseFixture = JSON.parse(fs.readFileSync(path.join(repoRoot, "tests", "fixtures", "eksamenshjelp-release-latest.json"), "utf8")) as Release;

type Asset = { name: string; browser_download_url: string; size?: number };
type Release = { tag_name: string; assets: Asset[] };
type InstallReport = { phase: string; percent?: number | null; message?: string };

const temps: string[] = [];
function tempDir() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eksamenshjelp-selfupdate-test-"));
	temps.push(dir);
	return fs.realpathSync(dir);
}
after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });

const sha512 = (data: Buffer | string) => createHash("sha512").update(data).digest("base64");
const DOWNLOAD = "https://github.com/thomas-schlytter/Eksamenshjelp/releases/download/v0.7.0/";

function release(keep: (name: string) => boolean = () => true): Release {
	return { ...releaseFixture, assets: releaseFixture.assets.filter((asset) => keep(asset.name)) };
}

function updateInfo(entries: { url: string; sha512: string; size?: number }[]) {
	return [
		"version: 0.7.0",
		"files:",
		...entries.flatMap((entry) => [`  - url: ${entry.url}`, `    sha512: ${entry.sha512}`, `    size: ${entry.size ?? 1}`]),
		`path: ${entries[0]?.url ?? "x"}`,
		`sha512: ${entries[0]?.sha512 ?? "x"}`,
		"releaseDate: '2026-11-20T10:00:00.000Z'",
		"",
	].join("\n");
}

describe("install target", () => {
	it("installs only on the shipped builds, packaged and outside the dev shell", () => {
		const target = (platform: string, arch: string, packaged = true, devUrl?: string) => selfUpdate.installTargetFor({ platform, arch, packaged, devUrl });
		assert.equal(target("darwin", "arm64"), "mac");
		assert.equal(target("win32", "x64"), "win");
		assert.equal(target("darwin", "x64"), null, "no Intel Mac build");
		assert.equal(target("win32", "arm64"), null, "only the x64 build is shipped");
		assert.equal(target("win32", "ia32"), null);
		assert.equal(target("linux", "x64"), null, "Linux keeps «Last ned»");
		assert.equal(target("darwin", "arm64", false), null, "unpackaged");
		assert.equal(target("win32", "x64", true, "http://127.0.0.1:3000"), null, "LH_DEV_URL");
	});
});

describe("file choice (same rules as site/install.sh and site/install.ps1)", () => {
	it("mac takes the arm64 zip, with the dmg as reserve", () => {
		assert.deepEqual(selfUpdate.pickAsset(release().assets, "mac"), {
			name: "Eksamenshjelp-0.7.0-arm64-mac.zip", url: `${DOWNLOAD}Eksamenshjelp-0.7.0-arm64-mac.zip`, size: 1002, kind: "zip",
		});
		const dmgOnly = release((name) => !name.endsWith("-mac.zip"));
		assert.deepEqual(selfUpdate.pickAsset(dmgOnly.assets, "mac"), {
			name: "Eksamenshjelp-0.7.0-arm64.dmg", url: `${DOWNLOAD}Eksamenshjelp-0.7.0-arm64.dmg`, size: 1000, kind: "dmg",
		});
		assert.equal(selfUpdate.pickAsset(release((name) => !name.includes("arm64") || name.endsWith(".blockmap")).assets, "mac"), null, "blockmaps are never picked");
	});

	it("Windows takes the x64 setup.exe; other machines get nothing", () => {
		assert.equal(selfUpdate.pickAsset(release().assets, "win")?.name, "Eksamenshjelp-0.7.0-x64-setup.exe");
		assert.equal(selfUpdate.pickAsset(release((name) => !name.endsWith("setup.exe")).assets, "win"), null);
		assert.equal(selfUpdate.pickAsset(release().assets, "linux"), null);
		assert.equal(selfUpdate.pickAsset(null, "mac"), null);
	});

	it("the checksum file comes from the same release", () => {
		assert.equal(selfUpdate.pickChecksumAsset(release().assets, "mac")?.url, `${DOWNLOAD}latest-mac.yml`);
		assert.equal(selfUpdate.pickChecksumAsset(release().assets, "win")?.url, `${DOWNLOAD}latest.yml`);
		assert.equal(selfUpdate.pickChecksumAsset(release((name) => name !== "latest.yml").assets, "win"), null);
	});

	it("downloads only from this repo's releases (or the drill feed's own origin)", () => {
		const foreign = [{ name: "Eksamenshjelp-0.7.0-arm64-mac.zip", browser_download_url: "https://evil.invalid/Eksamenshjelp-0.7.0-arm64-mac.zip" }];
		assert.equal(selfUpdate.pickAsset(foreign, "mac"), null);
		const otherRepo = [{ name: "Eksamenshjelp-0.7.0-arm64-mac.zip", browser_download_url: "https://github.com/someone/Eksamenshjelp/releases/download/v0.7.0/Eksamenshjelp-0.7.0-arm64-mac.zip" }];
		assert.equal(selfUpdate.pickAsset(otherRepo, "mac"), null);
		const local = [{ name: "Eksamenshjelp-0.7.0-arm64-mac.zip", browser_download_url: "http://127.0.0.1:8123/Eksamenshjelp-0.7.0-arm64-mac.zip" }];
		assert.equal(selfUpdate.pickAsset(local, "mac", "http://127.0.0.1:8123/latest.json")?.kind, "zip");
		assert.equal(selfUpdate.pickAsset(local, "mac", "http://127.0.0.1:9999/latest.json"), null);
		const traversal = [{ name: "../Eksamenshjelp-0.7.0-arm64-mac.zip", browser_download_url: `${DOWNLOAD}x` }];
		assert.equal(selfUpdate.pickAsset(traversal, "mac"), null);
	});
});

describe("latest*.yml and sha512", () => {
	const zipSum = sha512("zip");
	const dmgSum = sha512("dmg");

	it("reads every files[] entry and finds the sha512 for the chosen file", () => {
		const text = updateInfo([
			{ url: "Eksamenshjelp-0.7.0-arm64-mac.zip", sha512: zipSum, size: 3 },
			{ url: "Eksamenshjelp-0.7.0-arm64.dmg", sha512: dmgSum, size: 3 },
		]);
		const files = selfUpdate.parseUpdateInfo(text);
		assert.deepEqual(files, [
			{ url: "Eksamenshjelp-0.7.0-arm64-mac.zip", sha512: zipSum, size: 3 },
			{ url: "Eksamenshjelp-0.7.0-arm64.dmg", sha512: dmgSum, size: 3 },
		]);
		assert.equal(selfUpdate.expectedSha512(files, "Eksamenshjelp-0.7.0-arm64.dmg"), dmgSum);
		assert.equal(selfUpdate.expectedSha512(files, "Eksamenshjelp-0.7.0-arm64-mac.zip"), zipSum);
		assert.equal(selfUpdate.expectedSha512(files, "Eksamenshjelp-0.7.0-x64-setup.exe"), null);
	});

	it("accepts quoted values, CRLF and extra fields; ignores the legacy top-level sha512", () => {
		const text = `version: 0.7.0\r\nfiles:\r\n  - url: 'Eksamenshjelp-0.7.0-x64-setup.exe'\r\n    sha512: "${zipSum}"\r\n    size: 3\r\n    isAdminRightsRequired: false\r\npath: Eksamenshjelp-0.7.0-x64-setup.exe\r\nsha512: ${dmgSum}\r\n`;
		const files = selfUpdate.parseUpdateInfo(text);
		assert.equal(files.length, 1);
		assert.equal(selfUpdate.expectedSha512(files, "Eksamenshjelp-0.7.0-x64-setup.exe"), zipSum);
	});

	it("rejects anything that is not a base64 sha512", () => {
		const files = selfUpdate.parseUpdateInfo(updateInfo([{ url: "a.zip", sha512: "deadbeef" }]));
		assert.equal(selfUpdate.expectedSha512(files, "a.zip"), null);
		assert.deepEqual(selfUpdate.parseUpdateInfo("not: yaml: at all"), []);
		assert.deepEqual(selfUpdate.parseUpdateInfo(undefined as unknown as string), []);
	});

	it("download hashes what it writes; a matching sum passes and a wrong one fails", async () => {
		const dir = tempDir();
		const payload = Buffer.alloc(300_000, 7);
		const seen: (number | null)[] = [];
		const fetchImpl = async () => new Response(payload, { headers: { "content-length": String(payload.length) } });
		const result = await selfUpdate.downloadFile(fetchImpl as typeof fetch, `${DOWNLOAD}a.zip`, path.join(dir, "a.zip"), { onProgress: (percent: number | null) => seen.push(percent) });
		assert.equal(result.size, payload.length);
		assert.deepEqual(fs.readFileSync(path.join(dir, "a.zip")), payload);
		assert.equal(selfUpdate.sha512Matches(result.sha512, sha512(payload)), true);
		assert.equal(selfUpdate.sha512Matches(result.sha512, sha512("something else")), false);
		assert.equal(selfUpdate.sha512Matches(result.sha512, null as unknown as string), false);
		assert.equal(seen[0], 0); assert.equal(seen.at(-1), 100);
		assert.deepEqual([...seen].sort((a, b) => a! - b!), seen, "progress only moves forward");
		assert.equal(new Set(seen).size, seen.length, "each percent is reported once");
	});

	it("unknown size reports no percentage; HTTP errors and stalls reject", async () => {
		const dir = tempDir();
		const seen: (number | null)[] = [];
		const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } });
		await selfUpdate.downloadFile((async () => new Response(stream)) as unknown as typeof fetch, "u", path.join(dir, "b"), { onProgress: (p: number | null) => seen.push(p) });
		assert.deepEqual(seen, [null]);
		await assert.rejects(selfUpdate.downloadFile((async () => new Response("", { status: 404 })) as unknown as typeof fetch, "u", path.join(dir, "c")));
		const stalled = new ReadableStream({ start() { /* never sends */ } });
		await assert.rejects(selfUpdate.downloadFile((async () => new Response(stalled)) as unknown as typeof fetch, "u", path.join(dir, "d"), { idleTimeoutMs: 50 }));
	});
});

describe("macOS swap helper", () => {
	const base = { pid: 4242, target: "/Applications/Eksamenshjelp.app", staged: "/tmp/eksamenshjelp-update/ut/Eksamenshjelp.app", backup: "/Applications/.Eksamenshjelp.app.old-1", workDir: "/tmp/eksamenshjelp-update", executable: "Eksamenshjelp" };

	it("finds the running bundle from process.execPath and refuses a translocated or read-only one", () => {
		assert.equal(selfUpdate.macBundleFromExecPath("/Applications/Eksamenshjelp.app/Contents/MacOS/Eksamenshjelp"), "/Applications/Eksamenshjelp.app");
		assert.equal(selfUpdate.macBundleFromExecPath("/usr/local/bin/electron"), null);
		assert.equal(selfUpdate.macBundleFromExecPath("relative/Eksamenshjelp.app/Contents/MacOS/Eksamenshjelp"), null);
		const writable = { accessSync() {} } as unknown as typeof fs;
		const readOnly = { accessSync() { throw new Error("EACCES"); } } as unknown as typeof fs;
		assert.equal(selfUpdate.macBundleWritable("/Applications/Eksamenshjelp.app", writable), true);
		assert.equal(selfUpdate.macBundleWritable("/Applications/Eksamenshjelp.app", readOnly), false);
		assert.equal(selfUpdate.macBundleWritable("/private/var/folders/x/AppTranslocation/ABC/d/Eksamenshjelp.app", writable), false);
		assert.equal(selfUpdate.macBundleWritable(null as unknown as string, writable), false);
	});

	it("waits for the PID, keeps a backup beside the app, rolls back, clears quarantine and opens the app", () => {
		const script = selfUpdate.macSwapScript(base);
		assert.match(script, /^#!\/bin\/sh\n/);
		assert.match(script, /^PID=4242$/m);
		assert.match(script, /^TARGET='\/Applications\/Eksamenshjelp\.app'$/m);
		assert.match(script, /^STAGED='\/tmp\/eksamenshjelp-update\/ut\/Eksamenshjelp\.app'$/m);
		assert.match(script, /^BACKUP='\/Applications\/\.Eksamenshjelp\.app\.old-1'$/m);
		assert.match(script, /while kill -0 "\$PID"/);
		assert.match(script, /mv "\$TARGET" "\$BACKUP"/);
		assert.match(script, /mv "\$STAGED" "\$TARGET" && \[ -x "\$TARGET\/Contents\/MacOS\/\$EXE" \]/);
		assert.match(script, /xattr -dr com\.apple\.quarantine "\$TARGET"/);
		assert.match(script, /mv "\$BACKUP" "\$TARGET"/, "rollback");
		assert.match(script, /open "\$TARGET"/);
		assert.equal(spawnSync("sh", ["-n"], { input: script }).status, 0, "parses");
	});

	it("quotes hostile paths and refuses unsafe input", () => {
		const odd = selfUpdate.macSwapScript({ ...base, target: "/Users/a'b/Apps/Eksamenshjelp.app", backup: "/Users/a'b/Apps/.old" });
		assert.match(odd, /^TARGET='\/Users\/a'\\''b\/Apps\/Eksamenshjelp\.app'$/m);
		for (const bad of [
			{ pid: 0 }, { pid: 1.5 }, { target: "Eksamenshjelp.app" }, { target: "/" }, { target: "/Applications/Eksamenshjelp" },
			{ backup: "/elsewhere/.old" }, { backup: base.target }, { staged: "/other/Eksamenshjelp.app" },
			{ workDir: "/tmp/../tmp/x" }, { executable: "../x" }, { target: "/Applications/E\nrm.app" },
		]) {
			assert.throws(() => selfUpdate.macSwapScript({ ...base, ...bad }), JSON.stringify(bad));
		}
	});

	if (process.platform !== "win32") {
		function scene() {
			const root = tempDir();
			const bin = path.join(root, "bin");
			fs.mkdirSync(bin);
			const openLog = path.join(root, "open.log");
			fs.writeFileSync(path.join(bin, "open"), `#!/bin/sh\necho "$@" >> '${openLog}'\n`, { mode: 0o755 });
			fs.writeFileSync(path.join(bin, "xattr"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
			const makeApp = (dir: string, marker: string, withExe = true) => {
				fs.mkdirSync(path.join(dir, "Contents", "MacOS"), { recursive: true });
				fs.writeFileSync(path.join(dir, "Contents", "marker"), marker);
				if (withExe) fs.writeFileSync(path.join(dir, "Contents", "MacOS", "Eksamenshjelp"), "#!/bin/sh\n", { mode: 0o755 });
			};
			const apps = path.join(root, "Applications");
			const target = path.join(apps, "Eksamenshjelp.app");
			const workDir = path.join(root, "eksamenshjelp-update");
			const staged = path.join(workDir, "ut", "Eksamenshjelp.app");
			const backup = path.join(apps, ".Eksamenshjelp.app.old-1");
			makeApp(target, "old");
			const userData = path.join(root, "Application Support", "LearnHarness");
			fs.mkdirSync(userData, { recursive: true });
			fs.writeFileSync(path.join(userData, "settings.json"), "{}");
			// Async on purpose: a blocked event loop would leave a waited-on
			// child as an unreaped zombie, which `kill -0` still sees.
			const run = (pid: number) => {
				const scriptPath = path.join(workDir, "swap.sh");
				fs.writeFileSync(scriptPath, selfUpdate.macSwapScript({ pid, target, staged, backup, workDir, executable: "Eksamenshjelp" }));
				const env = { PATH: `${bin}:/usr/bin:/bin` } as unknown as NodeJS.ProcessEnv;
				const child = spawn("/bin/sh", [scriptPath], { env, timeout: 20_000, stdio: ["ignore", "pipe", "pipe"] });
				let output = "";
				child.stdout.on("data", (chunk: Buffer) => { output += chunk; });
				child.stderr.on("data", (chunk: Buffer) => { output += chunk; });
				return new Promise<{ status: number | null; output: string }>((resolve) => child.once("close", (status: number | null) => resolve({ status, output })));
			};
			return { root, target, staged, backup, workDir, userData, openLog, makeApp, run };
		}

		async function exitedPid() {
			const child = spawn("/bin/sh", ["-c", "exit 0"]);
			await new Promise((resolve) => child.once("exit", resolve));
			return child.pid!;
		}

		it("runs: waits for a live PID, swaps in the new app, removes backup and work folder, opens it", async () => {
			const s = scene();
			s.makeApp(s.staged, "new");
			const busy = spawn("/bin/sh", ["-c", "sleep 1"]);
			let busyExited = 0;
			busy.once("exit", () => { busyExited = Date.now(); });
			const result = await s.run(busy.pid!);
			const finished = Date.now();
			assert.equal(result.status, 0, result.output);
			assert.ok(busyExited > 0 && finished >= busyExited + 900, "swapped only after the process exited (plus the 1 s grace)");
			assert.equal(fs.readFileSync(path.join(s.target, "Contents", "marker"), "utf8"), "new");
			assert.equal(fs.existsSync(s.backup), false);
			assert.equal(fs.existsSync(s.workDir), false);
			assert.equal(fs.readFileSync(s.openLog, "utf8").trim(), s.target);
			assert.equal(fs.readFileSync(path.join(s.userData, "settings.json"), "utf8"), "{}", "user data untouched");
		});

		it("runs: a broken new app is rolled back and the old app opens again", async () => {
			const s = scene();
			s.makeApp(s.staged, "broken", false);
			const result = await s.run(await exitedPid());
			assert.equal(result.status, 1);
			assert.equal(fs.readFileSync(path.join(s.target, "Contents", "marker"), "utf8"), "old");
			assert.ok(fs.existsSync(path.join(s.target, "Contents", "MacOS", "Eksamenshjelp")));
			assert.equal(fs.existsSync(s.backup), false);
			assert.equal(fs.existsSync(s.workDir), false);
			assert.equal(fs.readFileSync(s.openLog, "utf8").trim(), s.target);
		});

		it("runs: a missing new app is rolled back too", async () => {
			const s = scene();
			fs.mkdirSync(s.workDir, { recursive: true });
			const result = await s.run(await exitedPid());
			assert.equal(result.status, 1);
			assert.equal(fs.readFileSync(path.join(s.target, "Contents", "marker"), "utf8"), "old");
		});
	}
});

describe("Windows installer arguments", () => {
	it("match electron-updater's silent install with run-after, and the NSIS template's flags", () => {
		assert.deepEqual([...selfUpdate.WINDOWS_INSTALLER_ARGS], ["--updated", "/S", "--force-run"]);
		const nsisUpdater = fs.readFileSync(require.resolve("electron-updater/out/NsisUpdater.js"), "utf8");
		assert.match(nsisUpdater, /const args = \["--updated"\];/);
		assert.match(nsisUpdater, /args\.push\("\/S"\)/);
		assert.match(nsisUpdater, /args\.push\("--force-run"\)/);
		const nsisTarget = fs.readFileSync(require.resolve("app-builder-lib/out/targets/nsis/NsisTarget.js"), "utf8");
		assert.match(nsisTarget, /flags\(\["updated", "force-run"/);
		const installSection = fs.readFileSync(path.join(path.dirname(require.resolve("app-builder-lib/package.json")), "templates", "nsis", "installSection.nsh"), "utf8");
		assert.match(installSection, /\$\{if\} \$\{isForceRun\}\s*\n\s*!insertmacro doStartApp/, "one-click + silent + --force-run starts the app");
	});
});

describe("install flow", () => {
	const API = "https://api.github.com/repos/thomas-schlytter/Eksamenshjelp/releases/latest";

	function flow({ target = "mac" as "mac" | "win" | null, execPath, payload = Buffer.from("the new app"), sums, releaseBody = release(), fail = {} as Record<string, Error | number> } = {} as {
		target?: "mac" | "win" | null; execPath?: string; payload?: Buffer; sums?: string; releaseBody?: Release; fail?: Record<string, Error | number>;
	}) {
		const root = tempDir();
		const tmpRoot = path.join(root, "tmp");
		fs.mkdirSync(tmpRoot);
		const bundle = path.join(root, "Applications", "Eksamenshjelp.app");
		fs.mkdirSync(path.join(bundle, "Contents", "MacOS"), { recursive: true });
		fs.writeFileSync(path.join(bundle, "Contents", "MacOS", "Eksamenshjelp"), "old");
		const reports: InstallReport[] = [];
		const fetched: string[] = [];
		const spawned: { file: string; args: string[]; options: Record<string, unknown> }[] = [];
		const execs: { file: string; args: string[] }[] = [];
		let quits = 0;
		const sum = sums ?? updateInfo([
			{ url: "Eksamenshjelp-0.7.0-arm64-mac.zip", sha512: sha512(payload) },
			{ url: "Eksamenshjelp-0.7.0-arm64.dmg", sha512: sha512(payload) },
			{ url: "Eksamenshjelp-0.7.0-x64-setup.exe", sha512: sha512(payload) },
		]);
		const fetchImpl = async (url: string) => {
			fetched.push(url);
			const failure = fail[url];
			if (failure instanceof Error) throw failure;
			if (typeof failure === "number") return new Response("", { status: failure });
			if (url === API) return Response.json(releaseBody);
			if (url.endsWith(".yml")) return new Response(sum);
			return new Response(new Uint8Array(payload), { headers: { "content-length": String(payload.length) } });
		};
		const spawnImpl = (file: string, args: string[], options: Record<string, unknown>) => {
			spawned.push({ file, args, options });
			const child = Object.assign(new EventEmitter(), { unref() {} });
			const failure = fail.spawn;
			process.nextTick(() => (failure instanceof Error ? child.emit("error", failure) : child.emit("spawn")));
			return child;
		};
		const execFileImpl = (file: string, args: string[], callback: (err: Error | null) => void) => {
			execs.push({ file, args });
			if (file === "/usr/bin/ditto") {
				const dest = args[0] === "-x" ? path.join(args[3]!, "Eksamenshjelp.app") : args[1]!;
				fs.mkdirSync(path.join(dest, "Contents", "MacOS"), { recursive: true });
				fs.writeFileSync(path.join(dest, "Contents", "MacOS", "Eksamenshjelp"), "new");
			}
			callback(null);
		};
		const installer = selfUpdate.createUpdateInstaller({
			target, currentVersion: "0.6.0", apiUrl: API, userAgent: "Eksamenshjelp/0.6.0", tmpRoot, pid: 4242,
			execPath: execPath ?? path.join(bundle, "Contents", "MacOS", "Eksamenshjelp"),
			report: (value: InstallReport) => reports.push(value), quit: () => { quits++; },
			fetchImpl: fetchImpl as unknown as typeof fetch, spawnImpl: spawnImpl as never, execFileImpl: execFileImpl as never,
		});
		return { installer, reports, fetched, spawned, execs, bundle, tmpRoot, quits: () => quits, workDir: path.join(tmpRoot, "eksamenshjelp-update") };
	}

	const last = (reports: InstallReport[]) => reports.at(-1)!;

	it("mac: downloads the zip with progress, verifies, unpacks with ditto, starts the detached helper, then quits", async () => {
		const f = flow();
		await f.installer.install();
		assert.deepEqual(f.reports[0], { phase: "downloading", percent: null });
		assert.ok(f.reports.some((r) => r.phase === "downloading" && r.percent === 100));
		assert.deepEqual(last(f.reports), { phase: "installing" });
		assert.deepEqual(f.fetched, [API, `${DOWNLOAD}latest-mac.yml`, `${DOWNLOAD}Eksamenshjelp-0.7.0-arm64-mac.zip`]);
		assert.deepEqual(f.execs[0], { file: "/usr/bin/ditto", args: ["-x", "-k", path.join(f.workDir, "Eksamenshjelp-0.7.0-arm64-mac.zip"), path.join(f.workDir, "ut")] });
		assert.equal(f.spawned.length, 1);
		const helper = f.spawned[0]!;
		assert.equal(helper.file, "/bin/sh");
		assert.deepEqual(helper.args, [path.join(f.workDir, "swap.sh")]);
		assert.equal(helper.options.detached, true);
		const script = fs.readFileSync(helper.args[0]!, "utf8");
		assert.match(script, /^PID=4242$/m);
		assert.ok(script.includes(`TARGET='${f.bundle}'`));
		assert.ok(script.includes(`STAGED='${path.join(f.workDir, "ut", "Eksamenshjelp.app")}'`));
		assert.ok(script.includes(`BACKUP='${path.join(path.dirname(f.bundle), ".Eksamenshjelp.app.old-")}`));
		assert.equal(f.quits(), 1);
		assert.equal(fs.readFileSync(path.join(f.bundle, "Contents", "MacOS", "Eksamenshjelp"), "utf8"), "old", "the app itself only changes after quitting");
	});

	it("mac: the dmg reserve is mounted read-only, copied out and detached", async () => {
		const f = flow({ releaseBody: release((name) => !name.endsWith("-mac.zip")) });
		await f.installer.install();
		const mount = path.join(f.workDir, "mnt");
		assert.deepEqual(f.execs.map((e) => [e.file, e.args[0]]), [["/usr/bin/hdiutil", "attach"], ["/usr/bin/ditto", path.join(mount, "Eksamenshjelp.app")], ["/usr/bin/hdiutil", "detach"]]);
		assert.ok(f.execs[0]!.args.includes("-readonly") && f.execs[0]!.args.includes("-nobrowse"));
		assert.equal(f.quits(), 1);
	});

	it("Windows: runs setup.exe silently and detached with --updated /S --force-run, then quits", async () => {
		const f = flow({ target: "win", execPath: "C:\\Users\\x\\AppData\\Local\\Programs\\learnharness\\Eksamenshjelp.exe" });
		await f.installer.install();
		assert.deepEqual(f.fetched.slice(1), [`${DOWNLOAD}latest.yml`, `${DOWNLOAD}Eksamenshjelp-0.7.0-x64-setup.exe`]);
		assert.deepEqual(f.spawned.map((s) => [s.file, s.args, s.options.detached, s.options.stdio]), [
			[path.join(f.workDir, "Eksamenshjelp-0.7.0-x64-setup.exe"), ["--updated", "/S", "--force-run"], true, "ignore"],
		]);
		assert.deepEqual(last(f.reports), { phase: "installing" });
		assert.equal(f.quits(), 1);
	});

	const failures: [string, Parameters<typeof flow>[0], keyof typeof selfUpdate.MESSAGES][] = [
		["a wrong sha512 stops before installing", { sums: updateInfo([{ url: "Eksamenshjelp-0.7.0-arm64-mac.zip", sha512: sha512("tampered") }]) }, "checksum"],
		["a checksum file without this file stops", { sums: updateInfo([{ url: "Eksamenshjelp-0.7.0-arm64.dmg", sha512: sha512("x") }]) }, "noChecksum"],
		["a release without latest-mac.yml stops", { releaseBody: release((name) => name !== "latest-mac.yml") }, "noChecksum"],
		["no file for this machine", { releaseBody: release((name) => !name.includes("arm64")) }, "noFile"],
		["the download failing", { fail: { [`${DOWNLOAD}Eksamenshjelp-0.7.0-arm64-mac.zip`]: new Error("ECONNRESET") } }, "network"],
		["the download answering 404", { fail: { [`${DOWNLOAD}Eksamenshjelp-0.7.0-arm64-mac.zip`]: 404 } }, "network"],
		["GitHub's API failing", { fail: { [API]: 403 } }, "api"],
		["the latest release not being newer", { releaseBody: { ...release(), tag_name: "v0.6.0" } }, "noNewer"],
		["the helper not starting", { fail: { spawn: new Error("EACCES") } }, "generic"],
		["no install target", { target: null }, "noFile"],
	];
	for (const [label, options, message] of failures) {
		it(`${label}: an honest message, nothing quit, the temp folder emptied`, async () => {
			const f = flow(options);
			await f.installer.install();
			assert.deepEqual(last(f.reports), { phase: "failed", message: selfUpdate.MESSAGES[message] });
			assert.equal(f.quits(), 0);
			if (message !== "generic") assert.equal(f.spawned.length, 0);
			assert.equal(fs.existsSync(f.workDir), false);
			assert.equal(fs.readFileSync(path.join(f.bundle, "Contents", "MacOS", "Eksamenshjelp"), "utf8"), "old");
		});
	}

	it("a translocated / read-only app stops before downloading anything", async () => {
		const f = flow({ execPath: "/private/var/folders/x/AppTranslocation/ABC/d/Eksamenshjelp.app/Contents/MacOS/Eksamenshjelp" });
		await f.installer.install();
		assert.deepEqual(last(f.reports), { phase: "failed", message: selfUpdate.MESSAGES.notWritable });
		assert.deepEqual(f.fetched, []);
		assert.equal(f.quits(), 0);
	});

	it("a second click while running shares the same run; cleanup empties the work folder", async () => {
		const f = flow();
		const a = f.installer.install(); const b = f.installer.install();
		assert.equal(a, b);
		await a;
		assert.equal(f.fetched.filter((url) => url === API).length, 1);
		fs.mkdirSync(f.workDir, { recursive: true });
		f.installer.cleanup();
		assert.equal(fs.existsSync(f.workDir), false);
	});

	it("every message is short Norwegian copy", () => {
		for (const message of Object.values(selfUpdate.MESSAGES)) {
			assert.ok(message.length <= 80, message);
			assert.doesNotMatch(message, /\b(the|failed|error|download)\b/i, message);
		}
	});
});
