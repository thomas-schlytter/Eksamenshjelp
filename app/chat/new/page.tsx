import { NewSession } from "@/components/new-session";
import { readSettingsRecord } from "@/src/server";
import { normalizeCourseCode, slotsConfigured, SUB_CHAT_MODE, type ChatCourseLink } from "@/src/core";

export const dynamic = "force-dynamic";

/**
 * The draft view behind «Ny økt» (owner, 2026-09-13): NO session is
 * created until the first message is sent. The view is a sessionless empty
 * chat; on send it creates the chat (title = that message) and redirects to
 * the real page, whose opening-prompt path delivers the message as turn 1.
 * Static segment beats the dynamic [id] route: "new" is never a chat id.
 *
 * One mode outwardly. The optional doors in the URL:
 *  - `?mode=practice` (the knowledge map) makes it an øvingsøkt;
 *  - `?mode=exam` (the help center) makes it an eksamensøkt without a fag:
 *    one session that maps the whole pensum and follows it on a colored map;
 *  - `?fag=<KODE>` makes the draft an UNDERCHAT of that fag (fase 2: the
 *    sidebar's «+» and the fag-chat's menu): the server writes the fag's
 *    context as the session's first message. A fag's own eksamensøkt is
 *    its fag-chat (POST /api/courses/[code]/chat), never a draft, so
 *    `?mode=exam` together with `?fag=` drafts an ordinary underchat.
 *
 * The draft's model control binds the STRONG SLOT (the new-session
 * default); the session the first send creates is stamped from it
 * server-side (per-session models, owner 2026-09-28).
 */
export default async function NewSessionPage({
	searchParams,
}: {
	searchParams: Promise<{ mode?: string; fag?: string }>;
}) {
	const { mode, fag } = await searchParams;
	const code = normalizeCourseCode(fag);
	const practice = mode === "practice";
	const exam = mode === "exam" && !code;
	const course: ChatCourseLink | undefined = code ? { code, mode: SUB_CHAT_MODE } : undefined;
	return (
		<NewSession
			initialConfigured={slotsConfigured(readSettingsRecord()?.models)}
			mode={practice ? "practice" : exam ? "exam" : "teach"}
			course={course}
		/>
	);
}
