"use client";

/**
 * «Importer fra LearnHarness»: bring sessions, the knowledge map and
 * (optionally) settings, keys and custom prompts over from another
 * LearnHarness data folder. Four steps: pick the folder, see what is in
 * it, run, receipt. The server does the work (src/server/data-import.ts);
 * the import only ever ADDS, and this dialog says so at every step.
 *
 * LegacyImportBody is the frame without portal or backdrop, so the render
 * tests can pin each step's markup (portals render nothing under
 * renderToStaticMarkup, the settings dialog's precedent).
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, CheckIcon, FolderIcon, FolderOpenIcon, ShieldCheckIcon, XIcon } from "lucide-react";
import {
	IMPORT_INCLUDE_KEYS,
	LEGACY_DATA_LOCATIONS,
	type AppearanceSettings,
	type ImportCandidate,
	type ImportInclude,
	type ImportPreview,
	type ImportResult,
} from "@/src/core";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import { BrailleSpinner } from "@/components/braille-spinner";
import { useAppearance } from "@/components/settings/appearance.tsx";
import { notifySettingsSaved, type SettingsSection } from "@/components/settings-signal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ImportStep = "source" | "preview" | "running" | "done";

export interface ImportDialogState {
	step: ImportStep;
	/** null = still looking for folders on this machine. */
	candidates: ImportCandidate[] | null;
	path: string;
	preview: ImportPreview | null;
	include: ImportInclude;
	result: ImportResult | null;
	error: string | null;
	/** A preview request is in flight. */
	busy: boolean;
}

const EMPTY_INCLUDE: ImportInclude = { chats: false, graph: false, settings: false, keys: false, prompts: false };

export const INITIAL_IMPORT_STATE: ImportDialogState = {
	step: "source",
	candidates: null,
	path: "",
	preview: null,
	include: EMPTY_INCLUDE,
	result: null,
	error: null,
	busy: false,
};

const SETTINGS_SECTIONS: readonly SettingsSection[] = ["general", "keys", "agent", "models", "appearance", "graph", "compaction", "dictation", "claudeCode"];

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** One line per candidate: what an import from it would add. */
export function candidateSummary(candidate: ImportCandidate): string {
	if (candidate.current) return "Dette er mappen appen allerede bruker.";
	const preview = candidate.preview;
	if (!preview) return "Trykk for å se hva som finnes her.";
	const parts = [
		plural(preview.chats.total, "økt", "økter"),
		plural(preview.graph.propositions.total, "påstand", "påstander"),
		plural(preview.graph.chains.total, "kjede", "kjeder"),
	];
	return parts.join(", ");
}

/** Which checkboxes can be ticked at all, and why not when they cannot. */
export function importOptions(preview: ImportPreview, include: ImportInclude) {
	const g = preview.graph;
	const graphNew = g.propositions.new + g.chains.new + g.sources.new;
	return [
		{
			key: "chats" as const,
			title: "Økter",
			detail: preview.chats.new > 0
				? `${plural(preview.chats.new, "ny økt", "nye økter")} med samtale, plan og bakgrunnsarbeid.${preview.chats.existing > 0 ? ` ${plural(preview.chats.existing, "økt", "økter")} finnes allerede her og røres ikke.` : ""}`
				: preview.chats.total > 0 ? "Alle øktene i mappen finnes allerede her." : "Mappen har ingen økter.",
			available: preview.chats.new > 0,
		},
		{
			key: "graph" as const,
			title: "Kunnskapskart",
			detail: g.blocked
				? g.blocked
				: !g.present
					? "Mappen har ikke noe kunnskapskart."
					: graphNew > 0
						? `${plural(g.propositions.new, "ny påstand", "nye påstander")} og ${plural(g.chains.new, "ny kjede", "nye kjeder")}${g.sources.new > 0 ? `, pluss ${plural(g.sources.new, "importert notatkilde", "importerte notatkilder")}` : ""}. Flettes inn i kartet du har.`
						: "Alt i kartet finnes allerede her. Importen fyller bare inn det som eventuelt mangler.",
			available: g.present && g.blocked === null,
			warning: include.graph && !include.chats && preview.chats.new > 0
				? "Uten øktene vises de importerte påstandene uten øktnavn, og du kan ikke åpne samtalen de kom fra."
				: undefined,
		},
		{
			key: "settings" as const,
			title: "Innstillinger og modellvalg",
			detail: !preview.settings.present
				? "Mappen har ingen innstillinger."
				: preview.settings.targetHasSettings
					? "Du har allerede innstillinger her. Bare det du ikke har satt selv, fylles inn."
					: "Utseende, modellvalg og andre valg du gjorde i den andre appen.",
			available: preview.settings.present,
		},
		{
			key: "keys" as const,
			title: "API-nøkler",
			detail: preview.keys.newVariables.length > 0
				? `Nøklene kopieres mellom to mapper på din egen maskin og sendes ingen steder. Gjelder: ${preview.keys.newVariables.join(", ")}.`
				: preview.keys.present ? "Du har allerede nøkler for de samme leverandørene." : "Fant ingen nøkkelfil ved siden av mappen.",
			available: preview.keys.newVariables.length > 0,
		},
		{
			key: "prompts" as const,
			title: "Egne systeminstrukser",
			detail: preview.prompts.new > 0
				? `${plural(preview.prompts.new, "egen instruksfil", "egne instruksfiler")} du har skrevet selv.`
				: preview.prompts.total > 0 ? "Du har allerede egne versjoner av de samme instruksene." : "Mappen har ingen egne systeminstrukser.",
			available: preview.prompts.new > 0,
		},
	];
}

/** The receipt's lines: only what actually happened. */
export function receiptLines(result: ImportResult): string[] {
	const lines: string[] = [];
	if (result.chats.imported > 0) lines.push(`${plural(result.chats.imported, "økt", "økter")} importert.`);
	if (result.jobs.imported > 0) lines.push(`${plural(result.jobs.imported, "bakgrunnsjobb", "bakgrunnsjobber")} fulgte med øktene.`);
	if (result.graph.propositions > 0 || result.graph.chains > 0) {
		lines.push(`${plural(result.graph.propositions, "ny påstand", "nye påstander")} og ${plural(result.graph.chains, "ny kjede", "nye kjeder")} i kunnskapskartet.`);
	}
	if (result.graph.sources > 0) lines.push(`${plural(result.graph.sources, "importert notatkilde", "importerte notatkilder")} lagt til.`);
	if (result.settings.outcome === "copied") lines.push("Innstillinger og modellvalg er hentet inn.");
	if (result.settings.outcome === "merged") lines.push("Innstillinger du ikke hadde satt selv, er fylt inn.");
	if (result.keys.imported > 0) lines.push(`${plural(result.keys.imported, "API-nøkkel", "API-nøkler")} kopiert (${result.keys.variables.join(", ")}).`);
	if (result.prompts.imported > 0) lines.push(`${plural(result.prompts.imported, "egen systeminstruks", "egne systeminstrukser")} kopiert.`);
	return lines;
}

const ASSURANCE = "Importen legger bare til. Ingenting hos deg slettes eller overskrives, og dataene i den andre mappen endres ikke.";

function Assurance({ children }: { children?: React.ReactNode }) {
	return (
		<p className="flex items-start gap-2 rounded-lg border border-border/60 bg-background px-3 py-2.5 font-ui text-xs leading-relaxed text-muted-foreground" data-testid="import-assurance">
			<ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden="true" />
			<span>{ASSURANCE}{children ? <> {children}</> : null}</span>
		</p>
	);
}

/** The dialog frame: props in, markup out. All effects live in the container. */
export function LegacyImportBody({ state, onPick, onPathChange, onPreviewPath, onDropPath, onToggle, onBack, onRun, onClose, onGoHome, onGoGraph }: {
	state: ImportDialogState;
	onPick: (candidate: ImportCandidate) => void;
	onPathChange: (path: string) => void;
	onPreviewPath: () => void;
	/** A folder dropped on the dialog; null when its path is not available (the browser). */
	onDropPath: (path: string | null) => void;
	onToggle: (key: keyof ImportInclude, on: boolean) => void;
	onBack: () => void;
	onRun: () => void;
	onClose: () => void;
	onGoHome: () => void;
	onGoGraph: () => void;
}) {
	const titleId = useId(), pathId = useId();
	const [dragging, setDragging] = useState(false);
	const { step, preview, result } = state;
	const found = (state.candidates ?? []).filter((candidate) => !candidate.current);
	const onlyCurrent = state.candidates !== null && found.length === 0 && state.candidates.some((candidate) => candidate.current);
	const options = preview ? importOptions(preview, state.include) : [];
	const anySelected = options.some((option) => option.available && state.include[option.key]);
	const hasFiles = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes("Files");

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
			data-lh-modal
			data-testid="legacy-import-dialog"
			data-step={step}
			className="flex max-h-[85vh] w-[560px] max-w-[92vw] flex-col overflow-hidden rounded-2xl border bg-card shadow-xl"
		>
			<header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
				<h2 id={titleId} className="font-ui text-base font-semibold">Importer fra LearnHarness</h2>
				<button
					type="button"
					aria-label="Lukk"
					data-testid="legacy-import-close"
					disabled={step === "running"}
					onClick={onClose}
					className="ml-auto flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
				>
					<XIcon className="size-4" aria-hidden="true" />
				</button>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
				{step === "source" && (
					<div
						className={cn("flex flex-col gap-4 rounded-lg", dragging && "outline-2 outline-dashed outline-offset-4 outline-primary")}
						data-testid="legacy-import-source"
						onDragEnter={(event) => {
							if (hasFiles(event)) setDragging(true);
						}}
						onDragOver={(event) => {
							if (!hasFiles(event)) return;
							event.preventDefault();
							event.dataTransfer.dropEffect = "copy";
						}}
						onDragLeave={(event) => {
							if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
						}}
						onDrop={(event) => {
							if (!hasFiles(event)) return;
							// Claimed here: the page's own drop zone must not also take it.
							event.preventDefault();
							event.stopPropagation();
							setDragging(false);
							const file = event.dataTransfer.files[0];
							const resolve = window.lh?.getPathForFile;
							let dropped: string | null = null;
							try {
								dropped = file && resolve ? resolve(file) : null;
							} catch {
								dropped = null;
							}
							onDropPath(dropped);
						}}
					>
						<p className="font-ui text-sm leading-relaxed text-muted-foreground">
							Har du brukt den vanlige LearnHarness-appen, kan du ta med deg øktene, kunnskapskartet og innstillingene dine hit.
						</p>

						{state.candidates === null ? (
							<p className="flex items-center gap-2 font-ui text-sm text-muted-foreground" role="status">
								<BrailleSpinner /> Ser etter LearnHarness-data på denne maskinen…
							</p>
						) : found.length > 0 ? (
							<section aria-label="Funnet på denne maskinen">
								<h3 className="font-ui text-sm font-medium">Fant LearnHarness-data på denne maskinen</h3>
								<ul className="mt-2 flex flex-col gap-2">
									{found.map((candidate) => (
										<li key={candidate.path}>
											<button
												type="button"
												data-testid="legacy-import-candidate"
												disabled={state.busy}
												onClick={() => onPick(candidate)}
												className="flex w-full items-center gap-3 rounded-xl border bg-background px-3 py-2.5 text-left transition-colors hover:border-primary/60 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
											>
												<FolderIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
												<span className="min-w-0 flex-1">
													<span className="block font-ui text-sm font-medium">{candidate.label}</span>
													<span className="block font-ui text-xs text-muted-foreground">{candidateSummary(candidate)}</span>
													<span className="block truncate font-mono text-[11px] text-muted-foreground/70" title={candidate.path}>{candidate.path}</span>
												</span>
											</button>
										</li>
									))}
								</ul>
							</section>
						) : (
							<p className="font-ui text-sm text-muted-foreground" data-testid="legacy-import-none">
								{onlyCurrent
									? "Denne appen bruker allerede samme datamappe som den vanlige LearnHarness-appen, så øktene og kartet ditt er her fra før. Du kan fortsatt importere fra en annen mappe."
									: "Fant ingen LearnHarness-data på standardplassen på denne maskinen. Velg mappen selv under."}
							</p>
						)}

						<section className="border-t border-border/60 pt-4">
							<label htmlFor={pathId} className="font-ui text-sm font-medium">Velg en annen mappe</label>
							<p className="mt-1 font-ui text-xs text-muted-foreground">
								Lim inn stien til mappen, eller dra mappen hit i skrivebordsappen. Du kan velge både LearnHarness-mappen og «data»-mappen inni den.
							</p>
							<form
								className="mt-2 flex gap-2"
								onSubmit={(event) => {
									event.preventDefault();
									onPreviewPath();
								}}
							>
								<Input
									id={pathId}
									data-testid="legacy-import-path"
									value={state.path}
									onChange={(event) => onPathChange(event.target.value)}
									placeholder="~/Library/Application Support/LearnHarness"
									spellCheck={false}
									autoComplete="off"
									className="font-mono text-xs"
								/>
								<Button type="submit" variant="outline" disabled={state.busy || state.path.trim().length === 0} data-testid="legacy-import-preview">
									{state.busy ? <BrailleSpinner /> : <FolderOpenIcon aria-hidden="true" />}
									Se innholdet
								</Button>
							</form>
							<details className="mt-3 font-ui text-xs text-muted-foreground">
								<summary className="cursor-pointer select-none">Hvor ligger mappen?</summary>
								<dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
									{LEGACY_DATA_LOCATIONS.map((location) => (
										<div key={location.platform} className="contents">
											<dt>{location.platform}</dt>
											<dd className="font-mono text-[11px] break-all">{location.path}</dd>
										</div>
									))}
								</dl>
								<p className="mt-2">Kommer dataene fra en annen maskin, kopierer du hele mappen over først og velger kopien her.</p>
							</details>
						</section>
					</div>
				)}

				{step === "preview" && preview && (
					<div className="flex flex-col gap-3" data-testid="legacy-import-preview-step">
						<p className="font-ui text-xs text-muted-foreground">
							Fra <span className="font-mono text-[11px] break-all text-foreground">{preview.dataDir}</span>
						</p>
						<fieldset className="flex flex-col gap-2">
							<legend className="mb-1 font-ui text-sm font-medium">Hva vil du ta med?</legend>
							{options.map((option) => (
								<label
									key={option.key}
									data-testid={`legacy-import-option-${option.key}`}
									className={cn("flex items-start gap-2.5 rounded-lg border border-border/60 px-3 py-2.5", option.available ? "cursor-pointer" : "opacity-50")}
								>
									<input
										type="checkbox"
										checked={option.available && state.include[option.key]}
										disabled={!option.available}
										onChange={(event) => onToggle(option.key, event.target.checked)}
										className="mt-0.5 size-4 shrink-0 accent-primary"
									/>
									<span className="min-w-0">
										<span className="block font-ui text-sm text-foreground">{option.title}</span>
										<span className="mt-0.5 block font-ui text-xs leading-relaxed text-muted-foreground">{option.detail}</span>
										{option.warning && <span className="mt-1 block font-ui text-xs leading-relaxed text-foreground" role="note">{option.warning}</span>}
									</span>
								</label>
							))}
						</fieldset>
						{preview.chats.newTitles.length > 0 && (
							<details className="font-ui text-xs text-muted-foreground">
								<summary className="cursor-pointer select-none">Vis øktene som blir importert</summary>
								<ul className="mt-2 flex list-disc flex-col gap-0.5 pl-5">
									{preview.chats.newTitles.map((title, index) => <li key={index}>{title}</li>)}
									{preview.chats.new > preview.chats.newTitles.length && <li>og {preview.chats.new - preview.chats.newTitles.length} til</li>}
								</ul>
							</details>
						)}
						{preview.notes.length > 0 && (
							<ul className="flex flex-col gap-1 font-ui text-xs text-muted-foreground" data-testid="legacy-import-notes">
								{preview.notes.map((note, index) => <li key={index}>{note}</li>)}
							</ul>
						)}
						<Assurance>Før noe skrives, tas en sikkerhetskopi av kunnskapskartet og innstillingene dine.</Assurance>
					</div>
				)}

				{step === "running" && (
					<p className="flex items-center gap-2 py-8 font-ui text-sm text-muted-foreground" role="status" data-testid="legacy-import-running">
						<BrailleSpinner /> Importerer. Dette tar vanligvis bare et øyeblikk…
					</p>
				)}

				{step === "done" && result && (
					<div className="flex flex-col gap-3" data-testid="legacy-import-done">
						<p className="flex items-center gap-2 font-ui text-sm font-medium">
							<CheckIcon className="size-4 text-primary" aria-hidden="true" />
							{receiptLines(result).length > 0 ? "Importen er ferdig" : "Alt var allerede importert"}
						</p>
						{receiptLines(result).length > 0 ? (
							<ul className="flex list-disc flex-col gap-1 pl-5 font-ui text-sm" data-testid="legacy-import-receipt">
								{receiptLines(result).map((line) => <li key={line}>{line}</li>)}
							</ul>
						) : (
							<p className="font-ui text-sm text-muted-foreground">Det var ikke noe nytt å hente fra mappen. Ingenting ble endret.</p>
						)}
						{result.skipped.length > 0 && (
							<section data-testid="legacy-import-skipped">
								<h3 className="font-ui text-xs font-medium uppercase tracking-widest text-muted-foreground">Ikke tatt med</h3>
								<ul className="mt-1.5 flex flex-col gap-1 font-ui text-xs text-muted-foreground">
									{result.skipped.map((item, index) => (
										<li key={index}><span className="text-foreground">{item.what}:</span> {item.reason}</li>
									))}
								</ul>
							</section>
						)}
						{result.backupDir && (
							<p className="font-ui text-xs text-muted-foreground">
								Sikkerhetskopi fra før importen: <span className="font-mono text-[11px] break-all">{result.backupDir}</span>
							</p>
						)}
						<Assurance />
					</div>
				)}

				{state.error && <p role="alert" className="mt-3 font-ui text-sm text-destructive" data-testid="legacy-import-error">{state.error}</p>}
			</div>

			<footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
				{step === "source" && <Button variant="outline" onClick={onClose}>Avbryt</Button>}
				{step === "preview" && (
					<>
						<Button variant="ghost" onClick={onBack} className="mr-auto" data-testid="legacy-import-back">
							<ArrowLeftIcon aria-hidden="true" /> Tilbake
						</Button>
						<Button variant="outline" onClick={onClose}>Avbryt</Button>
						<Button onClick={onRun} disabled={!anySelected} data-testid="legacy-import-run">Importer</Button>
					</>
				)}
				{step === "done" && (
					<>
						<Button variant="ghost" onClick={onClose} className="mr-auto">Lukk</Button>
						<Button variant="outline" onClick={onGoGraph} data-testid="legacy-import-go-graph">Åpne kunnskapskartet</Button>
						<Button onClick={onGoHome} data-testid="legacy-import-go-home">Gå til Hjem</Button>
					</>
				)}
			</footer>
		</div>
	);
}

async function readError(res: Response): Promise<string> {
	const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
	return typeof body?.error === "string" ? body.error : "Noe gikk galt. Prøv igjen.";
}

/** The container: owns the requests and the step transitions. */
export function LegacyImportDialog({ initialPath, onClose }: { initialPath?: string; onClose: () => void }) {
	const router = useRouter();
	const { onAppearanceChange } = useAppearance();
	const [state, setState] = useState<ImportDialogState>({ ...INITIAL_IMPORT_STATE, path: initialPath ?? "" });
	const stateRef = useRef(state);
	stateRef.current = state;
	const close = useCallback(() => {
		if (stateRef.current.step !== "running") onClose();
	}, [onClose]);
	const backdrop = useBackdropDismiss(close);

	const showPreview = useCallback((path: string, preview: ImportPreview) => {
		setState((prev) => ({ ...prev, step: "preview", path, preview, include: preview.defaults, error: null, busy: false }));
	}, []);

	const previewPath = useCallback(async (path: string) => {
		setState((prev) => ({ ...prev, path, busy: true, error: null }));
		try {
			const res = await fetch("/api/import/legacy/preview", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ path }),
			});
			if (!res.ok) {
				const error = await readError(res);
				setState((prev) => ({ ...prev, busy: false, error }));
				return;
			}
			showPreview(path, (await res.json()) as ImportPreview);
		} catch {
			setState((prev) => ({ ...prev, busy: false, error: "Fikk ikke kontakt med appen. Prøv igjen." }));
		}
	}, [showPreview]);

	// Look for the desktop app's folders once. A preselected path (the home
	// hint) goes straight to its preview.
	useEffect(() => {
		let live = true;
		fetch("/api/import/legacy")
			.then((res) => (res.ok ? res.json() : { candidates: [] }))
			.then((body: { candidates?: ImportCandidate[] }) => {
				if (!live) return;
				const candidates = body.candidates ?? [];
				setState((prev) => ({ ...prev, candidates }));
				const preselected = initialPath ? candidates.find((candidate) => candidate.path === initialPath && !candidate.current) : undefined;
				if (preselected?.preview) showPreview(preselected.path, preselected.preview);
			})
			.catch(() => {
				if (live) setState((prev) => ({ ...prev, candidates: [] }));
			});
		return () => {
			live = false;
		};
	}, [initialPath, showPreview]);

	// Esc closes (never mid-import), claimed so it does not also stop a turn.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			close();
		};
		document.addEventListener("keydown", onKeyDown, true);
		return () => document.removeEventListener("keydown", onKeyDown, true);
	}, [close]);

	const run = useCallback(async () => {
		const { path, include, preview } = stateRef.current;
		if (!preview) return;
		// Only what can actually be imported is sent, whatever the boxes say.
		const available = new Set(importOptions(preview, include).filter((option) => option.available).map((option) => option.key));
		const body = Object.fromEntries(IMPORT_INCLUDE_KEYS.map((key) => [key, include[key] && available.has(key)]));
		setState((prev) => ({ ...prev, step: "running", error: null }));
		try {
			const res = await fetch("/api/import/legacy", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ path, include: body }),
			});
			if (!res.ok) {
				const error = await readError(res);
				setState((prev) => ({ ...prev, step: "preview", error }));
				return;
			}
			const result = (await res.json()) as ImportResult;
			setState((prev) => ({ ...prev, step: "done", result }));
			// Open views refetch: the graph on its revision event, settings
			// consumers on theirs. (Lists follow the server's own events.)
			window.dispatchEvent(new CustomEvent("lh:graph-revision", { detail: { revision: result.graphRevision, graphRevision: result.graphRevision } }));
			if (result.settings.outcome === "copied" || result.settings.outcome === "merged") {
				for (const section of result.settings.sections) {
					if ((SETTINGS_SECTIONS as readonly string[]).includes(section)) notifySettingsSaved(section as SettingsSection);
				}
				if (result.settings.sections.includes("appearance")) {
					const saved = (await fetch("/api/settings").then((r) => (r.ok ? r.json() : null)).catch(() => null)) as { settings?: { appearance?: AppearanceSettings } } | null;
					if (saved?.settings?.appearance) onAppearanceChange(saved.settings.appearance);
				}
			}
			if (result.keys.imported > 0) notifySettingsSaved("keys");
			router.refresh();
		} catch {
			setState((prev) => ({ ...prev, step: "preview", error: "Fikk ikke kontakt med appen. Sjekk om importen ble fullført ved å åpne dialogen på nytt." }));
		}
	}, [router, onAppearanceChange]);

	return createPortal(
		<div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 p-4" data-testid="legacy-import-backdrop" {...backdrop}>
			<LegacyImportBody
				state={state}
				onPick={(candidate) => (candidate.preview ? showPreview(candidate.path, candidate.preview) : void previewPath(candidate.path))}
				onPathChange={(path) => setState((prev) => ({ ...prev, path, error: null }))}
				onPreviewPath={() => void previewPath(stateRef.current.path)}
				onDropPath={(path) => {
					if (path) void previewPath(path);
					else setState((prev) => ({ ...prev, error: "Dra og slipp av mapper virker bare i skrivebordsappen. Lim inn stien til mappen i stedet." }));
				}}
				onToggle={(key, on) => setState((prev) => ({ ...prev, include: { ...prev.include, [key]: on } }))}
				onBack={() => setState((prev) => ({ ...prev, step: "source", preview: null, error: null }))}
				onRun={() => void run()}
				onClose={close}
				onGoHome={() => {
					onClose();
					router.push("/");
				}}
				onGoGraph={() => {
					onClose();
					router.push("/kart");
				}}
			/>
		</div>,
		document.body,
	);
}
