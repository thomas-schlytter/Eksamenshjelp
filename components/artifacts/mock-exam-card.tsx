"use client";

import { useContext, useRef, useState } from "react";
import { ClipboardCheckIcon, FileTextIcon, FileUpIcon, NotebookPenIcon, PenLineIcon } from "lucide-react";
import { ChatActionsContext } from "@/components/chat";
import { DispatchCard } from "@/components/artifacts/dispatch-card";
import { MessageResponse } from "@/components/ai-elements/message";
import { ANSWER_ACCEPT, answerFileDeps, filesToPaths, withAnswerPaths } from "@/components/answer-upload";
import { MockExamAnswerView } from "@/components/mock-exam-view";
import { Button } from "@/components/ui/button";
import {
	durationLabel,
	pointsLabel,
	type ArtifactPartProps,
	type MockExamJobResult,
	type MockExamResult,
	type MockGradeJobResult,
} from "@/src/core";

/**
 * PRØVEEKSAMEN IN THE TRANSCRIPT (fase 6).
 *
 *   mock_exam / grade_mock_exam tool parts — the dispatch card (live
 *     «Prøveeksamen» / «Retting» status from the jobs feed), like every job.
 *   MockExamCard — the delivered exam (the steer artifact): fagkode, number
 *     of tasks, duration, total points, and the three ways to take it:
 *     «Åpne PDF», «Svar i appen», «Legg inn besvarelse».
 *   MockGradeCard — the graded result: total, grade estimate when the exam
 *     carries a known scale (else percent only), points per task, and per
 *     part the comment, what was missing and the løsningsforslag.
 */

export function MockExamDispatchCard({ part }: ArtifactPartProps) {
	if (part.state !== "output-available") return null;
	return <DispatchCard toolCallId={part.toolCallId} kind="mockExam" />;
}

export function MockGradeDispatchCard({ part }: ArtifactPartProps) {
	if (part.state !== "output-available") return null;
	return <DispatchCard toolCallId={part.toolCallId} kind="mockGrade" />;
}

export { MAKE_MOCK_EXAM_TEXT } from "@/src/core/mock-exam";

/** «Lag prøveeksamen» in the fag-chat's top bar. */
export function MakeMockExamButton({ onClick }: { onClick: () => void }) {
	return (
		<Button variant="outline" size="sm" data-testid="make-mock-exam" onClick={onClick} className="lh-no-drag shrink-0">
			<NotebookPenIcon aria-hidden />
			Lag prøveeksamen
		</Button>
	);
}

/** The learner's hand-in messages (what the agent reads as the hand-in). */
export function digitalHandInText(title: string, examId: string): string {
	return `Jeg har levert prøveeksamen «${title}» i appen (eksamen-id ${examId}). Rett den.`;
}

export function scanHandInText(title: string, examId: string, paths: readonly string[]): string {
	return withAnswerPaths(`Her er besvarelsen min på prøveeksamen «${title}» (eksamen-id ${examId}):`, paths);
}

/** The card's fact line: fagkode · oppgaver · varighet · poeng. */
export function mockExamFacts(r: Pick<MockExamJobResult, "code" | "taskCount" | "durationMinutes" | "scoring" | "totalPoints">): string {
	return [
		r.code,
		`${r.taskCount} ${r.taskCount === 1 ? "oppgave" : "oppgaver"}`,
		durationLabel(r.durationMinutes),
		r.scoring === "percent" ? "vektet i prosent (100 %)" : pointsLabel(r.totalPoints, "points"),
	].join(" · ");
}

export function MockExamCard({ result }: { result: MockExamJobResult }) {
	const actions = useContext(ChatActionsContext);
	const [answering, setAnswering] = useState(false);
	const [notice, setNotice] = useState("");
	const [busy, setBusy] = useState(false);
	const picker = useRef<HTMLInputElement>(null);

	if (!result.examId) {
		return (
			<div className="rounded-xl border bg-card p-4 text-sm" data-testid="mock-exam-failed">
				<div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					<NotebookPenIcon className="size-3.5" aria-hidden />
					Prøveeksamen
				</div>
				<p className="text-muted-foreground">Prøveeksamenen kunne ikke lages{result.notes ? `: ${result.notes}` : "."}</p>
			</div>
		);
	}

	const openPdf = async () => {
		setNotice("");
		try {
			const res = await fetch(`/api/mock-exams/${result.code}/${result.examId}/open`, { method: "POST" });
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				setNotice(body.error ?? "Klarte ikke å åpne PDF-en.");
			}
		} catch {
			setNotice("Klarte ikke å åpne PDF-en.");
		}
	};

	const handIn = async (files: File[]) => {
		if (files.length === 0) return;
		setBusy(true);
		setNotice("");
		try {
			const { paths, failed } = await filesToPaths(files, answerFileDeps());
			if (paths.length > 0) actions?.sendText(scanHandInText(result.title, result.examId, paths));
			if (failed.length > 0) setNotice(failed.length === 1 ? failed[0]! : `${failed.length} filer kunne ikke legges ved.`);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="rounded-xl border bg-card p-4 text-card-foreground" data-testid="mock-exam-card">
			<div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				<NotebookPenIcon className="size-3.5" aria-hidden />
				Prøveeksamen
			</div>
			<div className="font-medium">{result.title}</div>
			<div className="mt-0.5 text-sm text-muted-foreground" data-testid="mock-exam-facts">{mockExamFacts(result)}</div>
			<div className="mt-3 flex flex-wrap gap-2">
				<Button variant="outline" size="sm" onClick={() => void openPdf()} disabled={!result.pdfPath} data-testid="mock-exam-open-pdf">
					<FileTextIcon aria-hidden />
					Åpne PDF
				</Button>
				<Button variant="outline" size="sm" onClick={() => setAnswering(true)} data-testid="mock-exam-answer">
					<PenLineIcon aria-hidden />
					Svar i appen
				</Button>
				<input
					ref={picker}
					type="file"
					accept={ANSWER_ACCEPT}
					multiple
					hidden
					data-testid="mock-exam-upload-file"
					onChange={(e) => {
						const files = Array.from(e.target.files ?? []);
						e.target.value = "";
						void handIn(files);
					}}
				/>
				<Button variant="outline" size="sm" onClick={() => picker.current?.click()} disabled={busy} data-testid="mock-exam-upload">
					<FileUpIcon aria-hidden />
					Legg inn besvarelse
				</Button>
			</div>
			{!result.pdfPath && <p className="mt-2 text-xs text-muted-foreground">PDF-en kunne ikke lages. Du kan svare i appen.</p>}
			{notice && <p role="status" className="mt-2 text-xs text-destructive">{notice}</p>}
			{answering && (
				<MockExamAnswerView
					code={result.code}
					examId={result.examId}
					onClose={() => setAnswering(false)}
					onSubmitted={(title) => {
						setAnswering(false);
						actions?.sendText(digitalHandInText(title, result.examId));
					}}
				/>
			)}
		</div>
	);
}

/** "37,5 / 50 poeng" or "62 / 100 %". */
function scoreLine(r: Pick<MockExamResult, "points" | "max" | "scoring">): string {
	const n = (v: number) => String(v).replace(".", ",");
	return r.scoring === "percent" ? `${n(r.points)} / ${n(r.max)} %` : `${n(r.points)} / ${n(r.max)} poeng`;
}

export function MockGradeCard({ result }: { result: MockGradeJobResult }) {
	const res = result.result;
	if (!res) {
		return (
			<div className="rounded-xl border bg-card p-4 text-sm" data-testid="mock-grade-failed">
				<div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					<ClipboardCheckIcon className="size-3.5" aria-hidden />
					Retting
				</div>
				<p className="text-muted-foreground">Besvarelsen kunne ikke rettes{result.notes ? `: ${result.notes}` : "."}</p>
			</div>
		);
	}
	return (
		<div className="rounded-xl border bg-card p-4 text-card-foreground" data-testid="mock-grade-card">
			<div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				<ClipboardCheckIcon className="size-3.5" aria-hidden />
				Retting · {res.source === "scan" ? "skannet besvarelse" : "levert i appen"}
			</div>
			<div className="font-medium">{res.title}</div>
			<div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
				<span className="text-2xl font-semibold tabular-nums" data-testid="mock-grade-total">{scoreLine(res)}</span>
				<span className="text-sm text-muted-foreground tabular-nums">{res.percent} %</span>
				{res.grade && (
					<span className="text-sm" data-testid="mock-grade-grade">
						Karakterestimat: <strong>{res.grade}</strong>
					</span>
				)}
			</div>
			{res.summary && <p className="mt-2 text-sm text-muted-foreground">{res.summary}</p>}
			<table className="mt-3 w-full text-sm" data-testid="mock-grade-tasks">
				<thead>
					<tr className="border-b text-left text-xs text-muted-foreground">
						<th className="py-1 font-medium">Oppgave</th>
						<th className="py-1 text-right font-medium">{res.scoring === "percent" ? "Prosent" : "Poeng"}</th>
					</tr>
				</thead>
				<tbody>
					{res.tasks.map((t) => (
						<tr key={t.number} className="border-b last:border-b-0">
							<td className="py-1">Oppgave {t.number}</td>
							<td className="py-1 text-right tabular-nums">
								{String(t.points).replace(".", ",")} / {String(t.max).replace(".", ",")}
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<details className="group mt-3">
				<summary className="cursor-pointer select-none text-xs text-muted-foreground">
					<span className="group-open:hidden">Vis retting og løsningsforslag per deloppgave</span>
					<span className="hidden group-open:inline">Skjul retting og løsningsforslag</span>
				</summary>
				<ol className="mt-2 flex flex-col gap-3">
					{res.parts.map((p) => (
						<li key={p.key} className="rounded-lg border p-3 text-sm" data-testid="mock-grade-part">
							<div className="flex items-baseline justify-between gap-3">
								<span className="font-medium">Oppgave {p.task}{p.label ? ` ${p.label})` : ""}</span>
								<span className="tabular-nums text-muted-foreground">
									{String(p.points).replace(".", ",")} / {String(p.max).replace(".", ",")}
								</span>
							</div>
							<p className="mt-1">{p.comment}</p>
							{p.missing && <p className="mt-1 text-muted-foreground">Manglet: {p.missing}</p>}
							<div className="mt-2 border-t pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
								Løsningsforslag{p.correctOption ? ` · riktig svar: ${p.correctOption})` : ""}
							</div>
							<div className="text-sm [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
								<MessageResponse>{p.solution}</MessageResponse>
							</div>
						</li>
					))}
				</ol>
			</details>
		</div>
	);
}
