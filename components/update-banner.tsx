"use client";

/**
 * The update banner (owner 2026-11-23: «Varsel med nedlastingslenke»).
 * The shell pushes "lh:update-status" when GitHub has a release newer
 * than the running app (electron/main.cjs). Snapshot retrieval also
 * covers a late load. «Last ned» opens the release page in the system
 * browser (window.open is routed to shell.openExternal by the shell).
 * Browser builds have no window.lh and never see a push: renders null.
 *
 * Dismissing hides this version for the mounted window only; Settings →
 * Generelt still offers the download.
 */

import { useState } from "react";
import { XIcon } from "lucide-react";
import { availableRelease, useUpdateState } from "@/components/settings/update-settings.tsx";

export default function UpdateBanner() {
	const { state } = useUpdateState();
	const [dismissedVersion, setDismissedVersion] = useState<string | null>();
	const release = availableRelease(state);
	if (!release || release.version === dismissedVersion) return null;
	return (
		<div
			data-testid="update-banner"
			className="fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-lg border border-border bg-popover px-4 py-3 shadow-lg"
		>
			<p className="text-sm font-medium">Ny versjon {release.version}</p>
			<a
				href={release.url}
				target="_blank"
				rel="noopener noreferrer"
				data-testid="update-banner-download"
				className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				Last ned
			</a>
			<button
				type="button"
				aria-label="Lukk oppdateringsvarselet"
				onClick={() => setDismissedVersion(release.version)}
				className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<XIcon className="size-4" aria-hidden="true" />
			</button>
		</div>
	);
}
