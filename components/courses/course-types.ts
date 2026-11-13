/**
 * The ONE import point for course types inside the course UI. Everything
 * under components/courses/ imports from here, so the contract has a single
 * seam towards `@/src/core` (which owns the types).
 */
export type {
	ChatCourseLink,
	Course,
	CourseExam,
	CourseExamPart,
	CourseSearchHit,
	CourseSource,
	CourseSourceKind,
	CourseSummary,
	CourseTopic,
	ExamPlan,
	ExamPlanDay,
	ExamPlanItem,
	PlanActivity,
	TopicStatus,
} from "@/src/core";
export { localIsoDate, MAX_COURSE_TOPICS, MAX_NOTE_CHARS, normalizeCourseCode, TOPIC_STATUS_LABEL, topicCounts } from "@/src/core";
