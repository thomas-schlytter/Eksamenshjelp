"use client";

import { useId, useMemo, useRef, useState } from "react";
import { LoaderCircleIcon, PencilIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { TopicDraft } from "./course-api";
import { sortTopicsForBoard, STATUS_STYLE, WEIGHT_LABEL, type SelfStatus } from "./course-format";
import { MAX_COURSE_TOPICS, TOPIC_STATUS_LABEL, type Course, type CourseTopic } from "./course-types";
import { StatusButtons, StatusDot } from "./status-ui";

export interface TopicBoardActions {
	onStatus: (topicId: string, status: SelfStatus) => void;
	/** Replace the whole list (manual edit). Resolves true when saved. */
	onSaveTopics: (topics: TopicDraft[]) => Promise<boolean>;
	/** «Lag temaliste på nytt»: the page confirms, then regenerates. */
	onRegenerate: () => void;
	regenerating: boolean;
}

/** Exam relevance as 1–3 small dots plus the word (never dots alone). */
export function WeightMark({ weight }: { weight: 1 | 2 | 3 }) {
	return (
		<span className="inline-flex items-center gap-1.5 font-ui text-xs text-muted-foreground" data-testid="topic-weight">
			<span className="flex gap-0.5" aria-hidden="true">
				{[1, 2, 3].map((n) => (
					<span key={n} className={cn("size-1.5 rounded-full", n <= weight ? "bg-foreground/70" : "bg-muted-foreground/25")} />
				))}
			</span>
			{WEIGHT_LABEL[weight]}
		</span>
	);
}

/** One topic: what it is and how well you know it. (Fase 2: the Lær/Øv
 *  starts are gone; the work happens in the fag-chat.) */
export function TopicRow({ topic, actions }: {
	topic: CourseTopic;
	actions: Pick<TopicBoardActions, "onStatus">;
}) {
	return (
		<li data-testid="topic-row" data-status={topic.status} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-x-6">
			<div className="min-w-0">
				<p className="flex items-start gap-2 font-ui text-sm font-semibold">
					<StatusDot status={topic.status} className="mt-0.5" />
					<span className="min-w-0 break-words">{topic.title}</span>
				</p>
				<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-6">
					{/* The dot above carries the label for screen readers. */}
					<span className={cn("font-ui text-xs font-medium", STATUS_STYLE[topic.status].text)} aria-hidden="true">
						{TOPIC_STATUS_LABEL[topic.status]}
					</span>
					<WeightMark weight={topic.weight} />
				</div>
				{topic.description && (
					<p className="mt-1 pl-6 font-ui text-xs leading-relaxed text-muted-foreground">{topic.description}</p>
				)}
				{topic.statusSource === "agent" && topic.statusNote && (
					<p className="mt-1 pl-6 font-ui text-xs italic leading-relaxed text-muted-foreground" data-testid="topic-status-note">
						Sist vurdert av AI: {topic.statusNote}
					</p>
				)}
			</div>
			{/* Wide enough for the three status labels on one row; the buttons
			    wrap (never clip) if a larger font needs more. */}
			<div className="flex flex-col gap-2 sm:w-[22.5rem]">
				<StatusButtons value={topic.status} topicTitle={topic.title} onChange={(status) => actions.onStatus(topic.id, status)} />
			</div>
		</li>
	);
}

type EditRow = { key: string; id?: string; title: string; weight: 1 | 2 | 3; description?: string; status?: CourseTopic["status"] };

/**
 * «Rediger temaliste»: every topic as a row with its name, how important
 * it is, and a delete button; one field at the bottom to add a new one.
 * Nothing is saved until «Lagre»; status follows a topic through a rename
 * (the id is kept).
 */
function TopicListEditor({ topics, onSave, onCancel }: {
	topics: readonly CourseTopic[];
	onSave: (drafts: TopicDraft[]) => Promise<boolean>;
	onCancel: () => void;
}) {
	const [rows, setRows] = useState<EditRow[]>(() => topics.map((t) => ({
		key: t.id, id: t.id, title: t.title, weight: t.weight, description: t.description, status: t.status,
	})));
	const [draft, setDraft] = useState("");
	const [saving, setSaving] = useState(false);
	const nextKey = useRef(0);
	const addId = useId();
	const full = rows.length >= MAX_COURSE_TOPICS;
	const valid = rows.length > 0 && rows.every((row) => row.title.trim().length > 0);
	const add = () => {
		const title = draft.trim();
		if (!title || full) return;
		setRows((prev) => [...prev, { key: `new-${nextKey.current++}`, title, weight: 2 }]);
		setDraft("");
	};
	const patch = (key: string, change: Partial<EditRow>) =>
		setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...change } : row)));
	return (
		<form
			data-testid="topic-editor"
			className="rounded-2xl border bg-card p-4"
			onSubmit={(e) => {
				e.preventDefault();
				if (!valid || saving) return;
				setSaving(true);
				void onSave(rows.map((row) => ({
					...(row.id ? { id: row.id } : {}),
					title: row.title.trim(),
					weight: row.weight,
					...(row.description ? { description: row.description } : {}),
					...(row.status ? { status: row.status } : {}),
				}))).then((ok) => {
					setSaving(false);
					if (ok) onCancel();
				});
			}}
		>
			<p className="font-ui text-sm font-semibold">Rediger temaliste</p>
			<p className="mt-1 font-ui text-xs text-muted-foreground">
				Gi temaene navn slik de heter i faget ditt. Viktighet styrer hvor mye plass temaet får i planen.
			</p>
			<ul className="mt-3 flex flex-col gap-2">
				{rows.map((row, index) => (
					<li key={row.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
						<Input
							value={row.title}
							onChange={(e) => patch(row.key, { title: e.target.value })}
							aria-label={`Navn på tema ${index + 1}`}
							aria-invalid={row.title.trim().length === 0 || undefined}
						/>
						<select
							value={row.weight}
							onChange={(e) => patch(row.key, { weight: Number(e.target.value) as 1 | 2 | 3 })}
							aria-label={`Viktighet for ${row.title || `tema ${index + 1}`}`}
							className="h-9 cursor-pointer rounded-md border border-input bg-background px-2 font-ui text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
						>
							{([3, 2, 1] as const).map((w) => <option key={w} value={w}>{WEIGHT_LABEL[w]}</option>)}
						</select>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
							aria-label={`Slett temaet ${row.title || index + 1}`}
						>
							<Trash2Icon aria-hidden="true" />
						</Button>
					</li>
				))}
			</ul>
			<div className="mt-3 flex flex-col gap-1">
				<label htmlFor={addId} className="font-ui text-xs font-medium">Legg til tema</label>
				<div className="flex gap-2">
					<Input
						id={addId}
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						placeholder="F.eks. Laplacetransformasjon"
						disabled={full}
						onKeyDown={(e) => {
							// Enter adds the row; it must not submit the whole list.
							if (e.key === "Enter") {
								e.preventDefault();
								add();
							}
						}}
					/>
					<Button type="button" variant="outline" onClick={add} disabled={!draft.trim() || full}>
						<PlusIcon aria-hidden="true" />
						Legg til
					</Button>
				</div>
				{full && <p className="font-ui text-xs text-muted-foreground">Lista kan ha opptil {MAX_COURSE_TOPICS} temaer.</p>}
			</div>
			<div className="mt-4 flex flex-wrap gap-2">
				<Button type="submit" disabled={!valid || saving}>
					{saving && <LoaderCircleIcon className="animate-spin" aria-hidden="true" />}
					Lagre
				</Button>
				<Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>Avbryt</Button>
			</div>
		</form>
	);
}

/**
 * TEMAER: every topic with its colour and the three status buttons always
 * at hand.
 *
 * The order is "needs work first" AS OF WHEN THE TAB OPENED and then held
 * still: a topic does not jump away under the cursor the moment its status
 * changes. New topics join at the end; the next visit re-sorts.
 */
export function TopicBoard({ course, actions, onOpenWizard }: {
	course: Course;
	actions: TopicBoardActions;
	onOpenWizard: () => void;
}) {
	const [editing, setEditing] = useState(false);
	// Captured once per mount (= per visit to the tab), never re-sorted.
	const [order] = useState(() => sortTopicsForBoard(course.topics).map((t) => t.id));
	const ordered = useMemo(() => {
		const byId = new Map(course.topics.map((t) => [t.id, t]));
		const held = order.filter((id) => byId.has(id));
		const seen = new Set(held);
		return [...held, ...course.topics.map((t) => t.id).filter((id) => !seen.has(id))].map((id) => byId.get(id)!);
	}, [course.topics, order]);

	return (
		<section data-tour="topic-board" data-testid="topic-board" aria-label="Temaer" className="flex flex-col gap-4">
			{course.topics.length === 0 && !editing ? (
				<div className="rounded-2xl border border-dashed bg-card/50 px-6 py-10 text-center">
					<p className="font-ui text-base font-semibold">Ingen temaer ennå</p>
					<p className="mx-auto mt-2 max-w-md font-ui text-sm text-muted-foreground">
						La appen lage en temaliste fra emnesiden og materialet ditt, eller skriv inn temaene selv.
					</p>
					<div className="mt-5 flex flex-wrap justify-center gap-2">
						<Button onClick={onOpenWizard}>Lag temaliste</Button>
						<Button variant="outline" onClick={() => setEditing(true)}>Skriv inn selv</Button>
					</div>
				</div>
			) : editing ? (
				<TopicListEditor topics={course.topics} onSave={actions.onSaveTopics} onCancel={() => setEditing(false)} />
			) : (
				<>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<p className="font-ui text-xs text-muted-foreground">
							{course.topics.length} {course.topics.length === 1 ? "tema" : "temaer"}
							{course.topicsGeneratedBy === "fallback" && " · laget uten AI fra læringsutbyttet"}
						</p>
						<div className="flex flex-wrap gap-1">
							<Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
								<PencilIcon aria-hidden="true" />
								Rediger temaliste
							</Button>
							<Button variant="ghost" size="sm" onClick={actions.onRegenerate} disabled={actions.regenerating}>
								{actions.regenerating
									? <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
									: <RefreshCwIcon aria-hidden="true" />}
								Lag temaliste på nytt
							</Button>
						</div>
					</div>
					<ul className="divide-y divide-border/60 rounded-2xl border bg-card px-4">
						{ordered.map((topic) => <TopicRow key={topic.id} topic={topic} actions={actions} />)}
					</ul>
				</>
			)}
		</section>
	);
}
