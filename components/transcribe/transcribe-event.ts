/**
 * The one way to open «Les av skjermbilde» from anywhere: a window event
 * the global host (transcribe-host.tsx, mounted by the help provider)
 * answers. The composer's paste and button and the session's drop zone all
 * go through it.
 */
export const OPEN_TRANSCRIBE_EVENT = "lh:open-transcribe";

export interface TranscribeRequest {
	/** The image itself (a pasted clipboard image has no file behind it). */
	image: Blob;
	/** Where the approved text goes. Absent = the session's primary input. */
	insert?: (text: string) => void;
	/** Offered as «Legg ved som fil i stedet» when the image is a file on
	 *  disk: attaches its path the way a dropped file always did. */
	attachAsFile?: () => void;
}

export function openTranscribe(request: TranscribeRequest): void {
	window.dispatchEvent(new CustomEvent<TranscribeRequest>(OPEN_TRANSCRIBE_EVENT, { detail: request }));
}

/** The first image among pasted/dropped/picked files, if any. */
export function firstImageFile(files: Iterable<File> | ArrayLike<File> | null | undefined): File | null {
	for (const file of Array.from(files ?? [])) if (file.type.startsWith("image/")) return file;
	return null;
}

/** Join an approved transcription onto a draft: its own paragraph. */
export function joinTranscription(current: string, text: string): string {
	const draft = current.replace(/\s+$/, "");
	return draft ? `${draft}\n\n${text}` : text;
}
