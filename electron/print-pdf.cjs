/*
 * The browser-service helper's PDF printer (fase 6, prøveeksamen): the
 * server sends { type: "lh:print-pdf", id, file, out, options } over the
 * helper's Node IPC channel (src/agent/subagents/pdf-print.ts); the helper
 * loads the HTML file in its own hidden window, waits for the fonts, prints
 * with webContents.printToPDF and writes the PDF to `out`, then answers
 * { type: "lh:print-pdf:done", id, ok, error? }.
 *
 * One print at a time (a queue), one fresh window per print, destroyed
 * afterwards. The window runs no page script (the paper has none, and its
 * CSP forbids it) and has no preload, node or remote access.
 */
const fs = require("node:fs");
const path = require("node:path");

const FONT_WAIT_MS = 5000;

/** Only our own temp files: absolute paths, .html in, .pdf out, one dir. */
function validRequest(msg) {
	return (
		msg &&
		msg.type === "lh:print-pdf" &&
		typeof msg.id === "string" &&
		typeof msg.file === "string" &&
		typeof msg.out === "string" &&
		path.isAbsolute(msg.file) &&
		path.isAbsolute(msg.out) &&
		msg.file.endsWith(".html") &&
		msg.out.endsWith(".pdf") &&
		path.dirname(msg.file) === path.dirname(msg.out)
	);
}

function printOptions(raw) {
	const o = raw && typeof raw === "object" ? raw : {};
	return {
		pageSize: "A4",
		printBackground: true,
		...(o.margins && typeof o.margins === "object" ? { margins: o.margins } : {}),
		displayHeaderFooter: o.displayHeaderFooter === true,
		...(typeof o.headerTemplate === "string" ? { headerTemplate: o.headerTemplate } : {}),
		...(typeof o.footerTemplate === "string" ? { footerTemplate: o.footerTemplate } : {}),
	};
}

async function printOne(BrowserWindow, msg) {
	const win = new BrowserWindow({
		show: false,
		webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
	});
	try {
		await win.loadFile(msg.file);
		// Fonts (KaTeX) load lazily; printing before they settle prints fallbacks.
		await Promise.race([
			win.webContents.executeJavaScript("document.fonts.ready.then(() => true)", true),
			new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS)),
		]).catch(() => {});
		const data = await win.webContents.printToPDF(printOptions(msg.options));
		fs.writeFileSync(msg.out, data);
	} finally {
		win.destroy();
	}
}

/** Install the IPC listener (call after app ready). */
function installPrintPdf(BrowserWindow) {
	let chain = Promise.resolve();
	process.on("message", (msg) => {
		if (!msg || msg.type !== "lh:print-pdf") return;
		const reply = (ok, error) => {
			try {
				process.send?.({ type: "lh:print-pdf:done", id: msg.id, ok, ...(error ? { error } : {}) });
			} catch {
				/* parent gone */
			}
		};
		if (!validRequest(msg)) {
			reply(false, "invalid print request");
			return;
		}
		chain = chain.then(
			() => printOne(BrowserWindow, msg).then(() => reply(true), (err) => reply(false, err instanceof Error ? err.message : String(err))),
		);
	});
}

module.exports = { installPrintPdf, validRequest, printOptions };
