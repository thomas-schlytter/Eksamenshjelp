"use client";

import { SvgImage } from "@/components/artifacts/svg-image";
import { useSessionMermaid } from "@/components/session-overlay";
import { cn } from "@/lib/utils";

/**
 * A question's figure (fase 4, 2026-11), shared by the dock and the answered
 * card: the figure on the white backing of the transcript's figure card,
 * placed as on an exam paper by the caller's container layout (beside the
 * task text when the container is wide, above it when narrow). The image
 * FILLS its frame's width up to a cap, so a figure drawn with a small
 * viewBox still reads at a legible size instead of its intrinsic pixels; a
 * click opens it full size.
 */
export function QuestionFigure({ svg }: { svg: string }) {
	const overlay = useSessionMermaid();
	const image = <SvgImage svg={svg} className="mx-auto block h-auto max-h-[45dvh] w-full max-w-2xl object-contain" />;
	const frame = "w-full overflow-hidden rounded-lg bg-white p-2 @2xl:w-[45%] @2xl:shrink-0";
	if (!overlay) return <div data-testid="question-figure" className={frame}>{image}</div>;
	return (
		<button
			type="button"
			data-testid="question-figure"
			aria-label="Forstørr figuren"
			title="Forstørr figuren"
			onClick={() => overlay.openFigure(svg, false)}
			className={cn(frame, "block cursor-zoom-in")}
		>
			{image}
		</button>
	);
}
