"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, CalendarIcon, PlusIcon, XIcon } from "lucide-react";
import { ADD_COURSE_EVENT } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LegacyImportHint } from "@/components/import/legacy-import-hint";
import { AddCourse } from "./add-course";
import { CourseSelectChip } from "./course-chip";
import { daysLeftLabel, formatExamDate, sortCoursesByExam } from "./course-format";
import type { CourseSummary } from "./course-types";
import { LauncherSetupDialog, usePageTabCycle, useSessionLauncher } from "./session-launcher";
import { StartBox } from "./start-box";
import { TopicStatusBar } from "./status-ui";
import { useCourseSummaries } from "./use-courses";

const fagHref = (code: string) => `/fag/${encodeURIComponent(code)}`;

/**
 * One fag on the home screen. The WHOLE card is one link (one Tab stop,
 * one big target); «Fortsett» is its visible call to action. Everything a
 * screen reader needs is in the link's own text: code, name, countdown,
 * and the progress line's description.
 */
export function CourseCard({ course, tour = false }: { course: CourseSummary; tour?: boolean }) {
	const mapped = course.topicCount > 0;
	const urgent = course.daysLeft !== null && course.daysLeft >= 0 && course.daysLeft <= 7;
	return (
		<Link
			href={fagHref(course.code)}
			data-testid="course-card"
			data-tour={tour ? "course-card" : undefined}
			className="group flex min-h-44 flex-col rounded-2xl border bg-card p-5 shadow-xs outline-none transition-[border-color,box-shadow] hover:border-muted-foreground/40 hover:shadow-md focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
		>
			<span className="font-ui text-xs font-semibold uppercase tracking-wider tabular-nums text-muted-foreground">{course.code}</span>
			<span className="mt-1 line-clamp-2 font-ui text-lg font-semibold leading-snug">{course.name}</span>
			<span className={cn("mt-2 flex items-center gap-1.5 font-ui text-sm", urgent ? "font-medium text-foreground" : "text-muted-foreground")}>
				<CalendarIcon className="size-3.5 shrink-0" aria-hidden="true" />
				<span>{daysLeftLabel(course.daysLeft)}</span>
				{course.examDate && course.daysLeft !== null && course.daysLeft >= 0 && (
					<span className="text-muted-foreground">· {formatExamDate(course.examDate)}</span>
				)}
			</span>
			<span className="mt-auto block pt-4">
				<TopicStatusBar counts={course.counts} />
				<span className="mt-3 flex items-center justify-between gap-3">
					<span className="font-ui text-xs text-muted-foreground">
						{mapped
							? `${course.counts.green} av ${course.topicCount} temaer kan du`
							: "Ikke kartlagt ennå"}
					</span>
					<span className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 font-ui text-sm font-medium text-primary-foreground transition-opacity group-hover:opacity-90">
						{mapped ? "Fortsett" : "Kom i gang"}
						<ArrowRightIcon className="size-3.5" aria-hidden="true" />
					</span>
				</span>
			</span>
		</Link>
	);
}

/** Placeholder with the card's exact footprint: no jump when data lands. */
function CourseCardSkeleton() {
	return <div className="min-h-44 animate-pulse rounded-2xl border bg-card/60" aria-hidden="true" />;
}

/** The three steps, in one quiet line each: what will happen next. */
function HowItWorks() {
	const steps = [
		["Velg fag", "Appen henter emnesiden fra NTNU: innhold, læringsutbytte og eksamensdato."],
		["Kartlegg hva du kan", "Marker hvert tema som rødt, gult eller grønt, eller la AI-en teste deg."],
		["Følg planen", "Du får en plan dag for dag fram mot eksamen, med det viktigste først."],
	] as const;
	return (
		<ol className="mx-auto mt-10 grid max-w-3xl gap-3 text-left sm:grid-cols-3">
			{steps.map(([title, body], index) => (
				<li key={title} className="rounded-xl border bg-card/60 p-4">
					<span className="flex size-6 items-center justify-center rounded-full bg-primary font-ui text-xs font-semibold text-primary-foreground" aria-hidden="true">{index + 1}</span>
					<p className="mt-2 font-ui text-sm font-medium">{title}</p>
					<p className="mt-1 font-ui text-xs leading-relaxed text-muted-foreground">{body}</p>
				</li>
			))}
		</ol>
	);
}

/**
 * The body of «Mine fag», pure (props in, markup out): the first-run
 * welcome when there is no fag, otherwise the card grid sorted by nearest
 * exam. `addPanel` is the «Legg til fag» search, owned by the container.
 */
export function CoursesOverview({ courses, error, adding, onToggleAdd, onRetry, addPanel, importHint }: {
	/** null = still loading (skeletons, never a flash of the welcome). */
	courses: readonly CourseSummary[] | null;
	error?: string | null;
	adding: boolean;
	onToggleAdd: () => void;
	onRetry?: () => void;
	addPanel: React.ReactNode;
	/** First-run only: the «Har du brukt LearnHarness før?» line. */
	importHint?: React.ReactNode;
}) {
	const failure = error && (
		<p role="alert" className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 font-ui text-sm">
			<span>Kunne ikke hente fagene dine. {error}</span>
			{onRetry && <Button variant="outline" size="sm" onClick={onRetry}>Prøv igjen</Button>}
		</p>
	);
	if (courses !== null && courses.length === 0) {
		return (
			<section className="flex min-h-full flex-col justify-center py-10 text-center" data-testid="courses-empty">
				{failure}
				<h1 className="font-title text-3xl tracking-tight text-balance">Hvilket fag skal du ha eksamen i?</h1>
				<p className="mx-auto mt-3 max-w-lg font-ui text-base text-muted-foreground text-pretty">
					Skriv fagkoden eller navnet. Eksamenshjelp henter emnesiden fra NTNU og hjelper deg å lage en plan fram mot eksamen.
				</p>
				<div className="mt-8" data-tour="add-course">{addPanel}</div>
				<HowItWorks />
				{importHint}
			</section>
		);
	}
	return (
		<section data-testid="courses-overview">
			<div className="mb-5 flex flex-wrap items-center justify-between gap-3">
				<h1 className="font-title text-2xl tracking-tight">Mine fag</h1>
				<Button
					variant={adding ? "outline" : "default"}
					onClick={onToggleAdd}
					aria-expanded={adding}
					data-tour="add-course"
					data-testid="add-course-button"
				>
					{adding ? <XIcon aria-hidden="true" /> : <PlusIcon aria-hidden="true" />}
					{adding ? "Lukk" : "Legg til fag"}
				</Button>
			</div>
			{failure}
			{adding && <div className="mb-6 rounded-2xl border bg-card/60 p-4">{addPanel}</div>}
			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
				{courses === null
					? [0, 1, 2].map((i) => <CourseCardSkeleton key={i} />)
					: sortCoursesByExam(courses).map((course, index) => (
						<CourseCard key={course.code} course={course} tour={index === 0} />
					))}
			</div>
		</section>
	);
}

/**
 * HOME («Mine fag», `/`): the student's fag as cards, «Legg til fag», and
 * the start box for a free session at the bottom. The knowledge map that
 * used to live here is at /kart.
 */
export function CoursesHome({ initialConfigured, initialCourses, initialAdding = false }: {
	initialConfigured: boolean;
	/** Arrive with «Legg til fag» open (the sidebar's link). */
	initialAdding?: boolean;
	/** Server-read list when available: the first frame is already right. */
	initialCourses?: CourseSummary[];
}) {
	const router = useRouter();
	const root = useRef<HTMLDivElement>(null);
	usePageTabCycle(root);
	const launcher = useSessionLauncher(initialConfigured);
	const { courses, error, reload } = useCourseSummaries(initialCourses);
	const [adding, setAdding] = useState(initialAdding);
	const scroller = useRef<HTMLDivElement>(null);
	// The sidebar's «Legg til fag» while home is already showing.
	useEffect(() => {
		const onAdd = () => {
			setAdding(true);
			scroller.current?.scrollTo({ top: 0 });
		};
		window.addEventListener(ADD_COURSE_EVENT, onAdd);
		return () => window.removeEventListener(ADD_COURSE_EVENT, onAdd);
	}, []);
	// The start box's optional fag link. A deleted fag falls back to none.
	const [linkedCode, setLinkedCode] = useState("");
	const linked = courses?.some((c) => c.code === linkedCode) ? linkedCode : "";
	const empty = courses !== null && courses.length === 0;

	return (
		<div ref={root} className="flex h-dvh flex-col">
			<TopBar>
				<span className="font-ui text-sm font-medium text-muted-foreground">Hjem</span>
			</TopBar>
			<div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto h-full w-full max-w-5xl px-4 py-8 sm:px-6">
					<CoursesOverview
						courses={courses}
						error={error}
						adding={adding}
						onToggleAdd={() => setAdding((v) => !v)}
						onRetry={() => void reload()}
						importHint={empty ? <LegacyImportHint /> : undefined}
						addPanel={
							<AddCourse
								hero={empty}
								// First run and «Legg til fag» both land in the field.
								autoFocus={adding || empty}
								onAdded={(course) => router.push(fagHref(course.code))}
							/>
						}
					/>
				</div>
			</div>
			{/* The free-session start box: docked under the scroll area (never
			    over the cards), same geometry as the chat composer. */}
			<div className="shrink-0 border-t border-border/60 bg-background pb-4 pt-3">
				<div className="mx-auto w-full max-w-[46rem] px-4">
					<StartBox
						launcher={launcher}
						tourId="home-composer"
						placeholder="Hva vil du lære?"
						ownsFieldCycle={false}
						buildSession={(text) => ({ title: text, ...(linked ? { course: { code: linked } } : {}) })}
						leadingSlot={<CourseSelectChip courses={courses ?? []} value={linked} onChange={setLinkedCode} />}
					/>
				</div>
			</div>
			<LauncherSetupDialog launcher={launcher} />
		</div>
	);
}
