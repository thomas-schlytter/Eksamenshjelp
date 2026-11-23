"use client";

import { useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, LightbulbIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToolContentResponse } from "@/components/ai-elements/message";

/**
 * THE HINT BUTTON (fase 4, 2026-11 — «oppgaver som på eksamen»): a task
 * arrives as on an exam, the text alone. The hints the agent authored with
 * it stay hidden until the learner presses «Hint»; then he steps through
 * them himself — → opens the next one, ← goes back without hiding what he
 * has already seen. No model turn: the hints ride the call's arguments, so
 * every step is instant. `revealed` (the high-water mark) is owned by the
 * parent, which sends it with the answer.
 */
export function HintStepper({
	hints,
	revealed,
	onReveal,
}: {
	hints: readonly string[];
	/** How many hints have been opened so far (0 = none). */
	revealed: number;
	onReveal: (revealed: number) => void;
}) {
	const [index, setIndex] = useState(() => Math.max(0, Math.min(hints.length, revealed) - 1));
	if (hints.length === 0) return null;
	if (revealed <= 0) {
		return (
			<Button
				type="button"
				variant="ghost"
				size="xs"
				data-testid="hint-open"
				onClick={() => {
					setIndex(0);
					onReveal(1);
				}}
				className="text-muted-foreground"
			>
				<LightbulbIcon aria-hidden />
				Hint
			</Button>
		);
	}
	const shown = Math.min(index, hints.length - 1);
	const go = (next: number) => {
		setIndex(next);
		if (next + 1 > revealed) onReveal(next + 1);
	};
	const nextIsNew = shown + 1 >= revealed;
	return (
		<div data-testid="hint-stepper" className="rounded-lg border border-gold/50 bg-gold-soft/30 px-3 py-2 text-sm">
			<div className="flex items-center gap-2 text-xs text-muted-foreground">
				<LightbulbIcon className="size-3.5 shrink-0 text-gold-ink" aria-hidden />
				<span data-testid="hint-position" aria-live="polite" className="font-medium uppercase tracking-wide">
					Hint {shown + 1} av {hints.length}
				</span>
				<div className="ml-auto flex items-center gap-0.5">
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						data-testid="hint-prev"
						aria-label="Forrige hint"
						title="Forrige hint"
						disabled={shown === 0}
						onClick={() => go(shown - 1)}
					>
						<ChevronLeftIcon />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						data-testid="hint-next"
						aria-label={nextIsNew ? "Vis neste hint" : "Neste hint"}
						title={nextIsNew ? "Vis neste hint" : "Neste hint"}
						disabled={shown >= hints.length - 1}
						onClick={() => go(shown + 1)}
					>
						<ChevronRightIcon />
					</Button>
				</div>
			</div>
			<div data-testid="hint-text" className="mt-1">
				<ToolContentResponse>{hints[shown]!}</ToolContentResponse>
			</div>
		</div>
	);
}
