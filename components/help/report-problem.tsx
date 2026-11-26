"use client";

/**
 * «Meld feil» (2026-11-26): the card at the top of the help centre. The
 * form opens in place (one column, label above, example in the field, the
 * details folded away). Sending goes through the local server
 * (/api/feedback), which adds the technical info and posts it to the
 * website; the preview shows exactly that info.
 */

import { useEffect, useState } from "react";
import { Bug, Check, ChevronDown } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const MAX = 5000;

type Details = { info: { version: string; os: string; provider: string }; log: string };
type Status = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string };

/** The text «Kopier meldingen» puts on the clipboard when sending fails. */
export function feedbackText(message: string, email: string, details: Details | null): string {
	const parts = [`Hva skjedde:\n${message.trim()}`];
	if (email.trim()) parts.push(`Svar til: ${email.trim()}`);
	if (details) {
		parts.push(`Versjon: ${details.info.version}\nSystem: ${details.info.os}\nAI: ${details.info.provider}`);
		if (details.log) parts.push(`Logg:\n${details.log}`);
	}
	return parts.join("\n\n");
}

export function ReportProblem() {
	const [open, setOpen] = useState(false);
	const [message, setMessage] = useState("");
	const [email, setEmail] = useState("");
	const [includeDetails, setIncludeDetails] = useState(true);
	const [details, setDetails] = useState<Details | null>(null);
	const [status, setStatus] = useState<Status>({ kind: "idle" });
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!open || details) return;
		let cancelled = false;
		fetch("/api/feedback")
			.then((res) => (res.ok ? res.json() : null))
			.then((data: Details | null) => {
				if (!cancelled && data) setDetails(data);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [open, details]);

	const send = async () => {
		if (!message.trim() || status.kind === "sending") return;
		setStatus({ kind: "sending" });
		try {
			const res = await fetch("/api/feedback", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ message, email, includeDetails }),
			});
			const data = (await res.json().catch(() => null)) as { error?: string } | null;
			if (res.ok) {
				setStatus({ kind: "sent" });
				setMessage("");
			} else {
				setStatus({ kind: "error", message: data?.error ?? "Klarte ikke å sende meldingen." });
			}
		} catch {
			setStatus({ kind: "error", message: "Fikk ikke kontakt med appen. Prøv igjen." });
		}
	};

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(feedbackText(message, email, includeDetails ? details : null));
			setCopied(true);
			window.setTimeout(() => setCopied(false), 2400);
		} catch { /* nothing to fall back to */ }
	};

	return (
		<section id="meld-feil" aria-labelledby="meld-feil-tittel" data-testid="report-problem" className="mt-6 scroll-mt-6 rounded-lg border border-border bg-card p-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="min-w-0">
					<h2 id="meld-feil-tittel" className="text-sm font-semibold">
						Noe som ikke virker?
					</h2>
					<p className="mt-1 text-sm text-muted-foreground">Fortell hva som skjedde, så blir det fikset.</p>
				</div>
				{!open && (
					<button
						type="button"
						onClick={() => {
							setOpen(true);
							setStatus({ kind: "idle" });
						}}
						data-testid="report-problem-open"
						className={`inline-flex shrink-0 items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent ${FOCUS_RING}`}
					>
						<Bug className="size-4" aria-hidden="true" />
						Meld feil
					</button>
				)}
			</div>

			{open && status.kind === "sent" && (
				<div role="status" className="mt-4 flex items-start gap-2 text-sm">
					<Check className="mt-0.5 size-4 shrink-0 text-[var(--success,#2F7A57)]" aria-hidden="true" />
					<div>
						<p className="font-medium">Takk! Meldingen er sendt.</p>
						<button type="button" onClick={() => setStatus({ kind: "idle" })} className={`mt-1 text-sm text-muted-foreground underline underline-offset-4 ${FOCUS_RING}`}>
							Meld en feil til
						</button>
					</div>
				</div>
			)}

			{open && status.kind !== "sent" && (
				<form
					className="mt-4 flex flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						void send();
					}}
				>
					<label className="flex flex-col gap-1.5 text-sm">
						<span className="font-medium">Hva skjedde?</span>
						<Textarea
							value={message}
							onChange={(event) => setMessage(event.target.value.slice(0, MAX))}
							placeholder="For eksempel: Jeg trykket Avslutt økt, og ingenting skjedde."
							rows={4}
							required
							autoFocus
							data-testid="report-problem-message"
							className="bg-background"
						/>
					</label>

					<label className="flex flex-col gap-1.5 text-sm">
						<span className="font-medium">
							E-post, hvis du vil ha svar <span className="font-normal text-muted-foreground">(valgfritt)</span>
						</span>
						<input
							type="email"
							value={email}
							onChange={(event) => setEmail(event.target.value)}
							placeholder="navn@stud.ntnu.no"
							autoComplete="email"
							className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
						/>
					</label>

					<label className="flex items-start gap-2 text-sm">
						<input type="checkbox" checked={includeDetails} onChange={(event) => setIncludeDetails(event.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
						<span>
							Ta med teknisk info
							<span className="block text-muted-foreground">Versjon, system, hvilken AI du bruker og de siste linjene fra loggen. Brukernavnet ditt på maskinen tas bort.</span>
						</span>
					</label>

					{includeDetails && (
						<details className="group text-sm">
							<summary className={`flex cursor-pointer list-none items-center gap-1 text-muted-foreground ${FOCUS_RING}`}>
								<ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
								Se hva som sendes
							</summary>
							<pre data-testid="report-problem-preview" className="mt-2 max-h-64 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs whitespace-pre-wrap">
								{details ? feedbackText(message || "(teksten du skriver over)", email, details) : "Henter …"}
							</pre>
						</details>
					)}

					{status.kind === "error" && (
						<div role="alert" className="text-sm">
							<p className="text-destructive">{status.message}</p>
							<button type="button" onClick={() => void copy()} className={`mt-1 text-sm underline underline-offset-4 ${FOCUS_RING}`}>
								{copied ? "Kopiert" : "Kopier meldingen"}
							</button>
						</div>
					)}

					<div className="flex items-center gap-2">
						<button
							type="submit"
							disabled={!message.trim() || status.kind === "sending"}
							data-testid="report-problem-send"
							className={`rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 ${FOCUS_RING}`}
						>
							{status.kind === "sending" ? "Sender …" : "Send"}
						</button>
						<button type="button" onClick={() => setOpen(false)} className={`rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent ${FOCUS_RING}`}>
							Avbryt
						</button>
					</div>
				</form>
			)}
		</section>
	);
}
