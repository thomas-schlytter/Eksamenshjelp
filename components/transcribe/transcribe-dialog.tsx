"use client";

/**
 * «Les av skjermbilde» — the review window. The image sits beside the
 * formatted result so the learner can check the reading line by line; the
 * LaTeX source underneath is editable and the formatted view follows every
 * keystroke. Nothing reaches the composer until «Sett inn».
 *
 * The reading is verbatim unless «Fiks opplagte feil» is ticked; ticking
 * (or unticking) reads the image again and replaces the text, and a fixed
 * reading lists what was changed so the learner can go over it himself.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { BrailleSpinner } from "@/components/braille-spinner";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import { appendToPrimaryInput } from "@/components/dictation";
import type { TranscribeRequest } from "./transcribe-event.ts";

export type TranscribeState =
	| { status: "reading" }
	| { status: "failed"; error: string }
	| { status: "ready" };

const UNREADABLE = "[uleselig]";

/** The window's pure body — exported for static-render tests. The wrapper
 *  owns the request, the effects and the portal. */
export function TranscribeBody({
	imageUrl,
	state,
	latex,
	changes,
	fix,
	canAttach,
	onLatex,
	onFix,
	onRetry,
	onInsert,
	onAttach,
	onClose,
}: {
	imageUrl: string | null;
	state: TranscribeState;
	latex: string;
	changes: string[];
	fix: boolean;
	canAttach: boolean;
	onLatex: (value: string) => void;
	onFix: (value: boolean) => void;
	onRetry: () => void;
	onInsert: () => void;
	onAttach: () => void;
	onClose: () => void;
}) {
	const backdropDismiss = useBackdropDismiss(onClose);
	const reading = state.status === "reading";
	const unreadable = state.status === "ready" && latex.includes(UNREADABLE);
	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Les av skjermbilde"
			data-testid="transcribe-dialog"
			className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
			{...backdropDismiss}
		>
			<div className="flex max-h-full w-full max-w-5xl flex-col rounded-xl border bg-card shadow-lg" onClick={(e) => e.stopPropagation()}>
				<div className="flex items-center justify-between border-b px-5 py-3">
					<h2 className="text-sm font-semibold text-card-foreground">Les av skjermbilde</h2>
					<button type="button" aria-label="Lukk" onClick={onClose} className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
						<XIcon className="size-4" aria-hidden />
					</button>
				</div>

				<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
					<div className="grid gap-4 md:grid-cols-2">
						<section aria-label="Skjermbildet" className="flex min-w-0 flex-col gap-1.5">
							<p className="font-ui text-xs uppercase tracking-widest text-muted-foreground/70">Skjermbildet</p>
							<div className="max-h-[42vh] overflow-auto rounded-md border bg-background">
								{imageUrl && (
									// eslint-disable-next-line @next/next/no-img-element -- a local blob URL, not an optimizable asset
									<img src={imageUrl} alt="Skjermbildet som leses av" data-testid="transcribe-image" className="block w-full" />
								)}
							</div>
						</section>
						<section aria-label="Formatert visning" className="flex min-w-0 flex-col gap-1.5">
							<p className="font-ui text-xs uppercase tracking-widest text-muted-foreground/70">Slik blir det</p>
							<div data-testid="transcribe-preview" className="max-h-[42vh] min-h-24 overflow-auto rounded-md border bg-background p-3 text-sm">
								{reading ? (
									<span className="flex items-center gap-2 text-muted-foreground"><BrailleSpinner label="Leser av bildet" /> Leser av bildet…</span>
								) : state.status === "failed" ? (
									<div role="alert" className="flex flex-col items-start gap-2">
										<p className="text-destructive">{state.error}</p>
										<button type="button" data-testid="transcribe-retry" onClick={onRetry} className="rounded-sm border px-3 py-1.5 text-xs hover:bg-accent">Prøv igjen</button>
									</div>
								) : latex.trim() ? (
									<MessageResponse>{latex}</MessageResponse>
								) : (
									<span className="text-muted-foreground">Ingen tekst.</span>
								)}
							</div>
						</section>
					</div>

					<div className="flex flex-col gap-1.5">
						<label htmlFor="transcribe-latex" className="font-ui text-xs uppercase tracking-widest text-muted-foreground/70">LaTeX (kan rettes)</label>
						<textarea
							id="transcribe-latex"
							data-testid="transcribe-latex"
							value={latex}
							onChange={(e) => onLatex(e.target.value)}
							disabled={state.status !== "ready"}
							spellCheck={false}
							placeholder="$$\int_0^1 e^{2x}\,dx$$"
							className="h-44 w-full resize-y rounded-md border bg-background p-3 font-mono text-xs text-foreground outline-none focus-visible:border-ring disabled:opacity-50"
						/>
						{unreadable && (
							<p data-testid="transcribe-unreadable" className="text-xs text-amber-600 dark:text-amber-400">
								Noe i bildet lot seg ikke lese og er merket {UNREADABLE}. Fyll inn selv før du setter inn.
							</p>
						)}
					</div>

					<div className="flex flex-col gap-1.5">
						<label className="flex cursor-pointer items-start gap-2 text-sm">
							<input
								type="checkbox"
								data-testid="transcribe-fix"
								checked={fix}
								disabled={reading}
								onChange={(e) => onFix(e.target.checked)}
								className="mt-0.5 size-4"
							/>
							<span>
								Fiks opplagte feil
								<span className="block text-xs text-muted-foreground">
									Av: bildet skrives av ordrett, også feil. På: bildet leses på nytt, opplagte feil rettes, og teksten over erstattes.
								</span>
							</span>
						</label>
						{fix && state.status === "ready" && (
							<div data-testid="transcribe-changes" className="rounded-md border bg-background p-3 text-sm">
								<p className="mb-1 font-medium">{changes.length > 0 ? "Dette ble rettet. Gå over det selv:" : "Ingenting ble rettet."}</p>
								{changes.length > 0 && <MessageResponse>{changes.map((change) => `- ${change}`).join("\n")}</MessageResponse>}
							</div>
						)}
					</div>
				</div>

				<div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
					<div>
						{canAttach && (
							<button type="button" data-testid="transcribe-attach" onClick={onAttach} className="rounded-sm px-3 py-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
								Legg ved som fil i stedet
							</button>
						)}
					</div>
					<div className="flex gap-2">
						<button type="button" data-testid="transcribe-cancel" onClick={onClose} className="rounded-sm px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
							Avbryt
						</button>
						<button
							type="button"
							data-testid="transcribe-insert"
							onClick={onInsert}
							disabled={state.status !== "ready" || !latex.trim()}
							className="rounded-sm bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
						>
							Sett inn
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

function toDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error ?? new Error("read failed"));
		reader.readAsDataURL(blob);
	});
}

export function TranscribeDialog({ request, onClose }: { request: TranscribeRequest; onClose: () => void }) {
	const [state, setState] = useState<TranscribeState>({ status: "reading" });
	const [latex, setLatex] = useState("");
	const [changes, setChanges] = useState<string[]>([]);
	const [fix, setFix] = useState(false);
	const [imageUrl, setImageUrl] = useState<string | null>(null);
	const inFlight = useRef<AbortController | null>(null);

	useEffect(() => {
		const url = URL.createObjectURL(request.image);
		setImageUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [request.image]);

	const read = useCallback(async (withFix: boolean) => {
		inFlight.current?.abort();
		const controller = new AbortController();
		inFlight.current = controller;
		setState({ status: "reading" });
		try {
			const image = await toDataUrl(request.image);
			const res = await fetch("/api/transcribe", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ image, fix: withFix }),
				signal: controller.signal,
			});
			const body = (await res.json().catch(() => ({}))) as { latex?: string; changes?: string[]; error?: string };
			if (controller.signal.aborted) return;
			if (!res.ok || typeof body.latex !== "string") {
				setState({ status: "failed", error: body.error ?? "Avlesningen feilet. Prøv igjen om litt." });
				return;
			}
			setLatex(body.latex);
			setChanges(Array.isArray(body.changes) ? body.changes : []);
			setState({ status: "ready" });
		} catch {
			if (controller.signal.aborted) return;
			setState({ status: "failed", error: "Fikk ikke kontakt med appen. Prøv igjen." });
		}
	}, [request.image]);

	useEffect(() => {
		void read(false);
		return () => inFlight.current?.abort();
	}, [read]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			onClose();
		};
		// Capture: Esc must close this window, not abort the turn under it.
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [onClose]);

	return createPortal(
		<TranscribeBody
			imageUrl={imageUrl}
			state={state}
			latex={latex}
			changes={changes}
			fix={fix}
			canAttach={Boolean(request.attachAsFile)}
			onLatex={setLatex}
			onFix={(value) => { setFix(value); void read(value); }}
			onRetry={() => void read(fix)}
			onInsert={() => {
				const text = latex.trim();
				if (request.insert) request.insert(text);
				else appendToPrimaryInput(text);
				onClose();
			}}
			onAttach={() => { request.attachAsFile?.(); onClose(); }}
			onClose={onClose}
		/>,
		document.body,
	);
}
