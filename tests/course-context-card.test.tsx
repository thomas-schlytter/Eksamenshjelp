/**
 * The course-context line (exam mode, 2026-11): the transcript's face of the
 * `course-context` marker. Pins the guard (the part's data is untyped: a
 * foreign shape renders nothing, never a crash) and the one-line copy.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CourseContextCard, courseContextSegments, parseCourseContext } from "../components/course-context-card.tsx";
import { projectView } from "../src/core/view.ts";
import type { LhMessage } from "../src/core/native-messages.ts";

describe("CourseContextCard", () => {
	it("renders course, topic and source count as one quiet line linking to the course page", () => {
		const html = renderToStaticMarkup(
			<CourseContextCard data={{ code: "TTK4100", name: "Kybernetikk, introduksjon", topicId: "pid", topicTitle: "PID-regulering", sourceCount: 12 }} />,
		);
		assert.ok(html.includes('data-testid="course-context-card"'));
		assert.match(html, /href="\/fag\/TTK4100"/);
		assert.match(html, /TTK4100 Kybernetikk, introduksjon/);
		assert.match(html, /Tema: PID-regulering/);
		assert.match(html, /12 kilder/);
	});

	it("names the mode, counts honestly, and survives a course without topic or name", () => {
		assert.deepEqual(courseContextSegments(parseCourseContext({ code: "TMA4100", name: "Matematikk 1", mode: "practice", sourceCount: 1 })!), ["Øv", "1 kilde"]);
		assert.deepEqual(courseContextSegments(parseCourseContext({ code: "TMA4100", name: "Matematikk 1", mode: "mapping", sourceCount: 0 })!), ["Kartlegging", "Ingen kilder"]);
		assert.deepEqual(courseContextSegments(parseCourseContext({ code: "TMA4100", mode: "learn" })!), ["Lær", "Ingen kilder"]);
		const html = renderToStaticMarkup(<CourseContextCard data={{ code: "ÆØÅ-1", sourceCount: 2 }} />);
		assert.match(html, /href="\/fag\/%C3%86%C3%98%C3%85-1"/, "the code is encoded into the path");
	});

	it("renders nothing for a payload it cannot read (older/newer builds, corrupt records)", () => {
		for (const data of [undefined, null, "TTK4100", 7, {}, { name: "No code" }, { code: "" }, { code: 4100 }]) {
			assert.equal(parseCourseContext(data), null);
			assert.equal(renderToStaticMarkup(<CourseContextCard data={data} />), "");
		}
		assert.equal(parseCourseContext({ code: "TTK4100", mode: "cram", sourceCount: "many", topicTitle: 3 })?.mode, undefined, "unknown fields degrade, never throw");
	});

	it("an eksamensøkt's marker says so on the line", () => {
		const data = parseCourseContext({ code: "TTK4100", name: "Kybernetikk, introduksjon", mode: "exam", sourceCount: 2 });
		assert.equal(data?.mode, "exam");
		assert.deepEqual(courseContextSegments(data!), ["Eksamensøkt", "2 kilder"]);
	});

	it("the marker projects into the data-course-context part this card consumes", () => {
		const details = { code: "TTK4100", name: "Kybernetikk, introduksjon", sourceCount: 3 };
		const marker = { id: "m1", role: "custom", customType: "course-context", content: "[Session context] …", display: true, details, timestamp: 1 } as unknown as LhMessage;
		const part = projectView([marker]).flatMap((m) => m.parts).find((p) => p.type === "data-course-context");
		assert.ok(part, "view.ts (BACKEND) emits the part chat.tsx switches on");
		assert.deepEqual(parseCourseContext((part as { data?: unknown }).data), { code: "TTK4100", name: "Kybernetikk, introduksjon", topicId: undefined, topicTitle: undefined, mode: undefined, sourceCount: 3 });
	});
});
