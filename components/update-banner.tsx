"use client";

/**
 * The update banner (owner 2026-11-23: «Varsel med nedlastingslenke»;
 * 2026-11-26: «Oppdater nå»). The shell pushes "lh:update-status" when
 * GitHub has a release newer than the running app (electron/main.cjs).
 * Snapshot retrieval also covers a late load. Where the shell can install
 * itself (canInstall: packaged macOS arm64 / Windows x64) the button is
 * «Oppdater nå»: progress («Laster ned … 45 %», «Installerer …») replaces
 * the text, and a failure shows the shell's message with «Last ned selv».
 * Elsewhere «Last ned» opens the release page in the system browser
 * (window.open is routed to shell.openExternal by the shell). Browser
 * builds have no window.lh and never see a push: renders null.
 *
 * Dismissing hides this version for the mounted window only; Settings →
 * Generelt still offers the update. It cannot be dismissed mid-install.
 */

import { useState } from "react";
import { XIcon } from "lucide-react";
import {
	availableRelease, installBusy, installStatusText, startInstall, useUpdateState, type AvailableRelease,
} from "@/components/settings/update-settings.tsx";

const ACTION = "rounded-md bg-accent px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Pure view of a found release (static-renderable). */
export function UpdateBannerView({ release, onInstall, onDismiss }: { release: AvailableRelease; onInstall: () => void; onDismiss: () => void }) {
	const busy = installBusy(release.install);
	const failed = release.install?.phase === "failed";
	const link = (testid: string, text: string) => (
		<a href={release.url} target="_blank" rel="noopener noreferrer" data-testid={testid} className={ACTION}>
			{text}
		</a>
	);
	return (
		<div
			data-testid="update-banner"
			className="fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-lg border border-border bg-popover px-4 py-3 shadow-lg"
		>
			<p role="status" data-testid="update-banner-status" className="text-sm font-medium">
				{installStatusText(release.install) ?? `Ny versjon ${release.version}`}
			</p>
			{failed
				? link("update-banner-manual-download", "Last ned selv")
				: busy
					? null
					: release.canInstall
						? (
							<button type="button" data-testid="update-banner-install" onClick={onInstall} className={ACTION}>
								Oppdater nå
							</button>
						)
						: link("update-banner-download", "Last ned")}
			{!busy && (
				<button
					type="button"
					aria-label="Lukk oppdateringsvarselet"
					onClick={onDismiss}
					className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<XIcon className="size-4" aria-hidden="true" />
				</button>
			)}
		</div>
	);
}

export default function UpdateBanner() {
	const { state } = useUpdateState();
	const [dismissed, setDismissed] = useState<string | null>(null);
	const release = availableRelease(state);
	if (!release) return null;
	// Keyed by version AND install phase: progress and a failure still show
	// after the offer was dismissed (Settings can start the install too).
	const key = `${release.version}:${release.install?.phase ?? ""}`;
	if (key === dismissed) return null;
	return <UpdateBannerView release={release} onInstall={startInstall} onDismiss={() => setDismissed(key)} />;
}
