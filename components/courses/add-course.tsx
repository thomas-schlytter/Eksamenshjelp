"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircleIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { courseApi, CourseApiError, courseErrorMessage } from "./course-api";
import { formatExamDate } from "./course-format";
import { normalizeCourseCode, type Course, type CourseSearchHit } from "./course-types";

const DEBOUNCE_MS = 250;
const MIN_QUERY = 2;

/** One line under a hit: the next exam date NTNU lists, if any. */
export function hitExamLine(hit: Pick<CourseSearchHit, "examDates">): string {
	const dates = hit.examDates.map(formatExamDate).filter(Boolean);
	if (dates.length === 0) return "Ingen eksamensdato hos NTNU ennå";
	return dates.length === 1 ? `Eksamen ${dates[0]}` : `Eksamen ${dates[0]} (+${dates.length - 1} til)`;
}

/** The result list, pure (props in, markup out) for the render pins. */
export function CourseHitList({ id, hits, activeIndex, onPick, onHover, busyCode }: {
	id: string;
	hits: readonly CourseSearchHit[];
	activeIndex: number;
	onPick: (hit: CourseSearchHit) => void;
	onHover?: (index: number) => void;
	/** The hit being added right now (shows a spinner, blocks the rest). */
	busyCode?: string | null;
}) {
	return (
		<ul id={id} role="listbox" aria-label="Treff hos NTNU" className="max-h-72 overflow-y-auto p-1">
			{hits.map((hit, index) => (
				<li
					key={hit.code}
					id={`${id}-${index}`}
					role="option"
					aria-selected={index === activeIndex}
					aria-disabled={busyCode ? true : undefined}
					data-testid="course-hit"
					// mousedown, not click: the input must not blur (and close
					// the list) before the pick lands.
					onMouseDown={(e) => {
						e.preventDefault();
						if (!busyCode) onPick(hit);
					}}
					onMouseEnter={() => onHover?.(index)}
					className={cn(
						"flex cursor-pointer items-center gap-3 rounded-md px-3 py-2",
						index === activeIndex && "bg-accent",
					)}
				>
					<span className="w-24 shrink-0 font-ui text-sm font-semibold tabular-nums">{hit.code}</span>
					<span className="min-w-0 flex-1">
						<span className="block truncate font-ui text-sm">{hit.name}</span>
						<span className="block truncate font-ui text-xs text-muted-foreground">
							{hitExamLine(hit)}{hit.location ? ` · ${hit.location}` : ""}
						</span>
					</span>
					{busyCode === hit.code && <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />}
				</li>
			))}
		</ul>
	);
}

/** The reserve: type the fag in yourself. One column, label above,
 *  example in the field. Pure form; the parent owns the request. */
export function ManualCourseForm({ initialCode = "", busy, error, onSubmit, onCancel }: {
	initialCode?: string;
	busy: boolean;
	error?: string | null;
	onSubmit: (code: string, name: string) => void;
	onCancel?: () => void;
}) {
	const [code, setCode] = useState(initialCode);
	const [name, setName] = useState("");
	const codeId = useId(), nameId = useId(), hintId = useId();
	const normalized = normalizeCourseCode(code);
	const codeInvalid = code.trim().length > 0 && normalized === null;
	const ready = normalized !== null && name.trim().length > 0 && !busy;
	return (
		<form
			data-testid="manual-course-form"
			className="flex flex-col gap-3 text-left"
			onSubmit={(e) => {
				e.preventDefault();
				if (ready && normalized) onSubmit(normalized, name.trim());
			}}
		>
			<div className="flex flex-col gap-1">
				<label htmlFor={codeId} className="font-ui text-xs font-medium">Fagkode</label>
				<Input
					id={codeId}
					value={code}
					onChange={(e) => setCode(e.target.value)}
					placeholder="F.eks. TTK4100"
					autoCapitalize="characters"
					autoComplete="off"
					spellCheck={false}
					aria-invalid={codeInvalid || undefined}
					aria-describedby={hintId}
				/>
				<p id={hintId} className={cn("font-ui text-xs", codeInvalid ? "text-destructive" : "text-muted-foreground")}>
					2 til 12 tegn: bokstaver, tall og bindestrek.
				</p>
			</div>
			<div className="flex flex-col gap-1">
				<label htmlFor={nameId} className="font-ui text-xs font-medium">Navn på faget</label>
				<Input
					id={nameId}
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="F.eks. Kybernetikk introduksjon"
					autoComplete="off"
				/>
			</div>
			{error && <p role="alert" className="font-ui text-sm text-destructive">{error}</p>}
			<div className="flex flex-wrap gap-2">
				<Button type="submit" disabled={!ready}>
					{busy && <LoaderCircleIcon className="animate-spin" aria-hidden="true" />}
					Legg til fag
				</Button>
				{onCancel && <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Avbryt</Button>}
			</div>
		</form>
	);
}

/**
 * «Legg til fag»: ONE search field against NTNU (fagkode or name), with a
 * visible reserve for fag NTNU does not list. Picking a hit creates the fag
 * and hands it to `onAdded` (the caller navigates to the fag page).
 *
 * Keyboard: ↓/↑ walk the hits, Enter picks (or tries the typed fagkode
 * directly when nothing is highlighted), Esc closes the list.
 */
export function AddCourse({ onAdded, autoFocus = false, hero = false, fetchLike }: {
	onAdded: (course: Course) => void;
	autoFocus?: boolean;
	/** The big first-run version on the empty home screen. */
	hero?: boolean;
	fetchLike?: typeof fetch;
}) {
	const listId = useId();
	const [query, setQuery] = useState("");
	const [hits, setHits] = useState<CourseSearchHit[] | null>(null);
	const [searching, setSearching] = useState(false);
	const [searchError, setSearchError] = useState<string | null>(null);
	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(-1);
	const [adding, setAdding] = useState<string | null>(null);
	const [addError, setAddError] = useState<string | null>(null);
	const [manual, setManual] = useState<{ code: string } | null>(null);
	const [manualError, setManualError] = useState<string | null>(null);
	const trimmed = query.trim();

	// Debounced search; a newer keystroke aborts the older request so a
	// slow answer can never overwrite a fresher one.
	useEffect(() => {
		if (trimmed.length < MIN_QUERY) {
			setHits(null);
			setSearching(false);
			setSearchError(null);
			return;
		}
		const controller = new AbortController();
		setSearching(true);
		const timer = setTimeout(() => {
			courseApi.search(trimmed, fetchLike ?? fetch, controller.signal)
				.then((found) => {
					if (controller.signal.aborted) return;
					setHits(found);
					setSearchError(null);
					setActiveIndex(found.length > 0 ? 0 : -1);
					setSearching(false);
				})
				.catch((err) => {
					if (controller.signal.aborted) return;
					setHits(null);
					setSearchError(courseErrorMessage(err));
					setSearching(false);
				});
		}, DEBOUNCE_MS);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [trimmed, fetchLike]);

	const mounted = useRef(true);
	useEffect(() => () => { mounted.current = false; }, []);

	const add = async (body: { code: string } | { code: string; name: string; custom: true }) => {
		if (adding) return;
		setAdding(body.code);
		setAddError(null);
		setManualError(null);
		try {
			const { course } = await courseApi.create(body, fetchLike ?? fetch);
			onAdded(course);
			// Navigation usually unmounts this; if not, reset for the next fag.
			if (mounted.current) {
				setAdding(null);
				setQuery("");
				setManual(null);
				setOpen(false);
			}
		} catch (err) {
			if (!mounted.current) return;
			setAdding(null);
			const message = courseErrorMessage(err, body.code);
			if ("custom" in body) {
				setManualError(message);
				return;
			}
			setAddError(message);
			// NTNU could not supply it: put the reserve right there, prefilled.
			if (err instanceof CourseApiError && (err.code === "course_not_found" || err.code === "ntnu_unreachable")) {
				setManual({ code: body.code });
			}
		}
	};

	const typedCode = normalizeCourseCode(trimmed);
	const showList = open && trimmed.length >= MIN_QUERY && !!hits && hits.length > 0;
	const noHits = trimmed.length >= MIN_QUERY && !searching && !searchError && hits !== null && hits.length === 0;

	return (
		<div className={cn("w-full text-left", hero && "mx-auto max-w-xl")} data-testid="add-course">
			<div className="relative">
				<SearchIcon className={cn("pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground", hero ? "size-5" : "size-4")} aria-hidden="true" />
				<Input
					role="combobox"
					aria-expanded={showList}
					aria-controls={listId}
					aria-autocomplete="list"
					aria-activedescendant={showList && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
					aria-label="Søk etter fag med fagkode eller navn"
					data-testid="course-search-input"
					value={query}
					autoFocus={autoFocus}
					autoComplete="off"
					spellCheck={false}
					placeholder="Fagkode eller navn, f.eks. TTK4100"
					onChange={(e) => {
						setQuery(e.target.value);
						setOpen(true);
						setAddError(null);
					}}
					onFocus={() => setOpen(true)}
					onBlur={() => setOpen(false)}
					onKeyDown={(e) => {
						if (e.key === "Escape" && showList) {
							// Claimed: Esc closes the list, nothing else.
							e.preventDefault();
							e.stopPropagation();
							setOpen(false);
							return;
						}
						if (e.key === "ArrowDown" || e.key === "ArrowUp") {
							if (!hits || hits.length === 0) return;
							e.preventDefault();
							setOpen(true);
							const dir = e.key === "ArrowDown" ? 1 : -1;
							setActiveIndex((i) => (i + dir + hits.length) % hits.length);
							return;
						}
						if (e.key === "Enter") {
							e.preventDefault();
							const hit = showList && activeIndex >= 0 ? hits![activeIndex] : undefined;
							if (hit) void add({ code: hit.code });
							// Typed a full fagkode and pressed Enter before the
							// hits arrived: try it directly.
							else if (typedCode) void add({ code: typedCode });
						}
					}}
					className={cn("bg-card", hero ? "h-14 rounded-xl pl-11 pr-11 text-lg md:text-lg" : "h-10 pl-9 pr-9")}
				/>
				{(searching || adding) && (
					<LoaderCircleIcon className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" />
				)}
				{showList && (
					<div className="absolute inset-x-0 top-full z-20 mt-1 rounded-xl border bg-popover shadow-xl">
						<CourseHitList
							id={listId}
							hits={hits!}
							activeIndex={activeIndex}
							busyCode={adding}
							onHover={setActiveIndex}
							onPick={(hit) => void add({ code: hit.code })}
						/>
					</div>
				)}
			</div>

			{/* One polite live region: search state in words. */}
			<p role="status" className="mt-2 min-h-5 font-ui text-xs text-muted-foreground">
				{adding
					? `Henter ${adding} fra NTNU …`
					: searching
						? "Søker hos NTNU …"
						: searchError
							? searchError
							: noHits
								? `Ingen treff på «${trimmed}». Sjekk skrivemåten, eller legg faget inn selv.`
								: showList
									? `${hits!.length} treff. Bruk piltastene og Enter for å velge.`
									: ""}
			</p>
			{addError && <p role="alert" className="mt-1 font-ui text-sm text-destructive">{addError}</p>}

			{manual ? (
				<div className="mt-3 rounded-xl border bg-card p-4">
					<p className="mb-3 font-ui text-sm font-medium">Legg inn faget selv</p>
					<ManualCourseForm
						key={manual.code}
						initialCode={manual.code}
						busy={adding !== null}
						error={manualError}
						onSubmit={(code, name) => void add({ code, name, custom: true })}
						onCancel={() => {
							setManual(null);
							setManualError(null);
						}}
					/>
				</div>
			) : (
				<button
					type="button"
					data-testid="manual-course-toggle"
					onClick={() => setManual({ code: typedCode ?? "" })}
					className="mt-1 cursor-pointer rounded-sm font-ui text-sm text-muted-foreground underline underline-offset-4 outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
				>
					Finner du ikke faget? Legg det inn selv
				</button>
			)}
		</div>
	);
}
