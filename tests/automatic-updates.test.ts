/** Actual shell functions with fake Electron/fetch/filesystem. No app,
 * profile, network or timer is run. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { describe, it } from "node:test";

const mainFile = fileURLToPath(new URL("../electron/main.cjs", import.meta.url));
const mainSource = readFileSync(mainFile, "utf8");
const mainRequire = createRequire(mainFile);
const releaseCheck = mainRequire("./release-check.cjs") as {
	LATEST_RELEASE_API: string;
	RELEASES_PAGE: string;
	parseVersion: (value: unknown) => { core: number[]; pre: string[] } | null;
	isNewerVersion: (candidate: string, current: string) => boolean;
	releasePageFor: (tag: string) => string;
	readLatestRelease: (response: Response, current: string) => Promise<{ newer: boolean; version?: string; url?: string }>;
};

type Answer = { status: number; body?: unknown } | Error;

function fixture({ packaged = true, version = "0.4.1" } = {}) {
	let settings: string | Error = JSON.stringify({ version: 1, general: { autoUpdate: true } });
	const settingsReads: string[] = [];
	const intervals: { callback: () => void; delay: number }[] = [];
	const handles = new Map<string, (event: unknown) => unknown>();
	const windows: FakeWindow[] = [];
	const requests: { url: string; headers: Record<string, string> }[] = [];
	let answer: Answer = { status: 200, body: { tag_name: `v${version}` } };
	let enumerationFails = false;
	let userData = "/fixture/custom-user-data";
	let menu: { submenu?: { label?: string; click?: () => void }[] }[] = [];
	class FakeWebContents extends EventEmitter {
		mainFrame = { url: "http://127.0.0.1:9000/" };
		messages: { channel: string; value: unknown }[] = [];
		loading = false;
		fails = false;
		send(channel: string, value: unknown) {
			if (this.fails) throw new Error("window destroyed");
			this.messages.push({ channel, value: JSON.parse(JSON.stringify(value)) });
		}
		isLoadingMainFrame() { return this.loading; }
		setWindowOpenHandler() {}
		getZoomFactor() { return 1; }
	}
	class FakeWindow extends EventEmitter {
		webContents = new FakeWebContents();
		minimized = false;
		focused = false;
		constructor() { super(); windows.push(this); }
		loadURL() { this.webContents.loading = true; }
		isMinimized() { return this.minimized; }
		restore() { this.minimized = false; }
		focus() { this.focused = true; }
		show() {}
		static getAllWindows() {
			if (enumerationFails) throw new Error("window enumeration failed");
			return windows;
		}
		static fromWebContents(contents: FakeWebContents) { return windows.find(win => win.webContents === contents); }
	}
	const app = Object.assign(new EventEmitter(), {
		isPackaged: packaged,
		name: "Eksamenshjelp",
		setName() {},
		getVersion: () => version,
		getPath: (name: string) => name === "appData" ? "/fixture" : userData,
		setPath: (_: string, value: string) => { userData = value; },
		requestSingleInstanceLock: () => false,
		quit() {},
		whenReady: async () => {},
	});
	const electron = {
		app, BrowserWindow: FakeWindow,
		Menu: { buildFromTemplate: (value: typeof menu) => value, setApplicationMenu: (value: typeof menu) => { menu = value; } },
		ipcMain: { on() {}, handle: (channel: string, fn: (event: unknown) => unknown) => handles.set(channel, fn) },
		session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
	};
	const fakeFetch = async (url: string, init: { headers: Record<string, string> }) => {
		requests.push({ url, headers: init.headers });
		const current = answer;
		if (current instanceof Error) throw current;
		return new Response(current.body === undefined ? "not json" : JSON.stringify(current.body), { status: current.status });
	};
	const context = createContext({
		require: (id: string) => {
			if (id === "electron") return electron;
			if (id === "node:fs") return {
				readFileSync: (file: string) => {
					settingsReads.push(file);
					if (settings instanceof Error) throw settings;
					return settings;
				}, mkdirSync() {}, appendFileSync() {},
			};
			return mainRequire(id);
		},
		process: { argv: [], env: { LH_DEV_URL: "http://127.0.0.1:9000" }, platform: "darwin", on() {} },
		__dirname: path.dirname(mainFile), URL, AbortSignal, Promise,
		fetch: fakeFetch,
		setInterval: (callback: () => void, delay: number) => intervals.push({ callback, delay }),
		setTimeout() {},
	});
	runInContext(mainSource, context, { filename: mainFile });
	const run = (code: string) => runInContext(code, context);
	return {
		run, windows, intervals, handles, settingsReads, requests, app,
		answer: (value: Answer) => { answer = value; },
		setSettings: (value: unknown) => { settings = JSON.stringify(value); },
		setSettingsFailure: (value: string | Error) => { settings = value; },
		setEnumerationFailure: (value: boolean) => { enumerationFails = value; },
		window: () => new FakeWindow(),
		state: () => JSON.parse(JSON.stringify(run("updateState"))),
		check: async (manual = false) => { await run(`checkForUpdates({ manual: ${manual} })`); },
		menuCheck: () => menu[0]!.submenu!.find(item => item.label === "Se etter oppdateringer…")!.click!(),
		settle: async () => { await run("releaseCheckInFlight ?? Promise.resolve()"); },
	};
}

describe("release-check helpers", () => {
	it("parses tags with and without a leading v, and rejects anything else", () => {
		assert.deepEqual(releaseCheck.parseVersion("v0.5.0"), { core: [0, 5, 0], pre: [] });
		assert.deepEqual(releaseCheck.parseVersion("0.5.0"), { core: [0, 5, 0], pre: [] });
		assert.deepEqual(releaseCheck.parseVersion("1.2.3-beta.2+build.7"), { core: [1, 2, 3], pre: ["beta", "2"] });
		for (const bad of ["", "latest", "v1.2", "1.2.3.4", "01.2.3", "vv1.2.3", null, 5]) {
			assert.equal(releaseCheck.parseVersion(bad), null, String(bad));
		}
	});

	it("compares by semver precedence, not by string", () => {
		const newer = (a: string, b: string) => releaseCheck.isNewerVersion(a, b);
		assert.equal(newer("v0.5.0", "0.4.1"), true);
		assert.equal(newer("0.10.0", "0.9.9"), true);
		assert.equal(newer("1.0.0", "0.99.99"), true);
		assert.equal(newer("v0.4.1", "0.4.1"), false);
		assert.equal(newer("0.4.0", "0.4.1"), false);
		assert.equal(newer("0.5.0", "0.5.0-beta.1"), true, "a release outranks its prerelease");
		assert.equal(newer("0.5.0-beta.1", "0.5.0"), false);
		assert.equal(newer("0.5.0-beta.10", "0.5.0-beta.2"), true, "numeric identifiers compare numerically");
		assert.equal(newer("0.5.0-rc.1", "0.5.0-beta.9"), true);
		assert.equal(newer("0.5.0-beta.1", "0.5.0-beta"), true);
		assert.equal(newer("0.5.0-alpha", "0.5.0-1"), true, "alphanumeric outranks numeric");
		assert.equal(newer("0.5.0+build", "0.5.0"), false, "build metadata is ignored");
		assert.equal(newer("garbage", "0.4.1"), false);
		assert.equal(newer("0.5.0", "garbage"), false);
	});

	it("builds the release page from the repo constant, never the API's URLs", async () => {
		assert.equal(releaseCheck.LATEST_RELEASE_API, "https://api.github.com/repos/thomas-schlytter/Eksamenshjelp/releases/latest");
		const result = await releaseCheck.readLatestRelease(Response.json({ tag_name: "v0.5.0", html_url: "https://evil.invalid/" }), "0.4.1");
		assert.deepEqual(result, { newer: true, version: "0.5.0", url: "https://github.com/thomas-schlytter/Eksamenshjelp/releases/tag/v0.5.0" });
		assert.equal(releaseCheck.releasePageFor("v1/../x"), `${releaseCheck.RELEASES_PAGE}/tag/v1%2F..%2Fx`);
	});

	it("404 means no release yet; other failures throw", async () => {
		assert.deepEqual(await releaseCheck.readLatestRelease(new Response("", { status: 404 }), "0.4.1"), { newer: false });
		await assert.rejects(releaseCheck.readLatestRelease(new Response("", { status: 403 }), "0.4.1"));
		await assert.rejects(releaseCheck.readLatestRelease(new Response("not json", { status: 200 }), "0.4.1"));
		await assert.rejects(releaseCheck.readLatestRelease(Response.json({ tag_name: "nightly" }), "0.4.1"));
		await assert.rejects(releaseCheck.readLatestRelease(Response.json(null), "0.4.1"));
	});
});

describe("automatic-check preference gate", () => {
	it("explicit OFF skips automatic checks, but manual checks still run without reading the preference", async () => {
		const f = fixture();
		f.setSettings({ general: { autoUpdate: false } });
		f.run("setupReleaseCheck()");
		await f.check();
		assert.equal(f.requests.length, 0);
		assert.deepEqual(f.settingsReads, ["/fixture/LearnHarness-dev/data/settings.json"]);
		await f.check(true);
		assert.equal(f.requests.length, 1);
		assert.equal(f.settingsReads.length, 1);
	});

	for (const [label, setting] of [
		["ON", { general: { autoUpdate: true } }], ["absent field", { general: {} }],
		["absent section", { version: 1 }], ["null", null], ["non-boolean", { general: { autoUpdate: "false" } }],
	] as const) {
		it(`${label} keeps automatic checks enabled`, async () => {
			const f = fixture(); f.setSettings(setting); f.run("setupReleaseCheck()"); await f.check();
			assert.equal(f.requests.length, 1);
		});
	}
	for (const [label, failure] of [["missing", new Error("ENOENT")], ["unreadable", new Error("EACCES")], ["corrupt", "{nope"]] as const) {
		it(`${label} settings keep automatic checks enabled`, async () => {
			const f = fixture(); f.setSettingsFailure(failure); f.run("setupReleaseCheck()"); await f.check();
			assert.equal(f.requests.length, 1);
		});
	}

	it("re-reads the setting on each check, without triggering a check merely when saved", async () => {
		const f = fixture(); f.run("setupReleaseCheck()");
		f.setSettings({ general: { autoUpdate: false } }); await f.check();
		f.setSettings({ general: { autoUpdate: true } });
		assert.equal(f.requests.length, 0);
		await f.check();
		f.setSettings({ general: { autoUpdate: false } }); await f.check();
		assert.equal(f.requests.length, 1);
		assert.equal(f.settingsReads.length, 3);
	});

	it("an unpackaged (dev) build never checks and reports disabled", async () => {
		const f = fixture({ packaged: false });
		f.run("setupReleaseCheck()"); await f.check(true); await f.check();
		assert.equal(f.requests.length, 0);
		assert.equal(f.settingsReads.length, 0);
		assert.equal(f.state().status, "disabled");
	});
});

describe("release check results", () => {
	it("asks the public API anonymously, with no token", async () => {
		const f = fixture(); f.run("setupReleaseCheck()"); await f.check(true);
		assert.equal(f.requests[0]!.url, "https://api.github.com/repos/thomas-schlytter/Eksamenshjelp/releases/latest");
		assert.ok(!Object.keys(f.requests[0]!.headers).some(name => name.toLowerCase() === "authorization"));
	});

	it("a newer tag reports available with version and release page; the same tag is up to date", async () => {
		const f = fixture(); const win = f.window(); f.run("setupReleaseCheck()");
		await f.check(true);
		assert.equal(f.state().status, "up-to-date");
		f.answer({ status: 200, body: { tag_name: "0.5.0" } }); await f.check(true);
		assert.deepEqual({ ...f.state(), revision: 0 }, { status: "available", version: "0.5.0", url: "https://github.com/thomas-schlytter/Eksamenshjelp/releases/tag/0.5.0", revision: 0 });
		assert.equal(win.webContents.messages.at(-1)!.channel, "lh:update-status");
	});

	it("an older tag and a repo without releases are both no newer version", async () => {
		const f = fixture(); f.run("setupReleaseCheck()");
		f.answer({ status: 200, body: { tag_name: "v0.3.0" } }); await f.check(true);
		assert.equal(f.state().status, "up-to-date");
		f.answer({ status: 404, body: { message: "Not Found" } }); await f.check(true);
		assert.equal(f.state().status, "up-to-date");
	});

	for (const [label, answer] of [
		["offline", new Error("getaddrinfo ENOTFOUND private.detail")],
		["rate limited", { status: 403, body: { message: "API rate limit exceeded for 1.2.3.4" } }],
		["unparseable body", { status: 200 }],
		["invalid tag", { status: 200, body: { tag_name: "nightly" } }],
	] as const) {
		it(`${label} settles to a generic error and a later check still runs`, async () => {
			const f = fixture(); f.run("setupReleaseCheck()");
			f.answer(answer as Answer); await f.check(true);
			assert.equal(f.state().status, "error");
			assert.ok(!JSON.stringify(f.state()).match(/private|1\.2\.3\.4|rate/));
			f.answer({ status: 200, body: { tag_name: "v0.4.1" } }); await f.check(true);
			assert.equal(f.requests.length, 2); assert.equal(f.state().status, "up-to-date");
		});
	}

	it("a found version is not hidden by a later failure, but a newer release replaces it", async () => {
		const f = fixture(); f.run("setupReleaseCheck()");
		f.answer({ status: 200, body: { tag_name: "v0.5.0" } }); await f.check(true);
		const found = f.state();
		f.answer(new Error("offline")); await f.check(true);
		assert.deepEqual(f.state(), found);
		f.answer({ status: 200, body: { tag_name: "v0.6.0" } }); await f.check(true);
		assert.equal(f.state().version, "0.6.0");
		assert.ok(f.state().revision > found.revision);
	});

	it("overlapping checks share one request; the check promise never rejects", async () => {
		const f = fixture(); f.run("setupReleaseCheck()");
		const a = f.run("checkForUpdates({ manual: true })"); const b = f.run("checkForUpdates({ manual: true })");
		assert.equal(a, b);
		await a;
		assert.equal(f.requests.length, 1);
		f.answer(new Error("boom")); await f.check(true);
		assert.equal(f.state().status, "error");
	});

	for (const status of ["checking", "error", "disabled", "up-to-date"]) {
		it(`a ${status} display state does not block a future automatic check`, async () => {
			const f = fixture(); f.run(`setupReleaseCheck(); reportUpdateStatus("${status}")`); await f.check();
			assert.equal(f.requests.length, 1);
		});
	}

	it("window enumeration/send failures do not break checks or the next window's notification", async () => {
		const f = fixture(); const bad = f.window(); bad.webContents.fails = true; const good = f.window();
		f.run("setupReleaseCheck()"); await f.check();
		assert.equal(good.webContents.messages.at(-1)!.channel, "lh:update-status");
		f.setEnumerationFailure(true); await f.check();
		f.setEnumerationFailure(false); await f.check();
		assert.equal(f.requests.length, 3);
	});
});

describe("startup, timer, trusted IPC and menu wiring", () => {
	it("starts and retains the 24h timer without any Settings subscription, checking current preference each time", async () => {
		const f = fixture(); f.setSettings({ general: { autoUpdate: false } });
		await f.run("main()");
		assert.equal(f.requests.length, 0);
		assert.equal(f.intervals.length, 1); assert.equal(f.intervals[0]!.delay, 24 * 60 * 60 * 1000);
		f.setSettings({ general: { autoUpdate: true } }); f.intervals[0]!.callback(); await f.settle();
		assert.equal(f.requests.length, 1);
		f.windows.length = 0; f.intervals[0]!.callback(); await f.settle();
		assert.equal(f.requests.length, 2, "checks also work with every window closed");
	});

	it("ON/default boot checks immediately", async () => {
		const f = fixture(); f.setSettings({ version: 1 }); await f.run("main()"); await f.settle();
		assert.equal(f.requests.length, 1);
		f.intervals[0]!.callback(); await f.settle();
		assert.equal(f.requests.length, 2);
	});

	it("a dev build boots without a check or a timer", async () => {
		const f = fixture({ packaged: false }); await f.run("main()");
		assert.equal(f.requests.length, 0); assert.equal(f.intervals.length, 0);
		assert.equal(f.state().status, "disabled");
	});

	it("snapshot/manual IPC accepts only an owned main frame and snapshot reads never check", async () => {
		const f = fixture(); f.setSettings({ general: { autoUpdate: false } }); await f.run("main()");
		const sender = f.windows[0]!.webContents;
		const event = { sender, senderFrame: sender.mainFrame };
		const get = f.handles.get("lh:update:get")!; const check = f.handles.get("lh:update:check")!;
		assert.equal((get(event) as { status: string }).status, "idle"); assert.equal(f.requests.length, 0);
		await check(event); assert.equal(f.requests.length, 1);
		for (const bad of [
			{ sender: {}, senderFrame: sender.mainFrame },
			{ sender, senderFrame: { url: sender.mainFrame.url } },
		]) {
			assert.throws(() => get(bad), /Untrusted/); assert.throws(() => check(bad), /Untrusted/);
		}
		sender.mainFrame.url = "https://untrusted.invalid/";
		assert.throws(() => check(event), /Untrusted/);
		assert.equal(f.requests.length, 1);
		assert.equal(f.handles.has("lh:update-install"), false);
	});

	it("menu restores/focuses a minimized window, opens General, and manually checks while OFF", async () => {
		const f = fixture(); f.setSettings({ general: { autoUpdate: false } }); await f.run("main()");
		const win = f.windows[0]!; win.webContents.loading = false; win.minimized = true;
		f.menuCheck(); await f.settle();
		assert.equal(win.minimized, false); assert.equal(win.focused, true);
		assert.ok(win.webContents.messages.some(message => message.channel === "lh:open-settings" && message.value === "general"));
		assert.equal(f.requests.length, 1);
	});

	it("menu reopens a window and delivers General after load; loading existing windows are covered too", async () => {
		const f = fixture(); f.setSettings({ general: { autoUpdate: false } }); await f.run("main()");
		f.windows.length = 0; f.menuCheck(); await f.settle();
		assert.equal(f.windows.length, 1); assert.equal(f.requests.length, 1);
		const win = f.windows[0]!;
		assert.ok(!win.webContents.messages.some(message => message.channel === "lh:open-settings"));
		win.webContents.emit("did-finish-load");
		assert.ok(win.webContents.messages.some(message => message.channel === "lh:open-settings"));
		f.menuCheck(); win.webContents.emit("did-finish-load");
		assert.equal(win.webContents.messages.filter(message => message.channel === "lh:open-settings").length, 2);
	});

	it("menu navigation failure does not prevent its manual check", async () => {
		const f = fixture(); f.setSettings({ general: { autoUpdate: false } }); await f.run("main()");
		f.windows[0]!.webContents.fails = true; f.windows[0]!.webContents.loading = false;
		f.menuCheck(); await f.settle(); assert.equal(f.requests.length, 1);
	});
});
