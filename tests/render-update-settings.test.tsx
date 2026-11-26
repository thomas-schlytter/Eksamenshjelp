/** Update UI with a fake preload bridge: no Electron, network or updates. */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { AboutSettings, UpdateSettings, updateStatusText, AUTO_UPDATE_HINT, type UpdateState } from "../components/settings/update-settings.tsx";
import { AUTHOR_URL, UPSTREAM_URL } from "../lib/credits.ts";
import UpdateBanner from "../components/update-banner.tsx";
import { SettingsDialogBody, SettingsDialogProvider } from "../components/settings/settings-dialog.tsx";
import nextConfig from "../next.config.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, CustomEvent: dom.window.CustomEvent });
const originalFetch = globalThis.fetch;
const roots: { root: Root; host: HTMLElement }[] = [];
const state = (over: Partial<UpdateState> = {}): UpdateState => ({ status: "idle", version: null, url: null, revision: 0, ...over });
const RELEASE = "https://github.com/thomas-schlytter/Eksamenshjelp/releases/tag/v0.5.0";
const available = (over: Partial<UpdateState> = {}) => state({ status: "available", version: "0.5.0", url: RELEASE, ...over });
const props = { autoUpdate: true, onAutoUpdateChange: () => {} };
const about = { version: "0.4.1", homepage: "https://github.com/thomas-schlytter/Eksamenshjelp" };
const q = (host: ParentNode, id: string) => host.querySelector<HTMLElement>(`[data-testid='${id}']`);

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

function bridge(initial = state(), snapshot = Promise.resolve(initial)) {
	const listeners = new Set<(value: UpdateState) => void>();
	const calls = { check: 0, get: 0 };
	let onOpen: ((section: string) => void) | null = null;
	let checkFailure: Error | null = null;
	window.lh = {
		expandWindow() {},
		getUpdateState: () => { calls.get++; return snapshot; },
		onUpdateStatus: cb => { listeners.add(cb); return () => { listeners.delete(cb); }; },
		checkForUpdates: async () => { calls.check++; if (checkFailure) throw checkFailure; },
		onOpenSettings: cb => { onOpen = cb; return () => { onOpen = null; }; },
	};
	return {
		calls, listeners,
		failCheck: () => { checkFailure = new Error("sensitive raw diagnostics"); },
		push: async (value: UpdateState) => { await act(async () => { for (const listener of listeners) listener(value); }); },
		open: async () => { await act(async () => onOpen?.("general")); },
	};
}

async function mount(element: React.ReactElement) {
	const host = document.createElement("div"); document.body.append(host);
	const root = createRoot(host); roots.push({ root, host });
	await act(async () => { root.render(element); });
	return host;
}

async function click(element: HTMLElement | null) {
	assert.ok(element, "missing click target");
	await act(async () => { element.click(); });
}

afterEach(async () => {
	for (const { root, host } of roots.splice(0)) {
		await act(async () => { root.unmount(); }); host.remove();
	}
	delete window.lh;
	globalThis.fetch = originalFetch;
});

describe("version, credits and contextual copy", () => {
	it("build metadata comes from package.json and exposes only public version/homepage values", () => {
		const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		assert.deepEqual(nextConfig.env, { LH_VERSION: pkg.version, LH_HOMEPAGE: pkg.homepage });
		assert.equal(pkg.homepage, "https://github.com/thomas-schlytter/Eksamenshjelp");
		assert.deepEqual(pkg.author, { name: "Thomas Schlytter-Henrichsen" });
		assert.deepEqual(pkg.contributors, [{ name: "Amos Blomqvist", url: "https://github.com/amosblomqvist" }]);
		assert.equal(pkg.license, "AGPL-3.0-only");
	});

	it("the about block credits the author and the upstream project, opening in a new window", () => {
		const html = renderToStaticMarkup(<AboutSettings {...about} />);
		const doc = parseHTML(`<html><body><div>${html}</div></body></html>`).document.body;
		assert.ok(doc.textContent!.includes("Eksamenshjelp"));
		assert.ok(doc.textContent!.includes("Versjon 0.4.1"));
		assert.equal(q(doc, "release-notes")!.getAttribute("href"), `${about.homepage}/releases/tag/v0.4.1`);
		assert.ok(doc.textContent!.includes("Laget av Thomas Schlytter-Henrichsen"));
		assert.ok(doc.textContent!.includes("Basert på LearnHarness av Amos Blomqvist"));
		for (const [id, href] of [["about-author", AUTHOR_URL], ["about-upstream", UPSTREAM_URL]] as const) {
			assert.equal(q(doc, id)!.getAttribute("href"), href);
			assert.equal(q(doc, id)!.getAttribute("target"), "_blank", "window.open is routed to the system browser");
		}
	});

	it("keeps check errors generic and never claims live information", () => {
		assert.equal(updateStatusText(null), null);
		assert.equal(updateStatusText(state()), null);
		assert.equal(updateStatusText(state({ status: "disabled" })), null);
		assert.equal(updateStatusText(state({ status: "checking" })), "Ser etter oppdateringer…");
		assert.equal(updateStatusText(state({ status: "up-to-date" })), "Fant ingen nyere versjon ved forrige sjekk.");
		assert.equal(updateStatusText(state({ status: "error" })), "Kunne ikke se etter oppdateringer. Sjekk nettforbindelsen og prøv igjen.");
	});
});

describe("General update rows", () => {
	it("browser/SSR renders no update controls or claims", () => {
		const html = renderToStaticMarkup(<UpdateSettings {...props} />);
		assert.equal(html, "");
	});

	it("an unpackaged build renders no update controls", async () => {
		const b = bridge(state({ status: "disabled" })); const host = await mount(<UpdateSettings {...props} />);
		assert.equal(q(host, "update-check"), null);
		assert.equal(q(host, "row-auto-update"), null); assert.equal(b.calls.check, 0);
	});

	it("idle shows two rows; opening Settings never checks", async () => {
		const b = bridge(); const seen: boolean[] = [];
		const host = await mount(<UpdateSettings {...props} onAutoUpdateChange={value => seen.push(value)} />);
		assert.deepEqual([...host.children].map(el => el.getAttribute("data-testid")), ["row-updates", "row-auto-update"]);
		assert.ok(q(host, "row-updates")!.contains(q(host, "update-check")));
		assert.ok(host.textContent!.includes(AUTO_UPDATE_HINT));
		assert.equal(q(host, "update-status"), null); assert.equal(b.calls.check, 0);
		await click(q(host, "toggle-auto-update")); assert.deepEqual(seen, [false]);
		await click(q(host, "update-check")); assert.equal(b.calls.check, 1);
	});

	it("manual check remains available while automatic checks are OFF", async () => {
		const b = bridge(); const host = await mount(<UpdateSettings {...props} autoUpdate={false} />);
		assert.equal(q(host, "toggle-auto-update")!.getAttribute("aria-checked"), "false");
		await click(q(host, "update-check")); assert.equal(b.calls.check, 1);
	});

	it("checking disables only the UI button; a newer release offers the download link", async () => {
		const b = bridge(); const host = await mount(<UpdateSettings {...props} />);
		await b.push(state({ status: "checking", revision: 1 }));
		assert.equal((q(host, "update-check") as HTMLButtonElement).disabled, true);
		assert.equal(q(host, "update-check")!.getAttribute("aria-busy"), "true");
		assert.equal(q(host, "update-status")!.textContent, "Ser etter oppdateringer…");
		await b.push(available({ revision: 2 }));
		assert.equal(q(host, "update-check"), null);
		const link = q(host, "update-download")!;
		assert.equal(link.textContent, "Ny versjon 0.5.0 – last ned");
		assert.equal(link.getAttribute("href"), RELEASE);
		assert.equal(link.getAttribute("target"), "_blank");
		assert.equal(q(host, "update-status"), null);
		assert.equal(q(host, "update-restart"), null, "no restart state remains");
	});

	it("an available status without a release page falls back to the check button", async () => {
		const b = bridge(); const host = await mount(<UpdateSettings {...props} />);
		await b.push(available({ url: null, revision: 1 }));
		assert.equal(q(host, "update-download"), null); assert.ok(q(host, "update-check"));
	});

	it("up-to-date and failure statuses allow another manual check", async () => {
		const b = bridge(); const host = await mount(<UpdateSettings {...props} />);
		await b.push(state({ status: "up-to-date", revision: 1 }));
		assert.equal(q(host, "update-status")!.textContent, "Fant ingen nyere versjon ved forrige sjekk.");
		await b.push(state({ status: "error", revision: 2 }));
		assert.equal((q(host, "update-check") as HTMLButtonElement).disabled, false);
		assert.equal(q(host, "update-status")!.textContent, "Kunne ikke se etter oppdateringer. Sjekk nettforbindelsen og prøv igjen.");
		await click(q(host, "update-check")); assert.equal(b.calls.check, 1);
	});

	it("bridge command rejection is handled without exposing raw diagnostics", async () => {
		const b = bridge(); b.failCheck(); const host = await mount(<UpdateSettings {...props} />);
		await click(q(host, "update-check"));
		assert.equal(q(host, "update-status")!.textContent, "Kunne ikke se etter oppdateringer. Sjekk nettforbindelsen og prøv igjen.");
		assert.ok(!host.textContent!.includes("sensitive"));
	});

	it("late Settings and banner subscribers recover a found release without an event", async () => {
		const b = bridge(available({ revision: 5 }));
		const host = await mount(<><UpdateSettings {...props} /><UpdateBanner /></>);
		assert.ok(q(host, "update-download")); assert.ok(q(host, "update-banner"));
		assert.ok(q(host, "update-banner")!.textContent!.includes("0.5.0"));
		assert.equal(q(host, "update-banner-download")!.getAttribute("href"), RELEASE);
		assert.equal(b.calls.check, 0);
	});

	it("dismissing the banner keeps Settings' download and shows a newer version again", async () => {
		const b = bridge(available({ revision: 1 }));
		const host = await mount(<><UpdateSettings {...props} /><UpdateBanner /></>);
		await click(host.querySelector<HTMLElement>("[aria-label='Lukk oppdateringsvarselet']"));
		assert.equal(q(host, "update-banner"), null);
		assert.equal(b.calls.check, 0, "dismiss must not check for updates");
		await b.push(available({ revision: 2 }));
		assert.equal(q(host, "update-banner"), null, "repeated status must stay dismissed");
		assert.ok(q(host, "update-download"), "Settings still offers the download");
		const next = "https://github.com/thomas-schlytter/Eksamenshjelp/releases/tag/v0.6.0";
		await b.push(available({ version: "0.6.0", url: next, revision: 3 }));
		assert.ok(q(host, "update-banner")!.textContent!.includes("0.6.0"));
	});

	it("dismissal is forgotten when the banner remounts", async () => {
		const b = bridge(available({ revision: 1 }));
		const host = await mount(<UpdateBanner />);
		await click(host.querySelector("[aria-label='Lukk oppdateringsvarselet']"));
		const { root } = roots.pop()!;
		await act(async () => { root.unmount(); });
		host.remove();
		assert.equal(b.listeners.size, 0);
		bridge(available({ revision: 1 }));
		const reopened = await mount(<UpdateBanner />);
		assert.ok(q(reopened, "update-banner"), "dismissal is local state, not a persisted preference");
	});

	it("a delayed older snapshot cannot overwrite a newer push in Settings or the banner", async () => {
		const snapshot = deferred<UpdateState>(); const b = bridge(state(), snapshot.promise);
		const host = await mount(<><UpdateSettings {...props} /><UpdateBanner /></>);
		await b.push(available({ revision: 4 }));
		await act(async () => { snapshot.resolve(state({ status: "checking", revision: 3 })); });
		assert.ok(q(host, "update-download")); assert.ok(q(host, "update-banner"));
	});

	it("snapshot rejection cannot erase an already received event and late callbacks are unsubscribed", async () => {
		const snapshot = deferred<UpdateState>(); const b = bridge(state(), snapshot.promise);
		const host = await mount(<UpdateSettings {...props} />);
		await b.push(available({ revision: 1 }));
		await act(async () => { snapshot.reject(new Error("IPC disconnected")); });
		assert.ok(q(host, "update-download"));
		const { root } = roots.pop()!; await act(async () => { root.unmount(); }); host.remove();
		assert.equal(b.listeners.size, 0);
	});

	it("snapshot rejection without an event is handled with a generic message", async () => {
		const snapshot = deferred<UpdateState>(); bridge(state(), snapshot.promise);
		const host = await mount(<UpdateSettings {...props} />);
		await act(async () => { snapshot.reject(new Error("sensitive error")); });
		assert.equal(q(host, "update-status")!.textContent, "Kunne ikke se etter oppdateringer. Sjekk nettforbindelsen og prøv igjen.");
		assert.ok(!host.textContent!.includes("sensitive"));
	});
});

describe("Settings integration", () => {
	it("the toggle sends the complete General section and follows stored server truth", async () => {
		bridge();
		// A synthetic future sibling exercises the caller's section-preserving
		// contract without introducing a new product setting or changing its API.
		const record = { version: 1, general: { autoUpdate: true, futureSibling: "keep" } };
		const puts: unknown[] = [];
		globalThis.fetch = async (input, init) => {
			assert.equal(String(input), init?.method === "PUT" ? "/api/settings/general" : "/api/settings");
			if (init?.method === "PUT") {
				const body = JSON.parse(String(init.body)); puts.push(body);
				return Response.json({ settings: { ...record, general: body } });
			}
			return Response.json({ settings: record });
		};
		const host = await mount(<SettingsDialogBody initialSection="general" onClose={() => {}} />);
		await click(q(host, "toggle-auto-update"));
		assert.deepEqual(puts, [{ autoUpdate: false, futureSibling: "keep" }]);
		assert.equal(q(host, "toggle-auto-update")!.getAttribute("aria-checked"), "false");
	});

	it("the shell's navigation request opens General with the about block first, but opening alone never checks", async () => {
		const b = bridge();
		globalThis.fetch = async () => Response.json({ settings: { version: 1 } });
		const host = await mount(<SettingsDialogProvider><span>app</span></SettingsDialogProvider>);
		assert.equal(q(document, "settings-dialog"), null);
		await b.open();
		assert.equal(q(document, "settings-nav-general")!.getAttribute("aria-current"), "true");
		const section = q(document, "section-general")!;
		const aboutBlock = q(section, "settings-about")!;
		assert.ok(aboutBlock);
		assert.equal(section.querySelector("[data-testid^='settings-']"), q(section, "settings-about-group"), "Om is the first group");
		assert.ok(q(document, "row-version")); assert.equal(b.calls.check, 0);
		assert.ok(host.textContent!.includes("app"));
	});
});
