/**
 * «Les av skjermbilde»: the review window's body, statically rendered, and
 * the small pure helpers the three entrances share.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TranscribeBody, type TranscribeState } from "../components/transcribe/transcribe-dialog.tsx";
import { firstImageFile, joinTranscription } from "../components/transcribe/transcribe-event.ts";
import { composeTranscriberModel } from "../components/settings/agent-section.tsx";

const noop = () => {};
function render(over: Partial<{ state: TranscribeState; latex: string; changes: string[]; fix: boolean; canAttach: boolean }> = {}) {
	return renderToStaticMarkup(
		<TranscribeBody
			imageUrl="blob:test"
			state={over.state ?? { status: "ready" }}
			latex={over.latex ?? "$$\\int_0^1 e^{2x}\\,dx$$"}
			changes={over.changes ?? []}
			fix={over.fix ?? false}
			canAttach={over.canAttach ?? false}
			onLatex={noop} onFix={noop} onRetry={noop} onInsert={noop} onAttach={noop} onClose={noop}
		/>,
	);
}

describe("TranscribeBody", () => {
	it("ready: image, formatted math, editable source and an enabled Sett inn", () => {
		const html = render();
		assert.ok(html.includes('data-testid="transcribe-image"'));
		assert.ok(html.includes("katex"), "the preview renders the LaTeX");
		assert.ok(html.includes("$$\\int_0^1 e^{2x}\\,dx$$"), "the source stays editable text");
		assert.doesNotMatch(html, /data-testid="transcribe-insert"[^>]*disabled=""/);
		assert.ok(!html.includes('data-testid="transcribe-changes"'), "no change list when verbatim");
		assert.ok(!html.includes('data-testid="transcribe-attach"'));
	});

	it("reading and failed states block Sett inn; failed offers a retry", () => {
		const reading = render({ state: { status: "reading" }, latex: "" });
		assert.ok(reading.includes("Leser av bildet"));
		assert.match(reading, /data-testid="transcribe-insert"[^>]*disabled=""/);
		const failed = render({ state: { status: "failed", error: "Avlesningen feilet." }, latex: "" });
		assert.ok(failed.includes("Avlesningen feilet."));
		assert.ok(failed.includes('data-testid="transcribe-retry"'));
		assert.match(failed, /data-testid="transcribe-insert"[^>]*disabled=""/);
	});

	it("fix on: the change list shows, and says so when nothing was changed", () => {
		const changed = render({ fix: true, changes: ["$\\geq$ rettet til $\\leq$"] });
		assert.ok(changed.includes("Dette ble rettet. Gå over det selv:"));
		assert.ok(changed.includes('data-testid="transcribe-changes"'));
		assert.ok(render({ fix: true }).includes("Ingenting ble rettet."));
	});

	it("flags unreadable spots and offers the file route only for files on disk", () => {
		assert.ok(render({ latex: "$$x = [uleselig]$$" }).includes('data-testid="transcribe-unreadable"'));
		assert.ok(!render().includes('data-testid="transcribe-unreadable"'));
		assert.ok(render({ canAttach: true }).includes("Legg ved som fil i stedet"));
	});
});

describe("entrance helpers", () => {
	it("joinTranscription puts the text in its own paragraph", () => {
		assert.equal(joinTranscription("", "$$x$$"), "$$x$$");
		assert.equal(joinTranscription("Se her: \n", "$$x$$"), "Se her:\n\n$$x$$");
	});
	it("firstImageFile skips non-images", () => {
		const text = new File(["a"], "a.txt", { type: "text/plain" });
		const png = new File(["b"], "b.png", { type: "image/png" });
		assert.equal(firstImageFile([text, png]), png);
		assert.equal(firstImageFile([text]), null);
		assert.equal(firstImageFile(null), null);
	});
	it("composeTranscriberModel sets and clears only the reader's override", () => {
		const agent = { tools: { research: false }, models: { auditor: { thinkingLevel: "high" as const } } };
		const set = composeTranscriberModel(agent, { provider: "zai", id: "v" });
		assert.deepEqual(set, { tools: { research: false }, models: { auditor: { thinkingLevel: "high" }, transcriber: { model: { provider: "zai", id: "v" } } } });
		assert.deepEqual(composeTranscriberModel(set, null), agent);
	});
});
