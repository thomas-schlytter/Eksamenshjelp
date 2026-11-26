import { CourseSkeleton } from "@/components/route-skeletons";

/** Shown at once on navigation, until the page arrives (partial prefetch). */
export default function Loading() {
	return <CourseSkeleton />;
}
