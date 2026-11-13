"use client";

import { useMemo, useRef, useState } from "react";
import { GraphView } from "@/components/graph-view";
import { MinimalHome } from "@/components/minimal-home";
import { NodePickerControl } from "@/components/composer-actions";
import { SidebarToggle } from "@/components/sidebar";
import { LauncherSetupDialog, useSessionLauncher } from "@/components/courses/session-launcher";
import { StartBox } from "@/components/courses/start-box";

/** What an øvingsøkt on picked nodes opens with when the box is empty. */
export const PRACTICE_PICKS_OPENING = "Gi meg oppgaver om nodene jeg har valgt.";

/**
 * The knowledge map (/kart): the graph is the main view, full-bleed edge
 * to edge. The canvas owns the whole column, running under the header and
 * the start box, both of which float over it with no gradient scrims.
 * This was the home screen before «Mine fag» took `/` (NTNU round); nothing
 * was lost in the move: the pick flow, the chain table and the start box
 * all live here. Sessions live in the toggleable sidebar.
 */
export function KnowledgeMap({
	initialConfigured,
	rendering = true,
}: {
	initialConfigured: boolean;
	/** GRAPH RENDERING off: the main view is the quiet summary, not the
	 * canvas. Read server-side per navigation, so changing the setting
	 * applies on the next visit. */
	rendering?: boolean;
}) {
	// First-run gate + key guards: a start box never creates a session the
	// server would refuse (see useSessionLauncher).
	const launcher = useSessionLauncher(initialConfigured);
	const draftRef = useRef("");

	/* THE PICK SET: the chain table's selection is persistent and lifted
	 * here. Picks ride the session's CREATION as graphContext (the server
	 * writes a graph-context marker before the learner's first message).
	 * There is no lær/øv switch any more: typing and sending starts a
	 * læringsøkt on the picks, the «Øv på valgte noder» button an øvingsøkt. */
	const [picks, setPicks] = useState<{ id: string; name: string; statement: string }[]>([]);
	const [chainSelectOpen, setChainSelectOpen] = useState(false);
	// The chain table is CONTROLLED off this id set (the lifted pick).
	const pickedIds = useMemo(() => new Set(picks.map((p) => p.id)), [picks]);
	const graphContext = picks.length > 0 ? { graphContext: { propositions: picks } } : {};

	const mapProps = {
		chainSelectOpen,
		practiceSelection: pickedIds,
		onPracticeSelectionChange: setPicks,
		onChainSelectClose: () => setChainSelectOpen(false),
	};

	return (
		<div className="relative h-dvh">
			{/* Window-drag strip: a dedicated mask element, deliberately FIRST
			    in the DOM. Electron's app-region mask resolves by DOM order (a
			    no-drag element subtracts only drag regions that came EARLIER in
			    the tree), not by z-index. Placed first, every carved control
			    (chrome row, node detail card, the toggle) comes later and
			    subtracts correctly. Pure mask: it never receives events. */}
			<div className="lh-drag absolute inset-x-0 top-0 h-13" aria-hidden="true" />

			{/* The main view, full-bleed: no padding on any side. With
			    rendering OFF it is the quiet summary plus the graph chrome's
			    survivors; data, extraction and the pick flow are untouched. */}
			<main className="absolute inset-0">
				{rendering ? <GraphView {...mapProps} /> : <MinimalHome {...mapProps} />}
			</main>

			{/* Header floats over the graph: pointer-events-none except the
			    toggle, so the canvas stays draggable around it. No app-region
			    of its own: the drag comes from the mask div above, and the
			    toggle's lh-no-drag subtracts from it (later in the tree). */}
			<header className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 px-3 py-2">
				<div className="pointer-events-auto">
					<SidebarToggle />
				</div>
			</header>

			{/* The start box: same floating blob as the chat composer, docked
			    OVER the graph. Matches chat.tsx's dock geometry (max-w-[46rem]
			    px-4) so nothing shifts when a session starts. */}
			<div className="pointer-events-none absolute inset-x-0 bottom-0 pb-5">
				<div className="pointer-events-auto mx-auto w-full max-w-[46rem] px-4">
					<StartBox
						launcher={launcher}
						placeholder="Hva vil du lære?"
						autoFocus
						textRef={draftRef}
						buildSession={(text) => ({ title: text, ...graphContext })}
						picker={
							<NodePickerControl
								count={picks.length}
								onOpen={() => setChainSelectOpen(true)}
								onClear={() => setPicks([])}
								practiceDisabled={launcher.busy}
								onPractice={() => {
									// The student's own words win; an empty box still
									// starts, with a plain request about the picks.
									const text = draftRef.current.trim() || PRACTICE_PICKS_OPENING;
									void launcher.launch({ title: text, kind: "practice", ...graphContext });
								}}
							/>
						}
					/>
				</div>
			</div>

			<LauncherSetupDialog launcher={launcher} />
		</div>
	);
}
