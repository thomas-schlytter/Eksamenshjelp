"use client";

import { useId, type ComponentType } from "react";
import { CheckCheckIcon, HashIcon, LayersIcon, ListChecksIcon, PlayIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { flashcardCandidates, parseFlashcardSetup, DEFAULT_FLASHCARD_SETUP } from "@/src/core";
import type { Flashcard, FlashcardProgress, FlashcardSetup } from "./flashcard-types";

/**
 * «Før runden»: the setup menu (owner-approved plan, 2026-11-26). One
 * column, the label with its icon above each line, one choice marked per
 * line in a segmented control: Svar, Antall, Kort, Type. The last choice is
 * remembered on this device.
 */

const STORAGE_KEY = "lh-flashcard-setup";

/** The remembered setup, or the default (storage may be unavailable). */
export function loadFlashcardSetup(): FlashcardSetup {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		return raw ? parseFlashcardSetup(JSON.parse(raw)) : DEFAULT_FLASHCARD_SETUP;
	} catch {
		return DEFAULT_FLASHCARD_SETUP;
	}
}

export function saveFlashcardSetup(setup: FlashcardSetup): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(setup));
	} catch { /* a private window: the choice just isn't remembered */ }
}

interface Choice<T> {
	value: T;
	label: string;
	/** A small count after the label («Bare bomkort 4»). */
	count?: number;
}

/** One line of segment buttons (a radio group). */
function Segments<T extends string | number>({ name, field, value, choices, onChange }: {
	/** The label's id (the group's accessible name). */
	name: string;
	field: keyof FlashcardSetup;
	value: T;
	choices: Choice<T>[];
	onChange: (value: T) => void;
}) {
	return (
		<div role="radiogroup" aria-labelledby={name} className="flex w-full rounded-md border bg-muted p-0.5">
			{choices.map((choice) => {
				const selected = choice.value === value;
				return (
					<button
						key={String(choice.value)}
						type="button"
						role="radio"
						aria-checked={selected}
						data-testid={`flashcard-setup-${field}-${choice.value}`}
						onClick={() => onChange(choice.value)}
						className={cn(
							"flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 font-ui text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
							selected ? "bg-primary font-medium text-primary-foreground shadow-xs" : "text-foreground hover:bg-background",
						)}
					>
						<span className="truncate">{choice.label}</span>
						{choice.count !== undefined && (
							<span className={cn("text-xs tabular-nums", selected ? "text-primary-foreground/75" : "text-muted-foreground")}>{choice.count}</span>
						)}
					</button>
				);
			})}
		</div>
	);
}

function Line({ id, icon: Icon, label, children }: { id: string; icon: ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-1.5">
			<span id={id} className="flex items-center gap-2 font-ui text-sm font-medium">
				<Icon className="size-4 text-muted-foreground" aria-hidden="true" />
				{label}
			</span>
			{children}
		</div>
	);
}

/** How many cards the round would get. */
export function roundSize(deck: { cards: Flashcard[]; progress: Record<string, FlashcardProgress> }, setup: FlashcardSetup): number {
	const pool = flashcardCandidates(deck, setup).length;
	return setup.count === "all" ? pool : Math.min(setup.count, pool);
}

export function FlashcardSetupMenu({ deck, setup, onChange, onStart }: {
	deck: { cards: Flashcard[]; progress: Record<string, FlashcardProgress> };
	setup: FlashcardSetup;
	onChange: (setup: FlashcardSetup) => void;
	onStart: () => void;
}) {
	const id = useId();
	const set = (patch: Partial<FlashcardSetup>) => onChange({ ...setup, ...patch });
	const poolCount = (pool: FlashcardSetup["pool"]) => flashcardCandidates(deck, { pool, type: setup.type }).length;
	const size = roundSize(deck, setup);
	return (
		<section data-testid="flashcard-setup" aria-label="Oppsett for runden" className="flex w-full flex-col gap-5">
			<Line id={`${id}-reveal`} icon={CheckCheckIcon} label="Svar">
				<Segments
					name={`${id}-reveal`}
					field="reveal"
					value={setup.reveal}
					onChange={(reveal) => set({ reveal })}
					choices={[{ value: "now", label: "Med en gang" }, { value: "end", label: "Til slutt" }]}
				/>
			</Line>
			<Line id={`${id}-count`} icon={HashIcon} label="Antall">
				<Segments
					name={`${id}-count`}
					field="count"
					value={setup.count}
					onChange={(count) => set({ count })}
					choices={[{ value: 10, label: "10" }, { value: 20, label: "20" }, { value: "all", label: "Alle" }]}
				/>
			</Line>
			<Line id={`${id}-pool`} icon={LayersIcon} label="Kort">
				<Segments
					name={`${id}-pool`}
					field="pool"
					value={setup.pool}
					onChange={(pool) => set({ pool })}
					choices={[
						{ value: "mixed", label: "Blandet" },
						{ value: "missed", label: "Bare bomkort", count: poolCount("missed") },
						{ value: "new", label: "Bare nye", count: poolCount("new") },
					]}
				/>
			</Line>
			<Line id={`${id}-type`} icon={ListChecksIcon} label="Type">
				<Segments
					name={`${id}-type`}
					field="type"
					value={setup.type}
					onChange={(type) => set({ type })}
					choices={[{ value: "both", label: "Begge" }, { value: "single", label: "Ett valg" }, { value: "multi", label: "Flere valg" }]}
				/>
			</Line>
			<div className="flex items-center justify-between gap-3 border-t pt-4">
				<span className="font-ui text-sm text-muted-foreground" data-testid="flashcard-round-size">
					{size === 0 ? "Ingen kort passer valgene." : `${size} kort i runden`}
				</span>
				<Button size="lg" onClick={onStart} disabled={size === 0} data-testid="flashcard-start">
					<PlayIcon aria-hidden="true" />
					Start
				</Button>
			</div>
		</section>
	);
}
