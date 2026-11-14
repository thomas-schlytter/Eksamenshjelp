"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { OPEN_LEGACY_IMPORT_EVENT } from "./legacy-import-event.ts";

const LegacyImportDialog = lazy(() => import("./legacy-import.tsx").then((m) => ({ default: m.LegacyImportDialog })));

/** The global listener for `lh:open-legacy-import`. The dialog's code loads
 *  the first time it is asked for; `nonce` gives every opening a fresh state. */
export function LegacyImportHost() {
	const [request, setRequest] = useState<{ nonce: number; path?: string } | null>(null);
	useEffect(() => {
		const onOpen = (event: Event) => {
			const path = (event as CustomEvent<{ path?: unknown }>).detail?.path;
			setRequest((prev) => ({ nonce: (prev?.nonce ?? 0) + 1, ...(typeof path === "string" ? { path } : {}) }));
		};
		window.addEventListener(OPEN_LEGACY_IMPORT_EVENT, onOpen);
		return () => window.removeEventListener(OPEN_LEGACY_IMPORT_EVENT, onOpen);
	}, []);
	if (!request) return null;
	return (
		<Suspense fallback={null}>
			<LegacyImportDialog key={request.nonce} initialPath={request.path} onClose={() => setRequest(null)} />
		</Suspense>
	);
}
