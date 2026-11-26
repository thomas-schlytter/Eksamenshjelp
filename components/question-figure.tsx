"use client";

import { useEffect, useState } from "react";
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
/**
 * Fit the viewBox to what is actually drawn (owner, 2026-11-26: «bildene
 * har tendens til å bli avskjært»). A teacher-drawn figure often puts a
 * label outside its own viewBox (text-anchor end at x < 0), and an <img>
 * clips at the viewBox. The browser measures the real content: the
 * (already sanitized — core/figure-svg) markup is placed off-screen as
 * inline SVG for one getBBox, and the viewBox grows to cover it plus a
 * small margin. Never shrinks; unmeasurable (no layout, a parse error)
 * keeps the markup as it is.
 */
export function fitSvgViewBox(svg: string, doc: Document = document): string {
	try {
		const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
		const root = parsed.documentElement;
		if (!root || root.nodeName.toLowerCase() !== "svg" || parsed.getElementsByTagName("parsererror").length > 0) return svg;
		const host = doc.createElement("div");
		host.setAttribute("aria-hidden", "true");
		host.style.cssText = "position:absolute;left:-100000px;top:0;width:1000px;height:1000px;visibility:hidden;overflow:hidden;pointer-events:none";
		const live = doc.importNode(root, true) as unknown as SVGSVGElement;
		host.appendChild(live);
		doc.body.appendChild(host);
		try {
			if (typeof live.getBBox !== "function") return svg;
			const box = live.getBBox();
			const vb = live.viewBox?.baseVal;
			if (!vb || !(vb.width > 0) || !(vb.height > 0) || !(box.width > 0) || !(box.height > 0)) return svg;
			const pad = Math.max(vb.width, vb.height) * 0.02;
			const x0 = Math.min(vb.x, box.x - pad);
			const y0 = Math.min(vb.y, box.y - pad);
			const x1 = Math.max(vb.x + vb.width, box.x + box.width + pad);
			const y1 = Math.max(vb.y + vb.height, box.y + box.height + pad);
			const grows = x0 < vb.x - 0.5 || y0 < vb.y - 0.5 || x1 > vb.x + vb.width + 0.5 || y1 > vb.y + vb.height + 0.5;
			if (!grows) return svg;
			const round = (n: number) => Math.round(n * 100) / 100;
			root.setAttribute("viewBox", `${round(x0)} ${round(y0)} ${round(x1 - x0)} ${round(y1 - y0)}`);
			// Fixed width/height would letterbox the grown box: let the frame size it.
			root.removeAttribute("width");
			root.removeAttribute("height");
			return new XMLSerializer().serializeToString(root);
		} finally {
			host.remove();
		}
	} catch {
		return svg;
	}
}

function useFittedSvg(svg: string): string {
	const [fitted, setFitted] = useState<{ from: string; to: string } | null>(null);
	useEffect(() => {
		const to = fitSvgViewBox(svg);
		setFitted({ from: svg, to });
	}, [svg]);
	return fitted?.from === svg ? fitted.to : svg;
}

export function QuestionFigure({ svg: raw }: { svg: string }) {
	const svg = useFittedSvg(raw);
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
