/**
 * «Meld feil» (2026-11-26): the student describes what went wrong, and the
 * local server sends it with the technical info to the website's
 * /api/feil, which files it as an issue in a private GitHub repo.
 *
 * The server does this (not the renderer) because only it can read the
 * desktop log: <userData>/logs/main.log, next to LH_DATA_DIR (<userData>/data).
 * The home folder is replaced by «~» in everything sent, so the OS user name
 * stays on the machine. The preview (GET) shows exactly what POST sends.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveSettings } from "../core/settings-resolution.ts";
import { readSettings } from "../store/settings.ts";

export const FEEDBACK_URL = process.env.LH_FEEDBACK_URL ?? "https://eksamenshjelp-one.vercel.app/api/feil";
export const FEEDBACK_LOG_LINES = 200;
export const FEEDBACK_MESSAGE_MAX = 5000;
const LOG_TAIL_BYTES = 48 * 1024;
const LOG_MAX_CHARS = 40000;

export interface FeedbackInfo {
	version: string;
	os: string;
	provider: string;
}

export interface FeedbackPayload {
	message: string;
	email?: string;
	info?: FeedbackInfo;
	log?: string;
}

/** Replace the home folder (both slash styles on Windows) with «~». */
export function redactHome(text: string, home: string = os.homedir()): string {
	if (!home || home.length < 3) return text;
	const variants = new Set([home, home.replace(/\\/g, "/"), home.replace(/\//g, "\\")]);
	let out = text;
	for (const variant of variants) out = out.split(variant).join("~");
	return out;
}

/** The last `lines` lines of a file, reading only its tail. "" when missing. */
export function readLogTail(file: string, lines: number = FEEDBACK_LOG_LINES): string {
	let fd: number | undefined;
	try {
		fd = fs.openSync(file, "r");
		const size = fs.fstatSync(fd).size;
		const length = Math.min(size, LOG_TAIL_BYTES);
		const buffer = Buffer.alloc(length);
		fs.readSync(fd, buffer, 0, length, size - length);
		let text = buffer.toString("utf8");
		if (length < size) text = text.slice(text.indexOf("\n") + 1); // drop the cut first line
		const all = text.replace(/\n+$/, "").split("\n");
		return all.slice(-lines).join("\n").slice(-LOG_MAX_CHARS);
	} catch {
		return "";
	} finally {
		if (fd !== undefined) fs.closeSync(fd);
	}
}

/** <userData>/logs/main.log for the desktop app; null when not running in it. */
export function desktopLogFile(env: NodeJS.ProcessEnv = process.env): string | null {
	if (!env.LH_DATA_DIR) return null;
	return path.join(path.dirname(path.resolve(env.LH_DATA_DIR)), "logs", "main.log");
}

function osLabel(): string {
	const name = process.platform === "darwin" ? "macOS" : process.platform === "win32" ? "Windows" : process.platform;
	return `${name} ${os.release()} (${process.arch})`;
}

function providerLabel(): string {
	try {
		const strong = resolveSettings(readSettings()).models.strong;
		return strong ? `${strong.provider} / ${strong.id}` : "ingen modell valgt";
	} catch {
		return "ukjent";
	}
}

/** What «Ta med teknisk info» adds: shown in the preview, sent on POST. */
export function collectFeedbackDetails(): { info: FeedbackInfo; log: string } {
	const file = desktopLogFile();
	return {
		info: {
			version: process.env.LH_APP_VERSION ?? process.env.npm_package_version ?? "ukjent",
			os: osLabel(),
			provider: redactHome(providerLabel()),
		},
		log: file ? redactHome(readLogTail(file)) : "",
	};
}

export type FeedbackInput = { message?: unknown; email?: unknown; includeDetails?: unknown };

/** Validate the dialog's input; the same rules the website checks again. */
export function buildFeedbackPayload(
	input: FeedbackInput,
	details: () => { info: FeedbackInfo; log: string } = collectFeedbackDetails,
): { ok: true; payload: FeedbackPayload } | { ok: false; error: string } {
	const message = typeof input.message === "string" ? input.message.trim() : "";
	if (!message) return { ok: false, error: "Skriv hva som skjedde." };
	if (message.length > FEEDBACK_MESSAGE_MAX) return { ok: false, error: `Meldingen kan være høyst ${FEEDBACK_MESSAGE_MAX} tegn.` };
	const email = typeof input.email === "string" ? input.email.trim() : "";
	if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "E-postadressen ser ikke riktig ut." };
	const payload: FeedbackPayload = { message: redactHome(message) };
	if (email) payload.email = email;
	if (input.includeDetails !== false) {
		const { info, log } = details();
		payload.info = info;
		if (log) payload.log = log;
	}
	return { ok: true, payload };
}

/** POST to the website. Resolves to null on success, else a Norwegian error. */
export async function sendFeedback(payload: FeedbackPayload, fetchImpl: typeof fetch = fetch): Promise<string | null> {
	try {
		const response = await fetchImpl(FEEDBACK_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(15000),
		});
		if (response.ok) return null;
		const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
		return typeof body?.error === "string" ? body.error : "Klarte ikke å sende meldingen. Prøv igjen senere.";
	} catch {
		return "Fikk ikke kontakt med mottaket. Sjekk at du er på nett, og prøv igjen.";
	}
}
