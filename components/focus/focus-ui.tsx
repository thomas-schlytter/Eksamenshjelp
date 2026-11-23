"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { CheckIcon, CoffeeIcon, ClockIcon, PauseIcon, PlayIcon, SquareIcon, TimerIcon, XIcon } from "lucide-react";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";
import {
	clockLabel,
	countdownLabel,
	focusFinishAt,
	focusProgress,
	focusRemainingMs,
	FOCUS_LIMITS,
	FOCUS_PRESETS,
	isFocusPaused,
	normalizeFocusConfig,
	type FocusConfig,
	type FocusOrigin,
	type FocusState,
} from "@/src/core";
import {
	focusActions,
	focusSnapshot,
	lastFocusConfig,
	registerHeaderChip,
	requestEndSession,
	setFocusToast,
	tickFocus,
	useFocusSnapshot,
	type FocusToast,
} from "./focus-store";

/**
 * FOKUS, the UI (fase 7b, sketch D-chat + Flamme-og-lockin):
 *
 *   FocusControl  — the chat header's «Fokus» button, or the running chip
 *   FocusSidebar  — the sidebar's small copy, when no chat header shows it
 *   FocusRuntime  — mounted once in the app shell: ticks the timer, sends
 *                   the system notification and the sound, shows the toasts
 */

/** A re-render every second while something counts down. */
function useNow(active: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		setNow(Date.now());
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [active]);
	return now;
}

function phaseLabel(state: FocusState): string {
	if (state.phase === "done") return "FERDIG";
	return `${state.phase === "work" ? "FOKUS" : "PAUSE"} ${state.round}/${state.config.rounds}`;
}

/** The small progress ring (22px in the header). */
export function FocusRing({ progress, tone = "work", size = 22, label }: {
	progress: number;
	tone?: "work" | "break";
	size?: number;
	label?: string;
}) {
	const r = 9, c = 2 * Math.PI * r;
	return (
		<svg width={size} height={size} viewBox="0 0 22 22" className="shrink-0" {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
			<circle cx="11" cy="11" r={r} fill="none" stroke="var(--accent)" strokeWidth="3" />
			<circle
				cx="11"
				cy="11"
				r={r}
				fill="none"
				stroke={tone === "break" ? "var(--status-green)" : "var(--primary)"}
				strokeWidth="3"
				strokeDasharray={`${Math.max(0, Math.min(1, progress)) * c} ${c}`}
				transform="rotate(-90 11 11)"
			/>
		</svg>
	);
}

const CHIP_BUTTON = "lh-no-drag inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-sm text-primary outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** The running timer: ring, «FOKUS r/R», the countdown, pause/fortsett
 *  (or «Start pausen» while a break is due) and stop. */
export function FocusChip({ state, now, compact = false }: { state: FocusState; now: number; compact?: boolean }) {
	const paused = isFocusPaused(state);
	const remaining = focusRemainingMs(state, now);
	const progress = focusProgress(state, now);
	const tone = state.phase === "break" || state.phase === "break-due" ? "break" : "work";
	const percent = Math.round(progress * 100);
	return (
		<div
			data-testid="focus-chip"
			data-phase={state.phase}
			data-paused={paused || undefined}
			className={cn(
				"lh-no-drag flex shrink-0 items-center gap-2 rounded-md border bg-muted/60",
				compact ? "h-9 w-full px-2" : "h-10 pl-2.5 pr-1",
			)}
		>
			{state.phase === "done" ? (
				<CheckIcon className="size-4 shrink-0 text-status-green" aria-hidden="true" />
			) : (
				<FocusRing progress={progress} tone={tone} label={`${phaseLabel(state)}, ${percent} prosent ferdig`} />
			)}
			<div className="flex min-w-0 flex-1 flex-col leading-tight">
				<span className="font-ui text-[10px] font-bold tracking-wider text-muted-foreground">
					{phaseLabel(state)}{paused ? " · PAUSET" : ""}
				</span>
				<span className="font-title text-base font-semibold tabular-nums" aria-live="off">
					{state.phase === "done" ? "Fokus ferdig" : countdownLabel(remaining)}
				</span>
			</div>
			{state.phase === "break-due" ? (
				<Hint label="Start pausen" side="bottom">
					<button type="button" className={CHIP_BUTTON} onClick={focusActions.startBreak} aria-label="Start pausen" data-testid="focus-start-break">
						<CoffeeIcon className="size-3.5" aria-hidden="true" />
					</button>
				</Hint>
			) : state.phase !== "done" && (
				<Hint label={paused ? "Fortsett" : "Sett timeren på pause"} side="bottom">
					<button
						type="button"
						className={CHIP_BUTTON}
						onClick={paused ? focusActions.resume : focusActions.pause}
						aria-label={paused ? "Fortsett timeren" : "Sett timeren på pause"}
						data-testid="focus-pause"
					>
						{paused ? <PlayIcon className="size-3.5" aria-hidden="true" /> : <PauseIcon className="size-3.5" aria-hidden="true" />}
					</button>
				</Hint>
			)}
			<Hint label={state.phase === "done" ? "Lukk" : "Stopp fokus"} side="bottom">
				<button
					type="button"
					className={CHIP_BUTTON}
					onClick={focusActions.stop}
					aria-label={state.phase === "done" ? "Lukk fokus" : "Stopp fokus"}
					data-testid="focus-stop"
				>
					{state.phase === "done" ? <XIcon className="size-3.5" aria-hidden="true" /> : <SquareIcon className="size-3 fill-current" aria-hidden="true" />}
				</button>
			</Hint>
		</div>
	);
}

// ─── the setup ───────────────────────────────────────────────────────────────

/** The draft as typed (strings: a half-typed field must not snap). */
interface Draft { work: string; brk: string; rounds: string; sound: boolean }

const toDraft = (c: FocusConfig): Draft => ({ work: String(c.workMinutes), brk: String(c.breakMinutes), rounds: String(c.rounds), sound: c.sound });
const fromDraft = (d: Draft): FocusConfig => normalizeFocusConfig({ workMinutes: d.work, breakMinutes: d.brk, rounds: d.rounds, sound: d.sound });

/** «Start fokus»: presets, own numbers, sound, the finish time. Pure body
 *  (the dialog shell is FocusSetupDialog). */
export function FocusSetupForm({ initial, now, onStart }: { initial: FocusConfig; now: number; onStart: (config: FocusConfig) => void }) {
	const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
	const ids = { work: useId(), brk: useId(), rounds: useId(), sound: useId(), title: useId() };
	const config = fromDraft(draft);
	const field = "h-10 w-full rounded-md border border-input bg-background px-2.5 font-title text-base tabular-nums outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
	return (
		<form
			data-testid="focus-setup"
			className="flex flex-col gap-4"
			onSubmit={(e) => {
				e.preventDefault();
				onStart(config);
			}}
		>
			<div>
				<p className="font-ui text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Start fokus</p>
				<h2 id={ids.title} className="mt-1.5 font-title text-xl font-semibold tracking-tight">Hvor lenge vil du jobbe?</h2>
			</div>
			<div className="grid grid-cols-3 gap-2.5" role="group" aria-label="Forvalg">
				{FOCUS_PRESETS.map((preset) => {
					const chosen = config.workMinutes === preset.work && config.breakMinutes === preset.brk;
					return (
						<button
							key={preset.work}
							type="button"
							aria-pressed={chosen}
							onClick={() => setDraft((d) => ({ ...d, work: String(preset.work), brk: String(preset.brk) }))}
							className={cn(
								"flex cursor-pointer flex-col items-start gap-0.5 rounded-md border bg-card px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
								chosen ? "border-2 border-primary bg-muted" : "border-input",
							)}
						>
							<span className="font-title text-base font-semibold">{preset.work} + {preset.brk}</span>
							<span className="font-ui text-xs text-muted-foreground">{chosen ? "valgt" : preset.hint}</span>
						</button>
					);
				})}
			</div>
			<div className="grid grid-cols-3 gap-2.5">
				<div className="flex flex-col gap-1.5">
					<label htmlFor={ids.work} className="font-ui text-xs font-semibold">Jobb (min)</label>
					<input id={ids.work} type="number" inputMode="numeric" min={FOCUS_LIMITS.work.min} max={FOCUS_LIMITS.work.max} value={draft.work} onChange={(e) => setDraft((d) => ({ ...d, work: e.target.value }))} className={field} data-testid="focus-work" />
				</div>
				<div className="flex flex-col gap-1.5">
					<label htmlFor={ids.brk} className="font-ui text-xs font-semibold">Pause (min)</label>
					<input id={ids.brk} type="number" inputMode="numeric" min={FOCUS_LIMITS.brk.min} max={FOCUS_LIMITS.brk.max} value={draft.brk} onChange={(e) => setDraft((d) => ({ ...d, brk: e.target.value }))} className={field} data-testid="focus-break" />
				</div>
				<div className="flex flex-col gap-1.5">
					<label htmlFor={ids.rounds} className="font-ui text-xs font-semibold">Runder</label>
					<input id={ids.rounds} type="number" inputMode="numeric" min={FOCUS_LIMITS.rounds.min} max={FOCUS_LIMITS.rounds.max} value={draft.rounds} onChange={(e) => setDraft((d) => ({ ...d, rounds: e.target.value }))} className={field} data-testid="focus-rounds" />
				</div>
			</div>
			<label htmlFor={ids.sound} className="flex cursor-pointer items-center gap-2.5 font-ui text-sm">
				<input id={ids.sound} type="checkbox" checked={draft.sound} onChange={(e) => setDraft((d) => ({ ...d, sound: e.target.checked }))} className="size-4 accent-[var(--primary)]" data-testid="focus-sound" />
				Varsle med lyd når det er pause
			</label>
			<div className="flex items-center justify-between gap-3 pt-1">
				<span className="font-ui text-sm text-muted-foreground" data-testid="focus-finish">Ferdig ca. kl. {clockLabel(focusFinishAt(config, now))}</span>
				<Button type="submit" size="lg" data-testid="focus-start">Start fokus</Button>
			</div>
		</form>
	);
}

function FocusSetupDialog({ open, onClose, onStart }: { open: boolean; onClose: () => void; onStart: (config: FocusConfig) => void }) {
	const panel = useRef<HTMLDivElement>(null);
	const backdrop = useBackdropDismiss(onClose);
	const now = useNow(open);
	useEffect(() => {
		if (!open) return;
		const start = panel.current?.querySelector<HTMLElement>("[aria-pressed='true']") ?? panel.current?.querySelector<HTMLElement>("[data-testid='focus-work']");
		start?.focus();
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			e.stopPropagation();
			onClose();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, onClose]);
	if (!open) return null;
	return (
		<div className="lh-no-drag fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4" {...backdrop}>
			<div ref={panel} role="dialog" aria-modal="true" aria-label="Start fokus" data-lh-modal className="relative w-full max-w-lg rounded-lg border bg-card p-6 shadow-xl">
				<button
					type="button"
					onClick={onClose}
					aria-label="Lukk"
					className="absolute right-3 top-3 cursor-pointer rounded-sm p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
				>
					<XIcon className="size-4" aria-hidden="true" />
				</button>
				<FocusSetupForm initial={lastFocusConfig()} now={now} onStart={onStart} />
			</div>
		</div>
	);
}

/** Ask the browser (not Electron: it has its own bridge) for notifications. */
function askBrowserNotifications() {
	if (typeof window === "undefined" || window.lh?.notify || !("Notification" in window)) return;
	if (Notification.permission === "default") void Notification.requestPermission().catch(() => {});
}

/** The chat header's control: «Fokus», or the running chip. */
export function FocusControl({ origin }: { origin?: FocusOrigin }) {
	const { state } = useFocusSnapshot();
	const [open, setOpen] = useState(false);
	const now = useNow(state !== null && state.phase !== "done");
	useEffect(() => registerHeaderChip(), []);
	if (state) return <FocusChip state={state} now={now} />;
	return (
		<>
			<Hint label="Start en fokusøkt med pauser" side="bottom">
				<Button type="button" variant="outline" className="lh-no-drag shrink-0" onClick={() => setOpen(true)} data-testid="focus-button">
					<TimerIcon aria-hidden="true" />
					Fokus
				</Button>
			</Hint>
			<FocusSetupDialog
				open={open}
				onClose={() => setOpen(false)}
				onStart={(config) => {
					askBrowserNotifications();
					focusActions.start(config, origin);
					setOpen(false);
				}}
			/>
		</>
	);
}

/** The sidebar's small copy, only while no chat header shows the chip. */
export function FocusSidebar() {
	const { state, headerChips } = useFocusSnapshot();
	const now = useNow(state !== null && state.phase !== "done" && headerChips === 0);
	if (!state || headerChips > 0) return null;
	return (
		<div className="mx-3 mb-2" data-testid="sidebar-focus">
			<FocusChip state={state} now={now} compact />
		</div>
	);
}

// ─── the runtime: ticks, notifications, sound, toasts ────────────────────────

/** A short, soft two-note chime (WebAudio; no file, no dependency). */
export function playChime() {
	try {
		const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!Ctx) return;
		const ctx = new Ctx();
		const start = ctx.currentTime + 0.02;
		[659.25, 880].forEach((freq, i) => {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = "sine";
			osc.frequency.value = freq;
			const t = start + i * 0.22;
			gain.gain.setValueAtTime(0, t);
			gain.gain.linearRampToValueAtTime(0.12, t + 0.03);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
			osc.connect(gain).connect(ctx.destination);
			osc.start(t);
			osc.stop(t + 0.95);
		});
		setTimeout(() => void ctx.close().catch(() => {}), 1600);
	} catch { /* no audio: the toast and the notification still show */ }
}

function systemNotify(title: string, body: string) {
	try {
		if (window.lh?.notify) {
			void window.lh.notify(title, body).catch(() => {});
			return;
		}
		if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body });
	} catch { /* the in-app toast still shows */ }
}

/** The words of a toast: title and body (also the system notification). */
export function focusToastText(toast: FocusToast): { title: string; body: string } {
	if (toast.kind === "break-due") {
		return {
			title: `Pause! ${toast.breakMinutes} ${toast.breakMinutes === 1 ? "minutt" : "minutter"}`,
			body: `Runde ${toast.round} av ${toast.rounds} er ferdig. Reis deg og strekk på beina.`,
		};
	}
	if (toast.kind === "break-ended") {
		return { title: "Pausen er over", body: `Runde ${toast.round} av ${toast.rounds}: ${toast.workMinutes} minutter.` };
	}
	return {
		title: "Fokus ferdig",
		body: `${toast.rounds} ${toast.rounds === 1 ? "runde" : "runder"} er gjort. Avslutt økta når du er klar.`,
	};
}

const TOAST_SHELL = "lh-toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3.5 rounded-lg border border-l-4 bg-card p-4 shadow-[0_10px_30px_rgba(28,43,74,0.12)]";

/** The toast body (pure: props in, markup out). */
export function FocusToastCard({ toast, onStartBreak, onSkip, onClose, onOpenOrigin }: {
	toast: FocusToast;
	onStartBreak: () => void;
	onSkip: () => void;
	onClose: () => void;
	/** «Avslutt økt» in the chat the timer was started from. */
	onOpenOrigin?: () => void;
}) {
	const { title, body } = focusToastText(toast);
	const tone = toast.kind === "break-due" ? "border-l-status-green" : toast.kind === "done" ? "border-l-gold" : "border-l-primary";
	return (
		<div role="status" data-testid="focus-toast" data-kind={toast.kind} className={cn(TOAST_SHELL, tone)}>
			<span
				className={cn(
					"flex size-7 shrink-0 items-center justify-center rounded-full",
					toast.kind === "break-due" ? "bg-status-green-soft text-status-green" : toast.kind === "done" ? "bg-gold-soft text-gold-ink" : "bg-accent text-primary",
				)}
				aria-hidden="true"
			>
				{toast.kind === "break-due" ? <CoffeeIcon className="size-3.5" /> : toast.kind === "done" ? <CheckIcon className="size-3.5" /> : <ClockIcon className="size-3.5" />}
			</span>
			<div className="min-w-0 flex-1">
				<p className="font-title text-base font-semibold">{title}</p>
				<p className="mt-1 font-ui text-sm text-muted-foreground">{body}</p>
				{toast.kind === "break-due" && (
					<div className="mt-3 flex gap-2">
						<Button size="sm" className="bg-status-green text-status-green-foreground hover:bg-status-green/90" onClick={onStartBreak} data-testid="focus-toast-start-break">Start pausen</Button>
						<Button size="sm" variant="outline" onClick={onSkip} data-testid="focus-toast-skip">Hopp over</Button>
					</div>
				)}
				{toast.kind === "done" && onOpenOrigin && toast.origin && (
					<div className="mt-3">
						<Button size="sm" onClick={onOpenOrigin} data-testid="focus-toast-end-session">Avslutt økt i {toast.origin.label}</Button>
					</div>
				)}
			</div>
			<button
				type="button"
				onClick={onClose}
				aria-label="Lukk"
				className="shrink-0 cursor-pointer rounded-sm p-0.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
			>
				<XIcon className="size-4" aria-hidden="true" />
			</button>
		</div>
	);
}

/** Mounted once (the app shell). */
export function FocusRuntime() {
	const { state, toast } = useFocusSnapshot();
	const router = useRouter();
	const pathname = usePathname();
	const running = state !== null && state.endsAt !== null;

	useEffect(() => {
		if (!running) return;
		const tick = () => {
			const events = tickFocus();
			const last = events.at(-1);
			if (!last) return;
			const shown = focusSnapshot();
			if (shown.toast) {
				const { title, body } = focusToastText(shown.toast);
				systemNotify(title, body);
			}
			if (shown.state?.config.sound) playChime();
			// After the last round: the open chat offers «Avslutt økt».
			if (last.type === "done" && requestEndSession()) setFocusToast(null);
		};
		tick();
		const id = setInterval(tick, 1000);
		return () => clearInterval(id);
	}, [running]);

	// «Pausen er over» has nothing to answer: it goes by itself.
	useEffect(() => {
		if (toast?.kind !== "break-ended") return;
		const id = setTimeout(() => setFocusToast(null), 12_000);
		return () => clearTimeout(id);
	}, [toast]);

	if (!toast) return null;
	const origin = toast.kind === "done" ? toast.origin : undefined;
	const inOrigin = origin ? pathname === `/chat/${origin.chatId}` : false;
	return (
		<div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-[min(24rem,calc(100vw-2.5rem))] flex-col items-end gap-3">
			<FocusToastCard
				toast={toast}
				onStartBreak={focusActions.startBreak}
				onSkip={focusActions.skipBreak}
				onClose={() => setFocusToast(null)}
				onOpenOrigin={origin && !inOrigin ? () => {
					setFocusToast(null);
					requestEndSession(origin.chatId);
					router.push(`/chat/${origin.chatId}`);
				} : undefined}
			/>
		</div>
	);
}
