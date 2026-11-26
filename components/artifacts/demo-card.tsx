"use client";

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { DownloadIcon } from "lucide-react";
import { Toggle } from "@/components/settings/controls";
import { InvertDiscIcon } from "@/components/artifacts/invert-disc";
import { ChatActionsContext } from "@/components/chat";
import { downloadFile, slugFilename } from "@/components/artifacts/download";
import { DispatchCard } from "@/components/artifacts/dispatch-card";
import { JobsContext } from "@/components/jobs-context";
import type { ArtifactPartProps, DemoResult } from "@/src/core";

/**
 * Demo artifact card (W6): while the part is input-available, a job activity
 * card (the chat view's jobs feed — the job-card idiom); when output-available, the demo
 * runs in a SANDBOXED iframe (sandbox="allow-scripts", no allow-same-origin →
 * no access to app storage/cookies/DOM).
 *
 * The bridge script (contracts.ts "Demo iframe bridge") is auto-injected into
 * every demo by buildDemoSrcDoc — never the model's job: ResizeObserver →
 * postMessage {type:"demo-resize",height} (parent sizes the iframe) and
 * window.onerror → {type:"demo-error",message} (error chip on the card, with
 * a "Send to teacher" button that feeds the error back into the lesson — the
 * fix loop).
 *
 * Bridge message handling is a pure function (reduceDemoBridgeState) so
 * tests cover it without a DOM.
 */

// ─── bridge injection + message handling (pure, testable) ───────────────────

export const DEMO_BRIDGE_SCRIPT = `<script>(function(){
var send=function(m){try{parent.postMessage(m,"*")}catch(e){}};
var post=function(){
var b=document.body;
if(!b){send({type:"demo-resize",height:document.documentElement.scrollHeight});return}
var h=Math.max(b.scrollHeight,b.getBoundingClientRect().height);
var cs=getComputedStyle(b);
h+=(parseFloat(cs.marginTop)||0)+(parseFloat(cs.marginBottom)||0);
send({type:"demo-resize",height:Math.ceil(h)})
};
if(typeof ResizeObserver!=="undefined"){new ResizeObserver(post).observe(document.documentElement)}
window.addEventListener("resize",post);
window.addEventListener("load",post);
window.addEventListener("error",function(e){send({type:"demo-error",message:e.message||String(e)})});
setTimeout(post,50);
setTimeout(post,400);
})();</script>`;

/** Inject the bridge before </body> (or at the end of a body-less document). */
export function buildDemoSrcDoc(html: string): string {
	if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${DEMO_BRIDGE_SCRIPT}</body>`);
	return `${html}${DEMO_BRIDGE_SCRIPT}`;
}

export interface DemoBridgeState {
	height: number | null;
	error: string | null;
	/** The shrink-loop breaker (2026-11): consecutive small shrinks seen,
	 *  the height before the run, and whether the height is frozen. */
	shrinks?: number;
	shrinkPeak?: number | null;
	frozen?: boolean;
}

export const INITIAL_DEMO_BRIDGE_STATE: DemoBridgeState = { height: null, error: null };

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 2400;
/** A demo sized from the window height (vh units, height:100%) shrinks a
 *  few pixels every time the frame follows it, down to MIN_HEIGHT — the
 *  "tiny figure in a big card" incident (2026-11). This many small shrinks
 *  in a row is that loop, never a real layout change: the frame freezes at
 *  the height before the run. */
const SHRINK_LOOP_STEPS = 5;
const SHRINK_LOOP_MAX_STEP = 40;

/** Pure reducer over incoming postMessage data (contracts.ts DemoBridgeMessage). */
export function reduceDemoBridgeState(state: DemoBridgeState, data: unknown): DemoBridgeState {
	if (typeof data !== "object" || data === null) return state;
	const message = data as { type?: unknown; height?: unknown; message?: unknown };
	if (message.type === "demo-resize") {
		if (state.frozen) return state;
		if (typeof message.height !== "number" || !Number.isFinite(message.height) || message.height <= 0) return state;
		const height = Math.min(Math.max(Math.round(message.height), MIN_HEIGHT), MAX_HEIGHT);
		if (height === state.height) return state;
		const smallShrink = state.height !== null && height < state.height && state.height - height <= SHRINK_LOOP_MAX_STEP;
		if (!smallShrink) return { ...state, height, shrinks: 0, shrinkPeak: null };
		const shrinks = (state.shrinks ?? 0) + 1;
		const shrinkPeak = shrinks === 1 ? state.height : (state.shrinkPeak ?? state.height);
		if (shrinks >= SHRINK_LOOP_STEPS) return { ...state, height: shrinkPeak, shrinks, shrinkPeak, frozen: true };
		return { ...state, height, shrinks, shrinkPeak };
	}
	if (message.type === "demo-error") {
		const text = typeof message.message === "string" && message.message.trim() ? message.message : "ukjent feil";
		return text === state.error ? state : { ...state, error: text };
	}
	return state;
}

// ─── the demo card ──────────────────────────────────────────────────────────

/** The demo tool-call box: the part's output is the dispatch ack — the box
 * is the DispatchCard (live status via the chat view's jobs feed). The demo
 * itself renders from the steer message via DemoOutputCard. */
export function DemoCard({ part }: ArtifactPartProps) {
	const job = useContext(JobsContext).find((j) => j.toolCallId === part.toolCallId);
	if (part.state !== "output-available") return null;
	// A demo a question waited for (2026-11): claimed from the runner, so it
	// renders here, before the question, instead of in a later steer.
	if (job?.forQuestion && job.status === "done" && job.result !== undefined) return <DemoOutputCard output={job.result} />;
	return <DispatchCard toolCallId={part.toolCallId} kind="demo" />;
}

/** The demo artifact — exported: the steer card renders the delivered
 *  result. `messageId` + `initialInverted` carry the PERSISTED invert
 *  switch (details.ui.inverted via the artifact-ui route, owner 2026-10-07). */
export function DemoOutputCard({
	output,
	messageId,
	initialInverted = false,
}: {
	output: unknown;
	messageId?: string;
	initialInverted?: boolean;
}) {
	const result = output as DemoResult | undefined;
	if (!result || typeof result.html !== "string" || typeof result.title !== "string") {
		return (
			<div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
				Demoen ble ferdig, men resultatet kunne ikke vises.
			</div>
		);
	}
	const failed = result.html.length === 0;
	if (failed) {
		return (
			<div className="rounded-xl border bg-card p-4 text-card-foreground" data-testid="demo-card-failed">
				<div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Interaktiv demo
					<span className="rounded-sm bg-status-red-soft px-1.5 py-0.5 text-status-red-ink">mislyktes</span>
				</div>
				<p className="mt-2 text-sm text-muted-foreground">{result.notes ?? "Demoen kunne ikke lages."}</p>
			</div>
		);
	}
	return (
		<DemoFrame title={result.title} html={result.html} messageId={messageId} initialInverted={initialInverted} />
	);
}

function DemoFrame({
	title,
	html,
	messageId,
	initialInverted = false,
}: {
	title: string;
	html: string;
	messageId?: string;
	initialInverted?: boolean;
}) {
	const actions = useContext(ChatActionsContext);
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	const [state, setState] = useState<DemoBridgeState>(INITIAL_DEMO_BRIDGE_STATE);
	// Brightness inversion (owner, 2026-10-07): the switch state PERSISTS on
	// the steer record (details.ui.inverted) — seeded here, written through
	// the silent artifact-ui route on toggle. Without a chat page (tests,
	// previews) the toggle stays local-only. The filter rides the iframe
	// element, which carries the card's white backing, so one filter flips
	// page + content together while hue-rotate(180deg) undoes invert's hue
	// flip.
	const [inverted, setInverted] = useState(initialInverted);
	const toggleInverted = (next: boolean) => {
		setInverted(next);
		if (!actions?.chatId || !messageId) return;
		void fetch(`/api/chats/${actions.chatId}/artifact-ui`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ input: { messageId, inverted: next } }),
		}).catch(() => {});
	};
	const srcDoc = useMemo(() => buildDemoSrcDoc(html), [html]);

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			// Only messages from THIS demo's iframe (the sandbox gives it an
			// opaque origin; the window reference still matches).
			if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
			setState((prev) => reduceDemoBridgeState(prev, event.data));
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, []);

	return (
		<div className="rounded-xl border bg-card p-4 text-card-foreground" data-testid="demo-card">
			{/* Caption header (owner, 2026-10-07): kind label + title in the
			   label's size/tracking (title normal-case, foreground) — the
			   figure card's grammar plus a name. Switch + download far right. */}
			<div className="flex items-center justify-between gap-2">
				<div className="flex min-w-0 items-baseline gap-2">
					<span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						interaktiv demo
					</span>
					<span className="truncate text-xs font-medium tracking-wide text-foreground">{title}</span>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<Toggle
						checked={inverted}
						onChange={toggleInverted}
						label="Inverter lysstyrken i demoen"
						testid="toggle-invert-demo-brightness"
						title="Inverter farger"
						discIcon={<InvertDiscIcon className="size-3" />}
					/>
					<button
						type="button"
						aria-label="Last ned demoen som HTML"
						title="Last ned som HTML"
						onClick={() => downloadFile(`${slugFilename(title)}.html`, html, "text/html")}
						data-testid="demo-download"
						className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<DownloadIcon className="size-3.5" />
					</button>
				</div>
			</div>
			{state.error && (
				<DemoErrorChip
					title={title}
					message={state.error}
					onSend={actions ? () => actions.sendText(`The demo "${title}" threw an error: ${state.error}`) : undefined}
				/>
			)}
			<iframe
				ref={iframeRef}
				title={title}
				// allow-scripts ONLY — no allow-same-origin: the demo can run code
				// but never touch the app's storage, cookies, or DOM.
				sandbox="allow-scripts"
				srcDoc={srcDoc}
				// scrolling OFF (owner, 2026-10-07): the bridge auto-sizes the
				// iframe to its content, so an internal scrollbar can only appear
				// before the first resize lands — and a scrollable iframe TRAPS
				// the wheel (session scrolling stalls over the demo). With
				// scrolling disabled the wheel chains straight to the session.
				scrolling="no"
				className="mt-2 w-full rounded-lg border bg-white"
				// content-box: the bridge reports the CONTENT height — with the
				// preflight's border-box the 2px border would eat into it and clip
				// the bottom of the demo (smoke finding, 2026-10-07).
				style={{
					height: state.height ?? 360,
					boxSizing: "content-box",
					filter: inverted ? "invert(1) hue-rotate(180deg)" : undefined,
				}}
				data-testid="demo-iframe"
			/>
		</div>
	);
}

export function DemoErrorChip({
	title,
	message,
	onSend,
}: {
	title: string;
	message: string;
	onSend?: () => void;
}) {
	return (
		<div
			className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-status-red-soft px-3 py-2 text-sm text-status-red-ink"
			data-testid="demo-error-chip"
		>
			<span className="font-medium">Demoen ga en feil</span>
			<span className="min-w-0 flex-1 truncate font-mono text-xs" title={message}>
				{message}
			</span>
			{onSend && (
				<button
					type="button"
					onClick={onSend}
					className="rounded-md border border-status-red/40 px-2 py-1 text-xs font-medium hover:bg-status-red/15"
					data-testid="demo-error-send"
				>
					Send til læreren
				</button>
			)}
		</div>
	);
}
