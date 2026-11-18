import type { Metadata } from "next";
import { HelpCenter } from "@/components/help/help-center";
import { TopBar } from "@/components/top-bar";

export const metadata: Metadata = {
	title: "Hjelpesenter · Eksamenshjelp",
	description: "Spørsmål og svar om Eksamenshjelp, og veivisere som viser deg rundt i appen.",
};

/**
 * The help centre (NTNU round): questions and answers plus the guided tours.
 * Static content, no server data. The shared TopBar gives the page the same
 * window-drag band and sidebar toggle as every other surface; the bar's
 * label is plain chrome text (the serif title is reserved for sessions).
 * Deep links: `/hjelp#<article-id>` opens that answer.
 */
export default function HelpPage() {
	return (
		<div className="flex h-dvh flex-col">
			<TopBar>
				<span className="font-ui text-sm text-muted-foreground">Hjelp</span>
			</TopBar>
			<HelpCenter />
		</div>
	);
}
