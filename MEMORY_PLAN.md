# MEMORY_PLAN.md

Plan for Braian Desktop memory on the local-first desktop app.

This document defines the target memory architecture for Braian as a layered system:

- `AGENTS.md` for durable instruction memory and workspace conventions.
- Short-term conversation memory for current-task continuity.
- Long-term semantic memory for durable facts, decisions, preferences, episodes, and patterns.
- Codebase memory as a search/index layer over files, symbols, chunks, and recency signals.
- A full memory management UI so users can inspect, edit, promote, forget, and validate memory.

This plan is desktop-first, file-first, and future-sync-friendly, but it does not design the future cloud sync layer yet.

## Goals

- Make Braian feel meaningfully smarter over time in a specific workspace.
- Keep canonical memory readable and exportable as files inside the workspace.
- Use SQLite and vector indexes as derived retrieval layers, not the only source of truth.
- Support importing existing workspaces that already contain `AGENTS.md`.
- Keep all raw transcripts on disk.
- Let the user understand, inspect, and correct memory behavior.

## Decisions Locked In

- `AGENTS.md` is the instruction standard Braian should use.
- Canonical memory should be file-first as a soft principle.
- Full chat transcripts should be retained indefinitely unless the user deletes them.
- Long-term memory promotion should start with explicit remembers plus model-suggested promotes.
- Short-term memory should use a token-budgeted working set, not a fixed message count.
- Conversation compaction should happen automatically when over budget.
- Semantic memory should be structured records, not a single markdown blob.
- Codebase memory should be a search/index system, not a durable user-authored memory layer.
- Preference memory should exist with clear scopes.
- Braian should provide a full memory management UI.
- For compatibility in existing agent workspaces, Braian should read `AGENTS.md` from day one.

## Non-Goals For V1

- Team/shared memory semantics.
- Cloud sync design and conflict resolution.
- Mobile-specific memory UX.
- Importing `.claude/`, `.cursor/rules/`, or external skill formats beyond `AGENTS.md`.
- A perfect autonomous self-editing memory writer from the start.

## Design Principles

### 1. Layered memory, not one memory file

Braian should not treat memory as a single blob. Different problems need different memory layers:

- Instruction memory: stable rules and workspace guidance.
- Working memory: recent conversation, open loops, session summary.
- Semantic memory: durable facts and patterns worth reusing.
- Episodic memory: what happened during past work.
- Codebase memory: searchable knowledge derived from files and history.
- Preference memory: user-specific defaults and corrections.

### 2. Hot memory should stay small

Only a compact, high-value subset should be injected into every turn:

- relevant `AGENTS.md` instructions
- current task/session summary
- recent conversation turns
- open loops
- top relevant semantic facts/preferences

Everything else should be recallable through retrieval tools.

### 3. Files are canonical; indexes are derived

User-facing durable memory should live as plain files in the workspace so it can be:

- inspected manually
- versioned when appropriate
- exported
- migrated
- synced later

SQLite and vector indexes should be rebuildable from workspace files.

### 4. Provenance everywhere

Durable memory entries should record:

- source conversation / file / path / tool run
- created time
- last validated time
- confidence
- invalidation or supersession links

Without provenance, memory quality degrades quickly.

### 5. Conservative promotion first

Braian should not aggressively auto-memorize everything. V1 should prefer:

- explicit `remember` actions
- memory suggestions with user confirmation when appropriate
- automatic promotion only after repeated corrections or repeated evidence

### 6. Dynamic retrieval over static prompt stuffing

Braian should follow the same high-level lesson seen in strong coding agents: keep startup context compact, and retrieve deeper context only when needed.

## Current State Summary

Current implementation is useful but intentionally simple:

- the full current conversation history is replayed every turn
- `.braian/MEMORY.md` is injected as workspace memory
- memory review rewrites that markdown file from recent chat turns
- there is no real short-term compaction system
- there is no structured semantic memory store
- there is no codebase memory index beyond normal search tooling
- there is no preference memory system beyond ad hoc context/profile behavior

V1 of this plan should treat the current `MEMORY.md` flow as transitional.

## Target Architecture

### A. Instruction memory

Instruction memory is not "memory" in the semantic sense. It is stable guidance.

Primary source:

- `AGENTS.md`

Behavior:

- Read `AGENTS.md` from the workspace root when present.
- Inject relevant parts into the model context every turn.
- Later support path-aware subsection loading, but root-file support is enough for V1.

Braian-owned files:

- `.braian/instructions/README.md`
- optional derived files later if we need split instructions, but `AGENTS.md` remains the compatibility anchor.

Rule:

- Braian should never silently rewrite `AGENTS.md`.
- If Braian wants to suggest changes to instruction memory, it should write its own files or propose edits explicitly.

### B. Short-term conversation memory

Every active chat should have four working-memory components:

1. recent verbatim turns
2. rolling session summary
3. open loops / unresolved items
4. archive pointer to full transcript

The turn builder should no longer send the whole conversation history. Instead it should build a token-budgeted working set:

- recent turns within a configured token budget
- session summary for older compacted material
- open loops block
- note that the full transcript is available on disk

This is the default memory used on every turn.

### C. Long-term semantic memory

Semantic memory stores durable reusable knowledge that should help future work.

Initial kinds:

- `fact`
- `decision`
- `preference`
- `episode`
- `pattern`

Each memory item should be a structured record with fields like:

- `id`
- `kind`
- `scope`
- `text`
- `summary`
- `confidence`
- `status` (`active`, `stale`, `superseded`, `archived`)
- `sourceRefs[]`
- `createdAt`
- `updatedAt`
- `lastValidatedAt`
- `supersedes[]`
- `tags[]`

Semantic memory should be stored as individual files plus indexed in SQLite.

### D. Codebase memory

Codebase memory is a retrieval/index layer, not a canonical user-authored memory system.

Its job:

- searchable file and chunk index
- lexical and semantic retrieval
- symbol/path lookup
- recency and git weighting
- links from semantic memory to relevant code/files

It should not be treated as always-injected prompt memory.

### E. Preference memory

Preference memory captures user-specific patterns such as:

- preferred tools and workflows
- style and verbosity preferences
- repo-specific behavior corrections
- repeated "not like that, do it this way" guidance

Preference scopes for desktop:

- global user preference
- workspace preference
- session-local preference

Preference writes in V1:

- explicit user remembers
- repeated corrections

## Canonical Workspace Layout

Recommended file layout under `.braian/`:

```text
.braian/
  conversations/
    <conversation-id>.json
  conversation-summaries/
    <conversation-id>.summary.json
  memory/
    index.md
    facts/
      <memory-id>.json
    decisions/
      <memory-id>.json
    preferences/
      <memory-id>.json
    episodes/
      <memory-id>.json
    patterns/
      <memory-id>.json
  preferences/
    workspace-preferences.json
  retrieval/
    code-index-state.json
  logs/
    tool-runs/
    terminal/
  instructions/
    README.md
```

Notes:

- `conversations/` remains canonical full transcript storage.
- `conversation-summaries/` contains compacted short-term summaries and open loops.
- `memory/index.md` is a human-readable generated overview, not the only source of truth.
- semantic memory records live as structured JSON files for portability and future sync.
- `preferences/workspace-preferences.json` holds explicit durable preference state that is not naturally part of `AGENTS.md`.

## Derived SQLite / Vector Index

SQLite should maintain derived indexes for fast retrieval.

Suggested tables:

- `memory_entries`
- `memory_sources`
- `conversation_summaries`
- `conversation_open_loops`
- `code_chunks`
- `code_symbols`
- `chunk_embeddings`
- `file_observations`
- `retrieval_events`

Suggested relationships:

- memory entry -> source conversation/message
- memory entry -> related file(s)
- memory entry -> related symbol(s)
- summary -> conversation
- chunk -> file path + byte/line span
- embedding -> chunk id

Vector storage can start with a local SQLite-friendly solution so desktop setup stays simple.

Preferred retrieval approach:

- lexical search
- symbol/path search
- semantic embedding search
- recency weighting
- git/change weighting

Do not rely on embeddings alone.

## Memory Record Shapes

### Semantic memory record

Illustrative shape:

```json
{
  "schemaVersion": 1,
  "id": "mem_...",
  "kind": "decision",
  "scope": "workspace",
  "text": "Workspace snapshots use libgit2 and store config in .braian/git-history.json.",
  "summary": "Workspace history is git-backed via libgit2.",
  "confidence": 0.92,
  "status": "active",
  "tags": ["git", "history", "workspace"],
  "sourceRefs": [
    {
      "type": "file",
      "path": "src-tauri/src/workspace_git.rs"
    },
    {
      "type": "conversation",
      "conversationId": "..."
    }
  ],
  "createdAt": "2026-04-10T00:00:00Z",
  "updatedAt": "2026-04-10T00:00:00Z",
  "lastValidatedAt": "2026-04-10T00:00:00Z",
  "supersedes": []
}
```

### Conversation summary record

Illustrative shape:

```json
{
  "schemaVersion": 1,
  "conversationId": "...",
  "updatedAt": "2026-04-10T00:00:00Z",
  "coveredMessageIds": ["...", "..."],
  "summary": "Compact summary of earlier turns.",
  "openLoops": [
    "Need to implement token-budgeted short-term memory.",
    "Need a memory management UI."
  ],
  "importantDecisions": [
    "Use AGENTS.md as the instruction standard."
  ]
}
```

## Context Assembly Per Turn

Target turn assembly order for workspace chats:

1. system instructions from routing/core harness
2. relevant `AGENTS.md` content
3. user profile / client-time context
4. current session summary
5. open loops
6. top relevant semantic memory entries
7. recent verbatim conversation turns within token budget
8. optional attached files / canvas snapshot / tool-specific context
9. tools

Important rule:

- older raw transcript text should not be injected by default once compacted out of the hot working set
- instead, the turn should include an archive hint and retrieval tools so the agent can recall older detail when needed

## Retrieval Tools To Add

Braian should grow explicit memory tools instead of only relying on prompt injection.

Suggested tools:

- `search_conversation_archive`
- `open_conversation_span`
- `get_conversation_summary`
- `search_workspace_memory`
- `open_memory_entry`
- `remember_workspace_fact`
- `remember_workspace_preference`
- `forget_memory_entry`
- `mark_memory_stale`
- `validate_memory_entry`
- `search_codebase_index`
- `get_related_files_for_memory`

V1 can start smaller:

- `search_workspace_memory`
- `open_memory_entry`
- `search_conversation_archive`
- `remember_workspace_fact`
- `remember_workspace_preference`

## Promotion And Update Logic

### Explicit remember flow

When the user says some variation of:

- remember this
- always prefer X
- note that in this workspace Y

Braian should create or update a structured memory entry directly.

### Suggested promote flow

When the model detects candidate durable knowledge, it should be able to create a suggestion with:

- candidate text
- proposed kind
- confidence
- source refs

In early versions, suggestions should be reviewable in UI before becoming active memory unless confidence is very high and the type is safe.

### Repeated correction flow

If the user corrects the agent repeatedly on the same point, Braian should convert that into a preference or fact candidate.

Examples:

- repeated code-style corrections -> preference
- repeated "this file is the entrypoint" correction -> fact
- repeated "we do not use npm here" correction -> workspace preference

## Validation And Staleness

Memory entries should not live forever as unquestioned truth.

An entry should be marked `stale` or flagged for review when:

- related files changed significantly
- source content disappeared
- newer memory superseded it
- user contradicted it
- enough time elapsed without validation

Validation can happen by:

- explicit user confirmation
- fresh supporting evidence from files or tool output
- successful re-check against codebase index

## Memory Management UI

Braian should expose a first-class memory UI with:

- search across memory entries and summaries
- filters by kind, status, source, scope
- inspect provenance and related files
- edit memory text
- promote / demote / forget
- mark stale / validate
- review suggested memory promotions
- browse conversation summaries and open loops
- see why an entry was included in the last model context

V1 UI sections:

- `Instructions` (show detected `AGENTS.md`)
- `Workspace memory`
- `Preferences`
- `Conversation summaries`
- `Suggestions`

## Git And Exportability

Guidance for workspace files:

- full transcripts: file-backed and exportable
- summaries: file-backed and exportable
- instructions: file-backed and git-friendly
- preferences: file-backed and user-readable
- semantic memory files: file-backed but not necessarily ideal for git review noise

Recommendation:

- keep semantic memory file-backed in the workspace
- allow users to decide whether to commit it
- document that semantic memory may be noisy in git compared with curated instruction files

## Migration Plan

Current files to preserve:

- `.braian/conversations/*.json`
- `.braian/MEMORY.md`
- `.braian/memory-review-state.json`

Migration strategy:

1. keep existing conversation files as canonical transcripts
2. keep reading `.braian/MEMORY.md` during transition
3. introduce structured semantic memory store alongside it
4. generate `memory/index.md` and optionally continue generating `MEMORY.md` as a compatibility summary view
5. gradually stop treating `MEMORY.md` as the primary memory database
6. replace unbounded chat replay with summary + token-budgeted working memory

Important compatibility rule:

- do not break existing workspaces that only know about `.braian/MEMORY.md`

## Phased Desktop Implementation Plan

### Phase 0: stabilize and instrument current memory

Purpose:

- establish observability before changing behavior

Steps:

1. add diagnostics for prompt token usage and conversation-history size
2. log how much of each turn is occupied by history, memory, tools, and attachments
3. document current memory limitations in user-facing docs
4. detect and load `AGENTS.md` into workspace context

Exit criteria:

- we can measure current context pressure
- `AGENTS.md` is visible in context assembly

### Phase 1: short-term memory compaction

Purpose:

- stop replaying the full conversation each turn

Steps:

1. define token budget policy for short-term memory
2. add per-conversation summary file under `.braian/conversation-summaries/`
3. create compaction pipeline that summarizes older turns when over budget
4. track open loops and important decisions per conversation summary
5. change turn assembly to send:
  - session summary
  - open loops
  - recent verbatim turns within budget
  - archive hint
6. add archive retrieval tools for older transcript recall

Exit criteria:

- no turn sends the full conversation by default
- older turns remain recoverable via archive tools

### Phase 2: structured semantic memory

Purpose:

- replace single-file workspace memory as the main durable memory system

Steps:

1. add structured memory record format and storage layout
2. implement explicit remember flows for facts and preferences
3. implement suggested promotes from chat review pipeline
4. write semantic memory records as files under `.braian/memory/...`
5. index them in SQLite
6. generate a human-readable overview file
7. keep `MEMORY.md` as compatibility output during transition

Exit criteria:

- workspace durable memory exists as structured records
- explicit remember works without rewriting one monolithic file only

### Phase 3: validation and staleness

Purpose:

- keep memory trustworthy over time

Steps:

1. add source refs and related-file linking to memory records
2. detect stale entries when related files change
3. support superseding and invalidating memory entries
4. surface stale memory in the UI
5. add validation actions and background re-checks where cheap

Exit criteria:

- memory entries can become stale and be revalidated
- provenance is visible and actionable

### Phase 4: codebase memory index

Purpose:

- make the workspace deeply searchable beyond raw file reads

Steps:

1. build chunking pipeline for workspace files
2. add lexical index and symbol/path index
3. add local embeddings for semantic retrieval
4. store derived index state in SQLite
5. add hybrid ranking using lexical + semantic + recency signals
6. expose codebase search/retrieval tools to the agent
7. link semantic memory entries to related files and symbols

Exit criteria:

- code retrieval is hybrid and workspace-aware
- semantic memory can point to relevant code evidence

### Phase 5: preference memory

Purpose:

- make Braian adapt to the user over time

Steps:

1. define global/workspace/session preference models
2. add explicit preference remember actions
3. detect repeated corrections and suggest preference promotions
4. use preferences in prompt/context assembly
5. allow full preference editing in UI

Exit criteria:

- workspace and user preferences are durable and inspectable

### Phase 6: full memory management UI

Purpose:

- make memory transparent and user-controlled

Steps:

1. add memory browser/search UI
2. add provenance and related-file panels
3. add suggestion review queue
4. add summary/open-loop viewer
5. add last-turn context explanation for included memory
6. add export/open-in-folder affordances

Exit criteria:

- users can see, edit, and audit memory directly

## Suggested Order Of Actual Implementation

Recommended order for practical delivery:

1. `AGENTS.md` loading
2. prompt-budget instrumentation
3. short-term summary + compaction
4. archive retrieval tools
5. structured semantic memory
6. memory suggestion queue
7. validation/staleness
8. codebase hybrid index
9. preference memory
10. full memory UI polish

This order improves immediate quality quickly while leaving room for deeper retrieval work.

## Open Questions To Revisit Later

- Should semantic memory live directly under `.braian/memory/` as JSON or JSONL append logs plus materialized views?
- Should `MEMORY.md` remain generated long term or be retired after migration?
- Which embeddings model should be used locally on desktop?
- What heuristics should trigger automatic promote without explicit user confirmation?
- How should memory retrieval be ranked against pinned files, canvas, and chat summary when context is tight?

## Success Criteria

Braian memory is successful on desktop when:

- the model no longer degrades badly in long chats
- users can inspect why Braian "remembers" something
- important corrections are reused later
- older transcript details are recoverable on demand
- workspace-specific facts and decisions persist beyond one session
- code retrieval feels aware of the actual workspace, not just the current prompt
- the entire system remains understandable as files on disk

## Bottom Line

Braian should evolve from:

- full-history replay
- one generated `MEMORY.md`

to:

- compact hot working memory
- structured long-term semantic memory
- codebase retrieval indexes
- explicit preference memory
- transparent user-facing memory management
- `AGENTS.md`-compatible instruction loading

That architecture matches the product direction: local-first, inspectable, exportable, and able to become smarter over time inside a specific workspace.