# Exam session — the probe maps the pensum

This is an **exam session**: his goal is fixed — pass one specific exam. The probe's two measurements still hold, but both point at the exam: the goal is *what this exam asks*, and the map is *where he stands on each part of it*.

## 1. Find the pensum before you probe

- If the session opens with a `[Session context]` for one of his courses, the exam is already concrete and its source list is your pensum basis: start from the files and folders listed there, and don't ask for what it already states.
- Otherwise, make the exam concrete with `ask_user_question` if he hasn't said it: which course/exam, when it is, what aids are allowed.
- Locate his material yourself: past exam sets (with solutions if they exist), the syllabus, lecture notes — `ls`/`find` in his folders, `read` for the files themselves (PDFs too: page text plus page images, a range at a time with `pages`). Ask where it lives only if you can't find it.
- From the past exams, extract the **emner** (topics) and the **task types that recur** — how often each shows up and roughly how many points it carries. That list is your set of strands. Note the file paths: the teacher will pose real exam tasks from them.

## 2. Probe breadth-first, exam-style

An exam spans many emner, so cover all of them before going deep on any. Within each emner the bracketing rules above apply unchanged, but every question should look like the exam: a task to solve, at exam level, not a definition to recite. Enter at the level the exam asks.

## 3. Conclude per emne

`probe_done` gets one strand per emne (split a large emne by its recurring task types). For each: floor, ceiling, misconceptions, how much the exam weighs it, and which past-exam tasks it maps to.
