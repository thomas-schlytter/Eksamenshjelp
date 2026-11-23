import type {
	ChatCourseLink, CourseSummary, CourseTopic, ExamPlanItem, PlanActivity, TopicStatus,
} from "./course-types";

/**
 * Pure presentation helpers for the course UI: labels, dates, sorting and
 * the session each "Start"-button creates. No React, no fetch: the render
 * and unit tests pin these directly.
 */

/** Left-to-right order in the progress line: what you know first. */
export const STATUS_BAR_ORDER: readonly TopicStatus[] = ["green", "yellow", "red", "unknown"];
/** Top-to-bottom order on the topic board: what needs work first. */
export const STATUS_BOARD_ORDER: readonly TopicStatus[] = ["red", "yellow", "unknown", "green"];
/** The three choices a student can make (unknown is the absence of one). */
export const SELF_STATUSES = ["red", "yellow", "green"] as const;
export type SelfStatus = (typeof SELF_STATUSES)[number];

/** Tailwind classes per status. Status is never colour alone: every use
 *  pairs these with the label or an icon. */
export const STATUS_STYLE: Record<TopicStatus, { dot: string; bar: string; text: string; active: string; idle: string }> = {
	green: {
		dot: "bg-emerald-600 dark:bg-emerald-400",
		bar: "bg-emerald-600 dark:bg-emerald-400",
		text: "text-emerald-700 dark:text-emerald-300",
		active: "border-emerald-600 bg-emerald-600 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-emerald-950",
		idle: "border-emerald-600/40 text-emerald-800 hover:bg-emerald-600/10 dark:border-emerald-400/40 dark:text-emerald-200 dark:hover:bg-emerald-400/10",
	},
	yellow: {
		dot: "bg-amber-500 dark:bg-amber-400",
		bar: "bg-amber-500 dark:bg-amber-400",
		text: "text-amber-700 dark:text-amber-300",
		active: "border-amber-500 bg-amber-500 text-amber-950 dark:border-amber-400 dark:bg-amber-400",
		idle: "border-amber-500/50 text-amber-800 hover:bg-amber-500/10 dark:border-amber-400/40 dark:text-amber-200 dark:hover:bg-amber-400/10",
	},
	red: {
		dot: "bg-red-600 dark:bg-red-400",
		bar: "bg-red-600 dark:bg-red-400",
		text: "text-red-700 dark:text-red-300",
		active: "border-red-600 bg-red-600 text-white dark:border-red-400 dark:bg-red-400 dark:text-red-950",
		idle: "border-red-600/40 text-red-800 hover:bg-red-600/10 dark:border-red-400/40 dark:text-red-200 dark:hover:bg-red-400/10",
	},
	unknown: {
		dot: "bg-muted-foreground/40",
		bar: "bg-muted-foreground/25",
		text: "text-muted-foreground",
		active: "border-border bg-accent text-foreground",
		idle: "border-border text-muted-foreground hover:bg-accent",
	},
};

export const ACTIVITY_LABEL: Record<PlanActivity, string> = {
	learn: "Lær",
	practice: "Øv",
	review: "Repeter",
	mock: "Prøveeksamen",
};

export const WEIGHT_LABEL: Record<1 | 2 | 3, string> = {
	1: "Mindre viktig",
	2: "Viktig",
	3: "Svært viktig",
};

/** The simple "minutes per day" choices (4 t+ stores 240). */
export const MINUTES_PER_DAY_OPTIONS: readonly { minutes: number; label: string }[] = [
	{ minutes: 30, label: "30 min" },
	{ minutes: 60, label: "1 t" },
	{ minutes: 120, label: "2 t" },
	{ minutes: 180, label: "3 t" },
	{ minutes: 240, label: "4 t+" },
];

const MONTHS = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];
const WEEKDAYS = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];

function parseIsoDate(iso: string | undefined): { y: number; m: number; d: number } | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
	if (!match) return null;
	const y = Number(match[1]), m = Number(match[2]), d = Number(match[3]);
	if (m < 1 || m > 12 || d < 1 || d > 31) return null;
	return { y, m, d };
}

/** Whole calendar days from `fromIso` to `toIso` (negative when passed). */
export function daysBetween(fromIso: string, toIso: string): number | null {
	const a = parseIsoDate(fromIso), b = parseIsoDate(toIso);
	if (!a || !b) return null;
	return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/** "12. desember 2026", or "" for a missing/invalid date. */
export function formatExamDate(iso: string | undefined): string {
	const date = parseIsoDate(iso);
	return date ? `${date.d}. ${MONTHS[date.m - 1]} ${date.y}` : "";
}

/** "07/12/2026" (dd/mm/åååå), or "" for a missing/invalid date. */
export function formatNumericDate(iso: string | undefined): string {
	const date = parseIsoDate(iso);
	const pad = (n: number) => String(n).padStart(2, "0");
	return date ? `${pad(date.d)}/${pad(date.m)}/${date.y}` : "";
}

/** The countdown on cards and headers. Null means no date is set. */
export function daysLeftLabel(daysLeft: number | null): string {
	if (daysLeft === null) return "Sett eksamensdato";
	if (daysLeft < 0) return "Eksamen er over";
	if (daysLeft === 0) return "Eksamen er i dag";
	if (daysLeft === 1) return "1 dag til eksamen";
	return `${daysLeft} dager til eksamen`;
}

/** Compact form for the sidebar: "12 d", "i dag", "" when unknown/passed. */
export function daysLeftShort(daysLeft: number | null): string {
	if (daysLeft === null || daysLeft < 0) return "";
	return daysLeft === 0 ? "i dag" : `${daysLeft} d`;
}

/** Day heading in the plan: "I dag", "I morgen", else "tirsdag 17. november". */
export function formatPlanDay(dateIso: string, today: string): string {
	const diff = daysBetween(today, dateIso);
	if (diff === 0) return "I dag";
	if (diff === 1) return "I morgen";
	const date = parseIsoDate(dateIso);
	if (!date) return dateIso;
	const weekday = WEEKDAYS[new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay()]!;
	return `${weekday} ${date.d}. ${MONTHS[date.m - 1]}`;
}

/** "45 min", "1 t", "1 t 30 min". */
export function formatMinutes(minutes: number): string {
	const total = Math.max(0, Math.round(minutes));
	const h = Math.floor(total / 60), m = total % 60;
	if (h === 0) return `${m} min`;
	return m === 0 ? `${h} t` : `${h} t ${m} min`;
}

/** Screen-reader (and tooltip) text for the progress line. */
export function countsSummary(counts: Record<TopicStatus, number>): string {
	const total = counts.green + counts.yellow + counts.red + counts.unknown;
	if (total === 0) return "Ingen temaer ennå";
	const parts: string[] = [];
	if (counts.green > 0) parts.push(`${counts.green} kan du`);
	if (counts.yellow > 0) parts.push(`${counts.yellow} er du usikker på`);
	if (counts.red > 0) parts.push(`${counts.red} kan du ikke ennå`);
	if (counts.unknown > 0) parts.push(`${counts.unknown} er ikke kartlagt`);
	return `${total} ${total === 1 ? "tema" : "temaer"}: ${parts.join(", ")}`;
}

/** Nearest upcoming exam first, then courses without a date, then passed. */
export function sortCoursesByExam<T extends Pick<CourseSummary, "daysLeft" | "code">>(courses: readonly T[]): T[] {
	const rank = (c: T) => (c.daysLeft === null ? 1 : c.daysLeft < 0 ? 2 : 0);
	return [...courses].sort((a, b) =>
		rank(a) - rank(b)
		|| (rank(a) === 0 ? a.daysLeft! - b.daysLeft! : 0)
		|| a.code.localeCompare(b.code, "nb"));
}

/** Topics for the board: needs-work first, then exam relevance, then title. */
export function sortTopicsForBoard<T extends Pick<CourseTopic, "status" | "weight" | "title">>(topics: readonly T[]): T[] {
	return [...topics].sort((a, b) =>
		STATUS_BOARD_ORDER.indexOf(a.status) - STATUS_BOARD_ORDER.indexOf(b.status)
		|| b.weight - a.weight
		|| a.title.localeCompare(b.title, "nb"));
}

/** What one "Start"-button creates: the POST /api/chats body plus the
 *  learner's opening message (delivered as the session's first turn). */
export interface CourseSessionStart {
	title: string;
	kind?: "practice" | "exam";
	course: ChatCourseLink;
	openingText: string;
}

type CourseRef = { code: string; name: string };

export function learnSession(course: CourseRef, topic: Pick<CourseTopic, "id" | "title">): CourseSessionStart {
	return {
		title: `Lær: ${topic.title}`,
		course: { code: course.code, topicId: topic.id, mode: "learn" },
		openingText: `Lær meg ${topic.title} i ${course.code} fram mot eksamen.`,
	};
}

export function practiceSession(course: CourseRef, topic: Pick<CourseTopic, "id" | "title">): CourseSessionStart {
	return {
		title: `Øv: ${topic.title}`,
		kind: "practice",
		course: { code: course.code, topicId: topic.id, mode: "practice" },
		openingText: `Gi meg eksamensoppgaver om ${topic.title} i ${course.code}.`,
	};
}

export function mockExamSession(course: CourseRef): CourseSessionStart {
	return {
		title: `Prøveeksamen ${course.code}`,
		kind: "practice",
		course: { code: course.code, mode: "practice" },
		openingText: `Gi meg et prøveeksamenssett i ${course.code}.`,
	};
}

export function mappingSession(course: CourseRef): CourseSessionStart {
	return {
		title: `Kartlegging ${course.code}`,
		course: { code: course.code, mode: "mapping" },
		openingText: `Kartlegg hva jeg kan i ${course.code} ${course.name}.`,
	};
}

/** Eksamensøkt: one continuous session for the whole fag (kind "exam").
 *  The agent maps the pensum from the fag's sources and follows the
 *  student on a colored map; no single tema. */
export function examSession(course: CourseRef): CourseSessionStart {
	return {
		title: `Eksamensøkt ${course.code}`,
		kind: "exam",
		course: { code: course.code, mode: "exam" },
		openingText: `Jeg skal ha eksamen i ${course.code} ${course.name}. Kartlegg pensum og lag et eksamenskart.`,
	};
}

/** What a plan item is ABOUT: the topic's title when it still exists,
 *  else the item's own title without its «Lær: »-style activity prefix. */
export function planItemSubject(item: Pick<ExamPlanItem, "title">, topic?: Pick<CourseTopic, "title">): string {
	return topic?.title ?? item.title.replace(/^(Lær|Øv|Repeter):\s*/, "");
}

/** Plan item → session: learn/review teach, practice/mock drill. A plan
 *  item without a topic (a mock exam, or a topic since deleted) falls
 *  back to the course-wide variant of the same activity. */
export function sessionForPlanItem(
	course: CourseRef & { topics: readonly Pick<CourseTopic, "id" | "title">[] },
	item: Pick<ExamPlanItem, "activity" | "topicId" | "title">,
): CourseSessionStart {
	const topic = item.topicId ? course.topics.find((t) => t.id === item.topicId) : undefined;
	if (item.activity === "mock") return mockExamSession(course);
	const subject = planItemSubject(item, topic);
	if (item.activity === "practice") {
		return topic ? practiceSession(course, topic) : {
			title: `Øv: ${subject}`,
			kind: "practice",
			course: { code: course.code, mode: "practice" },
			openingText: `Gi meg eksamensoppgaver om ${subject} i ${course.code}.`,
		};
	}
	if (topic) {
		const start = learnSession(course, topic);
		return item.activity === "review"
			? { ...start, title: `Repeter: ${topic.title}`, openingText: `Repeter ${topic.title} i ${course.code} med meg fram mot eksamen.` }
			: start;
	}
	return {
		title: `${ACTIVITY_LABEL[item.activity]}: ${subject}`,
		course: { code: course.code, mode: "learn" },
		openingText: `Lær meg ${subject} i ${course.code} fram mot eksamen.`,
	};
}
