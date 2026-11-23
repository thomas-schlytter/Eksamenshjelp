/**
 * COURSES ("fag") — the exam-focused layer's contract and pure logic.
 *
 * A course is one NTNU subject (or a manually entered one) with its exam
 * facts, the learner's own sources, a topic list with a traffic-light
 * status per topic, and the checked-off exam-plan items. Everything here
 * is pure and browser-safe (no node builtins, no IO): the types every
 * layer codes against, the deterministic exam plan, the deterministic
 * topic fallback and the model-facing course-context text. Persistence is
 * src/store/courses.ts; the HTTP surface is src/server/courses.ts.
 */

// ─── Types (the cross-agent contract; shapes are fixed) ──────────────────────

export type TopicStatus = "unknown" | "red" | "yellow" | "green";
export interface CourseTopic {
	/** Stable slug. */
	id: string;
	title: string;
	description?: string;
	/** Exam relevance: 3 = very important. */
	weight: 1 | 2 | 3;
	status: TopicStatus;
	statusSource?: "self" | "agent";
	/** The agent's short reason for the status. */
	statusNote?: string;
	/** ISO timestamp of the last status change. */
	updatedAt?: string;
}
export type CourseSourceKind = "ntnu" | "file" | "folder" | "link" | "note";
export interface CourseSource {
	id: string;
	kind: CourseSourceKind;
	title: string;
	/** file/folder: absolute path on this machine. */
	path?: string;
	/** ntnu/link. */
	url?: string;
	/** note: pasted text. */
	text?: string;
	/** folder: number of supported files found. */
	fileCount?: number;
	/** true = fetched by the app, false = added by the learner. */
	auto: boolean;
	addedAt: string;
}
export interface CourseExamPart {
	form: string;
	weighting?: string;
	duration?: string;
	aids?: string;
	date?: string;
}
export interface CourseExam {
	/** YYYY-MM-DD (main exam; the learner may override). */
	date?: string;
	form?: string;
	duration?: string;
	aids?: string;
	parts?: CourseExamPart[];
}
export type PlanActivity = "learn" | "practice" | "review" | "mock";
export interface ExamPlanItem {
	key: string;
	topicId?: string;
	activity: PlanActivity;
	minutes: number;
	title: string;
	done: boolean;
}
/** date is YYYY-MM-DD. */
export interface ExamPlanDay {
	date: string;
	items: ExamPlanItem[];
}
export interface ExamPlan {
	generatedAt: string;
	daysLeft: number | null;
	days: ExamPlanDay[];
}
export interface Course {
	/** "TTK4100" — upper case, [A-ZÆØÅ0-9-]{2,12}. */
	code: string;
	name: string;
	/** true = entered manually (not found at NTNU). */
	custom: boolean;
	credits?: string;
	level?: string;
	url?: string;
	/** "Faglig innhold". */
	content?: string;
	learningOutcome?: string;
	learningMethods?: string;
	materials?: string;
	exam: CourseExam;
	/** Default 120. */
	minutesPerDay: number;
	sources: CourseSource[];
	topics: CourseTopic[];
	topicsGeneratedBy?: "ai" | "fallback" | "manual";
	/** ExamPlanItem.key values that are checked off. */
	planDone: string[];
	createdAt: string;
	updatedAt: string;
	ntnuFetchedAt?: string;
	/** Who set exam.date: "self" = the learner overrode it, and a refresh
	 *  from NTNU must leave it alone. Absent on courses without a date. */
	examDateSetBy?: "ntnu" | "self";
}
export interface CourseSummary {
	code: string;
	name: string;
	examDate?: string;
	daysLeft: number | null;
	counts: Record<TopicStatus, number>;
	topicCount: number;
	sourceCount: number;
	updatedAt: string;
}
export interface CourseSearchHit {
	code: string;
	name: string;
	examDates: string[];
	location?: string;
}
/** Which course link a session has (ChatRecord.course, ChatSummary, ChatListItem). */
export interface ChatCourseLink {
	code: string;
	topicId?: string;
	/** "exam" = the link of the fag's MAIN chat, the fag-chat (ChatRecord
	 *  kind "exam"): the whole fag, with its sources as the pensum basis.
	 *  "sub" (fase 2, 2026-11-23) = an underchat: an extra chat in the fag
	 *  (the «+» in the sidebar, the fag-chat's menu, «Flytt til fag»).
	 *  "learn" / "practice" / "mapping" are the retired Lær / Øv /
	 *  Kartlegging starts; old records keep them and list as underchats. */
	mode?: "learn" | "practice" | "mapping" | "exam" | "sub";
}

/** The link mode of an underchat. */
export const SUB_CHAT_MODE = "sub" as const satisfies ChatCourseLink["mode"];

/** Is this session its fag's main chat (the fag-chat)? An eksamensøkt
 *  linked to the fag: kind "exam" with a course link that is not an
 *  underchat's. Every other linked session is an underchat. */
export function isCourseMainChat(chat: { kind?: string; course?: ChatCourseLink | null }): boolean {
	return chat.kind === "exam" && !!chat.course && chat.course.mode !== SUB_CHAT_MODE;
}

/** One fag's chats: the fag-chat (null until it exists) and its
 *  underchats, newest activity first. */
export interface CourseChatGroup<T> {
	main: T | null;
	subs: T[];
}

/**
 * The sidebar's and the fag page's grouping (fase 2). `chats` comes newest
 * activity first (GET /api/chats); the order is kept inside each group.
 * A fag's fag-chat is its most recently active main chat; an older second
 * eksamensøkt (possible on records from before fase 2) lists as an
 * underchat, so nothing disappears. A session linked to a fag that no
 * longer exists is loose («Uten fag»), like a session with no link.
 */
export function groupChatsByCourse<T extends { kind?: string; course?: ChatCourseLink | null }>(
	chats: readonly T[],
	courseCodes: readonly string[],
): { byCourse: Map<string, CourseChatGroup<T>>; loose: T[] } {
	const byCourse = new Map<string, CourseChatGroup<T>>(courseCodes.map((code) => [code, { main: null, subs: [] }]));
	const loose: T[] = [];
	for (const chat of chats) {
		const group = chat.course ? byCourse.get(chat.course.code) : undefined;
		if (!group) {
			loose.push(chat);
			continue;
		}
		if (group.main === null && isCourseMainChat(chat)) group.main = chat;
		else group.subs.push(chat);
	}
	return { byCourse, loose };
}

// ─── Small shared rules ──────────────────────────────────────────────────────

export const TOPIC_STATUS_LABEL: Record<TopicStatus, string> = {
	unknown: "Ikke kartlagt",
	red: "Kan ikke ennå",
	yellow: "Usikker",
	green: "Kan dette",
};

export const TOPIC_STATUSES = ["unknown", "red", "yellow", "green"] as const satisfies readonly TopicStatus[];
export const COURSE_CODE_PATTERN = /^[A-ZÆØÅ0-9-]{2,12}$/;
export const DEFAULT_MINUTES_PER_DAY = 120;
export const MIN_MINUTES_PER_DAY = 15;
export const MAX_MINUTES_PER_DAY = 600;
export const MAX_COURSE_TOPICS = 40;
export const MAX_NOTE_CHARS = 20_000;

/** "ttk4100 " → "TTK4100"; null when it is not a course code. */
export function normalizeCourseCode(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const code = raw.trim().toUpperCase();
	// "SEARCH" is the one reserved word: /api/courses/search is the search route.
	return COURSE_CODE_PATTERN.test(code) && code !== "SEARCH" ? code : null;
}

export function isTopicStatus(value: unknown): value is TopicStatus {
	return typeof value === "string" && (TOPIC_STATUSES as readonly string[]).includes(value);
}

export function isIsoDate(value: unknown): value is string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const ms = dayNumber(value) * 86_400_000;
	return new Date(ms).toISOString().slice(0, 10) === value;
}

export function clampMinutesPerDay(value: unknown): number {
	const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : DEFAULT_MINUTES_PER_DAY;
	return Math.min(MAX_MINUTES_PER_DAY, Math.max(MIN_MINUTES_PER_DAY, n));
}

/** Days since the epoch for a YYYY-MM-DD date (UTC math: no DST drift). */
function dayNumber(isoDate: string): number {
	const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
	return Math.round(Date.UTC(y!, (m ?? 1) - 1, d ?? 1) / 86_400_000);
}

function addDays(isoDate: string, days: number): string {
	return new Date((dayNumber(isoDate) + days) * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `todayIso` to `date`; negative when the date has passed. */
export function daysUntil(date: string | undefined, todayIso: string): number | null {
	if (!isIsoDate(date) || !isIsoDate(todayIso.slice(0, 10))) return null;
	return dayNumber(date) - dayNumber(todayIso);
}

/** The local calendar date (the learner's "today"), YYYY-MM-DD. */
export function localIsoDate(now: Date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A stable slug: lower case, Norwegian letters kept readable, max 48 chars. */
export function slugifyTopicId(text: string): string {
	const slug = text
		.toLowerCase()
		.replace(/æ/g, "ae")
		.replace(/ø/g, "o")
		.replace(/å/g, "a")
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48)
		.replace(/-+$/g, "");
	return slug || "tema";
}

/** Make `id` unique within `taken` (adds -2, -3, …) and record it. */
export function uniqueTopicId(id: string, taken: Set<string>): string {
	let candidate = id;
	for (let n = 2; taken.has(candidate); n++) candidate = `${id}-${n}`;
	taken.add(candidate);
	return candidate;
}

export function topicCounts(topics: readonly CourseTopic[]): Record<TopicStatus, number> {
	const counts: Record<TopicStatus, number> = { unknown: 0, red: 0, yellow: 0, green: 0 };
	for (const topic of topics) counts[topic.status] += 1;
	return counts;
}

export function courseSummary(course: Course, todayIso: string): CourseSummary {
	return {
		code: course.code,
		name: course.name,
		...(course.exam.date ? { examDate: course.exam.date } : {}),
		daysLeft: daysUntil(course.exam.date, todayIso),
		counts: topicCounts(course.topics),
		topicCount: course.topics.length,
		sourceCount: course.sources.length,
		updatedAt: course.updatedAt,
	};
}

// ─── Topic lists ─────────────────────────────────────────────────────────────

export interface TopicDraft {
	id?: string;
	title: string;
	description?: string;
	weight?: number;
	status?: TopicStatus;
}

function topicWeight(value: unknown): 1 | 2 | 3 {
	return value === 1 || value === 3 ? value : 2;
}

/**
 * Turn drafts (AI output, the fallback, or a manual edit) into the stored
 * topic list. A topic that keeps its id, or whose title is identical to an
 * earlier one, keeps that topic's status history. An explicit draft status
 * that differs from the kept one is the learner's own call ("self").
 */
export function mergeTopics(previous: readonly CourseTopic[], drafts: readonly TopicDraft[], nowIso: string): CourseTopic[] {
	const byId = new Map(previous.map((t) => [t.id, t]));
	const byTitle = new Map(previous.map((t) => [t.title.trim().toLowerCase(), t]));
	// "generate" is reserved: /topics/generate is a route of its own.
	const taken = new Set<string>(["generate"]);
	const out: CourseTopic[] = [];
	for (const draft of drafts) {
		const title = typeof draft.title === "string" ? draft.title.trim().slice(0, 160) : "";
		if (!title) continue;
		const wanted = typeof draft.id === "string" && draft.id.trim() ? slugifyTopicId(draft.id) : slugifyTopicId(title);
		const kept = byId.get(wanted) ?? byTitle.get(title.toLowerCase());
		// A kept topic keeps its id even when its title was edited.
		const id = uniqueTopicId(kept && !taken.has(kept.id) ? kept.id : wanted, taken);
		const description = typeof draft.description === "string" ? draft.description.trim().slice(0, 600) : "";
		const topic: CourseTopic = {
			id,
			title,
			...(description ? { description } : {}),
			weight: topicWeight(draft.weight ?? kept?.weight),
			status: kept?.status ?? "unknown",
			...(kept?.statusSource ? { statusSource: kept.statusSource } : {}),
			...(kept?.statusNote ? { statusNote: kept.statusNote } : {}),
			...(kept?.updatedAt ? { updatedAt: kept.updatedAt } : {}),
		};
		if (isTopicStatus(draft.status) && draft.status !== topic.status) {
			topic.status = draft.status;
			topic.statusSource = "self";
			delete topic.statusNote;
			topic.updatedAt = nowIso;
		}
		out.push(topic);
		if (out.length >= MAX_COURSE_TOPICS) break;
	}
	return out;
}

const SECTION_LABEL =
	/(Kunnskap(?:er)?|Ferdighet(?:er)?|Generell kompetanse|Knowledge|Skills?|General competence)\s*:/gi;
const GENERAL_COMPETENCE = /^(generell kompetanse|general competence)$/i;
/** Lead-ins that say nothing about the topic itself. */
const LEAD_IN = [
	/^(kandidaten|studenten|studentene|the candidate|the student|students?)\s+(skal\s+)?(ha|har|kan|kunne|skal kunne|should|will|is able to|can|has|have)\s+/i,
	/^(skal\s+)?(kunne|ha|har)\s+/i,
	/^(grunnleggende|god|inngående|bred|basic|good|thorough|broad)\s+(kunnskap|kjennskap|forståelse|knowledge|understanding)\s+(om|til|av|of|about)\s+/i,
	/^(kunnskap|kjennskap|forståelse|innsikt|innføring|introduksjon|knowledge|understanding|insight)\s+(om|til|av|i|of|about|in|into)\s+/i,
	/^(kunne|can|be able to)\s+/i,
];

function sentencesOf(text: string): string[] {
	return text
		.replace(/\s+/g, " ")
		// Split after sentence punctuation, on semicolons and on list bullets.
		.split(/(?<=[.!?])\s+(?=[A-ZÆØÅ0-9(])|\s*;\s+|\s+[-•–]\s+(?=[A-ZÆØÅ])/)
		.map((s) => s.trim().replace(/[.;:]+$/, "").trim())
		.filter((s) => s.length >= 12);
}

function topicTitleFrom(sentence: string): string {
	let title = sentence;
	for (let pass = 0; pass < 3; pass++) {
		const before = title;
		for (const lead of LEAD_IN) title = title.replace(lead, "");
		if (title === before) break;
	}
	title = title.trim();
	if (title.length > 72) {
		const cut = title.slice(0, 72);
		const space = cut.lastIndexOf(" ");
		title = `${cut.slice(0, space > 40 ? space : 72).replace(/[,\s]+$/, "")}…`;
	}
	return title.charAt(0).toUpperCase() + title.slice(1);
}

/**
 * The deterministic reserve when no model is available: the learning
 * outcomes (minus the "general competence" part, which is not exam
 * material) and then the course content, one topic per sentence.
 */
export function fallbackTopicDrafts(course: Pick<Course, "learningOutcome" | "content">): TopicDraft[] {
	const drafts: TopicDraft[] = [];
	const seen = new Set<string>();
	const add = (sentence: string, weight: 1 | 2 | 3) => {
		if (drafts.length >= 20) return;
		const title = topicTitleFrom(sentence);
		if (title.length < 6) return;
		const id = slugifyTopicId(title);
		if (seen.has(id)) return;
		seen.add(id);
		drafts.push({ id, title, ...(title !== sentence ? { description: sentence } : {}), weight });
	};
	const outcome = course.learningOutcome?.trim() ?? "";
	if (outcome) {
		// "Kunnskap: … Ferdighet: … Generell kompetanse: …" is one paragraph
		// with inline section labels; cut it into labeled sections first.
		const pieces = outcome.split(SECTION_LABEL);
		const sections: Array<{ label: string; text: string }> = [{ label: "", text: pieces[0] ?? "" }];
		for (let i = 1; i < pieces.length; i += 2) sections.push({ label: pieces[i] ?? "", text: pieces[i + 1] ?? "" });
		for (const section of sections) {
			if (GENERAL_COMPETENCE.test(section.label.trim())) continue;
			for (const sentence of sentencesOf(section.text)) add(sentence, 2);
		}
	}
	if (drafts.length < 8 && course.content) {
		for (const sentence of sentencesOf(course.content)) add(sentence, 2);
	}
	return drafts;
}

// ─── The exam plan ───────────────────────────────────────────────────────────

const STATUS_PRIORITY: Record<TopicStatus, number> = { red: 4, unknown: 3, yellow: 2, green: 0.5 };
/** Without an exam date the plan is a "do this first" list over two weeks. */
const OPEN_HORIZON_DAYS = 14;
/** A plan never lists more than this many days ahead of the exam. */
const MAX_PLAN_DAYS = 240;
export const MOCK_EXAM_TITLE = "Prøveeksamen: løs et tidligere eksamenssett på tid";

const ACTIVITY_TITLE: Record<Exclude<PlanActivity, "mock">, string> = {
	learn: "Lær",
	practice: "Øv",
	review: "Repeter",
};

export function examPlanKey(date: string, topicId: string | undefined, activity: PlanActivity): string {
	return `${date}|${topicId ?? ""}|${activity}`;
}

function round5(minutes: number): number {
	return Math.max(5, Math.round(minutes / 5) * 5);
}

interface PlanSlot {
	date: string;
	left: number;
	items: ExamPlanItem[];
}

/**
 * Pure and deterministic: the plan from topic status + exam date.
 *
 * Priority = status weight (red 4, unknown 3, yellow 2, green 0.5) × topic
 * weight. Red/unknown topics get "learn" first and "practice" a couple of
 * days later; yellow topics get "practice"; every studied topic comes back
 * as short "review" items at growing intervals (spaced repetition); green
 * topics only get a short review near the end. The last one or two days
 * hold a mock exam and a review of the weakest topics. Few days left: the
 * items shrink and the least important ones fall off. Many days left: new
 * topics are paced out instead of filling every day.
 *
 * `todayIso` is the learner's local date (YYYY-MM-DD; a full ISO timestamp
 * also works). Items checked off on an earlier day move the topic on to
 * its next step, so the plan progresses as the learner works.
 */
export function buildExamPlan(course: Course, todayIso: string, generatedAt?: string): ExamPlan {
	const today = todayIso.slice(0, 10);
	const stamp = generatedAt ?? (todayIso.length > 10 ? todayIso : `${today}T00:00:00.000Z`);
	const daysLeft = daysUntil(course.exam.date, today);
	const empty: ExamPlan = { generatedAt: stamp, daysLeft, days: [] };
	if (!isIsoDate(today) || course.topics.length === 0) return empty;
	// Exam today or already held: nothing left to schedule.
	if (daysLeft !== null && daysLeft <= 0) return empty;

	const dated = daysLeft !== null;
	const horizon = Math.min(dated ? daysLeft : OPEN_HORIZON_DAYS, MAX_PLAN_DAYS);
	const perDay = clampMinutesPerDay(course.minutesPerDay);
	const slots: PlanSlot[] = Array.from({ length: horizon }, (_, i) => ({ date: addDays(today, i), left: perDay, items: [] }));
	const done = new Set(course.planDone);
	const keys = new Set<string>();

	const put = (index: number, topic: CourseTopic | null, activity: PlanActivity, minutes: number): void => {
		const slot = slots[index]!;
		const key = examPlanKey(slot.date, topic?.id, activity);
		if (keys.has(key)) return;
		keys.add(key);
		slot.left -= minutes;
		slot.items.push({
			key,
			...(topic ? { topicId: topic.id } : {}),
			activity,
			minutes,
			title: activity === "mock" || !topic ? MOCK_EXAM_TITLE : `${ACTIVITY_TITLE[activity]}: ${topic.title}`,
			done: done.has(key),
		});
	};
	/** First day in [from, to) with room, searching forward from `target`
	 *  and then backward; -1 when the window is full. An empty day always
	 *  takes one item, so a long item is never unplaceable. */
	const place = (topic: CourseTopic, activity: PlanActivity, minutes: number, target: number, from: number, to: number): number => {
		const fits = (i: number) =>
			(slots[i]!.left >= minutes || slots[i]!.items.length === 0) && !keys.has(examPlanKey(slots[i]!.date, topic.id, activity));
		const start = Math.min(Math.max(target, from), to - 1);
		let found = -1;
		for (let i = start; i < to && found < 0; i++) if (fits(i)) found = i;
		for (let i = start - 1; i >= from && found < 0; i--) if (fits(i)) found = i;
		if (found >= 0) put(found, topic, activity, Math.min(minutes, perDay));
		return found;
	};

	// Earlier checked-off work moves a topic to its next step, unless its
	// status was set again after that day (the newer status is the truth).
	const doneBefore = (topic: CourseTopic, activity: PlanActivity): boolean => {
		const since = topic.updatedAt?.slice(0, 10) ?? "";
		for (const key of course.planDone) {
			const [date, topicId, kind] = key.split("|");
			if (topicId === topic.id && kind === activity && date! < today && date! >= since) return true;
		}
		return false;
	};

	const ranked = course.topics
		.map((topic, index) => ({ topic, index, priority: STATUS_PRIORITY[topic.status] * topic.weight }))
		.sort((a, b) => b.priority - a.priority || a.index - b.index);
	const weak = ranked.filter((r) => r.topic.status !== "green");
	const strong = ranked.filter((r) => r.topic.status === "green");

	// The closing days: a mock exam and a review of the weakest topics.
	const closingDays = !dated ? 0 : horizon >= 6 ? 2 : horizon >= 2 ? 1 : 0;
	const workDays = horizon - closingDays;
	if (closingDays > 0) {
		const mockDay = horizon - closingDays;
		const lastDay = horizon - 1;
		const mockMinutes = round5(Math.min(perDay, closingDays === 2 ? 180 : Math.max(perDay / 2, 30)));
		put(mockDay, null, "mock", Math.min(mockMinutes, perDay));
		// Day before the exam stays light: short repeats, never new material.
		const reviewBudget = closingDays === 2 ? Math.min(perDay, 90) : slots[lastDay]!.left;
		let used = 0;
		for (const { topic } of weak.length > 0 ? weak : strong) {
			const minutes = Math.min(15, perDay);
			if (used + minutes > reviewBudget && used > 0) break;
			if (slots[lastDay]!.left < minutes && slots[lastDay]!.items.length > 0) break;
			put(lastDay, topic, "review", minutes);
			used += minutes;
		}
	}

	if (workDays > 0) {
		const learnMinutes = (t: CourseTopic) => 30 + 15 * t.weight;
		const practiceMinutes = (t: CourseTopic) => 20 + 10 * t.weight;
		const reviewMinutes = (t: CourseTopic) => (t.weight === 3 ? 20 : 15);

		interface Track {
			topic: CourseTopic;
			first: "learn" | "practice" | "review";
			practice: boolean;
		}
		const tracks: Track[] = weak.map(({ topic }) => {
			const needsLearn = topic.status !== "yellow" && !doneBefore(topic, "learn");
			const needsPractice = !doneBefore(topic, "practice");
			return {
				topic,
				first: needsLearn ? "learn" : needsPractice ? "practice" : "review",
				practice: needsLearn && needsPractice,
			};
		});
		const firstMinutes = (t: Track) =>
			t.first === "learn" ? learnMinutes(t.topic) : t.first === "practice" ? practiceMinutes(t.topic) : reviewMinutes(t.topic);

		// Few days: shrink every item (never below half) so more topics fit.
		const demand = tracks.reduce((sum, t) => sum + firstMinutes(t) + (t.practice ? practiceMinutes(t.topic) : 0), 0);
		const capacity = workDays * perDay;
		const scale = demand > capacity ? Math.max(0.5, capacity / demand) : 1;
		const sized = (minutes: number) => Math.min(perDay, round5(minutes * scale));

		// Pace the first step of each topic: most important first, spread by
		// workload over the opening stretch, at most three days per topic.
		const firstTotal = tracks.reduce((sum, t) => sum + sized(firstMinutes(t)), 0);
		const stretch = Math.max(1, Math.min(
			workDays <= 5 ? workDays : Math.ceil(workDays * 0.6),
			Math.max(tracks.length * 3, Math.ceil(firstTotal / perDay)),
		));
		const practiceGap = workDays >= 7 ? 2 : 1;
		const reviewGap = Math.min(7, Math.max(2, Math.round(workDays / 6)));

		const firstDay = new Map<string, number>();
		let cumulative = 0;
		for (const track of tracks) {
			const minutes = sized(firstMinutes(track));
			const target = firstTotal > 0 ? Math.floor((cumulative / firstTotal) * stretch) : 0;
			cumulative += minutes;
			const day = place(track.topic, track.first, minutes, target, 0, workDays);
			if (day >= 0) firstDay.set(track.topic.id, day);
		}
		const lastStudy = new Map<string, number>();
		for (const track of tracks) {
			const start = firstDay.get(track.topic.id);
			if (start === undefined) continue;
			let day = start;
			if (track.practice && start + practiceGap < workDays) {
				const placed = place(track.topic, "practice", sized(practiceMinutes(track.topic)), start + practiceGap, start + 1, workDays);
				if (placed >= 0) day = placed;
			}
			lastStudy.set(track.topic.id, day);
		}
		// Spaced repetition: each studied topic returns after reviewGap days,
		// then at doubling intervals, for as long as the days last.
		for (let round = 0, gap = reviewGap; round < 6; round++, gap *= 2) {
			let placedAny = false;
			for (const track of tracks) {
				const from = lastStudy.get(track.topic.id);
				if (from === undefined || from + gap >= workDays) continue;
				const day = place(track.topic, "review", Math.min(perDay, reviewMinutes(track.topic)), from + gap, from + 1, workDays);
				if (day >= 0) {
					lastStudy.set(track.topic.id, day);
					placedAny = true;
				}
			}
			if (!placedAny) break;
		}
		// What the learner already knows only needs a short refresh late on.
		const lateStart = Math.min(workDays - 1, Math.floor(workDays * 0.66));
		strong.forEach(({ topic }, i) => {
			const span = workDays - lateStart;
			const target = lateStart + Math.floor((i / Math.max(1, strong.length)) * span);
			place(topic, "review", Math.min(perDay, topic.weight >= 2 ? 15 : 10), target, 0, workDays);
		});
	}

	return {
		generatedAt: stamp,
		daysLeft,
		days: slots.filter((slot) => slot.items.length > 0).map((slot) => ({ date: slot.date, items: slot.items })),
	};
}

// ─── The course-context text (model-facing, English) ─────────────────────────

const STATUS_FOR_MODEL: Record<TopicStatus, string> = {
	unknown: "not mapped yet",
	red: "red (cannot do this yet)",
	yellow: "yellow (unsure)",
	green: "green (knows this)",
};

const MODE_INSTRUCTION: Record<NonNullable<ChatCourseLink["mode"]>, string> = {
	learn:
		"Mode: LEARN. Teach the focus topic (the whole course when none is given) so the learner can handle it at the exam: " +
		"build the understanding step by step, ground it in the course sources, and point out what typical exam problems on " +
		"this topic look like and how to attack them.",
	practice:
		"Mode: PRACTICE. Pose exam-style problems on the focus topic (across the course when none is given), at the level and " +
		"in the format of this course's exam. Prefer problems taken from or closely modeled on the earlier exam papers among the sources.",
	mapping:
		"Mode: MAPPING. Do a short diagnostic across ALL the topics listed above, not a deep dive into one: a few targeted " +
		"questions per area that reveal what the learner can and cannot do. For every topic you have real grounds for, set its " +
		"status with topic_status; leave the topics you did not reach as they are. The goal is already concrete (pass the exam " +
		"in this course), so do not interrogate it. Keep it brief: this session exists to color the learner's exam plan, not " +
		"to teach. When you are done, do NOT conclude the assessment tool-wise (no probe_done): write a short summary of " +
		"which topics you marked and why, tell the learner the exam plan for the course is now updated and that they can go " +
		"back to it and start from today's item, and end your turn. Only if the learner then explicitly asks to keep going " +
		"and be taught here do you conclude the assessment the normal way.",
	sub:
		"Mode: SIDE CHAT. This chat sits beside the course's main chat, where the learner's exam plan for the whole course " +
		"lives. He opened it to work on one part of the course in its own thread: follow his lead, explain or pose exam-style " +
		"tasks as the conversation calls for, and ground both in the sources. The exam plan map and its colors belong to the " +
		"main chat, not to this one. What you learn here about his mastery goes onto the course topics with `topic_status`.",
	exam:
		"Mode: EXAM SESSION. This is one continuous exam session for the whole course, with no single focus topic. The sources " +
		"listed below are the pensum basis: the earlier exam papers, solutions and notes among them are where the emner and the " +
		"recurring task types come from. Read them yourself (`ls`/`find` the folders, `read` opens PDF files directly) before you " +
		"probe, instead of asking the learner where the material is; ask only when the list holds no exam papers. The exam facts " +
		"above (date, form, permitted aids) are already known, so do not ask for them again. The course topics listed above are " +
		"a starting point for the emner of the plan map, but the past exams decide. Two status tools do two different things: " +
		"`plan_status` colors the nodes of THIS session's plan map (your own plan_init slugs), `topic_status` colors the " +
		"course's topics on the course page (the topic ids above). When the evidence that colors a plan node also settles a " +
		"course topic, update both.",
};

const NOTE_INLINE_CHARS = 4_000;
const NOTES_TOTAL_CHARS = 12_000;

function clip(text: string, max: number): string {
	const clean = text.replace(/\s+\n/g, "\n").trim();
	return clean.length > max ? `${clean.slice(0, max).trimEnd()} […truncated]` : clean;
}

/** What the course-context card shows (the marker's `details`). */
export interface CourseContextDetails {
	code: string;
	name: string;
	topicId?: string;
	topicTitle?: string;
	mode?: ChatCourseLink["mode"];
	sourceCount: number;
}

export function courseContextDetails(course: Course, link: ChatCourseLink): CourseContextDetails {
	const topic = link.topicId ? course.topics.find((t) => t.id === link.topicId) : undefined;
	return {
		code: course.code,
		name: course.name,
		...(topic ? { topicId: topic.id, topicTitle: topic.title } : {}),
		...(link.mode ? { mode: link.mode } : {}),
		sourceCount: course.sources.length,
	};
}

/**
 * The model-facing session context for a course-linked session. Flattened
 * to a user-role message on the wire, so it opens with the bracketed
 * "[Session context]" convention instead of posing as learner speech.
 */
export function courseContextText(
	course: Course,
	link: ChatCourseLink,
	todayIso: string,
	/** The session's kind. A practice session grades through `problem`,
	 *  not explain, so the explain approval rule stays out of its text. */
	opts: { kind?: "teach" | "practice" | "exam" } = {},
): string {
	const lines: string[] = [
		"[Session context] — this session belongs to one of the learner's university courses and is exam preparation. " +
			"The learner studies at NTNU and uses the app in Norwegian: speak Norwegian (bokmål) unless they write in another language.",
		"",
		`Course: ${course.code} ${course.name}${course.credits ? ` (${course.credits} credits)` : ""}${course.level ? `, ${course.level}` : ""}`,
	];
	const exam = course.exam;
	const left = daysUntil(exam.date, todayIso);
	const examFacts = [
		exam.date ? `${exam.date}${left !== null ? (left >= 0 ? ` (${left} days from the start of this session)` : " (already held)") : ""}` : "date not set",
		exam.form,
		exam.duration ? `duration ${exam.duration}` : undefined,
		exam.aids ? `permitted aids: ${exam.aids}` : undefined,
	].filter(Boolean);
	lines.push(`Exam: ${examFacts.join("; ")}`);
	if (exam.parts && exam.parts.length > 1) {
		lines.push("Assessment parts:");
		for (const part of exam.parts) {
			const facts = [part.weighting ? `weight ${part.weighting}` : "", part.duration ?? "", part.date ?? ""].filter(Boolean).join(", ");
			lines.push(`- ${part.form}${facts ? ` (${facts})` : ""}`);
		}
	}
	if (course.content) lines.push("", "Course content (from the official course description):", clip(course.content, 3_000));
	if (course.learningOutcome) lines.push("", "Learning outcomes:", clip(course.learningOutcome, 3_000));
	if (course.materials) lines.push("", `Course materials: ${clip(course.materials, 800)}`);

	if (course.topics.length > 0) {
		lines.push("", "Topics (id, title, exam relevance 1-3, the learner's current status):");
		for (const topic of course.topics) {
			lines.push(`- [${topic.id}] ${topic.title} (relevance ${topic.weight}): ${STATUS_FOR_MODEL[topic.status]}${topic.statusNote ? `. Note: ${clip(topic.statusNote, 200)}` : ""}`);
		}
	} else {
		lines.push("", "No topic list exists for this course yet.");
	}

	const focus = link.topicId ? course.topics.find((t) => t.id === link.topicId) : undefined;
	if (focus) {
		lines.push("", `Focus topic for this session: [${focus.id}] ${focus.title}${focus.description ? `. ${clip(focus.description, 600)}` : ""}`);
	}
	if (link.mode) lines.push("", MODE_INSTRUCTION[link.mode]);

	lines.push("", "Sources:");
	if (course.sources.length === 0) lines.push("- (none added yet)");
	let noteBudget = NOTES_TOTAL_CHARS;
	for (const source of course.sources) {
		switch (source.kind) {
			case "ntnu":
				lines.push(`- Official NTNU course page: ${source.url}`);
				break;
			case "link":
				lines.push(`- Link, ${source.title}: ${source.url}`);
				break;
			case "file":
				lines.push(`- File, ${source.title}: ${source.path}`);
				break;
			case "folder":
				lines.push(`- Folder, ${source.title}${typeof source.fileCount === "number" ? ` (${source.fileCount} readable files)` : ""}: ${source.path}`);
				break;
			case "note": {
				const text = clip(source.text ?? "", Math.min(NOTE_INLINE_CHARS, Math.max(0, noteBudget)));
				noteBudget -= text.length;
				lines.push(`- Note from the learner, ${source.title}:`, text ? text.split("\n").map((l) => `    ${l}`).join("\n") : "    (omitted: the notes above already fill the space)");
				break;
			}
		}
	}
	lines.push(
		"",
		"How to use the sources: the file and folder paths are on the learner's machine. Read them when you need them instead " +
			"of guessing what the course covers: `ls` and `find` list a folder, `read` opens text, image and PDF files " +
			"(a PDF comes back as page text plus page images, a range at a time with `pages`), and `grep` searches. File names often tell you what is what (earlier exam papers, solutions, lecture notes); " +
			"earlier exams are the best guide to what the exam asks.",
		"",
		"Topic status: when you have real evidence of how well the learner masters a topic (several answers or worked steps, " +
			"never one single answer), record it with the `topic_status` tool using the topic id from the list above: red = cannot " +
			"do this yet, yellow = unsure or partly there, green = can do it at exam level. Add a one-sentence note in Norwegian " +
			"with the reason. The learner sees these colors in their exam plan." +
			// Practice sessions grade through `problem`, not explain: no approval rule there.
			(link.mode === "practice" || opts.kind === "practice"
				? ""
				: " Green is an approval: while teaching, set it only after he has solved a task on that topic correctly in " +
					"his own words with `explain`. While probing you have only multiple choice, so green is allowed there " +
					"when both his picks and his written explanations carry it."),
	);
	return lines.join("\n");
}
