# Token saving

What the harness does to keep token use down, where it lives, and how to check
that it works. Numbers are from the real records in
`~/Library/Application Support/LearnHarness/data/chats` (read-only) as of
2026-11-26.

## 1. Unchanged files are not sent twice

[`read`](../src/agent/tools/read.ts) compares its result with the earlier
`read` results the model can still see. If the new result is byte-identical
to one of them (same text, same image bytes), the tool returns a one-line note
instead: `[Unchanged: <path> returns exactly what read result #N in this
conversation returned, and that result is still above. Not sent again — use
it.]`

- "Can still see" means the model-facing history: the conversation agent
  passes `toLlmMessages(agent.state.messages)` ([teacher-agent.ts](../src/agent/teacher-agent.ts)),
  so everything before the active compaction cut
  ([compaction.ts](../src/core/compaction.ts), the `compaction` marker's
  `firstKeptMessageId`) does not count. After compaction the content is sent
  again.
- Comparing results instead of mtime/size means a changed file, a different
  slice or another page range is never mistaken for "unchanged".
- Results under 1 500 characters without images are always sent: the note
  would save nothing.
- Background readers (mock exam maker/grader) have no history and never
  shorten.

## 2. Rendered PDF pages and tiles are cached on disk

[`read-cache.ts`](../src/agent/tools/read-cache.ts) keeps, per file content
hash (sha256):

- `pdf-text`: page count plus every page's text, visual verdict, size and
  source DPI;
- `page-<n>-<dpi>dpi-<limits>`: that page's model-ready images (whole, or
  its tiles with labels);
- `image-<limits>`: a tiled picture file's tiles.

The cache lives in `<data>/cache/read/` and is pruned to 512 MB, least
recently written first. Keyed by content, so a copied or moved file hits and
an edited file misses. It is off in tests unless a test points
`readCacheDir.current` at a temp dir. A second read of the same 8 MB scanned
answer went from ~1.8 s to ~5 ms locally.

## 3. Prompt caching

### Claude Code (CLI provider)

A held CLI child (tool calls, a learner question answered within 10 min)
continues natively and caches well. A fresh child replays the whole history as
ONE user message ([transcript.ts](../src/agent/claude-code/transcript.ts)).
That replay used to merge text into as few blocks as possible, so the next
fresh child's replay grew the last block and missed the cache.

Measured before the fix (Claude Code assistant messages with usage):

| Chat | Calls | Cache read | Cache write | Hit rate | Writes on fresh replays |
| --- | --- | --- | --- | --- | --- |
| Eksamensøving Matte | 389 | 14.8 M | 7.47 M | 66.5 % | 7.11 M (95 %) |
| ADE | 432 | 18.2 M | 8.07 M | 69.2 % | 7.78 M (95 %) |

Every fresh replay read only the system prompt and tools (≈ 26 k tokens) and
re-wrote the whole history (50–110 k).

Fix: `toClaudeInput(messages, segments)` ends a content block at every
conversation length where an earlier fresh replay of the same session ended
(`rememberReplaySegment` / `replaySegmentsFor`, in memory, per session id). The
earlier replay's blocks then come back byte-identical as a prefix, which the
API's prefix cache (lookback ≈ 20 blocks) can read. Tool-result captions also
keep their place before their images in the replay.

Projected from the same records (each fresh replay reads the previous fresh
replay's prefix when it came within an hour): hit rate 66.5 % → ~85 % and
69.1 % → ~91 %; input-side cost at API weights (read 0.1, write 1.25) to
~55 % and ~45 % of before. **Not measured live**: it assumes the CLI puts its
cache breakpoint at the end of our user message and appends nothing after it.
Check after real use: a fresh child's first assistant message should show
`cacheRead` well above the ~26 k system prefix.

Also checked: the system prompt is composed from static prompt files (no dates,
no random order), the tool list is built in a fixed order with constant
descriptions, so nothing there breaks the cache. Long gaps (> 1 h) still miss;
that is the provider's TTL.

### API providers

Caching is pi-ai's (`cache_control` on Anthropic, automatic on OpenAI-style
APIs) with the per-slot `cacheRetention` setting
([models.ts](../src/agent/models.ts)). The records hold no API-provider
turns, so there is nothing to measure yet. The same prefix rules apply: stable
system prompt and tools, append-only history.

## 4. Background jobs on the cheap model

Resolution is role override → slot → nothing
([settings.ts](../src/core/settings.ts) `ROLE_SLOT`).

| Job | Role | Slot |
| --- | --- | --- |
| Research | `researcher` | cheap |
| Demo builder | `demoBuilder` | cheap |
| Graph extraction, session topics, knowledge map, session wrap, course import | `extractor` | cheap |
| Extraction audit | `auditor` | cheap |
| Figure maker | `visualMaker` | vision |
| PDF reader job | `pdfReader` | vision |
| Compaction summary | the chat's own engine (owner ruling) | — |
| Task hints | `teacher` (owner: "hints must be right") | strong |
| Mock exam maker and grader | `teacher` (the key and the grades must be right) | strong |

Every job that can run on the cheap model already does; the three on the
strong model are there by decision, not by default.

## 5. Images

A tall page or picture is tiled rather than shrunk
([tiles.ts](../src/agent/image-processing/tiles.ts)), at most 10 tiles per
picture and 12 images per `read` call. An ordinary A4 page stays one image at
150 DPI. The Claude Code child gets `MAX_MCP_OUTPUT_TOKENS=64000` (unless the
environment sets one), because the CLI's default 25 000-token cap would drop
tiles from a single result.
