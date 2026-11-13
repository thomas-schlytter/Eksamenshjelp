"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { courseApi, courseErrorMessage } from "./course-api";
import type { CourseSummary } from "./course-types";

/** How long an event burst is allowed to settle before one refetch. */
const DEBOUNCE_MS = 250;

/**
 * Run `reload` when any fag changes on the server (`courses-changed`: the
 * student's own edits in another window, or the agent's topic_status tool
 * during a session), and on every reconnect of the events channel. Bursts
 * collapse into one trailing call.
 */
export function useCoursesChanged(reload: () => void): void {
	const reloadRef = useRef(reload);
	reloadRef.current = reload;
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useServerEvent("courses-changed", () => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			timer.current = undefined;
			reloadRef.current();
		}, DEBOUNCE_MS);
	});
	useServerResync(() => reloadRef.current());
	useEffect(() => () => {
		if (timer.current) clearTimeout(timer.current);
	}, []);
}

/**
 * The student's fag list, kept fresh. `courses` is null until the first
 * answer arrives (so callers can tell "loading" from "none yet"); a failed
 * refetch keeps the last list and reports the error beside it.
 */
export function useCourseSummaries(initial?: CourseSummary[]) {
	const [courses, setCourses] = useState<CourseSummary[] | null>(initial ?? null);
	const [error, setError] = useState<string | null>(null);
	const inFlight = useRef(false);
	const reload = useCallback(async () => {
		if (inFlight.current) return;
		inFlight.current = true;
		try {
			setCourses(await courseApi.list());
			setError(null);
		} catch (err) {
			setError(courseErrorMessage(err));
			setCourses((prev) => prev ?? []);
		} finally {
			inFlight.current = false;
		}
	}, []);
	useEffect(() => {
		void reload();
	}, [reload]);
	useCoursesChanged(() => void reload());
	return { courses, error, reload };
}
