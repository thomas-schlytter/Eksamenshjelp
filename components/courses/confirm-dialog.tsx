"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import { Button } from "@/components/ui/button";

/**
 * A small confirmation for the fag pages' irreversible actions (slett fag,
 * lag temaliste på nytt). Rendered in place (not portaled) and marked
 * `data-lh-modal`, so the page's Tab chain stays inside it while open.
 * Esc and a backdrop click cancel; focus starts on «Avbryt», the safe
 * choice.
 */
export function ConfirmDialog({ open, title, children, confirmLabel, destructive = false, busy = false, error, onConfirm, onCancel }: {
	open: boolean;
	title: string;
	children: ReactNode;
	confirmLabel: string;
	destructive?: boolean;
	busy?: boolean;
	error?: string | null;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	const titleId = useId(), bodyId = useId();
	const cancelRef = useRef<HTMLButtonElement>(null);
	const backdrop = useBackdropDismiss(() => {
		if (!busy) onCancel();
	});
	useEffect(() => {
		if (!open) return;
		cancelRef.current?.focus();
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			// Claimed at the document: Esc closes this, never also a turn.
			e.preventDefault();
			e.stopPropagation();
			if (!busy) onCancel();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, busy, onCancel]);
	if (!open) return null;
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4" {...backdrop}>
			<div
				role="alertdialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={bodyId}
				data-lh-modal
				data-testid="confirm-dialog"
				className="w-full max-w-md rounded-2xl border bg-card p-5 shadow-xl"
			>
				<h2 id={titleId} className={`font-ui text-base font-semibold ${destructive ? "text-destructive" : ""}`}>{title}</h2>
				<div id={bodyId} className="mt-2 font-ui text-sm leading-relaxed text-muted-foreground">{children}</div>
				{error && <p role="alert" className="mt-3 font-ui text-sm text-destructive">{error}</p>}
				<div className="mt-5 flex flex-wrap justify-end gap-2">
					<Button ref={cancelRef} variant="outline" onClick={onCancel} disabled={busy}>Avbryt</Button>
					<Button variant={destructive ? "destructive" : "default"} onClick={onConfirm} disabled={busy}>
						{busy && <LoaderCircleIcon className="animate-spin" aria-hidden="true" />}
						{confirmLabel}
					</Button>
				</div>
			</div>
		</div>
	);
}
