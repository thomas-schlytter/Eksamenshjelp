"use client";

/**
 * «Avslutt økt» (owner, 2026-11-22; the end flow 2026-11-23): the top-bar
 * button, its choice popup, the summary + quiz window and the «Økt
 * avsluttet» divider in the transcript.
 *
 * The learner keeps one chat per course. The button ends the current økt
 * and works at any time, also while the teacher writes or a question
 * waits: the server stops the turn and closes the question itself. The
 * popup offers «Oppsummering med quiz» (a summary and 3-10 multiple-choice
 * questions on what happened since the previous divider; an option is
 * chosen first and sent with «Send svar», then feedback) or «Bare avslutt»
 * (the divider straight away). Closing the quiz window only pauses: the
 * draft lives on the record, so the button resumes it until the økt ends.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useEmblaCarousel from "embla-carousel-react";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, FlagIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { BrailleSpinner } from "@/components/braille-spinner";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import { cn } from "@/lib/utils";
import { isBareWrap, readWrap, wrapCardMarkdown, wrapPointOf, wrapScore, type SessionWrapDetails, type SessionWrapDraft } from "@/src/core";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

// ─── The button ──────────────────────────────────────────────────────────────

/** ready = something to end; resume = a quiz draft waits; empty = nothing
 *  since the last divider. Busy is no state: ending stops the teacher. */
export type EndSessionState = "ready" | "resume" | "empty";

const BUTTON_HINT: Record<EndSessionState, string> = {
	ready: "Avslutt økta, med eller uten quiz",
	resume: "Fortsett quizen du startet",
	empty: "Ingenting å avslutte ennå",
};

export function EndSessionButton({ state, onClick }: { state: EndSessionState; onClick: () => void }) {
	const disabled = state === "empty";
	return (
		<Hint label={BUTTON_HINT[state]} side="bottom">
			<Button
				type="button"
				data-testid="end-session-button"
				data-state={state}
				aria-disabled={disabled}
				onClick={() => {
					if (!disabled) onClick();
				}}
				className={cn("lh-no-drag shrink-0", disabled && "cursor-default opacity-50 hover:bg-primary")}
			>
				<FlagIcon aria-hidden />
				Avslutt økt
			</Button>
		</Hint>
	);
}

/** «Bare avslutt»: the server stops what runs and writes the divider.
 *  Returns the error text, or null when the økt ended. */
export async function endSessionNow(chatId: string): Promise<string | null> {
	try {
		const res = await fetch(`/api/chats/${chatId}/wrap/complete`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ mode: "end" }),
		});
		if (res.ok) return null;
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		return body.error ?? `Klarte ikke å avslutte økta (${res.status}).`;
	} catch {
		return "Klarte ikke å avslutte økta på grunn av en nettverksfeil. Prøv igjen.";
	}
}

// ─── The choice popup ────────────────────────────────────────────────────────

const INTERRUPT_LINE = {
	turn: "Læreren stoppes.",
	question: "Spørsmålet som venter, lukkes.",
	both: "Læreren stoppes, og spørsmålet som venter, lukkes.",
} as const;

export function EndSessionDialog({
	open,
	interrupting,
	onQuiz,
	onEnd,
	onClose,
}: {
	open: boolean;
	/** What ending will stop: the teacher's turn, a waiting question, both. */
	interrupting: keyof typeof INTERRUPT_LINE | null;
	onQuiz: () => void;
	/** «Bare avslutt»; resolves to an error text, or null when done. */
	onEnd: () => Promise<string | null>;
	onClose: () => void;
}) {
	const [ending, setEnding] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		setEnding(false);
		setError(null);
	}, [open]);

	const backdropDismiss = useBackdropDismiss(() => {
		if (!ending) onClose();
	});

	// Esc closes (claimed: a dialog Esc must not also abort a turn).
	useEffect(() => {
		if (!open) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			e.stopPropagation();
			if (!ending) onClose();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, ending, onClose]);

	if (!open) return null;

	const end = async () => {
		setEnding(true);
		setError(null);
		const failure = await onEnd();
		setEnding(false);
		if (failure) setError(failure);
	};

	return createPortal(
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80" {...backdropDismiss}>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="end-session-title"
				data-testid="end-session-dialog"
				onClick={(e) => e.stopPropagation()}
				className="flex w-[24rem] max-w-[calc(100vw-2rem)] flex-col gap-4 rounded-xl border bg-card p-5 shadow-xl"
			>
				<div className="flex flex-col gap-1">
					<h2 id="end-session-title" className="text-base font-semibold">
						Avslutt økt
					</h2>
					{interrupting && <p className="text-sm text-muted-foreground">{INTERRUPT_LINE[interrupting]}</p>}
				</div>
				{error && (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				)}
				<div className="flex flex-col gap-2">
					<Button data-testid="end-session-quiz" autoFocus onClick={onQuiz} disabled={ending}>
						Oppsummering med quiz
					</Button>
					<Button data-testid="end-session-end" variant="outline" onClick={() => void end()} disabled={ending}>
						{ending ? "Avslutter …" : "Bare avslutt"}
					</Button>
					<Button data-testid="end-session-cancel" variant="ghost" onClick={onClose} disabled={ending}>
						Avbryt
					</Button>
				</div>
			</div>
		</div>,
		document.body,
	);
}

// ─── The divider ─────────────────────────────────────────────────────────────

export function SessionWrapDivider({ data, onOpen }: { data: unknown; onOpen: (wrap: SessionWrapDetails) => void }) {
	const wrap = readWrap(data) as SessionWrapDetails | null;
	if (!wrap) return null;
	const score = wrapScore(wrap);
	const bare = isBareWrap(wrap);
	return (
		<div data-testid="session-wrap-divider" className="my-6 flex w-full flex-col items-center gap-2">
			<div className="flex w-full items-center gap-3">
				<span className="h-0 flex-1 border-t-2 border-dotted border-border/60" aria-hidden />
				<span className="rounded-full border border-border/80 px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					{bare ? "Økt avsluttet" : `Økt avsluttet · ${score.correct}/${score.total} riktige`}
				</span>
				<span className="h-0 flex-1 border-t-2 border-dotted border-border/60" aria-hidden />
			</div>
			<p className="text-center text-sm text-muted-foreground">
				Skriv i chatten for å starte en ny økt.
				{!bare && (
					<>
						{" "}
						<button
							type="button"
							data-testid="session-wrap-open"
							onClick={() => onOpen(wrap)}
							className="cursor-pointer font-medium text-primary underline-offset-4 hover:underline"
						>
							Se oppsummering
						</button>
					</>
				)}
			</p>
		</div>
	);
}

// ─── The window ──────────────────────────────────────────────────────────────

type Step = "summary" | number | "result";

function firstStep(wrap: Pick<SessionWrapDraft, "answers">): Step {
	const answered = wrap.answers.filter((a) => a !== null && a !== undefined).length;
	if (answered === 0) return "summary";
	const next = wrap.answers.findIndex((a) => a === null || a === undefined);
	return next === -1 ? "result" : next;
}

/**
 * `review` set = read-only (opened from a divider). Otherwise the window
 * owns the live wrap: it generates (or resumes) the draft, records each
 * answer and ends the økt.
 */
export function SessionWrapDialog({
	chatId,
	open,
	draft: initialDraft,
	review,
	onClose,
	onDraft,
	onCompleted,
	onSettled,
}: {
	chatId: string;
	open: boolean;
	/** The draft already on the record, if any (resume). */
	draft: SessionWrapDraft | null;
	review: SessionWrapDetails | null;
	onClose: () => void;
	/** The draft changed (generated or answered): the chip follows it. */
	onDraft: (draft: SessionWrapDraft | null) => void;
	/** The økt ended: the transcript should fetch its new divider. */
	onCompleted: () => void;
	/** Generation stopped the teacher / closed a question first: the
	 *  transcript should fetch the settled record. */
	onSettled: () => void;
}) {
	const [draft, setDraft] = useState<SessionWrapDraft | null>(initialDraft);
	const [step, setStep] = useState<Step>(() => (initialDraft ? firstStep(initialDraft) : "summary"));
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [finishing, setFinishing] = useState(false);
	const [confirmEnd, setConfirmEnd] = useState(false);
	// The summary card on screen (owner, 2026-11-23: one card at a time).
	const [card, setCard] = useState(0);

	const generate = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await fetch(`/api/chats/${chatId}/wrap`, { method: "POST" });
			const body = (await res.json().catch(() => ({}))) as { draft?: SessionWrapDraft; error?: string };
			if (!res.ok || !body.draft) {
				setError(body.error ?? `Klarte ikke å lage oppsummeringen (${res.status}).`);
				return;
			}
			setDraft(body.draft);
			setStep(firstStep(body.draft));
			onDraft(body.draft);
		} catch {
			setError("Klarte ikke å lage oppsummeringen på grunn av en nettverksfeil. Prøv igjen.");
		} finally {
			setLoading(false);
			// Success or not, the server may have stopped the teacher and
			// closed a question before it generated.
			onSettled();
		}
	}, [chatId, onDraft, onSettled]);

	// Opening the live window: resume the record's draft, or generate one.
	useEffect(() => {
		if (!open) return;
		setCard(0);
		if (review) return;
		setConfirmEnd(false);
		setError(null);
		if (initialDraft) {
			setDraft(initialDraft);
			setStep(firstStep(initialDraft));
		} else {
			setDraft(null);
			setStep("summary");
			void generate();
		}
		// Only on open: later draft updates flow through local state.
	}, [open, review]);

	const answer = useCallback(
		(index: number, choice: number) => {
			if (!draft || (draft.answers[index] !== null && draft.answers[index] !== undefined)) return;
			const next = { ...draft, answers: draft.answers.map((a, i) => (i === index ? choice : a)) };
			setDraft(next);
			onDraft(next);
			void fetch(`/api/chats/${chatId}/wrap`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ index, choice }),
			}).catch((err) => console.error("wrap answer failed:", err));
		},
		[chatId, draft, onDraft],
	);

	const finish = useCallback(async (bare = false) => {
		setFinishing(true);
		setError(null);
		try {
			const res = await fetch(`/api/chats/${chatId}/wrap/complete`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(bare ? { mode: "end" } : {}),
			});
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) {
				setError(body.error ?? `Klarte ikke å avslutte økta (${res.status}).`);
				return;
			}
			onDraft(null);
			onCompleted();
			onClose();
		} catch {
			setError("Klarte ikke å avslutte økta på grunn av en nettverksfeil. Prøv igjen.");
		} finally {
			setFinishing(false);
		}
	}, [chatId, onClose, onCompleted, onDraft]);

	const backdropDismiss = useBackdropDismiss(() => {
		if (!finishing) onClose();
	});

	// Esc closes (claimed: a dialog Esc must not also abort a turn).
	useEffect(() => {
		if (!open) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			e.stopPropagation();
			if (!finishing) onClose();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, finishing, onClose]);

	if (!open) return null;

	const wrap: SessionWrapDraft | SessionWrapDetails | null = review ?? draft;

	return createPortal(
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80" {...backdropDismiss}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Oppsummering"
				data-testid="session-wrap-dialog"
				onClick={(e) => e.stopPropagation()}
				className="flex max-h-[calc(100dvh-4rem)] w-[40rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl border bg-card shadow-xl"
			>
				<div className="flex items-center justify-between gap-3 border-b px-5 py-3">
					<h2 className="text-sm font-semibold">
						{review ? "Oppsummering av økta" : typeof step === "number" && wrap ? `Quiz · spørsmål ${step + 1} av ${wrap.questions.length}` : step === "result" ? "Resultat" : "Oppsummering"}
					</h2>
					<Button variant="ghost" size="icon-sm" aria-label="Lukk" onClick={onClose} disabled={finishing}>
						<XIcon />
					</Button>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
					{!wrap ? (
						loading ? (
							<div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
								<BrailleSpinner label="Lager oppsummering" />
								<span>Leser gjennom økta og lager spørsmål …</span>
							</div>
						) : (
							<div className="flex flex-col items-center gap-3 py-8 text-center text-sm">
								<p role="alert" className="text-destructive">{error ?? "Noe gikk galt."}</p>
								<div className="flex gap-2">
									<Button variant="outline" size="sm" onClick={() => void generate()} disabled={finishing}>
										Prøv igjen
									</Button>
									<Button data-testid="session-wrap-end-bare" size="sm" onClick={() => void finish(true)} disabled={finishing}>
										{finishing ? "Avslutter …" : "Bare avslutt"}
									</Button>
								</div>
							</div>
						)
					) : review ? (
						<ReviewBody wrap={review} card={card} onCard={setCard} />
					) : step === "summary" ? (
						<SummaryCards items={wrap.summary} index={card} onIndex={setCard} />
					) : typeof step === "number" ? (
						<QuestionBody
							key={step}
							index={step}
							wrap={wrap}
							onAnswer={(choice) => answer(step, choice)}
							onNext={() => setStep(step + 1 < wrap.questions.length ? step + 1 : "result")}
						/>
					) : (
						<ResultBody wrap={wrap} />
					)}
				</div>

				{wrap && !review && (
					<div className="flex flex-col gap-2 border-t px-5 py-3">
						{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
						{confirmEnd ? (
							<div className="flex flex-wrap items-center justify-end gap-2">
								<span className="mr-auto text-sm text-muted-foreground">Avslutte økta nå? Svarene så langt lagres.</span>
								<Button variant="ghost" size="sm" onClick={() => setConfirmEnd(false)} disabled={finishing}>
									Fortsett quizen
								</Button>
								<Button size="sm" onClick={() => void finish()} disabled={finishing}>
									{finishing ? "Avslutter …" : "Avslutt økt"}
								</Button>
							</div>
						) : step === "summary" ? (
							<div className="flex items-center justify-end gap-2">
								{card < wrap.summary.length - 1 ? (
									<>
										<Button
											data-testid="session-wrap-skip"
											variant="ghost"
											size="sm"
											className="mr-auto text-muted-foreground"
											onClick={() => setStep(0)}
										>
											Hopp til quizen
										</Button>
										<Button data-testid="session-wrap-next-card" size="sm" onClick={() => setCard(card + 1)}>
											Neste
										</Button>
									</>
								) : (
									<Button data-testid="session-wrap-start" size="sm" autoFocus onClick={() => setStep(0)}>
										Start quizen
									</Button>
								)}
							</div>
						) : step === "result" ? (
							<div className="flex items-center justify-end gap-2">
								<Button data-testid="session-wrap-finish" size="sm" onClick={() => void finish()} disabled={finishing}>
									{finishing ? "Avslutter …" : "Avslutt økt"}
								</Button>
							</div>
						) : (
							<div className="flex items-center justify-start">
								<Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setConfirmEnd(true)}>
									Avslutt økta nå
								</Button>
							</div>
						)}
					</div>
				)}
			</div>
		</div>,
		document.body,
	);
}

/**
 * The summary as cards, one at a time (owner, 2026-11-23: the bullet list
 * was hard on the eyes). Controlled: the window owns the index, so its
 * footer («Neste» / «Start quizen») and the cards move together.
 *
 * Moving: drag or touch-swipe (Embla), a horizontal trackpad swipe (one
 * card per gesture), ←/→, the side arrows and the dots.
 */
export function SummaryCards({
	items,
	index,
	onIndex,
}: {
	items: readonly unknown[];
	index: number;
	onIndex: (next: number) => void;
}) {
	const count = items.length;
	const [viewportRef, embla] = useEmblaCarousel({ align: "center", duration: 22 });
	const at = Math.min(Math.max(index, 0), Math.max(count - 1, 0));
	const go = useCallback((next: number) => onIndex(Math.min(Math.max(next, 0), count - 1)), [count, onIndex]);

	// Embla → index (drag/touch), index → Embla (buttons, keys, dots).
	useEffect(() => {
		if (!embla) return;
		const onSelect = () => onIndex(embla.selectedScrollSnap());
		embla.on("select", onSelect);
		return () => {
			embla.off("select", onSelect);
		};
	}, [embla, onIndex]);
	useEffect(() => {
		if (embla && embla.selectedScrollSnap() !== at) embla.scrollTo(at);
	}, [embla, at]);

	// A horizontal trackpad swipe moves one card per gesture: the gesture's
	// wheel events are summed, and the lock holds until they stop.
	const wheel = useRef({ sum: 0, locked: false, timer: 0 as unknown as ReturnType<typeof setTimeout> });
	useEffect(() => {
		const node = embla?.rootNode();
		if (!node) return;
		const onWheel = (e: WheelEvent) => {
			if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
			e.preventDefault();
			const w = wheel.current;
			clearTimeout(w.timer);
			w.timer = setTimeout(() => {
				w.sum = 0;
				w.locked = false;
			}, 180);
			if (w.locked) return;
			w.sum += e.deltaX;
			if (Math.abs(w.sum) < 40) return;
			w.locked = true;
			if (w.sum > 0) embla?.scrollNext();
			else embla?.scrollPrev();
		};
		node.addEventListener("wheel", onWheel, { passive: false });
		return () => node.removeEventListener("wheel", onWheel);
	}, [embla]);

	// ←/→ while the cards are on screen.
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			const target = e.target as HTMLElement | null;
			if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
			if (e.key === "ArrowRight") {
				e.preventDefault();
				go(at + 1);
			} else if (e.key === "ArrowLeft") {
				e.preventDefault();
				go(at - 1);
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [at, go]);

	if (count === 0) return null;

	return (
		<div data-testid="session-wrap-cards" className="flex flex-col gap-4">
			<div className="relative">
				<div ref={viewportRef} className="overflow-hidden" aria-roledescription="karusell" aria-label="Oppsummering, kort for kort">
					<div className="flex touch-pan-y">
						{items.map((item, i) => {
							const { title, text } = wrapPointOf(item);
							return (
								<div
									key={i}
									role="group"
									aria-roledescription="kort"
									aria-label={`Kort ${i + 1} av ${count}`}
									aria-hidden={i !== at}
									className="min-w-0 shrink-0 grow-0 basis-full px-9"
								>
									<div
										data-testid="session-wrap-card"
										className="flex h-full min-h-[18rem] select-none flex-col gap-4 rounded-2xl border bg-background/60 px-7 py-6"
									>
										<span data-testid="session-wrap-card-count" className="text-xs font-medium tracking-wide text-muted-foreground tabular-nums">
											{i + 1} / {count}
										</span>
										{title && <h3 className="font-title text-2xl leading-tight tracking-tight">{title}</h3>}
										<ToolContentResponse className="lh-prose text-base leading-relaxed [&_.katex-display]:my-4">
											{wrapCardMarkdown(text)}
										</ToolContentResponse>
									</div>
								</div>
							);
						})}
					</div>
				</div>
				<button
					type="button"
					aria-label="Forrige kort"
					data-testid="session-wrap-prev-arrow"
					onClick={() => go(at - 1)}
					disabled={at === 0}
					className="absolute left-0 top-1/2 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border bg-card text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-0"
				>
					<ChevronLeftIcon className="size-4" />
				</button>
				<button
					type="button"
					aria-label="Neste kort"
					data-testid="session-wrap-next-arrow"
					onClick={() => go(at + 1)}
					disabled={at === count - 1}
					className="absolute right-0 top-1/2 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border bg-card text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-0"
				>
					<ChevronRightIcon className="size-4" />
				</button>
			</div>
			<div className="flex items-center justify-center gap-1.5" role="tablist" aria-label="Velg kort">
				{items.map((_, i) => (
					<button
						key={i}
						type="button"
						role="tab"
						aria-selected={i === at}
						aria-label={`Kort ${i + 1}`}
						data-testid="session-wrap-dot"
						onClick={() => go(i)}
						className={cn(
							"h-2 cursor-pointer rounded-full transition-all",
							i === at ? "w-5 bg-primary" : "w-2 bg-border hover:bg-muted-foreground/50",
						)}
					/>
				))}
			</div>
		</div>
	);
}

function optionTone(i: number, correct: number, chosen: number | null, selected: number | null): string {
	if (chosen === null) {
		return i === selected
			? "border-primary bg-primary/5 ring-1 ring-primary cursor-pointer"
			: "border-border hover:border-primary/60 hover:bg-accent cursor-pointer";
	}
	if (i === correct) return "border-emerald-600 bg-emerald-600/10 dark:border-emerald-400 dark:bg-emerald-400/10";
	if (i === chosen) return "border-destructive bg-destructive/10";
	return "border-border/50 opacity-60";
}

/** One question (owner, 2026-11-23): clicking an option (or 1-4 / A-D)
 *  only selects it, and the selection can change; «Send svar» (or Enter)
 *  sends it. Then the feedback and «Neste» (Enter moves on). Exported for
 *  the tests. */
export function QuestionBody({
	index,
	wrap,
	onAnswer,
	onNext,
}: {
	index: number;
	wrap: Pick<SessionWrapDraft, "questions" | "answers">;
	onAnswer: (choice: number) => void;
	onNext: () => void;
}) {
	const q = wrap.questions[index]!;
	const stored = wrap.answers[index];
	const chosen = stored === null || stored === undefined ? null : stored;
	const last = index === wrap.questions.length - 1;
	// The pick before «Send svar» (local: the window keys this per question).
	const [selected, setSelected] = useState<number | null>(null);

	// 1–4 / A–D select an option, Enter sends it; once answered, Enter
	// moves on. Enter's default is cancelled so a focused option button is
	// not also clicked.
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			const target = e.target as HTMLElement | null;
			if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
			if (e.key === "Enter") {
				if (chosen === null && selected === null) return;
				e.preventDefault();
				e.stopPropagation();
				if (chosen === null) onAnswer(selected!);
				else onNext();
				return;
			}
			if (chosen !== null) return;
			const key = e.key.toUpperCase();
			const pick = /^[1-9]$/.test(key) ? Number(key) - 1 : LETTERS.indexOf(key);
			if (pick >= 0 && pick < q.options.length) {
				e.preventDefault();
				setSelected(pick);
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [chosen, selected, q.options.length, onAnswer, onNext]);

	return (
		<div className="flex flex-col gap-4">
			<div className="flex gap-1" aria-hidden>
				{wrap.questions.map((qq, i) => {
					const a = wrap.answers[i];
					const done = a !== null && a !== undefined;
					return (
						<span
							key={i}
							className={cn(
								"h-1 flex-1 rounded-full",
								i === index ? "bg-primary" : !done ? "bg-border" : a === qq.correctIndex ? "bg-emerald-600 dark:bg-emerald-400" : "bg-destructive",
							)}
						/>
					);
				})}
			</div>
			<ToolContentResponse className="lh-prose text-base">{q.question}</ToolContentResponse>
			<div className="flex flex-col gap-2" role="radiogroup" aria-label="Svaralternativer">
				{q.options.map((option, i) => (
					<button
						key={i}
						type="button"
						role="radio"
						aria-checked={(chosen ?? selected) === i}
						data-testid={`session-wrap-option-${i}`}
						disabled={chosen !== null}
						onClick={() => setSelected(i)}
						className={cn("flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-default", optionTone(i, q.correctIndex, chosen, selected))}
					>
						<span
							className={cn(
								"mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
								chosen === null && selected === i && "border-primary bg-primary text-primary-foreground",
							)}
						>
							{chosen !== null && i === q.correctIndex ? <CheckIcon className="size-3" /> : chosen === i ? <XIcon className="size-3" /> : LETTERS[i]}
						</span>
						<ToolContentResponse className="lh-prose min-w-0 flex-1">{option}</ToolContentResponse>
					</button>
				))}
			</div>
			{chosen === null && (
				<div className="flex justify-end">
					<Button data-testid="session-wrap-submit" size="sm" disabled={selected === null} onClick={() => selected !== null && onAnswer(selected)}>
						Send svar
					</Button>
				</div>
			)}
			{chosen !== null && (
				<div data-testid="session-wrap-feedback" className="flex flex-col gap-3">
					<div className={cn("rounded-lg px-3 py-2.5 text-sm", chosen === q.correctIndex ? "bg-emerald-600/10 dark:bg-emerald-400/10" : "bg-destructive/10")}>
						<p className="mb-1 font-semibold">{chosen === q.correctIndex ? "Riktig!" : `Ikke helt. Riktig svar er ${LETTERS[q.correctIndex]}.`}</p>
						<ToolContentResponse className="lh-prose">{q.explanation}</ToolContentResponse>
					</div>
					<div className="flex justify-end">
						<Button data-testid="session-wrap-next" size="sm" autoFocus onClick={onNext}>
							{last ? "Se resultatet" : "Neste"}
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

function MissedList({ wrap }: { wrap: SessionWrapDraft | SessionWrapDetails }) {
	const missed = useMemo(
		() =>
			wrap.questions.flatMap((q, i) => {
				const a = wrap.answers[i];
				return a === q.correctIndex ? [] : [{ q, i, a: a === null || a === undefined ? null : a }];
			}),
		[wrap],
	);
	if (missed.length === 0) return <p className="text-sm">Alt riktig. Sterkt!</p>;
	return (
		<div className="flex flex-col gap-3">
			<p className="text-sm text-muted-foreground">Dette bør du se på igjen. Læreren tar det opp i neste økt.</p>
			{missed.map(({ q, i, a }) => (
				<div key={i} className="flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-sm">
					<div className="flex gap-2">
						<span className="shrink-0 font-semibold">{i + 1}.</span>
						<ToolContentResponse className="lh-prose min-w-0 flex-1">{q.question}</ToolContentResponse>
					</div>
					{a !== null && (
						<div className="flex gap-2 text-destructive">
							<span className="shrink-0">Ditt svar:</span>
							<ToolContentResponse className="lh-prose min-w-0 flex-1">{q.options[a] ?? ""}</ToolContentResponse>
						</div>
					)}
					{a === null && <span className="text-muted-foreground">Ikke besvart.</span>}
					<div className="flex gap-2 text-emerald-700 dark:text-emerald-300">
						<span className="shrink-0">Riktig:</span>
						<ToolContentResponse className="lh-prose min-w-0 flex-1">{q.options[q.correctIndex] ?? ""}</ToolContentResponse>
					</div>
					<ToolContentResponse className="lh-prose text-muted-foreground">{q.explanation}</ToolContentResponse>
				</div>
			))}
		</div>
	);
}

function ResultBody({ wrap }: { wrap: SessionWrapDraft | SessionWrapDetails }) {
	const score = wrapScore(wrap);
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col items-center gap-1 py-2">
				<span data-testid="session-wrap-score" className="font-title text-4xl tracking-tight">
					{score.correct}/{score.total}
				</span>
				<span className="text-sm text-muted-foreground">riktige</span>
			</div>
			<MissedList wrap={wrap} />
			<p className="text-sm text-muted-foreground">
				«Avslutt økt» setter et skille i chatten. Neste gang du skriver, starter en ny økt.
			</p>
		</div>
	);
}

function ReviewBody({ wrap, card, onCard }: { wrap: SessionWrapDetails; card: number; onCard: (next: number) => void }) {
	const score = wrapScore(wrap);
	return (
		<div className="flex flex-col gap-6">
			<SummaryCards items={wrap.summary} index={card} onIndex={onCard} />
			<div className="flex flex-col gap-3">
				<h3 className="text-sm font-semibold">
					Quiz: {score.correct}/{score.total} riktige
				</h3>
				<MissedList wrap={wrap} />
			</div>
		</div>
	);
}
