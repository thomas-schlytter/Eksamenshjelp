"use client";

import type { ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import { SidebarToggle } from "@/components/sidebar";
import { useRouteSkeleton } from "@/components/navigation-progress";
import { cn } from "@/lib/utils";

/**
 * THE ROUTE SKELETONS (2026-11-26): what loading.tsx shows the instant a
 * link is clicked, until the server's page arrives. Each one has the real
 * page's frame (the 60px top bar with the sidebar toggle, the same column
 * widths), so nothing jumps when the page lands, and grey blocks where the
 * content goes. Mounted = still loading: the top stripe keeps running
 * (useRouteSkeleton). The pulse honours reduced motion (motion-safe).
 */

/** One grey block. */
export function Bone({ className }: { className?: string }) {
	return <div className={cn("rounded-md bg-muted motion-safe:animate-pulse", className)} aria-hidden="true" />;
}

/** The top bar's frame: the window-drag band with the sidebar toggle. */
function SkeletonBar({ children }: { children?: ReactNode }) {
	return (
		<header className="lh-drag lh-wco-gutter flex h-15 shrink-0 select-none items-center gap-3 border-b border-border px-3">
			<SidebarToggle />
			{children}
		</header>
	);
}

function SkeletonPage({ label, bar, children }: { label: string; bar?: ReactNode; children: ReactNode }) {
	useRouteSkeleton();
	return (
		<div className="flex h-dvh flex-col" aria-busy="true" data-testid="route-skeleton">
			<span className="sr-only" role="status">{label}</span>
			<SkeletonBar>{bar}</SkeletonBar>
			<div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
		</div>
	);
}

/** /fag/[code]: breadcrumb, the header with its two buttons, the cards. */
export function CourseSkeleton() {
	return (
		<SkeletonPage
			label="Laster faget …"
			bar={
				<span className="flex items-center gap-1 font-ui text-sm text-muted-foreground">
					Mine fag
					<ChevronRightIcon className="size-3.5 shrink-0" aria-hidden="true" />
					<Bone className="h-4 w-16" />
				</span>
			}
		>
			<div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-7 sm:px-8 lg:px-11">
				<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
					<div className="flex flex-col gap-2.5">
						<Bone className="h-3 w-32" />
						<Bone className="h-9 w-80 max-w-full" />
					</div>
					<div className="flex gap-2.5">
						<Bone className="h-10 w-40" />
						<Bone className="h-10 w-48" />
					</div>
				</div>
				<div className="grid gap-5 lg:grid-cols-3">
					<Bone className="h-44 rounded-lg" />
					<Bone className="h-44 rounded-lg" />
					<Bone className="h-44 rounded-lg" />
				</div>
				<Bone className="h-64 rounded-lg" />
			</div>
		</SkeletonPage>
	);
}

/** /chat/[id]: the title, a few turns in the reading column, the composer. */
export function ChatSkeleton() {
	return (
		<SkeletonPage label="Laster chatten …" bar={<Bone className="h-6 w-56" />}>
			<div className="mx-auto flex w-full max-w-[46rem] flex-col gap-6 px-4 py-8">
				<Bone className="ml-auto h-10 w-2/5 rounded-xl" />
				<div className="flex flex-col gap-2.5">
					<Bone className="h-4 w-full" />
					<Bone className="h-4 w-11/12" />
					<Bone className="h-4 w-4/5" />
				</div>
				<Bone className="ml-auto h-10 w-1/3 rounded-xl" />
				<div className="flex flex-col gap-2.5">
					<Bone className="h-4 w-full" />
					<Bone className="h-4 w-3/4" />
				</div>
			</div>
			<div className="absolute inset-x-0 bottom-0 pb-5">
				<div className="mx-auto w-full max-w-[46rem] px-4">
					<Bone className="h-24 rounded-2xl" />
				</div>
			</div>
		</SkeletonPage>
	);
}

/** /kart: the map has no bar of its own; the toggle floats top-left. */
export function MapSkeleton() {
	useRouteSkeleton();
	return (
		<div className="relative h-dvh" aria-busy="true" data-testid="route-skeleton">
			<span className="sr-only" role="status">Laster kunnskapskartet …</span>
			<div className="lh-drag absolute inset-x-0 top-0 h-13" aria-hidden="true" />
			<div className="absolute inset-x-0 top-0 flex items-center gap-2 px-3 py-2">
				<SidebarToggle />
			</div>
			<div className="absolute inset-0 flex items-center justify-center">
				<Bone className="size-56 rounded-full opacity-60" />
			</div>
			<div className="absolute inset-x-0 bottom-0 pb-5">
				<div className="mx-auto w-full max-w-[46rem] px-4">
					<Bone className="h-24 rounded-2xl" />
				</div>
			</div>
		</div>
	);
}

/** /hjelp: the search field and the question rows. */
export function HelpSkeleton() {
	return (
		<SkeletonPage label="Laster hjelpesenteret …" bar={<span className="font-ui text-sm text-muted-foreground">Hjelp</span>}>
			<div className="mx-auto flex w-full max-w-[46rem] flex-col gap-3 px-5 pt-10 pb-20">
				<Bone className="mb-3 h-11 rounded-lg" />
				{[0, 1, 2, 3, 4, 5].map((i) => <Bone key={i} className="h-12 rounded-lg" />)}
			</div>
		</SkeletonPage>
	);
}
