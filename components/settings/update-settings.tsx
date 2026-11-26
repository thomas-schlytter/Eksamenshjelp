"use client";

import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { BrailleSpinner } from "@/components/braille-spinner";
import { cn } from "@/lib/utils";
import { AUTHOR_NAME, AUTHOR_URL, UPSTREAM_AUTHOR, UPSTREAM_NAME, UPSTREAM_URL } from "@/lib/credits";
import { SettingsRow, Toggle } from "./controls.tsx";

/** «Oppdater nå» progress from electron/self-update.cjs. A failure leaves
 * the app unchanged; `message` is short Norwegian copy from the shell. */
export type UpdateInstall =
	| { phase: "downloading"; percent: number | null }
	| { phase: "installing" }
	| { phase: "failed"; message: string };

/** Observational snapshot from electron/main.cjs (the GitHub release
 * check). "available" carries the newer version and its release page.
 * `canInstall` is true where the shell installs itself (packaged macOS
 * arm64 / Windows x64); elsewhere the release page is the way. */
export type UpdateState = {
	status: "idle" | "checking" | "up-to-date" | "available" | "error" | "disabled";
	version: string | null;
	url: string | null;
	revision: number;
	canInstall?: boolean;
	install?: UpdateInstall | null;
};

export type AvailableRelease = { version: string; url: string; canInstall: boolean; install: UpdateInstall | null };

export const APP_VERSION = process.env.LH_VERSION ?? "";
const HOMEPAGE = process.env.LH_HOMEPAGE ?? "";
export const AUTO_UPDATE_HINT = "Ser etter nye versjoner ved oppstart og hver 24. time.";
const UPDATE_ERROR = "Kunne ikke se etter oppdateringer. Sjekk nettforbindelsen og prøv igjen.";

const LINK = "rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Subscribe before requesting the snapshot. IPC replies and pushes can
 * cross; a revision prevents an older reply from hiding a newer event.
 * The banner shares this read-only observer so late loads recover too. */
export function useUpdateState() {
	const [state, setState] = useState<UpdateState | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		const lh = window.lh;
		if (!lh) return;
		let live = true;
		let revision = -1;
		const accept = (next: UpdateState) => {
			if (!live || next.revision < revision) return;
			revision = next.revision;
			setState(next);
			setFailed(false);
		};
		const off = lh.onUpdateStatus?.(accept);
		void lh.getUpdateState?.().then(accept).catch(() => {
			if (live && revision === -1) setFailed(true);
		});
		return () => { live = false; off?.(); };
	}, []);
	return { state, failed };
}

/** The found release, only for a usable "available" snapshot. */
export function availableRelease(state: UpdateState | null): AvailableRelease | null {
	if (state?.status !== "available" || !state.version || !state.url) return null;
	return { version: state.version, url: state.url, canInstall: state.canInstall === true, install: state.install ?? null };
}

/** True while «Oppdater nå» is downloading or installing. */
export function installBusy(install: UpdateInstall | null): boolean {
	return install?.phase === "downloading" || install?.phase === "installing";
}

/** «Laster ned … 45 %» (a non-breaking space before %), «Installerer …»,
 * or the shell's failure message. */
export function installStatusText(install: UpdateInstall | null): string | null {
	switch (install?.phase) {
		case "downloading": return install.percent === null ? "Laster ned …" : `Laster ned … ${install.percent} %`;
		case "installing": return "Installerer …";
		case "failed": return install.message;
		default: return null;
	}
}

/** The shell reports every outcome as install status; nothing to await. */
export function startInstall() {
	void window.lh?.installUpdate?.().catch(() => {});
}

export function updateStatusText(state: UpdateState | null): string | null {
	switch (state?.status) {
		case "checking": return "Ser etter oppdateringer…";
		case "up-to-date": return "Fant ingen nyere versjon ved forrige sjekk.";
		case "error": return UPDATE_ERROR;
		default: return null;
	}
}

/** «Om»: who made the app, and what it builds on. Always visible. */
export function AboutSettings({ version = APP_VERSION, homepage = HOMEPAGE }: { version?: string; homepage?: string }) {
	const releaseNotes = version && homepage ? `${homepage}/releases/tag/v${version}` : null;
	return (
		<div data-testid="settings-about" className="flex flex-col gap-0.5 py-1">
			<p className="font-prose text-(length:--lh-prose-size) font-medium">Eksamenshjelp</p>
			<p className="text-xs text-muted-foreground" data-testid="row-version">
				Versjon {version || "ukjent"}
				{releaseNotes && (
					<>
						{" · "}
						<a href={releaseNotes} target="_blank" rel="noopener noreferrer" className={LINK} data-testid="release-notes">Versjonsnotater</a>
					</>
				)}
			</p>
			<p className="text-xs text-muted-foreground">
				Laget av{" "}
				<a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer" className={LINK} data-testid="about-author">{AUTHOR_NAME}</a>
			</p>
			<p className="text-xs text-muted-foreground">
				Basert på{" "}
				<a href={UPSTREAM_URL} target="_blank" rel="noopener noreferrer" className={LINK} data-testid="about-upstream">{UPSTREAM_NAME}</a>
				{` av ${UPSTREAM_AUTHOR}`}
			</p>
		</div>
	);
}

/** The row's control for a found release: «oppdater nå» where the shell
 * installs itself, the release page elsewhere and after a failed install. */
export function ReleaseAction({ release, onInstall = startInstall }: { release: AvailableRelease; onInstall?: () => void }) {
	const link = (testid: string, text: string) => (
		<a
			href={release.url}
			target="_blank"
			rel="noopener noreferrer"
			data-testid={testid}
			className={cn(buttonVariants({ size: "xs" }), "cursor-pointer")}
		>
			{text}
		</a>
	);
	if (release.install?.phase === "failed") return link("update-manual-download", "Last ned selv");
	if (!release.canInstall) return link("update-download", `Ny versjon ${release.version} – last ned`);
	const busy = installBusy(release.install);
	return (
		<Button type="button" size="xs" className="cursor-pointer disabled:cursor-not-allowed" data-testid="update-install" disabled={busy} aria-busy={busy} onClick={onInstall}>
			{busy && <BrailleSpinner label="Oppdaterer" />}
			Ny versjon {release.version} – oppdater nå
		</Button>
	);
}

/** Update controls only belong to a packaged shell (the check is skipped
 * in dev and has no bridge in the browser). Opening this row never checks. */
export function UpdateSettings({
	autoUpdate,
	onAutoUpdateChange,
}: {
	autoUpdate: boolean;
	onAutoUpdateChange: (on: boolean) => void;
}) {
	const { state, failed } = useUpdateState();
	const [checkFailed, setCheckFailed] = useState(false);
	useEffect(() => setCheckFailed(false), [state]);
	if ((state === null && !failed) || state?.status === "disabled") return null;
	const busy = state?.status === "checking";
	const release = availableRelease(state);
	const status = release ? installStatusText(release.install) : failed || checkFailed ? UPDATE_ERROR : updateStatusText(state);
	const check = () => {
		setCheckFailed(false);
		void window.lh?.checkForUpdates?.().catch(() => setCheckFailed(true));
	};

	return (
		<>
			<SettingsRow
				label="Oppdateringer"
				testid="row-updates"
				hint={status && <span role="status" data-testid="update-status">{status}</span>}
			>
				{release ? (
					<ReleaseAction release={release} />
				) : (
					<Button type="button" size="xs" variant="outline" className="cursor-pointer disabled:cursor-not-allowed" data-testid="update-check" disabled={busy} aria-busy={busy} onClick={check}>
						{busy && <BrailleSpinner label="Ser etter oppdateringer" />}
						Se etter oppdateringer
					</Button>
				)}
			</SettingsRow>
			<SettingsRow label="Automatiske oppdateringer" hint={AUTO_UPDATE_HINT} testid="row-auto-update">
				<Toggle checked={autoUpdate} label="automatiske oppdateringer" testid="toggle-auto-update" onChange={onAutoUpdateChange} />
			</SettingsRow>
		</>
	);
}
