/**
 * «Legg inn besvarelse» (fase 5): picked files become quoted path chips —
 * a file's own path when Electron resolves one, else a saved copy — and an
 * empty draft gets the short lead. Pure helpers plus the static button.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { quoteFilePath } from "../src/core/file-paths.ts";
import { ANSWER_ACCEPT, ANSWER_LEAD, AnswerUploadButton, filesToPaths, firstImageFile, withAnswerPaths } from "../components/answer-upload.tsx";
import { ChatSessionComposer } from "../components/composer.tsx";
import { QuestionDock } from "../components/question-dock.tsx";

const file = (name: string, type = "application/pdf") => new File(["x"], name, { type });

describe("withAnswerPaths", () => {
	it("an empty draft gets the lead before the chips", () => {
		assert.equal(withAnswerPaths("", ["/a/oppgave 1.pdf", "/a/side2.png"]), `${ANSWER_LEAD} ${quoteFilePath("/a/oppgave 1.pdf")} ${quoteFilePath("/a/side2.png")}`);
		assert.equal(withAnswerPaths("  \n", ["/a/x.pdf"]), `${ANSWER_LEAD} \`/a/x.pdf\``);
	});

	it("a draft with text keeps it and appends the chips after a space", () => {
		assert.equal(withAnswerPaths("Se oppgave 2b\n", ["/a/x.pdf"]), "Se oppgave 2b `/a/x.pdf`");
	});

	it("no paths leaves the draft untouched", () => {
		assert.equal(withAnswerPaths("hei", []), "hei");
	});
});

describe("filesToPaths", () => {
	it("uses the file's own path when it has one, and saves only the pathless ones, in order", async () => {
		const own = file("svar.pdf");
		const pasted = file("image.png", "image/png");
		const saved: Blob[] = [];
		const out = await filesToPaths([own, pasted], {
			resolve: (f) => (f === own ? "/Users/me/svar.pdf" : ""),
			save: async (blob) => { saved.push(blob); return "/data/vedlegg/besvarelse-1.png"; },
		});
		assert.deepEqual(out, { paths: ["/Users/me/svar.pdf", "/data/vedlegg/besvarelse-1.png"], failed: [] });
		assert.deepEqual(saved, [pasted], "a file with a path is never uploaded");
	});

	it("without the desktop bridge every file is saved", async () => {
		const out = await filesToPaths([file("a.pdf"), file("b.png", "image/png")], { save: async (b) => `/saved/${(b as File).name}` });
		assert.deepEqual(out.paths, ["/saved/a.pdf", "/saved/b.png"]);
	});

	it("a failing file is reported, never silently dropped, and the rest still attach", async () => {
		const out = await filesToPaths([file("big.pdf"), file("ok.pdf")], {
			resolve: (f) => { if (f.name === "big.pdf") throw new Error("bridge"); return "/ok.pdf"; },
			save: async () => { throw new Error("Filen er for stor. Største størrelse er 25 MB."); },
		});
		assert.deepEqual(out.paths, ["/ok.pdf"]);
		assert.deepEqual(out.failed, ["Filen er for stor. Største størrelse er 25 MB."]);
	});

	it("a resolved path that breaks the chip rule counts as failed", async () => {
		const out = await filesToPaths([file("x.pdf")], { resolve: () => "relative.pdf", save: async () => "/never" });
		assert.deepEqual(out.paths, []);
		assert.equal(out.failed.length, 1);
	});
});

describe("the button and its entrances", () => {
	it("firstImageFile picks the first image among pasted files", () => {
		const png = file("s.png", "image/png");
		assert.equal(firstImageFile([file("a.pdf"), png]), png);
		assert.equal(firstImageFile([file("a.pdf")]), null);
		assert.equal(firstImageFile(null), null);
	});

	it("renders a labelled button with a multi-file PDF/image picker", () => {
		const html = renderToStaticMarkup(<AnswerUploadButton onPaths={() => {}} />);
		assert.match(html, /aria-label="Legg inn besvarelse"/);
		assert.match(html, /data-testid="answer-upload-button"/);
		assert.match(html, /type="file"/);
		assert.match(html, /multiple=""/);
		assert.ok(html.includes(`accept="${ANSWER_ACCEPT}"`));
		assert.match(ANSWER_ACCEPT, /pdf/);
		assert.match(ANSWER_ACCEPT, /image\/\*/);
	});

	it("the session composer carries the button; the old screenshot reader is gone", () => {
		const html = renderToStaticMarkup(
			<ChatSessionComposer busy={false} value="" revision={0} onChange={() => {}} onSend={() => {}} onStop={() => {}} sendAllowed dictationActive={false} />,
		);
		assert.match(html, /data-testid="answer-upload-button"/);
		assert.doesNotMatch(html, /transcribe|Les av skjermbilde/);
	});

	it("the question dock offers it on a task's free answer field, not on multiple choice", () => {
		const task = renderToStaticMarkup(
			<QuestionDock toolName="explain" toolCallId="t1" input={{ type: "check", nodeId: "n", question: "Løs oppgave 3.", correctAnswer: "x = 2" } as never}
				expanded onExpand={() => {}} onSubmit={() => {}} dictationClaim={false} />,
		);
		assert.match(task, /data-testid="answer-field"/);
		assert.match(task, /data-testid="question-answer-upload"/);
		const quiz = renderToStaticMarkup(
			<QuestionDock toolName="quiz" toolCallId="q1" input={{ question: "Hva?", options: [{ label: "A" }, { label: "B" }], correctAnswer: "A", explanation: "A." } as never}
				expanded onExpand={() => {}} onSubmit={() => {}} dictationClaim={false} />,
		);
		assert.doesNotMatch(quiz, /question-answer-upload/);
	});
});
