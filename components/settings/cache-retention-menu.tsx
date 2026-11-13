"use client";

import type { CacheRetention } from "@earendil-works/pi-ai";

const OPTIONS = [
	{ value: undefined, compact: "standard", label: "Pi-standard", description: "Lar valget stå urørt. Pis vanlige oppførsel og miljøvariabler gjelder." },
	{ value: "none", compact: "ikke forespurt", label: "Ikke be om caching", description: "Sender Pis innebygde valg «none». Leverandører kan likevel cache automatisk." },
	{ value: "short", compact: "kort", label: "Kort varighet", description: "Sender Pis innebygde valg «short». Varigheten avhenger av leverandør og modell." },
	{ value: "long", compact: "lang", label: "Lang varighet", description: "Sender Pis innebygde valg «long». Det kan koste mer å skrive til cachen." },
] as const;

export function cacheRetentionLabel(value: CacheRetention | undefined): string {
	return `Cache: ${OPTIONS.find((option) => option.value === value)!.compact}`;
}

export function CacheRetentionMenu({ value, onPick }: {
	value: CacheRetention | undefined;
	onPick: (value: CacheRetention | undefined) => void;
}) {
	return <>
		<div className="border-b border-border px-2 pb-2">
			<p className="text-card-foreground">Cache-varighet</p>
			<p className="mt-1 text-muted-foreground">Styrer hvilken cache-varighet som sendes til Pi. Støtte og varighet avhenger av leverandør og modell. Dette garanterer ikke cache-treff.</p>
		</div>
		{OPTIONS.map((option) => <button
			key={option.value ?? "default"}
			type="button"
			data-testid={`cache-retention-option-${option.value ?? "default"}`}
			aria-pressed={value === option.value}
			onClick={() => onPick(option.value)}
			className={`rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted ${value === option.value ? "bg-muted/60" : ""}`}
		>
			<span className="flex justify-between gap-2 text-card-foreground"><span>{option.label}</span>{value === option.value && <span aria-hidden>✓</span>}</span>
			<span className="mt-1 block text-muted-foreground">{option.description}</span>
		</button>)}
	</>;
}
