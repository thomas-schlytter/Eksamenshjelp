/**
 * «Meld feil» (2026-11-26): the app side (src/server/feedback.ts) and the
 * website's receiver (site/api/feil.mjs). No network: fetch is faked.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { buildFeedbackPayload, desktopLogFile, readLogTail, redactHome, sendFeedback } from "../src/server/feedback.ts";
import handler, { buildIssue, rateLimited, validate } from "../site/api/feil.mjs";

const details = () => ({ info: { version: "0.7.3", os: "macOS 25.4.0 (arm64)", provider: "claude-code / opus" }, log: "linje" });

describe("feedback (app side)", () => {
	it("replaces the home folder in both slash styles", () => {
		assert.equal(redactHome("/Users/kari/Library/x and /Users/kari", "/Users/kari"), "~/Library/x and ~");
		assert.equal(redactHome("C:\\Users\\kari\\AppData and C:/Users/kari/x", "C:\\Users\\kari"), "~\\AppData and ~/x");
	});

	it("reads only the last lines of the log, and nothing when it is missing", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-feedback-"));
		const file = path.join(dir, "main.log");
		fs.writeFileSync(file, Array.from({ length: 5000 }, (_, i) => `linje ${i}`).join("\n") + "\n");
		const tail = readLogTail(file, 200).split("\n");
		assert.equal(tail.length, 200);
		assert.equal(tail[0], "linje 4800");
		assert.equal(tail.at(-1), "linje 4999");
		assert.equal(readLogTail(path.join(dir, "finnes-ikke.log")), "");
	});

	it("finds the desktop log next to the data folder", () => {
		assert.equal(desktopLogFile({ LH_DATA_DIR: "/a/LearnHarness/data" } as unknown as NodeJS.ProcessEnv), path.join("/a/LearnHarness", "logs", "main.log"));
		assert.equal(desktopLogFile({} as unknown as NodeJS.ProcessEnv), null);
	});

	it("validates the input and adds the details only when asked", () => {
		assert.deepEqual(buildFeedbackPayload({ message: "   " }, details), { ok: false, error: "Skriv hva som skjedde." });
		assert.equal(buildFeedbackPayload({ message: "x".repeat(5001) }, details).ok, false);
		assert.deepEqual(buildFeedbackPayload({ message: "Hei", email: "ikke-epost" }, details), { ok: false, error: "E-postadressen ser ikke riktig ut." });
		const withInfo = buildFeedbackPayload({ message: " Hei ", email: "kari@stud.ntnu.no" }, details);
		assert.deepEqual(withInfo, { ok: true, payload: { message: "Hei", email: "kari@stud.ntnu.no", ...details() } });
		const without = buildFeedbackPayload({ message: "Hei", includeDetails: false }, details);
		assert.deepEqual(without, { ok: true, payload: { message: "Hei" } });
	});

	it("maps the website's answers to a Norwegian error or null", async () => {
		const answer = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
		assert.equal(await sendFeedback({ message: "Hei" }, answer(201, { ok: true })), null);
		assert.equal(await sendFeedback({ message: "Hei" }, answer(429, { error: "Vent litt." })), "Vent litt.");
		const offline = (async () => { throw new Error("ENOTFOUND"); }) as unknown as typeof fetch;
		assert.match((await sendFeedback({ message: "Hei" }, offline)) ?? "", /Fikk ikke kontakt/);
	});
});

describe("site/api/feil.mjs (website receiver)", () => {
	it("validates like the app does", () => {
		assert.equal(validate(null).ok, false);
		assert.equal(validate({ message: "" }).ok, false);
		assert.equal(validate({ message: "Hei", email: "x" }).ok, false);
		const ok = validate({ message: "Hei", info: { version: "0.7.3" }, log: "l" });
		assert.equal(ok.ok, true);
		assert.equal(ok.report?.info.version, "0.7.3");
	});

	it("builds a private issue without mentions or fence breaks", () => {
		const issue = buildIssue({ message: "Ping @thomas\nlinje to", email: "kari@stud.ntnu.no", info: { version: "0.7.3", os: "macOS", provider: "claude" }, log: "a ```` b" });
		assert.equal(issue.title, "[0.7.3] Ping @\u200bthomas");
		assert.deepEqual(issue.labels, ["fra-appen"]);
		assert.match(issue.body, /> Ping @\u200bthomas\n> linje to/);
		assert.match(issue.body, /`kari@stud\.ntnu\.no`/);
		assert.equal(issue.body.split("````").length - 1, 2, "only the fence itself");
	});

	it("rate-limits one address to five reports per ten minutes", () => {
		const now = 1_000_000;
		for (let i = 0; i < 5; i++) assert.equal(rateLimited("test-ip", now + i), false);
		assert.equal(rateLimited("test-ip", now + 10), true);
		assert.equal(rateLimited("test-ip", now + 10 * 60 * 1000 + 10), false);
	});

	it("answers 503 honestly when the token is not set", async () => {
		const saved = process.env.FEIL_GITHUB_TOKEN;
		delete process.env.FEIL_GITHUB_TOKEN;
		let status = 0;
		let body: unknown = null;
		const res = { setHeader() {}, status(code: number) { status = code; return this; }, json(value: unknown) { body = value; return this; } };
		await handler({ method: "POST", headers: { "x-forwarded-for": "token-test" }, body: { message: "Hei" } }, res);
		if (saved !== undefined) process.env.FEIL_GITHUB_TOKEN = saved;
		assert.equal(status, 503);
		assert.deepEqual(body, { error: "Mottaket for feilmeldinger er ikke satt opp ennå." });
	});
});
