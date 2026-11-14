"use client";

import { useState } from "react";
import {
	BookOpenIcon, CalendarClockIcon, CheckIcon, ChevronRightIcon, ClipboardCheckIcon, DumbbellIcon, PlayIcon, RotateCcwIcon, SparklesIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
	ACTIVITY_LABEL, daysLeftLabel, formatExamDate, formatMinutes, formatPlanDay, MINUTES_PER_DAY_OPTIONS,
	mappingSession, planItemSubject, sessionForPlanItem, type CourseSessionStart,
} from "./course-format";
import {
	topicCounts, type Course, type ExamPlan, type ExamPlanDay, type ExamPlanItem, type PlanActivity,
} from "./course-types";
import { ExamSessionCard, type ExamSessionState } from "./exam-session";
import { StatusDot, TopicStatusBar } from "./status-ui";

const ACTIVITY_ICON: Record<PlanActivity, typeof BookOpenIcon> = {
	learn: BookOpenIcon,
	practice: DumbbellIcon,
	review: RotateCcwIcon,
	mock: ClipboardCheckIcon,
};

/** How many upcoming days show before «Vis hele planen». */
const UPCOMING_PREVIEW = 6;

export interface ExamPlanActions {
	onToggleDone: (key: string, done: boolean) => void;
	onStart: (session: CourseSessionStart) => void;
	onMinutesPerDay: (minutes: number) => void;
	/** Open the first-run wizard (no topics yet). */
	onOpenWizard: () => void;
	/** Go to the Temaer tab so the student can set the colours («Kartlegg
	 *  nå»). Absent = the nudge offers only the AI mapping session. */
	onMapTopics?: () => void;
	/** Put focus on the exam date field (no date, or the exam has passed). */
	onEditExamDate: () => void;
	/** A session is being created: every Start button waits. */
	starting: boolean;
}

/** From this share of unmapped topics and up, the plan is mostly a guess
 *  and says so. */
export const UNMAPPED_NUDGE_SHARE = 0.7;

/** Is (nearly) nothing mapped yet? True when at least 70 % of the topics
 *  are still «Ikke kartlagt»; never for an empty topic list (that state
 *  has its own message). */
export function planNeedsMapping(topics: ReadonlyArray<{ status: string }>): boolean {
	if (topics.length === 0) return false;
	return topics.filter((topic) => topic.status === "unknown").length / topics.length >= UNMAPPED_NUDGE_SHARE;
}

/** The option whose minutes are closest to the stored value. */
export function minutesOptionFor(minutes: number): number {
	return MINUTES_PER_DAY_OPTIONS.reduce((best, option) =>
		Math.abs(option.minutes - minutes) < Math.abs(best - minutes) ? option.minutes : best, MINUTES_PER_DAY_OPTIONS[0]!.minutes);
}

const dayMinutes = (day: ExamPlanDay) => day.items.reduce((sum, item) => sum + item.minutes, 0);

/** One plan item: tick it off, see what it is, start it. */
function PlanItemRow({ course, item, actions }: { course: Course; item: ExamPlanItem; actions: ExamPlanActions }) {
	const topic = item.topicId ? course.topics.find((t) => t.id === item.topicId) : undefined;
	const Icon = ACTIVITY_ICON[item.activity];
	const subject = item.activity === "mock" ? item.title : planItemSubject(item, topic);
	return (
		<li data-testid="plan-item" data-done={item.done || undefined} className="flex items-center gap-3 py-2.5">
			<label className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none transition-colors focus-within:ring-[3px] focus-within:ring-ring/50 hover:bg-accent">
				<input
					type="checkbox"
					checked={item.done}
					onChange={(e) => actions.onToggleDone(item.key, e.target.checked)}
					className="peer sr-only"
					aria-label={`${item.done ? "Ferdig" : "Marker som ferdig"}: ${ACTIVITY_LABEL[item.activity]}, ${subject}`}
				/>
				<span className="flex size-5 items-center justify-center rounded-md border border-muted-foreground/50 text-transparent transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground" aria-hidden="true">
					<CheckIcon className="size-3.5" strokeWidth={3} />
				</span>
			</label>
			<div className={cn("min-w-0 flex-1", item.done && "opacity-55")}>
				<p className={cn("flex items-center gap-2 font-ui text-sm font-medium", item.done && "line-through")}>
					{topic && <StatusDot status={topic.status} />}
					<span className="truncate">{subject}</span>
				</p>
				<p className="mt-0.5 flex items-center gap-1.5 font-ui text-xs text-muted-foreground">
					<Icon className="size-3 shrink-0" aria-hidden="true" />
					<span>{ACTIVITY_LABEL[item.activity]}</span>
					<span aria-hidden="true">·</span>
					<span className="tabular-nums">{formatMinutes(item.minutes)}</span>
				</p>
			</div>
			<Button
				size="sm"
				variant={item.done ? "outline" : "default"}
				disabled={actions.starting}
				onClick={() => actions.onStart(sessionForPlanItem(course, item))}
				aria-label={`Start: ${ACTIVITY_LABEL[item.activity]}, ${subject}`}
				data-testid="plan-item-start"
			>
				<PlayIcon aria-hidden="true" />
				Start
			</Button>
		</li>
	);
}

/** A later day: one compact row that opens to its items. */
function UpcomingDay({ course, day, today, actions }: { course: Course; day: ExamPlanDay; today: string; actions: ExamPlanActions }) {
	const left = day.items.filter((item) => !item.done).length;
	return (
		<details data-testid="plan-day" className="group border-b border-border/60 last:border-b-0">
			<summary className="flex cursor-pointer list-none items-center gap-3 rounded-md px-2 py-2.5 font-ui text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
				<ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
				<span className="w-44 shrink-0 truncate font-medium first-letter:uppercase">{formatPlanDay(day.date, today)}</span>
				<span className="min-w-0 flex-1 truncate text-muted-foreground">
					{day.items.map((item) => item.activity === "mock" ? ACTIVITY_LABEL.mock : planItemSubject(item, course.topics.find((t) => t.id === item.topicId))).join(", ")}
				</span>
				<span className="shrink-0 text-xs tabular-nums text-muted-foreground">
					{left === 0 ? "Ferdig" : `${day.items.length} ${day.items.length === 1 ? "økt" : "økter"} · ${formatMinutes(dayMinutes(day))}`}
				</span>
			</summary>
			<ul className="divide-y divide-border/60 pb-2 pl-9 pr-2">
				{day.items.map((item) => <PlanItemRow key={item.key} course={course} item={item} actions={actions} />)}
			</ul>
		</details>
	);
}

/** A calm, centered message with one way forward. */
function PlanMessage({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
	return (
		<div className="rounded-2xl border border-dashed bg-card/50 px-6 py-10 text-center" data-testid="plan-message">
			<p className="font-ui text-base font-semibold">{title}</p>
			<p className="mx-auto mt-2 max-w-md font-ui text-sm leading-relaxed text-muted-foreground">{children}</p>
			{action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
		</div>
	);
}

/**
 * EKSAMENSPLAN: the page's most important view. A compact status line
 * (days left, the colour split, today's load), then the plan day by day:
 * today open and prominent, the coming days as compact rows.
 *
 * Pure in everything but two bits of view state (which days are revealed);
 * the plan itself always comes from the server (`plan`), so ticking an item
 * or changing a status re-plans there.
 */
export function ExamPlanView({ course, plan, today, actions, examSession = null }: {
	course: Course;
	plan: ExamPlan;
	/** The student's local date, YYYY-MM-DD. */
	today: string;
	actions: ExamPlanActions;
	/** The fag's eksamensøkt, if it has one (the card under the status
	 *  line continues it instead of starting another). */
	examSession?: ExamSessionState;
}) {
	const [showAll, setShowAll] = useState(false);
	const counts = topicCounts(course.topics);
	const todayPlan = plan.days.find((day) => day.date === today);
	const upcoming = plan.days.filter((day) => day.date > today && day.items.length > 0);
	const shown = showAll ? upcoming : upcoming.slice(0, UPCOMING_PREVIEW);
	const todayLeft = todayPlan ? todayPlan.items.filter((item) => !item.done) : [];
	const noTopics = course.topics.length === 0;
	const examPassed = plan.daysLeft !== null && plan.daysLeft < 0;
	const examToday = plan.daysLeft === 0;
	// Nothing (or nearly nothing) mapped: the plan below treats every topic
	// alike. Say so, with the two ways to fix it. Gone the moment enough
	// topics have a colour, and never on or after exam day.
	const needsMapping = planNeedsMapping(course.topics) && !examPassed && !examToday;

	return (
		<section data-tour="exam-plan" data-testid="exam-plan" aria-label="Eksamensplan" className="flex flex-col gap-5">
			{needsMapping && (
				<div
					data-testid="plan-mapping-nudge"
					role="note"
					className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-primary/40 bg-primary/5 px-4 py-3"
				>
					<p className="min-w-0 flex-1 basis-64 font-ui text-sm leading-relaxed">
						<span className="font-semibold">Planen blir bedre når du har kartlagt temaene.</span>{" "}
						<span className="text-muted-foreground">Det tar ett minutt.</span>
					</p>
					<div className="flex flex-wrap gap-2">
						{actions.onMapTopics && (
							<Button size="sm" onClick={actions.onMapTopics} data-testid="plan-map-now">Kartlegg nå</Button>
						)}
						<Button
							variant="outline"
							size="sm"
							disabled={actions.starting}
							onClick={() => actions.onStart(mappingSession(course))}
							data-testid="plan-map-with-ai"
						>
							<SparklesIcon aria-hidden="true" />
							La AI-en teste meg
						</Button>
					</div>
				</div>
			)}

			{/* The status line: three facts, always in the same places. */}
			<div className="grid gap-4 rounded-2xl border bg-card p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-6">
				<div>
					<p className="font-ui text-xl font-semibold tabular-nums">{daysLeftLabel(plan.daysLeft)}</p>
					<p className="font-ui text-xs text-muted-foreground">
						{course.exam.date ? formatExamDate(course.exam.date) : "Planen dekker de neste to ukene"}
					</p>
				</div>
				<TopicStatusBar counts={counts} legend />
				<label className="flex flex-col gap-1 font-ui text-xs text-muted-foreground">
					Tid per dag
					<select
						value={minutesOptionFor(course.minutesPerDay)}
						onChange={(e) => actions.onMinutesPerDay(Number(e.target.value))}
						data-testid="minutes-per-day"
						className="h-8 cursor-pointer rounded-md border border-input bg-background px-2 font-ui text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
					>
						{MINUTES_PER_DAY_OPTIONS.map((option) => (
							<option key={option.minutes} value={option.minutes}>{option.label}</option>
						))}
					</select>
				</label>
			</div>

			{/* The other way through the fag: one continuous eksamensøkt. Always
			    here, in the same place, whatever state the plan below is in. */}
			<ExamSessionCard course={course} session={examSession} onStart={actions.onStart} starting={actions.starting} />

			{noTopics ? (
				<PlanMessage
					title="Planen trenger en temaliste"
					action={<Button onClick={actions.onOpenWizard}>Kom i gang</Button>}
				>
					Først lager vi en liste over temaene i faget, og du markerer hva du kan fra før. Det tar et par minutter, og så har du en plan.
				</PlanMessage>
			) : examPassed ? (
				<PlanMessage
					title="Eksamen er over"
					action={<Button variant="outline" onClick={actions.onEditExamDate}>Sett ny dato</Button>}
				>
					Skal du ta faget på nytt, setter du en ny eksamensdato og får en ny plan. Er du ferdig med faget, kan du slette det fra menyen øverst. Øktene dine beholdes.
				</PlanMessage>
			) : examToday ? (
				<PlanMessage title="Eksamen er i dag. Lykke til!">
					Det er ikke mer å planlegge nå. Stol på det du har øvd på, og les oppgavene nøye.
				</PlanMessage>
			) : plan.days.every((day) => day.items.length === 0) ? (
				<PlanMessage title="Ingenting igjen å planlegge">
					Alle temaene er dekket. Bruk fanen Temaer hvis du vil lære eller øve på noe spesielt.
				</PlanMessage>
			) : (
				<>
					{!course.exam.date && (
						<p className="flex flex-wrap items-center gap-2 rounded-xl border bg-card/60 px-4 py-3 font-ui text-sm text-muted-foreground">
							<CalendarClockIcon className="size-4 shrink-0" aria-hidden="true" />
							<span className="min-w-0 flex-1">Sett eksamensdato, så rekker planen helt fram til eksamen.</span>
							<Button variant="outline" size="sm" onClick={actions.onEditExamDate}>Sett eksamensdato</Button>
						</p>
					)}

					{/* TODAY: open, prominent, the one thing to act on. */}
					<div className="rounded-2xl border-2 border-primary/40 bg-card p-4 shadow-xs" data-testid="plan-today">
						<div className="flex flex-wrap items-baseline justify-between gap-2">
							<h2 className="font-ui text-lg font-semibold">I dag</h2>
							<p className="font-ui text-sm text-muted-foreground">
								{!todayPlan || todayPlan.items.length === 0
									? "Ingenting planlagt"
									: todayLeft.length === 0
										? "Ferdig for i dag"
										: `${todayLeft.length} ${todayLeft.length === 1 ? "økt" : "økter"} igjen · ${formatMinutes(todayLeft.reduce((sum, item) => sum + item.minutes, 0))}`}
							</p>
						</div>
						{!todayPlan || todayPlan.items.length === 0 ? (
							<p className="mt-2 font-ui text-sm text-muted-foreground">
								Fridag i planen. Vil du gjøre noe likevel, finner du alle temaene under Temaer.
							</p>
						) : (
							<>
								<ul className="mt-1 divide-y divide-border/60">
									{todayPlan.items.map((item) => <PlanItemRow key={item.key} course={course} item={item} actions={actions} />)}
								</ul>
								{todayLeft.length === 0 && (
									<p role="status" className="mt-2 font-ui text-sm font-medium text-emerald-700 dark:text-emerald-300">
										Bra jobba! Du er ferdig med dagens plan.
									</p>
								)}
							</>
						)}
					</div>

					{upcoming.length > 0 && (
						<div>
							<h2 className="mb-1 px-2 font-ui text-xs font-medium uppercase tracking-widest text-muted-foreground">De neste dagene</h2>
							<div className="rounded-2xl border bg-card px-2">
								{shown.map((day) => <UpcomingDay key={day.date} course={course} day={day} today={today} actions={actions} />)}
							</div>
							{upcoming.length > UPCOMING_PREVIEW && (
								<Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
									{showAll ? "Vis færre dager" : `Vis hele planen (${upcoming.length - UPCOMING_PREVIEW} dager til)`}
								</Button>
							)}
						</div>
					)}
				</>
			)}
		</section>
	);
}
