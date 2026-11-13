import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AppShell, SidebarProvider } from "@/components/sidebar";
import { ActivityProvider } from "@/components/activity-dock";
import { ServerEventsProvider } from "@/components/server-events";
import { AppearanceProvider } from "@/components/settings/appearance";
import UpdateBanner from "@/components/update-banner";
import { HelpProvider } from "@/components/help/help-provider";

// LettBestilt-tema: Inter for both chrome and teaching prose; JetBrains Mono
// stays only for code (font-mono). Titles follow the prose font unless the
// "session names in serif" toggle brings back CMU Serif.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

// Runs before first paint: applies the cached mode (system/light/dark) so the
// page never flashes the wrong theme. AppearanceProvider keeps it in sync.
const themeBootstrap = `(function(){try{var m=localStorage.getItem("lh-theme-mode")||"system";var d=m==="dark"||(m==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

export const metadata: Metadata = {
	title: "LearnHarness",
	description: "Les smartere til eksamen: legg til fagene dine, kartlegg hva du kan, og følg en plan fram til eksamensdagen.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="nb" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
			</head>
			<body className="min-h-dvh antialiased">
			{/* The notification channel rides OUTSIDE everything: sidebar, dock,
				 and pages all subscribe as the polls retire (push S3, 2026-10-02). */}
			<ServerEventsProvider>
				<AppearanceProvider>
					<SidebarProvider>
						<ActivityProvider>
							{/* The help layer (search palette, guided tours) sits INSIDE the
							    shell: it opens the settings dialog and the sidebar, whose
							    providers live there. */}
							<AppShell>
								<HelpProvider>{children}</HelpProvider>
							</AppShell>
						</ActivityProvider>
					</SidebarProvider>
				</AppearanceProvider>
			</ServerEventsProvider>
			{/* Auto-update banner (Wave C): fixed card, Electron-only pushes. */}
			<UpdateBanner />
		</body>
		</html>
	);
}
