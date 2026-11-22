"use client";

/**
 * «Oppsummering» (owner, 2026-11-22): the top-bar chip, the summary + quiz
 * window and the «Økt avsluttet» divider in the transcript.
 *
 * The learner keeps one chat per course. The chip wraps the current økt:
 * the server writes a summary and ten multiple-choice questions on what
 * happened since the previous divider; the window shows the summary, then
 * the quiz with feedback right after each answer, then the score. «Avslutt
 * økta» turns it into the divider (and a note for the teacher). Closing
 * the window only pauses: the draft lives on the record, so the chip says
 * «Fortsett quizen» until the økt is ended.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ClipboardCheckIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { BrailleSpinner } from "@/components/braille-spinner";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import { cn } from "@/lib/utils";
import { readWrap, wrapScore, type SessionWrapDetails, type SessionWrapDraft } from "@/src/core";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

// ─── The chip ────────────────────────────────────────────────────────────────

export type WrapChipState = "ready" | "resume" | "busy" | "empty";

const CHIP_HINT: Record<WrapChipState, string> = {
	ready: "Oppsummer økta og ta en quiz på 10 spørsmål",
	resume: "Du har en quiz som ikke er ferdig",
	busy: "Vent til læreren er ferdig, eller svar på spørsmålet som venter",
	empty: "Ingenting å oppsummere ennå i denne økta",
};

export function SessionWrapChip({ state, onClick }: { state: WrapChipState; onClick: () => void }) {
	const disabled = state === "busy" || state === "empty";
	return (
		<Hint label={CHIP_HINT[state]} side="bottom">
			<button
				type="button"
				data-testid="session-wrap-chip"
				data-state={state}
				aria-disabled={disabled}
				onClick={() => {
					if (!disabled) onClick();
				}}
				className={cn(
					"lh-no-drag flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide transition-colors",
					disabled
						? "cursor-default border-border/50 text-muted-foreground/50"
						: state === "resume"
							? "cursor-pointer border-primary/60 text-foreground hover:border-primary"
							: "cursor-pointer border-border/80 text-muted-foreground hover:border-border hover:text-foreground",
				)}
			>
				<ClipboardCheckIcon className={cn("size-3.5", disabled ? "" : "text-primary")} aria-hidden />
				{state === "resume" ? "Fortsett quizen" : "Oppsummering"}
			</button>
		</Hint>
	);
}

// ─── The divider ─────────────────────────────────────────────────────────────

export function SessionWrapDivider({ data, onOpen }: { data: unknown; onOpen: (wrap: SessionWrapDetails) => void }) {
	const wrap = readWrap(data) as SessionWrapDetails | null;
	if (!wrap) return null;
	const score = wrapScore(wrap);
	return (
		<div data-testid="session-wrap-divider" className="my-6 flex w-full flex-col items-center gap-2">
			<div className="flex w-full items-center gap-3">
				<span className="h-0 flex-1 border-t-2 border-dotted border-border/60" aria-hidden />
				<span className="rounded-full border border-border/80 px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Økt avsluttet · {score.correct}/{score.total} riktige
				</span>
				<span className="h-0 flex-1 border-t-2 border-dotted border-border/60" aria-hidden />
			</div>
			<p className="text-center text-sm text-muted-foreground">
				Skriv i chatten for å starte en ny økt.{" "}
				<button
					type="button"
					data-testid="session-wrap-open"
					onClick={() => onOpen(wrap)}
					className="cursor-pointer font-medium text-primary underline-offset-4 hover:underline"
				>
					Se oppsummering
				</button>
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
}) {
	const [draft, setDraft] = useState<SessionWrapDraft | null>(initialDraft);
	const [step, setStep] = useState<Step>(() => (initialDraft ? firstStep(initialDraft) : "summary"));
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [finishing, setFinishing] = useState(false);
	const [confirmEnd, setConfirmEnd] = useState(false);

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
		}
	}, [chatId, onDraft]);

	// Opening the live window: resume the record's draft, or generate one.
	useEffect(() => {
		if (!open || review) return;
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

	const finish = useCallback(async () => {
		setFinishing(true);
		setError(null);
		try {
			const res = await fetch(`/api/chats/${chatId}/wrap/complete`, { method: "POST" });
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
						{review ? "Oppsummering av økta" : typeof step === "number" ? `Quiz · spørsmål ${step + 1} av ${wrap?.questions.length ?? 10}` : step === "result" ? "Resultat" : "Oppsummering"}
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
								<span>Leser gjennom økta og lager 10 spørsmål …</span>
							</div>
						) : (
							<div className="flex flex-col items-center gap-3 py-8 text-center text-sm">
								<p role="alert" className="text-destructive">{error ?? "Noe gikk galt."}</p>
								<Button variant="outline" size="sm" onClick={() => void generate()}>
									Prøv igjen
								</Button>
							</div>
						)
					) : review ? (
						<ReviewBody wrap={review} />
					) : step === "summary" ? (
						<SummaryBody wrap={wrap} />
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
									{finishing ? "Avslutter …" : "Avslutt økta"}
								</Button>
							</div>
						) : step === "summary" ? (
							<div className="flex items-center justify-end gap-2">
								<Button data-testid="session-wrap-start" size="sm" onClick={() => setStep(0)}>
									Start quizen
								</Button>
							</div>
						) : step === "result" ? (
							<div className="flex items-center justify-end gap-2">
								<Button data-testid="session-wrap-finish" size="sm" onClick={() => void finish()} disabled={finishing}>
									{finishing ? "Avslutter …" : "Avslutt økta"}
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

function SummaryBody({ wrap, review = false }: { wrap: SessionWrapDraft | SessionWrapDetails; review?: boolean }) {
	return (
		<div className="flex flex-col gap-3">
			<p className="text-sm text-muted-foreground">Dette jobbet du med i denne økta:</p>
			<ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
				{wrap.summary.map((point, i) => (
					<li key={i}>
						<ToolContentResponse className="lh-prose">{point}</ToolContentResponse>
					</li>
				))}
			</ul>
			{!review && (
				<p className="text-sm text-muted-foreground">
					Så kommer {wrap.questions.length} flervalgsspørsmål på det viktigste, for å få minnet i gang.
				</p>
			)}
		</div>
	);
}

function optionTone(i: number, correct: number, chosen: number | null): string {
	if (chosen === null) return "border-border hover:border-primary/60 hover:bg-accent cursor-pointer";
	if (i === correct) return "border-emerald-600 bg-emerald-600/10 dark:border-emerald-400 dark:bg-emerald-400/10";
	if (i === chosen) return "border-destructive bg-destructive/10";
	return "border-border/50 opacity-60";
}

function QuestionBody({
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

	// 1–4 / A–D pick an option, Enter moves on once answered.
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			const target = e.target as HTMLElement | null;
			if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
			if (chosen === null) {
				const key = e.key.toUpperCase();
				const pick = /^[1-9]$/.test(key) ? Number(key) - 1 : LETTERS.indexOf(key);
				if (pick >= 0 && pick < q.options.length) {
					e.preventDefault();
					onAnswer(pick);
				}
			} else if (e.key === "Enter") {
				e.preventDefault();
				e.stopPropagation();
				onNext();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [chosen, q.options.length, onAnswer, onNext]);

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
						aria-checked={chosen === i}
						data-testid={`session-wrap-option-${i}`}
						disabled={chosen !== null}
						onClick={() => onAnswer(i)}
						className={cn("flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-default", optionTone(i, q.correctIndex, chosen))}
					>
						<span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold">
							{chosen !== null && i === q.correctIndex ? <CheckIcon className="size-3" /> : chosen === i ? <XIcon className="size-3" /> : LETTERS[i]}
						</span>
						<ToolContentResponse className="lh-prose min-w-0 flex-1">{option}</ToolContentResponse>
					</button>
				))}
			</div>
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
				«Avslutt økta» setter et skille i chatten. Neste gang du skriver, starter en ny økt.
			</p>
		</div>
	);
}

function ReviewBody({ wrap }: { wrap: SessionWrapDetails }) {
	const score = wrapScore(wrap);
	return (
		<div className="flex flex-col gap-5">
			<SummaryBody wrap={wrap} review />
			<div className="flex flex-col gap-3">
				<h3 className="text-sm font-semibold">
					Quiz: {score.correct}/{score.total} riktige
				</h3>
				<MissedList wrap={wrap} />
			</div>
		</div>
	);
}
