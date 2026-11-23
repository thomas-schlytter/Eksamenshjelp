"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { CornerDownLeftIcon } from "lucide-react";
import { ComposerActions } from "@/components/composer-actions";
import { DictationBar, joinDictation, useDictation } from "@/components/dictation";
import { useFieldCycle } from "@/components/field-cycle";
import { OPENING_PROMPT_FAILURE } from "@/components/opening-prompt";
import { PathInput } from "@/components/path-input";
import type { SessionCreation } from "@/components/start-session";
import { StatsBar } from "@/components/stats-bar";
import type { TurnUsage } from "@/src/core";
import { SetupCta, type SessionLauncher } from "./session-launcher";

const NO_TURNS: TurnUsage[] = [];

/**
 * The start box for a free session: the same floating blob as the chat
 * composer (path chips, dictation, the model control underneath), shared by
 * home, the fag page and the knowledge map. One mode outwardly: there is no
 * lær/øv switch. What the session carries (a fag link, picked nodes) is
 * decided by the caller through `buildSession`.
 *
 * The draft is never lost: a refused start (setup needed, failed create)
 * leaves the text in the box.
 */
export function StartBox({
	launcher,
	placeholder,
	buildSession,
	send,
	picker,
	leadingSlot,
	tourId,
	autoFocus = false,
	ownsFieldCycle = true,
	textRef,
	submitLabel = "Start økt",
}: {
	launcher: SessionLauncher;
	placeholder: string;
	/** The create body for this draft. Default: a free session titled by the text. */
	buildSession?: (text: string) => SessionCreation;
	/** Instead of creating a session: hand the draft elsewhere (the fag
	 *  page sends it into the fag-chat). The caller owns the guards. */
	send?: (text: string) => void;
	/** Leads the action row above the box (the node picker on the map). */
	picker?: ReactNode;
	/** The stats row's left edge (the fag chip). */
	leadingSlot?: ReactNode;
	tourId?: string;
	autoFocus?: boolean;
	/** False where the page runs its own Tab chain over every control. */
	ownsFieldCycle?: boolean;
	/** Mirrors the draft for callers that start a session from elsewhere. */
	textRef?: RefObject<string>;
	submitLabel?: string;
}) {
	const [text, setText] = useState("");
	/* The draft MIRROR: a dictation flush lands via setState, invisible to a
	 * closure that waited through `await finish()`. Kept current at every
	 * write, and read by the send. */
	const ownRef = useRef("");
	const mirror = textRef ?? ownRef;
	const apply = useCallback((value: string) => {
		mirror.current = value;
		setText(value);
	}, [mirror]);
	const dictation = useDictation({ append: (t) => apply(joinDictation(mirror.current, t)) });

	const inputRef = useRef<HTMLDivElement>(null);
	const cycle = useCallback(
		(): readonly HTMLElement[] => (ownsFieldCycle && inputRef.current ? [inputRef.current] : []),
		[ownsFieldCycle],
	);
	useFieldCycle(cycle);
	// Run end focuses the box: the hands are on the keyboard from the stop.
	const dictationWasActive = useRef(false);
	useEffect(() => {
		if (dictation.active) dictationWasActive.current = true;
		else if (dictationWasActive.current) {
			dictationWasActive.current = false;
			inputRef.current?.focus();
		}
	}, [dictation.active]);

	const begin = () => {
		const draft = mirror.current.trim();
		if (!draft) return;
		if (send) {
			send(draft);
			return;
		}
		void launcher.launch(buildSession ? buildSession(draft) : { title: draft });
	};
	// FINISH DICTATION FIRST: let the last spoken words land, then send.
	const start = () => {
		if (dictation.active) void dictation.finish().then(begin);
		else begin();
	};

	// ComposerActions hides its row on a falsy `setup`; an element that
	// renders null would still be truthy, so decide here.
	const needsSetup = launcher.zeroKeys || !launcher.configured;
	return (
		<div data-tour={tourId}>
			<ComposerActions picker={picker} setup={needsSetup ? <SetupCta launcher={launcher} /> : undefined} />
			{launcher.failed && <p role="alert" className="mb-2 font-ui text-sm text-destructive">{OPENING_PROMPT_FAILURE}</p>}
			<form
				className="flex items-end gap-1.5 rounded-2xl border bg-card p-1.5 shadow-lg"
				onSubmit={(e) => {
					e.preventDefault();
					start();
				}}
			>
				<PathInput
					ref={inputRef}
					value={text}
					onValueChange={apply}
					defaultDropTarget
					aria-label={placeholder}
					onKeyDown={(e) => {
						// Esc ends dictation; claimed so the window chain does
						// not also abort a turn.
						if (e.key === "Escape" && dictation.active) {
							e.preventDefault();
							e.stopPropagation();
							dictation.cancel();
							return;
						}
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							start();
						}
					}}
					placeholder={placeholder}
					autoFocus={autoFocus}
					className="field-sizing-content lh-input max-h-48 min-h-10 flex-1 resize-none bg-transparent px-2.5 py-2 outline-none placeholder:text-muted-foreground"
				/>
				<button
					type="submit"
					aria-label={submitLabel}
					disabled={(!text.trim() && !dictation.active) || launcher.busy}
					className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-40"
				>
					<CornerDownLeftIcon className="size-5" aria-hidden="true" />
				</button>
			</form>
			<StatsBar dictationSlot={<DictationBar dictation={dictation} />} turns={NO_TURNS} leadingSlot={leadingSlot} />
		</div>
	);
}
