"use client";

import { StatusDot } from "@/components/courses/status-ui";
import { TOPIC_STATUS_LABEL, type TopicStatus } from "@/src/core";

/**
 * The agent's `topic_status` call in the transcript (exam mode): ONE calm
 * line, «Tema oppdatert: Laplace → Kan dette», with the status dot. The
 * colour change itself lives on the course page; this is only the trace
 * that it happened, so it never shows the raw arguments. The agent's short
 * reason (`note`) follows, muted, and is the line's tooltip when clipped.
 *
 * A refused call (unknown topic id, deleted course) renders nothing: the
 * agent corrects it and the corrected call leaves its own line.
 */
interface TopicStatusPart {
	state?: string;
	input?: unknown;
	output?: unknown;
	errorText?: string;
}

const AGENT_STATUSES: readonly TopicStatus[] = ["red", "yellow", "green"];

/** «pid-regulator» → «Pid regulator»: the fallback when an older record's
 *  result carries no title. */
function readableTopicId(id: string): string {
	const words = id.replace(/[-_]+/g, " ").trim();
	return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}

export function TopicStatusCard({ part }: { part: unknown }) {
	const p = part as TopicStatusPart;
	if (p.state !== "output-available" || typeof p.errorText === "string") return null;
	const out = (p.output ?? {}) as { ok?: unknown; topicId?: unknown; status?: unknown; title?: unknown };
	const inp = (p.input ?? {}) as { topicId?: unknown; status?: unknown; note?: unknown };
	if (out.ok === false) return null;
	const status = [out.status, inp.status].find((s): s is TopicStatus => AGENT_STATUSES.includes(s as TopicStatus));
	if (!status) return null;
	const id = typeof out.topicId === "string" ? out.topicId : typeof inp.topicId === "string" ? inp.topicId : "";
	const title = typeof out.title === "string" && out.title.trim() ? out.title.trim() : readableTopicId(id);
	const note = typeof inp.note === "string" ? inp.note.trim() : "";
	return (
		<div
			data-testid="topic-status-card"
			data-status={status}
			title={note || undefined}
			className="my-1 flex w-full max-w-2xl items-center gap-2 text-xs text-muted-foreground"
		>
			<StatusDot status={status} />
			<span className="min-w-0 truncate">
				Tema oppdatert: <span className="text-foreground">{title || "tema"}</span> → {TOPIC_STATUS_LABEL[status]}
				{note && <span className="text-muted-foreground/80">. {note}</span>}
			</span>
		</div>
	);
}
