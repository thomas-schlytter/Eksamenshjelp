import { NewSession } from "@/components/new-session";
import { readSettingsRecord } from "@/src/server";
import { normalizeCourseCode, slotsConfigured, type ChatCourseLink } from "@/src/core";

export const dynamic = "force-dynamic";

/**
 * The draft view behind «Ny økt» (owner, 2026-09-13): NO session is
 * created until the first message is sent. The view is a sessionless empty
 * chat; on send it creates the chat (title = that message) and redirects to
 * the real page, whose opening-prompt path delivers the message as turn 1.
 * Static segment beats the dynamic [id] route: "new" is never a chat id.
 *
 * One mode outwardly. Two optional doors in the URL:
 *  - `?mode=practice` (the knowledge map, the fag page) makes it an øvingsøkt;
 *  - `?mode=exam` (the fag page, the help center) makes it an eksamensøkt:
 *    one session that maps the whole pensum and follows it on a colored map;
 *  - `?fag=<KODE>` (+ `&tema=<id>`) links the draft to a fag, so the server
 *    writes the fag's context as the session's first message.
 *
 * The draft's model control binds the STRONG SLOT (the new-session
 * default); the session the first send creates is stamped from it
 * server-side (per-session models, owner 2026-09-28).
 */
export default async function NewSessionPage({
	searchParams,
}: {
	searchParams: Promise<{ mode?: string; fag?: string; tema?: string }>;
}) {
	const { mode, fag, tema } = await searchParams;
	const practice = mode === "practice";
	const exam = mode === "exam";
	const code = normalizeCourseCode(fag);
	// A topic id is a slug; anything else is dropped rather than trusted.
	const topicId = typeof tema === "string" && /^[a-z0-9-]{1,64}$/.test(tema) ? tema : undefined;
	// An eksamensøkt spans the whole fag: no single tema, and the link's
	// mode tells the server to present the fag's sources as the pensum.
	const course: ChatCourseLink | undefined = code
		? exam
			? { code, mode: "exam" }
			: { code, ...(topicId ? { topicId, mode: practice ? "practice" : "learn" } : {}) }
		: undefined;
	return (
		<NewSession
			initialConfigured={slotsConfigured(readSettingsRecord()?.models)}
			mode={practice ? "practice" : exam ? "exam" : "teach"}
			course={course}
		/>
	);
}
