"use client";

/**
 * The help API every surface talks to (NTNU round). The default value is a
 * set of no-ops, so a component rendered outside the provider (a static
 * render in a test, a storybook-style mount) still renders; it just cannot
 * act.
 */

import { createContext, useContext } from "react";
import type { HelpAction } from "./types.ts";

export interface HelpApi {
	/** Perform a registry/content action (navigate, open settings, start a tour …). */
	run: (action: HelpAction) => void;
	/** Open the global search palette, optionally pre-filled. */
	openSearch: (query?: string) => void;
	startTour: (id: string) => void;
	/** Tour ids the learner has finished on this device. */
	completedTours: readonly string[];
}

export const HelpContext = createContext<HelpApi>({
	run: () => {},
	openSearch: () => {},
	startTour: () => {},
	completedTours: [],
});

export function useHelp(): HelpApi {
	return useContext(HelpContext);
}
