"use client";

import { useRef, useState } from "react";
import { FileUpIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { quoteFilePath } from "@/src/core";
import { Hint } from "@/components/ui/hint";

/**
 * «Legg inn besvarelse» (fase 5): hand the agent a worked answer as FILES —
 * PDFs and images, one or several. Picked files become quoted path chips in
 * the draft, exactly like dropped files; the agent then reads them itself
 * with `read` (PDFs page by page, with page images for handwriting). A file
 * with no path of its own (a pasted screenshot, a browser build's pick) is
 * saved under the data folder first (/api/attachments).
 *
 * Used by the chat composer and the question dock's answer field.
 */

export const ANSWER_LABEL = "Legg inn besvarelse";
/** The draft's lead when the learner uploads into an empty field. */
export const ANSWER_LEAD = "Her er besvarelsen min:";
export const ANSWER_ACCEPT = "application/pdf,.pdf,image/*";

/** Paths onto a draft: an empty draft gets the lead, otherwise the chips
 *  join the text after a space (the dictation separator rule). */
export function withAnswerPaths(draft: string, paths: readonly string[]): string {
	const chips = paths.map(quoteFilePath).join(" ");
	if (!chips) return draft;
	const current = draft.replace(/\s+$/, "");
	return current ? `${current} ${chips}` : `${ANSWER_LEAD} ${chips}`;
}

/** The first image among pasted files, if any. */
export function firstImageFile(files: Iterable<File> | ArrayLike<File> | null | undefined): File | null {
	for (const file of Array.from(files ?? [])) if (file.type.startsWith("image/")) return file;
	return null;
}

/** Save bytes that have no path on disk; answers the saved file's path. */
export async function saveAttachment(file: Blob): Promise<string> {
	const res = await fetch("/api/attachments", {
		method: "POST",
		headers: { "content-type": file.type || "application/octet-stream" },
		body: file,
	});
	const body = (await res.json().catch(() => null)) as { path?: unknown; error?: unknown } | null;
	if (!res.ok || typeof body?.path !== "string") {
		throw new Error(typeof body?.error === "string" ? body.error : "Klarte ikke å legge ved filen.");
	}
	return body.path;
}

export interface FilesToPathsDeps {
	/** Electron's webUtils.getPathForFile via the preload ("" = no path). */
	resolve?: (file: File) => string;
	save: (file: Blob) => Promise<string>;
}

/** Each file's path: its own on disk when it has one, else a saved copy.
 *  Order is kept; a file that fails is counted, never silently dropped. */
export async function filesToPaths(files: readonly File[], deps: FilesToPathsDeps): Promise<{ paths: string[]; failed: string[] }> {
	const paths: string[] = [];
	const failed: string[] = [];
	for (const file of files) {
		let own = "";
		try { own = deps.resolve?.(file) ?? ""; } catch { own = ""; }
		try {
			if (own) {
				quoteFilePath(own); // the chip rule: a single-line rooted path
				paths.push(own);
			} else {
				paths.push(await deps.save(file));
			}
		} catch (err) {
			failed.push(err instanceof Error ? err.message : String(err));
		}
	}
	return { paths, failed };
}

/** The default deps: the desktop bridge when present, the save route always. */
export function answerFileDeps(): FilesToPathsDeps {
	const bridge = typeof window !== "undefined" ? window.lh : undefined;
	return { resolve: bridge?.getPathForFile, save: saveAttachment };
}

function failureNotice(failed: readonly string[]): string {
	if (failed.length === 0) return "";
	return failed.length === 1 ? failed[0]! : `${failed.length} filer kunne ikke legges ved. ${failed[0]}`;
}

/**
 * The button + its hidden file picker. `onPaths` receives the resolved paths
 * (never empty); the caller decides where they go in its draft.
 */
export function AnswerUploadButton({
	onPaths,
	className,
	testId = "answer-upload-button",
}: {
	onPaths: (paths: string[]) => void;
	className?: string;
	testId?: string;
}) {
	const picker = useRef<HTMLInputElement>(null);
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState("");
	const pick = async (files: File[]) => {
		if (files.length === 0) return;
		setBusy(true);
		setNotice("");
		try {
			const { paths, failed } = await filesToPaths(files, answerFileDeps());
			if (paths.length > 0) onPaths(paths);
			setNotice(failureNotice(failed));
		} finally {
			setBusy(false);
		}
	};
	return (
		<span className="relative inline-flex shrink-0">
			<input
				ref={picker}
				type="file"
				accept={ANSWER_ACCEPT}
				multiple
				hidden
				data-testid={`${testId}-file`}
				onChange={(e) => {
					const files = Array.from(e.target.files ?? []);
					e.target.value = "";
					void pick(files);
				}}
			/>
			<Hint label={ANSWER_LABEL}>
				<button
					type="button"
					data-testid={testId}
					aria-label={ANSWER_LABEL}
					disabled={busy}
					onClick={() => picker.current?.click()}
					className={cn(
						"flex size-10 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40",
						className,
					)}
				>
					<FileUpIcon className="size-5" aria-hidden />
				</button>
			</Hint>
			{notice && (
				<span role="status" className="absolute right-0 bottom-full z-50 mb-2 flex w-max max-w-72 items-center gap-2 rounded-md border bg-card px-3 py-2 font-ui text-xs shadow-sm">
					<span>{notice}</span>
					<button type="button" aria-label="Lukk meldingen om vedlegg" onClick={() => setNotice("")} className="shrink-0 rounded-sm p-1 hover:bg-accent">
						<XIcon className="size-3" aria-hidden />
					</button>
				</span>
			)}
		</span>
	);
}
