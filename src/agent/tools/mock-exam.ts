import { Type, type Static } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { invalidInputResult, serverExecute } from "../tool-execute.ts";
import type { JobRecord, MockExamToolInput, MockGradeToolInput } from "../../core/contracts.ts";
import type { JobStore } from "../../core/ports.ts";

/**
 * THE PRØVEEKSAMEN TOOLS (fase 6), registered only in exam sessions linked
 * to a course (the fag-chat):
 *
 *   mock_exam       — dispatch the background generator: it reads the past
 *                     exams and solutions and writes a mock exam of the same
 *                     form (structured, key included) plus its PDF.
 *   grade_mock_exam — dispatch the background grader for a hand-in: the
 *                     digital answers given in the app, or scan/photo files.
 *
 * Both follow the async job protocol (jobs.ts): the call creates the job,
 * spawns the runner and returns an ack at once; the result arrives later as
 * a steer message carrying the card. The course code is the session's own —
 * the model never names it, so a job can never write into another course.
 */

/** What the tools need from the composition root. */
export interface MockExamToolContext {
	chatId: string;
	/** The session's course code. */
	code: string;
	jobStore: JobStore;
	spawn: (job: JobRecord, input: MockExamToolInput | MockGradeToolInput) => void;
	/** The stored exam's title, or null when no such exam exists for the course. */
	examTitle: (examId: string) => string | null;
	/** True once the learner pressed «Lever» on this exam in the app. */
	submittedInApp: (examId: string) => boolean;
}

export const mockExamInputSchema = Type.Object({
	focus: Type.Optional(
		Type.String({
			description:
				"Only what the learner asked for beyond a full mock exam, in his words (e.g. \"bare del 2\", \"mer om Laplace\"). " +
				"Leave it out for an ordinary full mock exam — the generator already weights his red and yellow topics.",
		}),
	),
});

export const gradeMockExamInputSchema = Type.Object({
	examId: Type.String({ description: 'The mock exam\'s id exactly as given ("mx_…").' }),
	files: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"The hand-in's files (scanned PDF pages or photos) exactly as the learner gave the paths. Leave it out when he handed in digitally in the app («Lever»).",
		}),
	),
});

const MOCK_EXAM_DESCRIPTION =
	"Dispatch a background agent that writes a MOCK EXAM (prøveeksamen) for this session's course: it reads the course's past exams and " +
	"solutions itself and writes a new paper of the same form (cover, numbering, points, multiple-choice share, task types), leaning on " +
	"the learner's red and yellow topics, with a hidden answer key, and prints it as a PDF. The learner gets a card with «Åpne PDF», " +
	"«Svar i appen» and «Legg inn besvarelse». Call it when he asks for a mock exam (also via the «Lag prøveeksamen» button, which " +
	"sends that request). The call is ASYNC and fire-and-forget — it resolves immediately and your turn continues; the finished exam " +
	"arrives later as a new message. Takes several minutes. You never see the key; do not draft tasks yourself meanwhile.";

const GRADE_DESCRIPTION =
	"Dispatch a background sensor that GRADES a hand-in of a mock exam part by part against its hidden key (points per part, reason, " +
	"what was missing) and stores the result for the course's score curve. Give examId, plus files when he handed in a scan or photos " +
	"(PDF or images, the paths exactly as he gave them); without files the answers he handed in in the app («Lever») are graded. The " +
	"call is ASYNC and fire-and-forget — it resolves immediately; the graded result arrives later as a new message with the result " +
	"card, and then you advise him and update topic_status and plan_status.";

const ACK =
	"This call is fire-and-forget: continue your turn — tell him in one short line that it is under way, and do not wait, poll or " +
	"mention waiting again. The result arrives as a new message when ready.";

function dispatch(ctx: MockExamToolContext, kind: "mockExam" | "mockGrade", toolCallId: string, input: MockExamToolInput | MockGradeToolInput): string {
	const existing = ctx.jobStore.findJobByToolCallId(ctx.chatId, toolCallId);
	const job = existing ?? ctx.jobStore.createJob({ kind, chatId: ctx.chatId, toolCallId, input });
	if (!existing) ctx.spawn(job, input);
	return `Dispatched (job ${job.id}). ${ACK}`;
}

export function mockExamTools(ctx: MockExamToolContext): Record<string, AgentTool<any>> {
	const mockExam: AgentTool<typeof mockExamInputSchema> = {
		name: "mock_exam",
		label: "mock_exam",
		description: MOCK_EXAM_DESCRIPTION,
		parameters: mockExamInputSchema,
		execute: serverExecute("mock_exam", mockExamInputSchema, (input, { toolCallId }) => {
			const focus = input.focus?.trim();
			return dispatch(ctx, "mockExam", toolCallId, { code: ctx.code, ...(focus ? { focus } : {}) });
		}),
	};
	const grade: AgentTool<typeof gradeMockExamInputSchema> = {
		name: "grade_mock_exam",
		label: "grade_mock_exam",
		description: GRADE_DESCRIPTION,
		parameters: gradeMockExamInputSchema,
		execute: async (toolCallId, input, signal) => {
			const examId = input.examId.trim().replace(/^["«]|["»]$/g, "");
			if (ctx.examTitle(examId) === null) {
				return invalidInputResult("grade_mock_exam", [
					`no mock exam ${JSON.stringify(examId)} exists for ${ctx.code} — copy the exam id from the mock exam message or the learner's hand-in`,
				]);
			}
			const files = (input.files ?? []).map((f) => f.trim()).filter(Boolean);
			if (files.length === 0 && !ctx.submittedInApp(examId)) {
				return invalidInputResult("grade_mock_exam", [
					"nothing to grade: he has not handed in this exam in the app («Lever»), and no files were given — ask him to hand it in, or pass the files he gave",
				]);
			}
			const run = serverExecute("grade_mock_exam", gradeMockExamInputSchema, (_input, { toolCallId: id }) =>
				dispatch(ctx, "mockGrade", id, { code: ctx.code, examId, ...(files.length > 0 ? { files } : {}) }),
			);
			return run(toolCallId, input, signal);
		},
	};
	return { mock_exam: mockExam, grade_mock_exam: grade };
}

export type MockExamInput = Static<typeof mockExamInputSchema>;
export type GradeMockExamInput = Static<typeof gradeMockExamInputSchema>;
