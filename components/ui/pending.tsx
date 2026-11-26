import { LoaderCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * THE WAITING STATE, one look everywhere (2026-11-26): a button that waits
 * for the server shows the spinner in place of its icon (or before its
 * label), is aria-busy, and is disabled until the answer is in.
 *
 *   <Button pending={saving}>…</Button>     the Button prop (ui/button.tsx)
 *   <Spinner />                             for buttons that are not <Button>
 *
 * The spinner turns only when motion is welcome (motion-safe); under
 * reduced motion it stands still, and the disabled state carries it.
 */
export function Spinner({ className }: { className?: string }) {
	return <LoaderCircleIcon data-pending-spinner="" className={cn("motion-safe:animate-spin", className)} aria-hidden="true" />;
}

