"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { SetupDialog } from "@/components/setup-dialog";
import { openModelPicker, selectedModelUnavailable, useModelSetup, ZeroKeysPill } from "@/components/setup-cta";
import { SessionStarter, type SessionCreation } from "@/components/start-session";
import { OPENING_PROMPT_FAILURE, stashCarriedMessage, stashOpeningPrompt } from "@/components/opening-prompt";
import { openCourseChatId } from "./course-chats";

/**
 * ONE way to start a session from the fag surfaces (home, the fag page,
 * the knowledge map). Every "Start"-button and every start box goes through
 * `launch`, so the pre-send guards live in one place:
 *
 *  - models not set up, or no provider connected: open the setup dialog
 *    INSTEAD of creating a session (no orphan error-shell sessions);
 *  - the selected model's route is gone: open the ordinary model picker;
 *  - otherwise create, stash the opening message, and navigate.
 *
 * Anything but "started" leaves the caller's draft alone: "blocked" means
 * a guard took over (the setup dialog or the model picker is now open),
 * "failed" that the session could not be created.
 */
export type LaunchOutcome = "started" | "blocked" | "failed";

export function useSessionLauncher(initialConfigured: boolean) {
	const router = useRouter();
	const { catalog, configured, zeroKeys } = useModelSetup(initialConfigured);
	const [setupOpen, setSetupOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const startingRef = useRef(false);
	const starterRef = useRef(new SessionStarter());

	/** The pre-send guards: true when one took over. */
	const guarded = useCallback((): boolean => {
		if (!configured || zeroKeys) {
			setSetupOpen(true);
			return true;
		}
		const strong = catalog?.slots.strong?.model;
		if (selectedModelUnavailable(catalog, strong ? `${strong.provider}:${strong.id}` : undefined)) {
			openModelPicker();
			return true;
		}
		return false;
	}, [catalog, configured, zeroKeys]);

	const launch = useCallback(async (body: SessionCreation, openingText?: string): Promise<LaunchOutcome> => {
		if (startingRef.current) return "blocked";
		if (guarded()) return "blocked";
		startingRef.current = true;
		setBusy(true);
		setFailed(false);
		try {
			const target = await starterRef.current.start(body, fetch, JSON.stringify(catalog?.slots.strong), openingText);
			router.push(target);
			return "started";
		} catch {
			startingRef.current = false;
			setBusy(false);
			setFailed(true);
			return "failed";
		}
	}, [catalog, guarded, router]);

	/** Send `text` into the fag's fag-chat (fase 2): find or create it,
	 *  hand the text over, open it. A chat with no conversation yet gets it
	 *  as its opening message; otherwise it is carried into the composer
	 *  and sent there. */
	const sendToCourseChat = useCallback(async (code: string, text: string): Promise<LaunchOutcome> => {
		if (startingRef.current) return "blocked";
		if (guarded()) return "blocked";
		startingRef.current = true;
		setBusy(true);
		setFailed(false);
		try {
			const id = await openCourseChatId(code, fetch);
			const handed = id.empty ? stashOpeningPrompt(id.id, text) : stashCarriedMessage(id.id, text);
			if (!handed) throw new Error(OPENING_PROMPT_FAILURE);
			router.push(`/chat/${id.id}`);
			return "started";
		} catch {
			startingRef.current = false;
			setBusy(false);
			setFailed(true);
			return "failed";
		}
	}, [guarded, router]);

	return {
		launch,
		sendToCourseChat,
		busy,
		failed,
		configured,
		zeroKeys,
		setupOpen,
		openSetup: useCallback(() => setSetupOpen(true), []),
		closeSetup: useCallback(() => setSetupOpen(false), []),
	};
}

export type SessionLauncher = ReturnType<typeof useSessionLauncher>;

/** The first-run call to action above a start box: connect a provider,
 *  or pick the models. Renders nothing once everything is set up. */
export function SetupCta({ launcher }: { launcher: Pick<SessionLauncher, "configured" | "zeroKeys" | "openSetup"> }) {
	if (launcher.zeroKeys) return <ZeroKeysPill inline onOpen={launcher.openSetup} />;
	if (launcher.configured) return null;
	return (
		<button
			type="button"
			data-testid="setup-cta"
			onClick={launcher.openSetup}
			className="cursor-pointer rounded-sm border border-border bg-card px-3 py-1.5 font-ui text-xs text-foreground transition-colors hover:border-muted-foreground/50 hover:bg-accent"
		>
			Sett opp modellene dine
		</button>
	);
}

/** The setup dialog the guards open. Saving only saves: any draft stays
 *  where it is, and the student presses Start again. */
export function LauncherSetupDialog({ launcher }: { launcher: Pick<SessionLauncher, "setupOpen" | "closeSetup"> }) {
	return <SetupDialog open={launcher.setupOpen} onClose={launcher.closeSetup} onDone={launcher.closeSetup} />;
}

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [contenteditable='true'], [tabindex]:not([tabindex='-1'])";

/**
 * Keyboard navigation on the fag pages. The app's global handler suppresses
 * the browser's own Tab order and instead announces `lh:kbd-cycle-fields`
 * (forward-only, wrapping). On the chat surfaces only the text fields
 * answer; here EVERY visible control inside `root` joins the chain, so a
 * student can reach each button, link and field without a mouse.
 */
export function usePageTabCycle(root: RefObject<HTMLElement | null>) {
	useEffect(() => {
		const onCycle = () => {
			const host = root.current;
			if (!host) return;
			// An open dialog owns the chain: nothing behind it is reachable.
			const scope = host.querySelector<HTMLElement>("[data-lh-modal]") ?? host;
			const list = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE))
				.filter((el) => el.getClientRects().length > 0 && !el.closest("[aria-hidden='true'], [inert]"));
			if (list.length === 0) return;
			const active = document.activeElement;
			// Focus inside a portaled dialog or popover (setup, settings, the
			// search palette): that layer owns the keyboard, not the page.
			if (active && !host.contains(active) && active.closest("[role='dialog'], [data-lh-menu], .fixed.inset-0")) return;
			const index = active ? list.findIndex((el) => el === active || el.contains(active)) : -1;
			const next = list[(index + 1) % list.length]!;
			next.focus();
			next.scrollIntoView({ block: "nearest" });
		};
		window.addEventListener("lh:kbd-cycle-fields", onCycle);
		return () => window.removeEventListener("lh:kbd-cycle-fields", onCycle);
	}, [root]);
}
