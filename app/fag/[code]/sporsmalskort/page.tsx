import { CourseNotFound } from "@/components/courses/course-page";
import { FlashcardPracticePage } from "@/components/flashcards/flashcard-practice";
import { readCourse, readFlashcards } from "@/src/server";

// Dynamic: the deck and its progress change with every answer.
export const dynamic = "force-dynamic";

/**
 * SPØRSMÅLSKORT (/fag/[code]/sporsmalskort): the fag's practice page. The
 * deck is read here, on the server, so the first frame already shows the
 * setup (or the waiting state). An unknown fagkode renders «Fant ikke
 * faget», as the fag page does.
 */
export default async function FlashcardsRoute({ params }: { params: Promise<{ code: string }> }) {
	const { code } = await params;
	let wanted = code;
	try {
		wanted = decodeURIComponent(code);
	} catch { /* a malformed escape is just an unknown fag */ }
	const course = readCourse(wanted);
	if (!course.ok) return <CourseNotFound code={wanted.slice(0, 24)} />;
	const flashcards = readFlashcards(course.course.code);
	if (!flashcards.ok) return <CourseNotFound code={wanted.slice(0, 24)} />;
	return (
		<FlashcardPracticePage
			key={course.course.code}
			code={course.course.code}
			name={course.course.name}
			initial={flashcards.view}
		/>
	);
}
