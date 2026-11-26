/**
 * POST /api/feil — «Meld feil» from the Eksamenshjelp app (Vercel function).
 *
 * The app's local server sends { message, email?, info?, log? }; this turns
 * it into an issue in the PRIVATE repo thomas-schlytter/eksamenshjelp-feil,
 * labelled «fra-appen». The token lives only in Vercel:
 *   vercel env add FEIL_GITHUB_TOKEN production
 * (fine-grained, Issues: Read and write, that one repo).
 *
 * The endpoint is public by nature (the app is open source), so it caps
 * sizes and rate-limits per IP. The limit is per function instance: it stops
 * a loop or a careless script, not a determined spammer. Issues land in a
 * private repo where they can be deleted.
 */

const REPO = "thomas-schlytter/eksamenshjelp-feil";
const LABEL = "fra-appen";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGE = 5000;
const MAX_LOG = 40000;
const MAX_EMAIL = 200;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;

const hits = new Map();

export function rateLimited(ip, now = Date.now()) {
	const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
	if (recent.length >= RATE_MAX) {
		hits.set(ip, recent);
		return true;
	}
	recent.push(now);
	hits.set(ip, recent);
	if (hits.size > 5000) hits.clear();
	return false;
}

const str = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");

/** Returns { ok: true, report } or { ok: false, error } (Norwegian, for the app). */
export function validate(body) {
	if (!body || typeof body !== "object") return { ok: false, error: "Meldingen mangler." };
	const message = str(body.message, MAX_MESSAGE + 1).trim();
	if (!message) return { ok: false, error: "Skriv hva som skjedde." };
	if (message.length > MAX_MESSAGE) return { ok: false, error: `Meldingen kan være høyst ${MAX_MESSAGE} tegn.` };
	const email = str(body.email, MAX_EMAIL + 1).trim();
	if (email && (email.length > MAX_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
		return { ok: false, error: "E-postadressen ser ikke riktig ut." };
	}
	const info = body.info && typeof body.info === "object" ? body.info : {};
	return {
		ok: true,
		report: {
			message,
			email,
			info: {
				version: str(info.version, 40),
				os: str(info.os, 60),
				provider: str(info.provider, 80),
			},
			log: str(body.log, MAX_LOG),
		},
	};
}

/** No @mentions from user text (GitHub would notify), no breaking out of the log fence. */
const noMentions = (text) => text.replace(/@/g, "@​");
const quote = (text) => text.split(/\r?\n/).map((line) => `> ${line}`).join("\n");

export function buildIssue(report) {
	const firstLine = report.message.split(/\r?\n/)[0].replace(/\s+/g, " ").trim();
	const short = firstLine.length > 70 ? `${firstLine.slice(0, 69)}…` : firstLine;
	const version = report.info.version || "ukjent versjon";
	const lines = [
		"**Hva skjedde**",
		"",
		quote(noMentions(report.message)),
		"",
		`**Svar til:** ${report.email ? `\`${report.email}\`` : "ingen e-post oppgitt"}`,
		"",
		"| Versjon | System | AI |",
		"| --- | --- | --- |",
		`| ${report.info.version || "–"} | ${report.info.os || "–"} | ${report.info.provider || "–"} |`,
	];
	if (report.log) {
		lines.push("", "<details><summary>Logg (siste linjer)</summary>", "", "````text", report.log.replace(/````/g, "'''"), "````", "", "</details>");
	}
	return { title: noMentions(`[${version}] ${short}`), body: lines.join("\n"), labels: [LABEL] };
}

export default async function handler(req, res) {
	if (req.method !== "POST") {
		res.setHeader("Allow", "POST");
		return res.status(405).json({ error: "Bare POST." });
	}
	const length = Number(req.headers["content-length"] ?? 0);
	if (length > MAX_BODY_BYTES) return res.status(413).json({ error: "Meldingen er for stor." });

	const ip = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || "ukjent";
	if (rateLimited(ip)) return res.status(429).json({ error: "Du har sendt mange meldinger nå. Prøv igjen om litt." });

	const checked = validate(req.body);
	if (!checked.ok) return res.status(400).json({ error: checked.error });

	const token = process.env.FEIL_GITHUB_TOKEN;
	if (!token) return res.status(503).json({ error: "Mottaket for feilmeldinger er ikke satt opp ennå." });

	try {
		const response = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
			method: "POST",
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${token}`,
				"User-Agent": "eksamenshjelp-feil",
				"X-GitHub-Api-Version": "2022-11-28",
			},
			body: JSON.stringify(buildIssue(checked.report)),
			signal: AbortSignal.timeout(10000),
		});
		if (!response.ok) {
			console.error("github", response.status, await response.text().catch(() => ""));
			return res.status(502).json({ error: "Klarte ikke å lagre meldingen. Prøv igjen senere." });
		}
		return res.status(201).json({ ok: true });
	} catch (err) {
		console.error("github", err);
		return res.status(502).json({ error: "Klarte ikke å lagre meldingen. Prøv igjen senere." });
	}
}
