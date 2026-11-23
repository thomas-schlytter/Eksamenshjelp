"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TimerIcon, XIcon } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { SvgImage } from "@/components/artifacts/svg-image";
import { BrailleSpinner } from "@/components/braille-spinner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
	durationLabel,
	partKey,
	pointsLabel,
	taskPoints,
	type MockExamAnswers,
	type PublicMockExam,
} from "@/src/core";

/**
 * «SVAR I APPEN» (fase 6): the mock exam task by task, one answer field per
 * part — free text with LaTeX (a live preview under the field, the app's own
 * math rendering) or the options of a multiple-choice part. An optional
 * countdown runs from the exam's duration. The draft saves itself while he
 * writes; «Lever» freezes the answers and hands them to grading in the
 * fag-chat (the caller sends the message).
 *
 * A large modal over the chat (portal, no-drag so Electron's title-bar drag
 * band under it never swallows clicks). The paper comes from the public
 * route: no key ever reaches this view.
 */

const SAVE_DEBOUNCE_MS = 800;

/** "3:05:09" — the countdown's remaining time (pure; exported for tests). */
export function remainingLabel(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const pad = (n: number) => String(n).padStart(2, "0");
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** The remaining ms of a countdown started at `startedAt` (ISO). */
export function remainingMs(startedAt: string, durationMinutes: number, now: number): number {
	return Date.parse(startedAt) + durationMinutes * 60_000 - now;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function MockExamAnswerView({
	code,
	examId,
	onClose,
	onSubmitted,
	initial,
}: {
	code: string;
	examId: string;
	onClose: () => void;
	/** Called after «Lever» succeeded, with the exam's title. */
	onSubmitted: (title: string) => void;
	/** Test seam / prefetched data: skips the first fetch. */
	initial?: { exam: PublicMockExam; answers: MockExamAnswers | null };
}) {
	const [exam, setExam] = useState<PublicMockExam | null>(initial?.exam ?? null);
	const [answers, setAnswers] = useState<Record<string, string>>(initial?.answers?.answers ?? {});
	const [timerStartedAt, setTimerStartedAt] = useState<string | undefined>(initial?.answers?.timerStartedAt);
	const [submittedAt, setSubmittedAt] = useState<string | undefined>(initial?.answers?.submittedAt);
	const [loadError, setLoadError] = useState("");
	const [save, setSave] = useState<SaveState>("idle");
	const [confirming, setConfirming] = useState(false);
	const [submitError, setSubmitError] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [now, setNow] = useState(() => Date.now());
	const dirty = useRef(false);
	const latest = useRef({ answers, timerStartedAt });
	latest.current = { answers, timerStartedAt };
	const base = `/api/mock-exams/${encodeURIComponent(code)}/${encodeURIComponent(examId)}`;

	useEffect(() => {
		if (initial) return;
		let live = true;
		fetch(base, { cache: "no-store" })
			.then(async (res) => {
				const body = (await res.json().catch(() => ({}))) as { exam?: PublicMockExam; answers?: MockExamAnswers | null; error?: string };
				if (!live) return;
				if (!res.ok || !body.exam) {
					setLoadError(body.error ?? "Fant ikke prøveeksamenen.");
					return;
				}
				setExam(body.exam);
				setAnswers(body.answers?.answers ?? {});
				setTimerStartedAt(body.answers?.timerStartedAt);
				setSubmittedAt(body.answers?.submittedAt);
			})
			.catch(() => live && setLoadError("Klarte ikke å hente prøveeksamenen."));
		return () => {
			live = false;
		};
	}, [base, initial]);

	const flush = useCallback(async () => {
		if (!dirty.current) return;
		dirty.current = false;
		setSave("saving");
		try {
			const res = await fetch(base, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ answers: latest.current.answers, timerStartedAt: latest.current.timerStartedAt ?? null }),
			});
			setSave(res.ok ? "saved" : "error");
		} catch {
			setSave("error");
		}
	}, [base]);

	// Debounced autosave of the draft.
	useEffect(() => {
		if (!dirty.current || submittedAt) return;
		const timer = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [answers, timerStartedAt, submittedAt, flush]);

	// The countdown's clock (only while it runs).
	useEffect(() => {
		if (!timerStartedAt || submittedAt) return;
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [timerStartedAt, submittedAt]);

	const close = useCallback(() => {
		void flush();
		onClose();
	}, [flush, onClose]);

	// Esc closes (claimed: it must not also abort a turn).
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			e.stopPropagation();
			close();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [close]);

	const setAnswer = (key: string, value: string) => {
		dirty.current = true;
		setAnswers((prev) => ({ ...prev, [key]: value }));
	};

	const submit = async () => {
		if (!exam) return;
		setSubmitting(true);
		setSubmitError("");
		try {
			const res = await fetch(`${base}/submit`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ answers, timerStartedAt: timerStartedAt ?? null }),
			});
			const body = (await res.json().catch(() => ({}))) as { answers?: MockExamAnswers; error?: string };
			if (!res.ok) {
				setSubmitError(body.error ?? "Klarte ikke å levere.");
				return;
			}
			dirty.current = false;
			setSubmittedAt(body.answers?.submittedAt ?? new Date().toISOString());
			onSubmitted(exam.title);
		} catch {
			setSubmitError("Klarte ikke å levere på grunn av en nettverksfeil. Prøv igjen.");
		} finally {
			setSubmitting(false);
			setConfirming(false);
		}
	};

	const locked = Boolean(submittedAt);
	const left = exam && timerStartedAt ? remainingMs(timerStartedAt, exam.cover.durationMinutes, now) : null;

	const body = (
		<div className="lh-no-drag fixed inset-0 z-50 flex items-center justify-center bg-background/80">
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Svar på prøveeksamen"
				data-testid="mock-exam-view"
				className="flex h-[calc(100dvh-2rem)] w-[min(60rem,calc(100vw-2rem))] flex-col rounded-xl border bg-card shadow-xl"
			>
				<div className="flex items-center gap-3 border-b px-5 py-3">
					<h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{exam?.title ?? "Prøveeksamen"}</h2>
					{exam && !locked && (
						left === null ? (
							<Button
								variant="outline"
								size="sm"
								data-testid="mock-exam-timer-start"
								onClick={() => {
									dirty.current = true;
									setTimerStartedAt(new Date().toISOString());
									setNow(Date.now());
								}}
							>
								<TimerIcon aria-hidden />
								Start nedtelling ({durationLabel(exam.cover.durationMinutes)})
							</Button>
						) : (
							<span data-testid="mock-exam-timer" className={cn("text-sm tabular-nums", left <= 0 ? "font-medium text-destructive" : "text-muted-foreground")}>
								{left <= 0 ? "Tiden er ute" : `Tid igjen ${remainingLabel(left)}`}
							</span>
						)
					)}
					{!locked && (
						<span className="text-xs text-muted-foreground" aria-live="polite">
							{save === "saving" ? "Lagrer …" : save === "saved" ? "Lagret" : save === "error" ? "Ikke lagret" : ""}
						</span>
					)}
					<Button variant="ghost" size="icon-sm" aria-label="Lukk" onClick={close}>
						<XIcon />
					</Button>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
					{!exam ? (
						loadError ? (
							<p role="alert" className="py-8 text-center text-sm text-destructive">{loadError}</p>
						) : (
							<div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
								<BrailleSpinner label="Henter prøveeksamen" />
								Henter prøveeksamen …
							</div>
						)
					) : (
						<div className="mx-auto flex max-w-3xl flex-col gap-8">
							<div className="text-sm text-muted-foreground">
								{exam.code} {exam.courseName} · {durationLabel(exam.cover.durationMinutes)} · Hjelpemidler: {exam.cover.aids}
							</div>
							{locked && (
								<p className="rounded-lg border px-3 py-2 text-sm" data-testid="mock-exam-submitted">
									Levert. Rettingen skjer i fag-chatten.
								</p>
							)}
							{exam.tasks.map((task) => (
								<section key={task.number} className="flex flex-col gap-3" data-testid="mock-exam-task">
									<h3 className="font-semibold">
										Oppgave {task.number}
										{task.title ? ` ${task.title}` : ""} ({pointsLabel(taskPoints(task), exam.scoring)})
									</h3>
									{task.intro && (
										<div className="text-sm [&_p:first-child]:mt-0">
											<MessageResponse>{task.intro}</MessageResponse>
										</div>
									)}
									{task.figureSvg && <SvgImage svg={task.figureSvg} className="max-h-80 max-w-full self-center rounded-md bg-white" />}
									{task.parts.map((part) => {
										const key = partKey(task, part);
										const value = answers[key] ?? "";
										const single = task.parts.length === 1 && part.label === "";
										return (
											<div key={key} className="flex flex-col gap-2">
												<div className="text-sm [&_p:first-child]:mt-0">
													{!single && (
														<span className="font-medium">
															{part.label}) ({pointsLabel(part.points, exam.scoring)}){" "}
														</span>
													)}
													<MessageResponse>{part.text}</MessageResponse>
												</div>
												{part.figureSvg && <SvgImage svg={part.figureSvg} className="max-h-80 max-w-full self-center rounded-md bg-white" />}
												{part.options && part.options.length > 0 ? (
													<fieldset className="flex flex-col gap-1.5" disabled={locked} data-testid="mock-exam-options">
														<legend className="sr-only">Velg ett alternativ for oppgave {key}</legend>
														{part.options.map((option) => (
															<label key={option.id} className="flex cursor-pointer items-baseline gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent">
																<input
																	type="radio"
																	name={`answer-${key}`}
																	value={option.id}
																	checked={value === option.id}
																	onChange={() => setAnswer(key, option.id)}
																/>
																<span className="[&_p]:m-0">
																	<MessageResponse>{option.text}</MessageResponse>
																</span>
															</label>
														))}
													</fieldset>
												) : (
													<>
														<Textarea
															aria-label={`Svar på oppgave ${key}`}
															data-testid="mock-exam-answer-field"
															value={value}
															readOnly={locked}
															onChange={(e) => setAnswer(key, e.target.value)}
															placeholder="Skriv svaret ditt. Matte skrives som LaTeX mellom $-tegn, for eksempel $\frac{1}{s+2}$."
															className="min-h-28 font-mono text-sm"
														/>
														{value.includes("$") && (
															<div className="rounded-md border px-3 py-2 text-sm [&_p:first-child]:mt-0 [&_p:last-child]:mb-0" data-testid="mock-exam-preview">
																<MessageResponse>{value}</MessageResponse>
															</div>
														)}
													</>
												)}
											</div>
										);
									})}
								</section>
							))}
						</div>
					)}
				</div>

				{exam && !locked && (
					<div className="flex items-center justify-end gap-3 border-t px-5 py-3">
						{submitError && <span role="alert" className="mr-auto text-sm text-destructive">{submitError}</span>}
						{confirming ? (
							<>
								<span className="text-sm text-muted-foreground">Du kan ikke endre svarene etterpå.</span>
								<Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={submitting}>
									Avbryt
								</Button>
								<Button size="sm" onClick={() => void submit()} disabled={submitting} data-testid="mock-exam-submit-confirm">
									{submitting ? "Leverer …" : "Lever nå"}
								</Button>
							</>
						) : (
							<Button size="sm" onClick={() => setConfirming(true)} data-testid="mock-exam-submit">
								Lever
							</Button>
						)}
					</div>
				)}
			</div>
		</div>
	);
	return typeof document === "undefined" ? body : createPortal(body, document.body);
}
