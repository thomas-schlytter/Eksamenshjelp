"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
	ExternalLinkIcon, FileTextIcon, FolderIcon, FolderUpIcon, LandmarkIcon, LinkIcon, LoaderCircleIcon, StickyNoteIcon, XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { NewSource } from "./course-api";
import { formatExamDate } from "./course-format";
import { MAX_NOTE_CHARS, type Course, type CourseSource, type CourseSourceKind } from "./course-types";

const SOURCE_ICON: Record<CourseSourceKind, typeof FileTextIcon> = {
	ntnu: LandmarkIcon,
	file: FileTextIcon,
	folder: FolderIcon,
	link: LinkIcon,
	note: StickyNoteIcon,
};

const SOURCE_KIND_LABEL: Record<CourseSourceKind, string> = {
	ntnu: "NTNU",
	file: "Fil",
	folder: "Mappe",
	link: "Lenke",
	note: "Notat",
};

const BROWSER_DROP_NOTICE = "I nettleseren får ikke appen vite hvor filene ligger. Lim inn stien til filen eller mappen i stedet.";

/** The second line under a source's title: where it is, or what it says. */
export function sourceDetail(source: CourseSource): string {
	if (source.kind === "folder") {
		const count = source.fileCount === undefined ? "" : ` · ${source.fileCount} ${source.fileCount === 1 ? "fil" : "filer"}`;
		return `${source.path ?? ""}${count}`;
	}
	if (source.kind === "file") return source.path ?? "";
	if (source.kind === "note") {
		const text = (source.text ?? "").replace(/\s+/g, " ").trim();
		return text.length > 120 ? `${text.slice(0, 120)}…` : text;
	}
	return source.url ?? "";
}

/** A pasted path with a file extension is tried as a file first. */
export function pathKindOrder(path: string): ("file" | "folder")[] {
	return /\.[A-Za-z0-9]{1,8}$/.test(path.trim().replace(/[\\/]+$/, "")) ? ["file", "folder"] : ["folder", "file"];
}

/** Adds one source; resolves to an error message, or null when it worked. */
export type AddSource = (source: NewSource) => Promise<string | null>;

type AdderMode = "none" | "path" | "note" | "link";

/**
 * «Legg til materiale»: drop files or folders, paste a path, paste a note,
 * or add a link. The app is local, so what is stored for files is the PATH
 * (the agent reads the file where it lies); nothing is uploaded.
 *
 * In the desktop app a drop resolves real paths. In a plain browser the
 * page cannot learn where a dropped file lives, so the drop explains that
 * and opens the paste-a-path field instead.
 */
export function SourceAdder({ onAdd, compact = false }: { onAdd: AddSource; compact?: boolean }) {
	const [mode, setMode] = useState<AdderMode>("none");
	const [dragging, setDragging] = useState(false);
	const depth = useRef(0);
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	// The Electron bridge exists only in the client: read it after mount so
	// server and first client render agree.
	const [desktop, setDesktop] = useState(false);
	useEffect(() => setDesktop(typeof window.lh?.getPathForFile === "function"), []);

	const [path, setPath] = useState("");
	const [noteTitle, setNoteTitle] = useState("");
	const [note, setNote] = useState("");
	const [url, setUrl] = useState("");
	const [linkTitle, setLinkTitle] = useState("");
	const pathId = useId(), noteTitleId = useId(), noteId = useId(), urlId = useId(), linkTitleId = useId();
	const pathRef = useRef<HTMLInputElement>(null);

	const run = async (work: () => Promise<string | null>): Promise<boolean> => {
		setBusy(true);
		setFailure(null);
		setNotice(null);
		const error = await work();
		setBusy(false);
		setFailure(error);
		return error === null;
	};

	/** Try the kinds in order: the first one the server accepts wins. */
	const addPath = async (rawPath: string, kinds: readonly ("file" | "folder")[]): Promise<string | null> => {
		let last: string | null = null;
		for (const kind of kinds) {
			last = await onAdd({ kind, path: rawPath });
			if (last === null) return null;
		}
		return last;
	};

	const hasFiles = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes("Files");
	const endDrag = () => {
		depth.current = 0;
		setDragging(false);
	};

	const tab = (value: AdderMode, label: string, Icon: typeof FileTextIcon) => (
		<Button
			type="button"
			variant={mode === value ? "secondary" : "outline"}
			size="sm"
			aria-expanded={mode === value}
			onClick={() => {
				setMode((current) => (current === value ? "none" : value));
				setFailure(null);
			}}
		>
			<Icon aria-hidden="true" />
			{label}
		</Button>
	);

	return (
		<div data-testid="source-adder" className="flex flex-col gap-3">
			{/* The drop target. Every drag event stops here: the app-wide
			    drop zone (which attaches paths to the chat box) must not also
			    answer a drop meant for the fag. */}
			<div
				data-testid="source-drop-zone"
				onDragEnter={(event) => {
					if (!hasFiles(event)) return;
					event.preventDefault();
					event.stopPropagation();
					depth.current++;
					setDragging(true);
				}}
				onDragOver={(event) => {
					if (!hasFiles(event)) return;
					event.preventDefault();
					event.stopPropagation();
					event.dataTransfer.dropEffect = "link";
				}}
				onDragLeave={(event) => {
					if (!hasFiles(event)) return;
					event.stopPropagation();
					depth.current = Math.max(0, depth.current - 1);
					if (depth.current === 0) setDragging(false);
				}}
				onDrop={(event) => {
					if (!hasFiles(event)) return;
					event.preventDefault();
					event.stopPropagation();
					endDrag();
					const resolve = window.lh?.getPathForFile;
					if (!resolve) {
						setNotice(BROWSER_DROP_NOTICE);
						setMode("path");
						requestAnimationFrame(() => pathRef.current?.focus());
						return;
					}
					// Entry metadata is only readable during the event itself.
					const entries = Array.from(event.dataTransfer.items).filter((item) => item.kind === "file");
					const drops: { path: string; kind: "file" | "folder" }[] = [];
					let unreadable = 0;
					for (const [index, file] of Array.from(event.dataTransfer.files).entries()) {
						try {
							const dropped = resolve(file);
							if (!dropped) throw new Error("no path");
							drops.push({ path: dropped, kind: entries[index]?.webkitGetAsEntry?.()?.isDirectory ? "folder" : "file" });
						} catch {
							unreadable++;
						}
					}
					void run(async () => {
						const errors: string[] = [];
						for (const drop of drops) {
							const error = await onAdd(drop);
							if (error) errors.push(error);
						}
						if (unreadable > 0) errors.push("Noen av elementene hadde ingen sti på maskinen og ble hoppet over.");
						return errors.length > 0 ? errors.join(" ") : null;
					});
				}}
				className={cn(
					"flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 text-center transition-colors",
					compact ? "py-6" : "py-9",
					dragging ? "border-primary bg-primary/5" : "border-border bg-card/40",
				)}
			>
				{busy
					? <LoaderCircleIcon className="size-7 animate-spin text-muted-foreground" aria-hidden="true" />
					: <FolderUpIcon className={cn("size-7", dragging ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />}
				<p className="font-ui text-sm font-medium">
					{dragging ? "Slipp for å legge til" : "Dra filer eller mapper hit"}
				</p>
				<p className="max-w-md font-ui text-xs leading-relaxed text-muted-foreground">
					{desktop
						? "Filene blir liggende der de er. Appen husker bare hvor de ligger, og leser dem når du jobber med faget."
						: "Dra-og-slipp av filer virker i skrivebordsappen. Her kan du lime inn stien til en fil eller mappe."}
				</p>
			</div>

			<div className="flex flex-wrap gap-2">
				{tab("path", "Lim inn sti", FolderIcon)}
				{tab("note", "Lim inn notat", StickyNoteIcon)}
				{tab("link", "Legg til lenke", LinkIcon)}
			</div>

			{notice && <p role="status" className="font-ui text-sm text-muted-foreground">{notice}</p>}
			{failure && <p role="alert" className="font-ui text-sm text-destructive">{failure}</p>}

			{mode === "path" && (
				<form
					className="flex flex-col gap-1 rounded-xl border bg-card p-3"
					onSubmit={(e) => {
						e.preventDefault();
						const value = path.trim();
						if (!value || busy) return;
						void run(() => addPath(value, pathKindOrder(value))).then((ok) => {
							if (ok) setPath("");
						});
					}}
				>
					<label htmlFor={pathId} className="font-ui text-xs font-medium">Sti til en fil eller mappe på maskinen</label>
					<div className="flex gap-2">
						<Input
							ref={pathRef}
							id={pathId}
							value={path}
							onChange={(e) => setPath(e.target.value)}
							placeholder="F.eks. /Users/deg/Documents/TTK4100/eksamener"
							spellCheck={false}
							autoComplete="off"
						/>
						<Button type="submit" disabled={!path.trim() || busy}>Legg til</Button>
					</div>
					<p className="font-ui text-xs text-muted-foreground">
						Tips: høyreklikk filen eller mappen i filbehandleren og velg «Kopier som sti» eller «Kopier banenavn».
					</p>
				</form>
			)}

			{mode === "note" && (
				<form
					className="flex flex-col gap-3 rounded-xl border bg-card p-3"
					onSubmit={(e) => {
						e.preventDefault();
						const text = note.trim();
						if (!text || text.length > MAX_NOTE_CHARS || busy) return;
						void run(() => onAdd({ kind: "note", text, ...(noteTitle.trim() ? { title: noteTitle.trim() } : {}) })).then((ok) => {
							if (ok) {
								setNote("");
								setNoteTitle("");
							}
						});
					}}
				>
					<div className="flex flex-col gap-1">
						<label htmlFor={noteTitleId} className="font-ui text-xs font-medium">Tittel (valgfritt)</label>
						<Input id={noteTitleId} value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} placeholder="F.eks. Forelesning 7: stabilitet" />
					</div>
					<div className="flex flex-col gap-1">
						<label htmlFor={noteId} className="font-ui text-xs font-medium">Notat</label>
						<Textarea
							id={noteId}
							value={note}
							onChange={(e) => setNote(e.target.value)}
							placeholder="Lim inn notater, pensumliste, beskjeder fra faglærer …"
							className="min-h-32"
							aria-invalid={note.length > MAX_NOTE_CHARS || undefined}
						/>
						<p className={cn("font-ui text-xs tabular-nums", note.length > MAX_NOTE_CHARS ? "text-destructive" : "text-muted-foreground")}>
							{note.length.toLocaleString("nb-NO")} av {MAX_NOTE_CHARS.toLocaleString("nb-NO")} tegn
							{note.length > MAX_NOTE_CHARS && ". Notatet er for langt: del det opp i flere."}
						</p>
					</div>
					<div><Button type="submit" disabled={!note.trim() || note.length > MAX_NOTE_CHARS || busy}>Lagre notat</Button></div>
				</form>
			)}

			{mode === "link" && (
				<form
					className="flex flex-col gap-3 rounded-xl border bg-card p-3"
					onSubmit={(e) => {
						e.preventDefault();
						const value = url.trim();
						if (!value || busy) return;
						void run(() => onAdd({ kind: "link", url: value, ...(linkTitle.trim() ? { title: linkTitle.trim() } : {}) })).then((ok) => {
							if (ok) {
								setUrl("");
								setLinkTitle("");
							}
						});
					}}
				>
					<div className="flex flex-col gap-1">
						<label htmlFor={urlId} className="font-ui text-xs font-medium">Lenke</label>
						<Input id={urlId} type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="F.eks. https://www.ntnu.no/studier/emner/TTK4100" spellCheck={false} />
					</div>
					<div className="flex flex-col gap-1">
						<label htmlFor={linkTitleId} className="font-ui text-xs font-medium">Tittel (valgfritt)</label>
						<Input id={linkTitleId} value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} placeholder="F.eks. Formelsamling" />
					</div>
					<div><Button type="submit" disabled={!url.trim() || busy}>Legg til lenke</Button></div>
				</form>
			)}
		</div>
	);
}

/** The student's own sources as a list: icon per kind, where it is, and a
 *  remove button. Removing never touches the file itself. */
export function SourceList({ sources, onRemove, emptyText }: {
	sources: readonly CourseSource[];
	onRemove?: (id: string) => void;
	emptyText?: string;
}) {
	if (sources.length === 0) {
		return emptyText ? <p className="font-ui text-sm text-muted-foreground">{emptyText}</p> : null;
	}
	return (
		<ul data-testid="source-list" className="divide-y divide-border/60 rounded-2xl border bg-card px-3">
			{sources.map((source) => {
				const Icon = SOURCE_ICON[source.kind];
				const detail = sourceDetail(source);
				return (
					<li key={source.id} data-testid="source-row" data-kind={source.kind} className="flex items-center gap-3 py-2.5">
						<Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						<div className="min-w-0 flex-1">
							<p className="truncate font-ui text-sm font-medium">
								<span className="sr-only">{SOURCE_KIND_LABEL[source.kind]}: </span>
								{source.url && source.kind !== "note"
									? <a href={source.url} target="_blank" rel="noreferrer" className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">{source.title}</a>
									: source.title}
							</p>
							{detail && <p className="truncate font-ui text-xs text-muted-foreground" title={detail}>{detail}</p>}
						</div>
						{onRemove && !source.auto && (
							<Button variant="ghost" size="icon-sm" onClick={() => onRemove(source.id)} aria-label={`Fjern ${source.title}`}>
								<XIcon aria-hidden="true" />
							</Button>
						)}
					</li>
				);
			})}
		</ul>
	);
}

/** A collapsed block of NTNU text (faglig innhold, læringsutbytte …). */
function NtnuText({ title, text }: { title: string; text?: string }) {
	if (!text?.trim()) return null;
	return (
		<details className="group border-t border-border/60 first:border-t-0">
			<summary className="cursor-pointer list-none rounded-md px-1 py-2.5 font-ui text-sm font-medium outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
				<span className="mr-2 inline-block text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true">›</span>
				{title}
			</summary>
			<p className="whitespace-pre-line px-1 pb-3 pl-5 font-ui text-sm leading-relaxed text-muted-foreground">{text}</p>
		</details>
	);
}

/**
 * KONTEKST: what the app knows about the fag. «Hentet automatisk» is the
 * NTNU course page; «Ditt materiale» is whatever the student adds.
 */
export function SourcesPanel({ course, onAdd, onRemove }: {
	course: Course;
	onAdd: AddSource;
	onRemove: (id: string) => void;
}) {
	const auto = course.sources.filter((source) => source.auto);
	const own = course.sources.filter((source) => !source.auto);
	const fetched = formatExamDate(course.ntnuFetchedAt);
	return (
		<section data-tour="course-sources" data-testid="course-sources" aria-label="Kontekst" className="flex flex-col gap-8">
			<div>
				<h2 className="font-ui text-base font-semibold">Hentet automatisk</h2>
				{course.custom ? (
					<p className="mt-2 font-ui text-sm text-muted-foreground">
						Dette faget la du inn selv, så appen har ikke hentet noe fra NTNU. Legg gjerne inn emnebeskrivelse og pensum under Ditt materiale.
					</p>
				) : (
					<div className="mt-2 rounded-2xl border bg-card p-4">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<p className="flex items-center gap-2 font-ui text-sm font-medium">
								<LandmarkIcon className="size-4 text-muted-foreground" aria-hidden="true" />
								Emnesiden hos NTNU
							</p>
							{course.url && (
								<a href={course.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-sm font-ui text-sm text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
									Åpne emnesiden
									<ExternalLinkIcon className="size-3.5" aria-hidden="true" />
								</a>
							)}
						</div>
						{fetched && <p className="mt-1 font-ui text-xs text-muted-foreground">Sist hentet {fetched}. Velg «Oppdater fra NTNU» i menyen øverst for å hente på nytt.</p>}
						<div className="mt-3">
							<NtnuText title="Faglig innhold" text={course.content} />
							<NtnuText title="Læringsutbytte" text={course.learningOutcome} />
							<NtnuText title="Læringsformer og aktiviteter" text={course.learningMethods} />
							<NtnuText title="Kursmateriell og pensum" text={course.materials} />
						</div>
						{auto.length > 0 && <div className="mt-3"><SourceList sources={auto} /></div>}
					</div>
				)}
			</div>

			<div>
				<h2 className="font-ui text-base font-semibold">Ditt materiale</h2>
				<div className="mt-2 flex flex-col gap-4">
					<SourceAdder onAdd={onAdd} />
					<SourceList sources={own} onRemove={onRemove} emptyText="Du har ikke lagt til noe ennå." />
				</div>
				<p className="mt-4 font-ui text-xs text-muted-foreground">
					Tips: notatene dine kan også importeres til{" "}
					<Link href="/kart" className="rounded-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">kunnskapskartet</Link>
					, så husker appen hva du har lært på tvers av fag.
				</p>
			</div>
		</section>
	);
}
