/**
 * Update-banner render tests: the banner is a pure function of the
 * shell's observational status — hidden without a bridge or a found
 * release, visible with "available", its link pointing at the release
 * page (opened in the system browser by the shell's window-open handler).
 * The subscribe effect only runs client-side, so the SSR pass pins the
 * hidden state; the pushed state is exercised by mounting with the bridge
 * stubbed (classic-JSX shim as in render-sidebar.test.tsx).
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as ReactDOMClient from "react-dom/client";
import { flushSync } from "react-dom";
import { parseHTML } from "linkedom";
import UpdateBanner, { UpdateBannerView } from "../components/update-banner.tsx";
import type { AvailableRelease, UpdateState } from "../components/settings/update-settings.tsx";

// The window.lh bridge type is declared globally by components/sidebar.tsx.
const dom = parseHTML("<html><body></body></html>");
(globalThis as Record<string, unknown>).window = dom.window;
(globalThis as Record<string, unknown>).document = dom.document;
const RELEASE = "https://github.com/thomas-schlytter/Eksamenshjelp/releases/tag/v0.5.0";

describe("update banner", () => {
	afterEach(() => {
		delete (window as { lh?: unknown }).lh;
	});

	it("renders nothing with no bridge (browser / SSR)", () => {
		const html = renderToStaticMarkup(<UpdateBanner />);
		assert.equal(html, "");
	});

	it("renders nothing when the bridge exists but no status has arrived", () => {
		(window as { lh?: unknown }).lh = {
			onUpdateStatus: () => () => {},
		};
		const html = renderToStaticMarkup(<UpdateBanner />);
		assert.equal(html, "");
	});

	it("shows the version and a download link once a newer release is pushed", async () => {
		let pushed: ((s: UpdateState) => void) | null = null;
		(window as { lh?: unknown }).lh = {
			onUpdateStatus: (cb: (s: UpdateState) => void) => {
				pushed = cb;
				return () => {};
			},
		};
		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = ReactDOMClient.createRoot(host);
		flushSync(() => root.render(<UpdateBanner />));
		assert.equal(host.innerHTML, "", "hidden before the push");

		await new Promise((r) => setTimeout(r, 0));
		flushSync(() => pushed?.({ status: "up-to-date", version: null, url: null, revision: 1 }));
		assert.equal(host.innerHTML, "", "no banner without a newer release");

		const url = "https://github.com/thomas-schlytter/Eksamenshjelp/releases/tag/v0.5.0";
		flushSync(() => pushed?.({ status: "available", version: "0.5.0", url, revision: 2 }));
		assert.ok(host.textContent!.includes("Ny versjon 0.5.0"), "the version renders");
		const link = host.querySelector<HTMLAnchorElement>("[data-testid='update-banner-download']");
		assert.ok(link, "download link exists");
		assert.equal(link!.textContent, "Last ned");
		assert.equal(link!.getAttribute("href"), url);
		assert.equal(link!.getAttribute("target"), "_blank");
		assert.ok(!host.innerHTML.includes("Start på nytt"), "no restart affordance remains");
		assert.equal(host.querySelector("[data-testid='update-banner-install']"), null, "no «Oppdater nå» without canInstall (Linux, dev)");
		root.unmount();
		host.remove();
	});

	it("where the shell can install, the one button is «Oppdater nå» and it calls the bridge", async () => {
		let pushed: ((s: UpdateState) => void) | null = null;
		let installs = 0;
		(window as { lh?: unknown }).lh = {
			onUpdateStatus: (cb: (s: UpdateState) => void) => { pushed = cb; return () => {}; },
			installUpdate: async () => { installs++; },
		};
		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = ReactDOMClient.createRoot(host);
		flushSync(() => root.render(<UpdateBanner />));
		await new Promise((r) => setTimeout(r, 0));
		flushSync(() => pushed?.({ status: "available", version: "0.5.0", url: RELEASE, revision: 1, canInstall: true, install: null }));
		const button = host.querySelector<HTMLButtonElement>("[data-testid='update-banner-install']");
		assert.equal(button?.textContent, "Oppdater nå");
		assert.equal(host.querySelector("[data-testid='update-banner-download']"), null, "no «Last ned» beside it");
		button!.click();
		assert.equal(installs, 1);
		root.unmount();
		host.remove();
	});
});

describe("update banner view (static render)", () => {
	const release = (over: Partial<AvailableRelease> = {}): AvailableRelease => ({ version: "0.5.0", url: RELEASE, canInstall: true, install: null, ...over });
	const render = (value: AvailableRelease) => {
		const html = renderToStaticMarkup(<UpdateBannerView release={value} onInstall={() => {}} onDismiss={() => {}} />);
		return parseHTML(`<html><body>${html}</body></html>`).document.body;
	};
	const status = (body: HTMLElement) => body.querySelector("[data-testid='update-banner-status']")!.textContent;

	it("offers «Oppdater nå» with the version and a close button", () => {
		const body = render(release());
		assert.equal(status(body), "Ny versjon 0.5.0");
		assert.equal(body.querySelector("[data-testid='update-banner-install']")!.textContent, "Oppdater nå");
		assert.ok(body.querySelector("[aria-label='Lukk oppdateringsvarselet']"));
	});

	it("shows download progress, then «Installerer …», with nothing to click", () => {
		for (const [install, text] of [
			[{ phase: "downloading", percent: 45 }, "Laster ned … 45 %"],
			[{ phase: "downloading", percent: null }, "Laster ned …"],
			[{ phase: "installing" }, "Installerer …"],
		] as const) {
			const body = render(release({ install }));
			assert.equal(status(body), text);
			assert.equal(body.querySelector("button, a"), null, `${text}: no buttons or links mid-install`);
		}
	});

	it("a failure shows the shell's message and «Last ned selv» to the release page", () => {
		const body = render(release({ install: { phase: "failed", message: "Nedlastingen stoppet. Sjekk nettforbindelsen." } }));
		assert.equal(status(body), "Nedlastingen stoppet. Sjekk nettforbindelsen.");
		const link = body.querySelector("[data-testid='update-banner-manual-download']")!;
		assert.equal(link.textContent, "Last ned selv");
		assert.equal(link.getAttribute("href"), RELEASE);
		assert.equal(link.getAttribute("target"), "_blank");
		assert.equal(body.querySelector("[data-testid='update-banner-install']"), null);
		assert.ok(body.querySelector("[aria-label='Lukk oppdateringsvarselet']"));
	});

	it("without canInstall (Linux, dev) the button stays «Last ned» to the release page", () => {
		const body = render(release({ canInstall: false }));
		const link = body.querySelector("[data-testid='update-banner-download']")!;
		assert.equal(link.textContent, "Last ned");
		assert.equal(link.getAttribute("href"), RELEASE);
		assert.equal(body.querySelector("[data-testid='update-banner-install']"), null);
	});
});
