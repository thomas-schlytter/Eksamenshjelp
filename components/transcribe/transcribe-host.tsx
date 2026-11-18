"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { OPEN_TRANSCRIBE_EVENT, type TranscribeRequest } from "./transcribe-event.ts";

const TranscribeDialog = lazy(() => import("./transcribe-dialog.tsx").then((m) => ({ default: m.TranscribeDialog })));

/** The global listener for `lh:open-transcribe`. The dialog's code loads
 *  the first time it is asked for; `nonce` gives every opening a fresh state. */
export function TranscribeHost() {
	const [request, setRequest] = useState<{ nonce: number; detail: TranscribeRequest } | null>(null);
	useEffect(() => {
		const onOpen = (event: Event) => {
			const detail = (event as CustomEvent<TranscribeRequest>).detail;
			if (!(detail?.image instanceof Blob)) return;
			setRequest((prev) => ({ nonce: (prev?.nonce ?? 0) + 1, detail }));
		};
		window.addEventListener(OPEN_TRANSCRIBE_EVENT, onOpen);
		return () => window.removeEventListener(OPEN_TRANSCRIBE_EVENT, onOpen);
	}, []);
	if (!request) return null;
	return (
		<Suspense fallback={null}>
			<TranscribeDialog key={request.nonce} request={request.detail} onClose={() => setRequest(null)} />
		</Suspense>
	);
}
