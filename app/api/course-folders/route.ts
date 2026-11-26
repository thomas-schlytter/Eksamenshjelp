/**
 * GET /api/course-folders — scan the fagmappe (~/Documents/Eksamenshjelp)
 * and report every course with its folder and the exams in it. The scan
 * creates courses for new course-code folders and links folders as sources
 * (src/server/course-folders.ts); the window calls this on focus, and the
 * innføring reads it.
 */
import { installCourseFolderWatcher, scanCourseFolders } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
	installCourseFolderWatcher();
	return Response.json(await scanCourseFolders());
}
