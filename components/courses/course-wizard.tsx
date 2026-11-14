"use client";

import { useId, useState } from "react";
import { ArrowLeftIcon, ArrowRightIcon, LoaderCircleIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatExamDate, mappingSession, type CourseSessionStart, type SelfStatus } from "./course-format";
import { SourceAdder, SourceList, type AddSource } from "./course-sources";
import { ExamSessionCard, type ExamSessionState } from "./exam-session";
import { topicCounts, type Course } from "./course-types";
import { StatusButtons, StatusDot } from "./status-ui";

export interface WizardActions {
	/** Save the exam date ("" clears it). Resolves true when saved. */
	onExamDate: (date: string) => Promise<boolean>;
	onAddSource: AddSource;
	onRemoveSource: (id: string) => void;
	/** Make the topic list. Resolves how it was made, or null on failure. */
	onGenerate: () => Promise<"ai" | "fallback" | null>;
	onStatus: (topicId: string, status: SelfStatus) => void;
	onStart: (session: CourseSessionStart) => void;
	/** Open model setup (offered when the list was made without AI). */
	onOpenSetup: () => void;
	onDone: () => void;
	starting: boolean;
}

const STEPS = ["Når er eksamen?", "Har du noe materiale?", "Kartlegg hva du kan"] as const;

/** «Steg 2 av 3» with three marks: where you are, in words and in shape. */
function StepIndicator({ step }: { step: number }) {
	return (
		<div className="flex items-center gap-3">
			<ol className="flex gap-1.5" aria-hidden="true">
				{STEPS.map((label, index) => (
					<li key={label} className={cn("h-1.5 w-8 rounded-full", index <= step ? "bg-primary" : "bg-muted")} />
				))}
			</ol>
			<p className="font-ui text-xs text-muted-foreground" data-testid="wizard-step">Steg {step + 1} av {STEPS.length}</p>
		</div>
	);
}

/**
 * THE FIRST-RUN WIZARD: shown while a fag has no topics. Three small steps
 * in one calm card, each skippable: (1) confirm the exam date, (2) add
 * material, (3) make the topic list and say how well you know each topic.
 * Every answer is saved as it is given, so leaving halfway loses nothing.
 */
export function CourseWizard({ course, actions, initialStep = 0, examSession = null }: {
	course: Course;
	actions: WizardActions;
	initialStep?: 0 | 1 | 2;
	/** The fag's eksamensøkt, if it has one (the last step offers the
	 *  eksamensøkt as an alternative to the topic list and the plan). */
	examSession?: ExamSessionState;
}) {
	const [step, setStep] = useState<number>(initialStep);
	const [date, setDate] = useState(course.exam.date ?? "");
	const [savingDate, setSavingDate] = useState(false);
	const [generating, setGenerating] = useState(false);
	const [generatedBy, setGeneratedBy] = useState<"ai" | "fallback" | null>(
		course.topics.length > 0 && course.topicsGeneratedBy === "fallback" ? "fallback" : null,
	);
	const dateId = useId(), headingId = useId();
	const own = course.sources.filter((source) => !source.auto);
	const counts = topicCounts(course.topics);
	const assessed = course.topics.length - counts.unknown;
	const fromNtnu = !course.custom && !!course.exam.date;

	const generate = async () => {
		setGenerating(true);
		const how = await actions.onGenerate();
		setGenerating(false);
		if (how) setGeneratedBy(how);
	};

	return (
		<section
			data-testid="course-wizard"
			aria-labelledby={headingId}
			className="mx-auto w-full max-w-2xl rounded-2xl border bg-card p-5 shadow-xs sm:p-7"
		>
			<StepIndicator step={step} />
			<h2 id={headingId} className="mt-3 font-ui text-xl font-semibold tracking-tight">{STEPS[step]}</h2>

			{step === 0 && (
				<form
					className="mt-3 flex flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						if (savingDate) return;
						if (date === (course.exam.date ?? "")) {
							setStep(1);
							return;
						}
						setSavingDate(true);
						void actions.onExamDate(date).then((ok) => {
							setSavingDate(false);
							if (ok) setStep(1);
						});
					}}
				>
					<p className="font-ui text-sm leading-relaxed text-muted-foreground">
						{fromNtnu
							? `NTNU oppgir ${formatExamDate(course.exam.date)}. Stemmer det? Du kan endre datoen når som helst.`
							: "Datoen brukes til å lage en plan som rekker fram. Vet du den ikke ennå, hopper du bare over."}
					</p>
					<div className="flex flex-col gap-1">
						<label htmlFor={dateId} className="font-ui text-xs font-medium">Eksamensdato</label>
						<Input id={dateId} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-48" />
					</div>
					{(course.exam.form || course.exam.duration || course.exam.aids) && (
						<dl className="grid gap-x-6 gap-y-1 font-ui text-sm sm:grid-cols-[auto_1fr]">
							{course.exam.form && <><dt className="text-muted-foreground">Eksamensform</dt><dd>{course.exam.form}</dd></>}
							{course.exam.duration && <><dt className="text-muted-foreground">Varighet</dt><dd>{course.exam.duration}</dd></>}
							{course.exam.aids && <><dt className="text-muted-foreground">Hjelpemidler</dt><dd>{course.exam.aids}</dd></>}
						</dl>
					)}
					<div className="flex flex-wrap gap-2">
						<Button type="submit" disabled={savingDate}>
							{savingDate && <LoaderCircleIcon className="animate-spin" aria-hidden="true" />}
							Neste
							<ArrowRightIcon aria-hidden="true" />
						</Button>
						<Button type="button" variant="ghost" onClick={() => setStep(1)} disabled={savingDate}>Hopp over</Button>
					</div>
				</form>
			)}

			{step === 1 && (
				<div className="mt-3 flex flex-col gap-4">
					<p className="font-ui text-sm leading-relaxed text-muted-foreground">
						Valgfritt, men det hjelper mye. <strong className="font-semibold text-foreground">Tidligere eksamener og løsningsforslag</strong> gir den beste planen: last dem ned fra Canvas og dra mappen hit. Forelesningsnotater og pensumlister er også nyttige.
					</p>
					<SourceAdder onAdd={actions.onAddSource} compact />
					<SourceList sources={own} onRemove={actions.onRemoveSource} />
					<div className="flex flex-wrap gap-2">
						<Button variant="ghost" onClick={() => setStep(0)}>
							<ArrowLeftIcon aria-hidden="true" />
							Tilbake
						</Button>
						<Button onClick={() => setStep(2)}>
							{own.length > 0 ? "Neste" : "Hopp over"}
							<ArrowRightIcon aria-hidden="true" />
						</Button>
					</div>
				</div>
			)}

			{step === 2 && course.topics.length === 0 && (
				<div className="mt-3 flex flex-col gap-4">
					<p className="font-ui text-sm leading-relaxed text-muted-foreground">
						Appen lager en liste over temaene i {course.code} fra emnesiden og materialet ditt. Etterpå sier du hvor godt du kan hvert tema, og så er planen klar.
					</p>
					<div role="status" className="min-h-5 font-ui text-sm text-muted-foreground">
						{generating && "Lager temaliste … Det kan ta opptil et minutt."}
					</div>
					<div className="flex flex-wrap gap-2">
						<Button variant="ghost" onClick={() => setStep(1)} disabled={generating}>
							<ArrowLeftIcon aria-hidden="true" />
							Tilbake
						</Button>
						<Button onClick={() => void generate()} disabled={generating} data-testid="generate-topics">
							{generating
								? <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
								: <SparklesIcon aria-hidden="true" />}
							Lag temaliste
						</Button>
					</div>
				</div>
			)}

			{step === 2 && course.topics.length > 0 && (
				<div className="mt-3 flex flex-col gap-4">
					<p className="font-ui text-sm leading-relaxed text-muted-foreground">
						Hvor godt kan du hvert tema? Svar etter magefølelsen, du kan endre det senere. Svarene lagres med en gang.
					</p>
					{generatedBy === "fallback" && (
						<p className="rounded-xl border bg-background px-3 py-2.5 font-ui text-sm leading-relaxed" data-testid="fallback-note">
							Lista ble laget uten AI, rett fra læringsutbyttet på emnesiden.{" "}
							<button
								type="button"
								onClick={actions.onOpenSetup}
								className="cursor-pointer rounded-sm underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
							>
								Sett opp modeller
							</button>{" "}
							for en bedre liste, og velg så «Lag temaliste på nytt» under Temaer.
						</p>
					)}
					<div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-background px-3 py-2.5">
						<p className="min-w-0 flex-1 font-ui text-sm text-muted-foreground">Usikker på hva du kan? AI-en kan stille deg noen spørsmål og sette fargene for deg.</p>
						<Button
							variant="outline"
							size="sm"
							disabled={actions.starting}
							onClick={() => actions.onStart(mappingSession(course))}
							data-testid="start-mapping"
						>
							<SparklesIcon aria-hidden="true" />
							La AI-en teste meg i stedet
						</Button>
					</div>
					<ul className="flex flex-col gap-3">
						{course.topics.map((topic) => (
							<li key={topic.id} data-testid="wizard-topic" className="rounded-xl border bg-background p-3">
								<p className="flex items-start gap-2 font-ui text-sm font-semibold">
									<StatusDot status={topic.status} className="mt-0.5" />
									<span className="min-w-0 break-words">{topic.title}</span>
								</p>
								{topic.description && <p className="mt-1 pl-6 font-ui text-xs leading-relaxed text-muted-foreground">{topic.description}</p>}
								<div className="mt-3">
									<StatusButtons
										size="lg"
										value={topic.status}
										topicTitle={topic.title}
										onChange={(status) => actions.onStatus(topic.id, status)}
									/>
								</div>
							</li>
						))}
					</ul>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<p role="status" className="font-ui text-sm text-muted-foreground">
							{assessed} av {course.topics.length} temaer vurdert
						</p>
						<Button onClick={actions.onDone} data-testid="wizard-done">
							{assessed === 0 ? "Hopp over og vis planen" : "Ferdig, vis planen"}
							<ArrowRightIcon aria-hidden="true" />
						</Button>
					</div>
				</div>
			)}

			{/* The alternative to the plan: one continuous eksamensøkt. */}
			{step === 2 && !generating && (
				<div className="mt-4 border-t border-border/60 pt-4">
					<p className="mb-2 font-ui text-xs font-medium uppercase tracking-widest text-muted-foreground">Eller</p>
					<ExamSessionCard course={course} session={examSession} onStart={actions.onStart} starting={actions.starting} compact />
				</div>
			)}
		</section>
	);
}
