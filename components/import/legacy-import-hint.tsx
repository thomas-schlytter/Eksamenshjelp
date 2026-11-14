"use client";

import { useEffect, useState } from "react";
import type { ImportCandidate } from "@/src/core";
import { openLegacyImport } from "./legacy-import-event.ts";

/** True when a found folder holds something this app does not have yet. */
export function candidateWorthImporting(candidate: ImportCandidate): boolean {
	const preview = candidate.preview;
	if (candidate.current || !preview) return false;
	return preview.chats.new > 0 || (preview.graph.blocked === null && (preview.graph.propositions.new > 0 || preview.graph.chains.new > 0));
}

/** The quiet line itself (pure, for the render tests). */
export function LegacyImportHintLine({ onOpen }: { onOpen: () => void }) {
	return (
		<p className="mx-auto mt-8 max-w-lg font-ui text-sm text-muted-foreground" data-testid="legacy-import-hint">
			Har du brukt LearnHarness før?{" "}
			<button
				type="button"
				onClick={onOpen}
				className="rounded-sm font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				Hent inn øktene og kunnskapskartet ditt.
			</button>
		</p>
	);
}

/** Home's empty state: shown only when the desktop app's data is on this
 *  machine and is not the folder this app already uses. Silent otherwise. */
export function LegacyImportHint() {
	const [path, setPath] = useState<string | null>(null);
	useEffect(() => {
		let live = true;
		fetch("/api/import/legacy")
			.then((res) => (res.ok ? res.json() : null))
			.then((body: { candidates?: ImportCandidate[] } | null) => {
				const found = body?.candidates?.find(candidateWorthImporting);
				if (live && found) setPath(found.path);
			})
			.catch(() => {});
		return () => {
			live = false;
		};
	}, []);
	if (path === null) return null;
	return <LegacyImportHintLine onOpen={() => openLegacyImport(path)} />;
}
