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
import UpdateBanner from "../components/update-banner.tsx";
import type { UpdateState } from "../components/settings/update-settings.tsx";

// The window.lh bridge type is declared globally by components/sidebar.tsx.
const dom = parseHTML("<html><body></body></html>");
(globalThis as Record<string, unknown>).window = dom.window;
(globalThis as Record<string, unknown>).document = dom.document;

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
		root.unmount();
		host.remove();
	});
});
