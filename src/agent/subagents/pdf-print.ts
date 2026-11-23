import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { ensureBrowserService, resolveChromeExecutablePath } from "./headless.ts";

/**
 * HTML → PDF (fase 6, the prøveeksamen paper). The engine choice:
 *
 *   PRIMARY — the app's own Electron, through the browser-service helper the
 *   server already spawns for demos (headless.ts). The helper receives one
 *   IPC message per print, loads the HTML file in a hidden window and calls
 *   `webContents.printToPDF` — Electron's documented printing API, the same
 *   Chromium print pipeline as headless Chrome, available in the packaged
 *   app (the helper is process.execPath) and in dev (the electron package's
 *   binary) alike. IPC, not CDP: CDP's Page.printToPDF is a Chrome-browser
 *   delegate feature an embedder may not implement, while printToPDF on
 *   webContents is Electron's own contract. No extra Chromium ships.
 *
 *   FALLBACK — a system Chrome/Chromium through puppeteer-core's page.pdf()
 *   (plain web dev without the electron binary). Neither = an honest error;
 *   the caller keeps the exam and reports that the PDF is missing.
 *
 * Test seam: `pdfPrinterOverride.current` replaces the engine entirely.
 */

export interface PrintPdfOptions {
	/** Chromium footer template (pageNumber/totalPages spans). */
	footerTemplate?: string;
}

export type PdfPrinter = (html: string, opts?: PrintPdfOptions) => Promise<Buffer>;

export const pdfPrinterOverride: { current?: PdfPrinter } = {};

const PRINT_TIMEOUT_MS = 60_000;
/** Paper margins (inches): the footer lives inside the bottom margin. */
const MARGINS = { top: 0.85, bottom: 0.8, left: 0.8, right: 0.8 };

export async function printHtmlToPdf(html: string, opts: PrintPdfOptions = {}): Promise<Buffer> {
	if (pdfPrinterOverride.current) return pdfPrinterOverride.current(html, opts);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-print-"));
	const file = path.join(dir, "paper.html");
	const out = path.join(dir, "paper.pdf");
	fs.writeFileSync(file, html, "utf-8");
	try {
		let helperError: string | null = null;
		try {
			const viaHelper = await printViaHelper(file, out, opts);
			if (viaHelper) return viaHelper;
			helperError = "the app's print helper is not available";
		} catch (err) {
			helperError = err instanceof Error ? err.message : String(err);
		}
		try {
			return await printViaChrome(file, opts);
		} catch (err) {
			const chromeError = err instanceof Error ? err.message : String(err);
			throw new Error(`could not print the PDF (app helper: ${helperError}; Chrome: ${chromeError})`);
		}
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

/** The helper path: null = no helper (try the fallback); throws on a
 *  helper that answered with an error or never answered. */
async function printViaHelper(file: string, out: string, opts: PrintPdfOptions): Promise<Buffer | null> {
	const service = await ensureBrowserService();
	if (!service || typeof service.proc.send !== "function" || !service.proc.connected) return null;
	const { proc } = service;
	const id = randomUUID();
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("the print helper did not answer in time"));
		}, PRINT_TIMEOUT_MS);
		const onMessage = (msg: unknown) => {
			const m = msg as { type?: string; id?: string; ok?: boolean; error?: string } | null;
			if (!m || m.type !== "lh:print-pdf:done" || m.id !== id) return;
			cleanup();
			if (m.ok) resolve();
			else reject(new Error(m.error ?? "the print helper failed"));
		};
		const onExit = () => {
			cleanup();
			reject(new Error("the print helper exited"));
		};
		function cleanup() {
			clearTimeout(timer);
			proc.off("message", onMessage);
			proc.off("exit", onExit);
		}
		proc.on("message", onMessage);
		proc.once("exit", onExit);
		proc.send({
			type: "lh:print-pdf",
			id,
			file,
			out,
			options: {
				pageSize: "A4",
				printBackground: true,
				margins: MARGINS,
				displayHeaderFooter: Boolean(opts.footerTemplate),
				headerTemplate: "<span></span>",
				footerTemplate: opts.footerTemplate ?? "<span></span>",
			},
		});
	});
	return fs.readFileSync(out);
}

async function printViaChrome(file: string, opts: PrintPdfOptions): Promise<Buffer> {
	const puppeteer = (await import("puppeteer-core")).default;
	const executablePath = resolveChromeExecutablePath();
	const browser = await puppeteer.launch({
		headless: true,
		...(executablePath ? { executablePath } : { channel: "chrome" as const }),
		args: ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
	});
	try {
		const page = await browser.newPage();
		await page.setJavaScriptEnabled(false);
		await page.goto(pathToFileURL(file).href, { waitUntil: "load", timeout: 30_000 });
		const pdf = await page.pdf({
			format: "A4",
			printBackground: true,
			margin: { top: `${MARGINS.top}in`, bottom: `${MARGINS.bottom}in`, left: `${MARGINS.left}in`, right: `${MARGINS.right}in` },
			displayHeaderFooter: Boolean(opts.footerTemplate),
			headerTemplate: "<span></span>",
			footerTemplate: opts.footerTemplate ?? "<span></span>",
		});
		return Buffer.from(pdf);
	} finally {
		await browser.close().catch(() => {});
	}
}

/** A PDF's page count (pdfjs — no browser). */
export async function pdfPageCount(pdf: Uint8Array): Promise<number> {
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	const task = pdfjs.getDocument({ data: new Uint8Array(pdf), verbosity: 0 });
	try {
		const doc = await task.promise;
		return doc.numPages;
	} finally {
		await task.destroy().catch(() => {});
	}
}
