/**
 * FOKUS (fase 7b): a work/break timer the learner sets up himself, e.g.
 * 3 rounds of 50 minutes work and 10 minutes break.
 *
 * The state is stored as END TIMESTAMPS, never as a ticking counter, so it
 * survives a reload or a closed window: `advanceFocus(state, now)` replays
 * every boundary that passed meanwhile.
 *
 *   work (round r) ──ends──▶ break-due  (r < rounds: waits for «Start pausen»
 *                                         or «Hopp over»)
 *                  └─ends──▶ done       (the last round)
 *   break-due ──Start pausen──▶ break ──ends──▶ work (round r+1)
 *            └─Hopp over────────────────────▶ work (round r+1)
 *   work/break ──pause──▶ paused (remaining kept) ──resume──▶ running
 *
 * The timer never ends an økt by itself; after the last round the app only
 * suggests «Avslutt økt». Pure and browser-safe.
 */

export interface FocusConfig {
	workMinutes: number;
	breakMinutes: number;
	rounds: number;
	sound: boolean;
}

export type FocusPhase = "work" | "break-due" | "break" | "done";

/** Where the timer was started: the suggestion after the last round links
 *  back to it. */
export interface FocusOrigin {
	chatId: string;
	label: string;
}

export interface FocusState {
	config: FocusConfig;
	phase: FocusPhase;
	/** 1-based. */
	round: number;
	/** When the running phase ends (ms). Null while paused, due or done. */
	endsAt: number | null;
	/** Paused: what was left of the phase (ms). */
	remainingMs: number | null;
	startedAt: number;
	origin?: FocusOrigin;
}

export type FocusEvent =
	| { type: "work-ended"; round: number }
	| { type: "break-ended"; round: number }
	| { type: "done" };

export const FOCUS_PRESETS: readonly { work: number; brk: number; hint: string }[] = [
	{ work: 25, brk: 5, hint: "kort og hyppig" },
	{ work: 50, brk: 10, hint: "balansert" },
	{ work: 90, brk: 15, hint: "dyp økt" },
];

export const DEFAULT_FOCUS_CONFIG: FocusConfig = { workMinutes: 50, breakMinutes: 10, rounds: 3, sound: true };

export const FOCUS_LIMITS = {
	work: { min: 1, max: 240 },
	brk: { min: 1, max: 60 },
	rounds: { min: 1, max: 12 },
} as const;

const MINUTE = 60_000;

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
	// An empty field is no number (Number("") is 0).
	const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, Math.round(n)));
};

/** A config from untrusted input (a form, localStorage), clamped. */
export function normalizeFocusConfig(raw: unknown): FocusConfig {
	const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
	return {
		workMinutes: clampInt(r.workMinutes, FOCUS_LIMITS.work.min, FOCUS_LIMITS.work.max, DEFAULT_FOCUS_CONFIG.workMinutes),
		breakMinutes: clampInt(r.breakMinutes, FOCUS_LIMITS.brk.min, FOCUS_LIMITS.brk.max, DEFAULT_FOCUS_CONFIG.breakMinutes),
		rounds: clampInt(r.rounds, FOCUS_LIMITS.rounds.min, FOCUS_LIMITS.rounds.max, DEFAULT_FOCUS_CONFIG.rounds),
		sound: typeof r.sound === "boolean" ? r.sound : DEFAULT_FOCUS_CONFIG.sound,
	};
}

/** When all rounds are done if every break is taken right away. */
export function focusFinishAt(config: FocusConfig, now: number): number {
	return now + config.rounds * config.workMinutes * MINUTE + (config.rounds - 1) * config.breakMinutes * MINUTE;
}

/** «18.40» (the Norwegian clock style). */
export function clockLabel(ms: number): string {
	const date = new Date(ms);
	return `${String(date.getHours()).padStart(2, "0")}.${String(date.getMinutes()).padStart(2, "0")}`;
}

export function startFocus(config: FocusConfig, now: number, origin?: FocusOrigin): FocusState {
	return {
		config,
		phase: "work",
		round: 1,
		endsAt: now + config.workMinutes * MINUTE,
		remainingMs: null,
		startedAt: now,
		...(origin ? { origin } : {}),
	};
}

export function isFocusPaused(state: FocusState): boolean {
	return (state.phase === "work" || state.phase === "break") && state.endsAt === null && state.remainingMs !== null;
}

/** Replay every boundary up to `now`. Returns the new state and what
 *  happened, oldest first (one notification per event). */
export function advanceFocus(state: FocusState, now: number): { state: FocusState; events: FocusEvent[] } {
	const events: FocusEvent[] = [];
	let s = state;
	// Bounded: at most two boundaries per round can pass.
	for (let guard = 0; guard < 2 * s.config.rounds + 2; guard++) {
		if (s.endsAt === null || now < s.endsAt) break;
		const boundary = s.endsAt;
		if (s.phase === "work") {
			if (s.round >= s.config.rounds) {
				s = { ...s, phase: "done", endsAt: null, remainingMs: null };
				events.push({ type: "done" });
			} else {
				s = { ...s, phase: "break-due", endsAt: null, remainingMs: null };
				events.push({ type: "work-ended", round: s.round });
			}
			break; // both wait for the learner (or are final)
		}
		if (s.phase === "break") {
			const round = s.round + 1;
			s = { ...s, phase: "work", round, endsAt: boundary + s.config.workMinutes * MINUTE, remainingMs: null };
			events.push({ type: "break-ended", round });
			continue;
		}
		break;
	}
	return { state: s, events };
}

/** «Start pausen». */
export function startBreak(state: FocusState, now: number): FocusState {
	if (state.phase !== "break-due") return state;
	return { ...state, phase: "break", endsAt: now + state.config.breakMinutes * MINUTE, remainingMs: null };
}

/** «Hopp over»: straight into the next work round. */
export function skipBreak(state: FocusState, now: number): FocusState {
	if (state.phase !== "break-due" && state.phase !== "break") return state;
	return { ...state, phase: "work", round: state.round + 1, endsAt: now + state.config.workMinutes * MINUTE, remainingMs: null };
}

export function pauseFocus(state: FocusState, now: number): FocusState {
	if ((state.phase !== "work" && state.phase !== "break") || state.endsAt === null) return state;
	return { ...state, endsAt: null, remainingMs: Math.max(0, state.endsAt - now) };
}

export function resumeFocus(state: FocusState, now: number): FocusState {
	if (!isFocusPaused(state)) return state;
	return { ...state, endsAt: now + (state.remainingMs ?? 0), remainingMs: null };
}

/** The phase's full length (ms). */
export function phaseLengthMs(state: FocusState): number {
	return (state.phase === "break" || state.phase === "break-due" ? state.config.breakMinutes : state.config.workMinutes) * MINUTE;
}

/** What is left of the phase (ms): the break's full length while it is due. */
export function focusRemainingMs(state: FocusState, now: number): number {
	if (state.phase === "done") return 0;
	if (state.phase === "break-due") return phaseLengthMs(state);
	if (state.endsAt === null) return state.remainingMs ?? 0;
	return Math.max(0, state.endsAt - now);
}

/** 0–1: how much of the running phase has passed. */
export function focusProgress(state: FocusState, now: number): number {
	if (state.phase === "done") return 1;
	if (state.phase === "break-due") return 0;
	const length = phaseLengthMs(state);
	return length <= 0 ? 1 : Math.min(1, Math.max(0, 1 - focusRemainingMs(state, now) / length));
}

/** «18:04», «1:05:00». */
export function countdownLabel(ms: number): string {
	const total = Math.max(0, Math.ceil(ms / 1000));
	const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
	const pad = (n: number) => String(n).padStart(2, "0");
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** A stored state from untrusted input (localStorage), or null. */
export function parseFocusState(raw: unknown): FocusState | null {
	if (typeof raw !== "object" || raw === null) return null;
	const r = raw as Record<string, unknown>;
	const phases: readonly FocusPhase[] = ["work", "break-due", "break", "done"];
	if (!phases.includes(r.phase as FocusPhase)) return null;
	const config = normalizeFocusConfig(r.config);
	const round = clampInt(r.round, 1, config.rounds, 1);
	const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
	const endsAt = num(r.endsAt);
	const remainingMs = num(r.remainingMs);
	const startedAt = num(r.startedAt);
	if (startedAt === null) return null;
	const phase = r.phase as FocusPhase;
	if ((phase === "work" || phase === "break") && endsAt === null && remainingMs === null) return null;
	const o = r.origin as Record<string, unknown> | undefined;
	const origin = o && typeof o.chatId === "string" && /^[A-Za-z0-9_-]+$/.test(o.chatId) && typeof o.label === "string"
		? { chatId: o.chatId, label: o.label.slice(0, 80) }
		: undefined;
	return {
		config,
		phase,
		round,
		endsAt: phase === "work" || phase === "break" ? endsAt : null,
		remainingMs: phase === "work" || phase === "break" ? (endsAt === null ? remainingMs : null) : null,
		startedAt,
		...(origin ? { origin } : {}),
	};
}
