"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GraduationCapIcon, PlayIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { cn } from "@/lib/utils";
import { examSession, type CourseSessionStart } from "./course-format";

/**
 * EKSAMENSØKT on the fag page: ONE continuous session for the whole fag.
 * The agent maps the pensum from the earlier exams among the fag's sources,
 * finds out what the student can do, and follows them node by node on a
 * colored map (red / yellow / green). It is a different thing from the
 * Eksamensplan around it (the day-by-day plan built from the topic colors),
 * so it gets its own calm card with one action.
 *
 * A fag has at most one eksamensøkt in the ordinary case: when one exists
 * the card offers to continue it, and starting another is a small
 * secondary action.
 */

/** The copy, in one place (the help center quotes the same sentence). */
export const EXAM_SESSION_BLURB =
	"Én økt som kartlegger hele pensum fra tidligere eksamener, og følger deg tema for tema med et fargekart.";

/** The session the card continues. */
export interface ExamSessionRef {
	id: string;
	title: string;
}

/** What the card knows about the fag's eksamensøkt: one to continue, none
 *  (null), or not known yet ("loading": the button waits, so a slow list
 *  can never lead to a duplicate session). */
export type ExamSessionState = ExamSessionRef | null | "loading";

/** The fag's eksamensøkt among the session list (GET /api/chats, newest
 *  activity first): kind "exam" and linked to this fag. Pure. */
export function findExamSession(chats: unknown, code: string): ExamSessionRef | null {
	if (!Array.isArray(chats)) return null;
	for (const raw of chats) {
		if (typeof raw !== "object" || raw === null) continue;
		const chat = raw as { id?: unknown; title?: unknown; kind?: unknown; course?: { code?: unknown } | null };
		if (chat.kind !== "exam" || typeof chat.id !== "string" || chat.course?.code !== code) continue;
		return { id: chat.id, title: typeof chat.title === "string" ? chat.title : "" };
	}
	return null;
}

/** The fag's eksamensøkt, kept fresh: refetched when the session list
 *  changes on the server and on every reconnect. A failed fetch reads as
 *  "none" so the student can always start. */
export function useExamSession(code: string): ExamSessionState {
	const [state, setState] = useState<ExamSessionState>("loading");
	const alive = useRef(true);
	const reload = useCallback(async () => {
		try {
			const res = await fetch("/api/chats", { cache: "no-store" });
			const body = res.ok ? ((await res.json()) as { chats?: unknown }) : {};
			if (alive.current) setState(findExamSession(body.chats, code));
		} catch {
			if (alive.current) setState((prev) => (prev === "loading" ? null : prev));
		}
	}, [code]);
	useEffect(() => {
		alive.current = true;
		void reload();
		return () => {
			alive.current = false;
		};
	}, [reload]);
	useServerEvent("chats-changed", () => void reload());
	useServerResync(() => void reload());
	return state;
}

export function ExamSessionCard({ course, session, onStart, starting, compact = false }: {
	course: { code: string; name: string };
	session: ExamSessionState;
	onStart: (session: CourseSessionStart) => void;
	/** A session is being created: every Start button waits. */
	starting: boolean;
	/** The wizard's quieter version (an alternative, not the main action). */
	compact?: boolean;
}) {
	const existing = session !== "loading" ? session : null;
	const waiting = starting || session === "loading";
	return (
		<div
			data-tour="exam-session"
			data-testid="exam-session-card"
			data-state={session === "loading" ? "loading" : existing ? "continue" : "start"}
			className={cn(
				"flex flex-wrap items-center gap-x-4 gap-y-3 border px-4 py-3",
				compact ? "rounded-xl bg-background" : "rounded-2xl bg-card",
			)}
		>
			<div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
				<GraduationCapIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
				<div className="min-w-0">
					<p className="font-ui text-sm font-semibold">Eksamensøkt</p>
					<p className="mt-0.5 font-ui text-sm leading-relaxed text-muted-foreground">{EXAM_SESSION_BLURB}</p>
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				{existing ? (
					<>
						<Button asChild size="sm" variant={compact ? "outline" : "default"}>
							<Link href={`/chat/${existing.id}`} data-testid="exam-session-continue" title={existing.title || undefined}>
								<PlayIcon aria-hidden="true" />
								Fortsett eksamensøkta
							</Link>
						</Button>
						<Button
							variant="ghost"
							size="sm"
							disabled={waiting}
							onClick={() => onStart(examSession(course))}
							data-testid="exam-session-start-new"
						>
							Start en ny
						</Button>
					</>
				) : (
					<Button
						size="sm"
						variant={compact ? "outline" : "default"}
						disabled={waiting}
						onClick={() => onStart(examSession(course))}
						data-testid="exam-session-start"
					>
						<GraduationCapIcon aria-hidden="true" />
						Start eksamensøkt
					</Button>
				)}
			</div>
		</div>
	);
}
