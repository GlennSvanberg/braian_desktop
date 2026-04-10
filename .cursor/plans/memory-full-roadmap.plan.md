---
name: MEMORY_PLAN full implementation
overview: End-to-end execution roadmap for everything in MEMORY_PLAN.md through Phase 6, with locked technical decisions and no open questions. Phases 0–1 are treated as baseline with small documented close-out work; remaining work is sequenced in milestones P1-close through P7 plus documentation.
todos:
  - id: doc-debt-d0
    content: "D0: Update docs/app/memory.md and docs/app/model-context.md to match shipped Phase 0–1 behavior"
  - id: p1-close
    content: "P1-close: importantDecisions in conversation summaries + compaction prompt + turn injection"
  - id: p2a-files-tools
    content: "P2a: .braian/memory JSON layout, record schema, tools (search/open/remember), index.md, structured memory system block + transitional MEMORY.md"
  - id: p2b-sqlite
    content: "P2b: braian.db memory_entries + rebuild/upsert from workspace files (derived index)"
  - id: p2c-suggestions
    content: "P2c: file-backed suggestion queue + pipeline from memory review; confirm-before-activate policy"
  - id: p3-staleness
    content: "P3: forget/stale/validate tools, file-change staleness, supersession, provenance"
  - id: p4-codebase
    content: "P4: chunking, lexical+symbol+provider embeddings, SQLite chunks, hybrid rank, codebase tools"
  - id: p5-prefs
    content: "P5: global/workspace/session preference models, injection order, correction→suggestion"
  - id: p6-ui
    content: "P6: full memory UI sections per MEMORY_PLAN V1"
  - id: p7-migration
    content: "P7: MEMORY.md no longer primary; compatibility summary or pointer from structured store"
---

# MEMORY_PLAN — full implementation roadmap

This document is the single execution plan for [MEMORY_PLAN.md](MEMORY_PLAN.md). It covers every phased item through the full memory management UI and migration exit. **Phases 0–1 are baseline** (already implemented in the desktop app except where a close-out milestone below says otherwise).

## Locked decisions

These resolve items that MEMORY_PLAN leaves as “revisit later” so implementation proceeds without ambiguity.

| Topic | Decision |
|--------|-----------|
| Semantic record storage | One JSON file per record under `.braian/memory/{facts,decisions,preferences,episodes,patterns}/` with filenames derived from record `id`. Not JSONL for V1. |
| Derived SQLite | **Milestone P2b**, after file-first semantic memory ships. `braian.db` holds derived rows; workspace JSON files remain canonical; rebuild-from-disk is supported. |
| Codebase semantic search | **Provider embeddings only** (BYOK via existing AI settings). Chunk text is embedded with the configured provider; no bundled local embedding model in V1 of Phase 4. |
| Automatic promotion | No silent activation of suggested memory. Candidates go to a **suggestion queue**; activation requires explicit user confirmation in the Memory UI or through a dedicated confirm tool that records the user’s approval. |
| `MEMORY.md` end state | **P7**: structured `.braian/memory` is authoritative. `.braian/MEMORY.md` is a **generated read-only view** from structured records when memory changes. Until P7, keep injecting the existing hand-maintained file alongside structured memory. After P7, do not inject `MEMORY.md` into the model; it remains on disk for humans and git. |
| Open Questions section in MEMORY_PLAN | **Semantic format**: JSON files as above. **Embeddings for codebase**: provider-only. **Ranking under context pressure**: apply MEMORY_PLAN turn order; within the semantic block, prefer `active` entries, then by `updatedAt` descending, then cap by token budget. **Auto-promote heuristics**: deferred to suggestion queue + confirmation in V1. |

## Baseline already delivered (Phase 0–1)

The following are **done** in code; they are not replanned except for P1-close and D0.

- Token estimation, chat perf timings, context breakdown; `AGENTS.md` loaded via `loadAgentsMdSystemBlock` in [src/lib/ai/chat-turn-args.ts](src/lib/ai/chat-turn-args.ts).
- Max chat history tokens in AI settings; per-conversation `.braian/conversation-summaries/<id>.summary.json`; compaction in [src/lib/conversation/working-memory.ts](src/lib/conversation/working-memory.ts); trimmed history + working memory context.
- Eager archive tools [src/lib/ai/conversation-archive-tools.ts](src/lib/ai/conversation-archive-tools.ts): `search_conversation_archive`, `open_conversation_span`.
- Legacy: `.braian/MEMORY.md` still injected via `loadWorkspaceMemorySystemBlock`; `add_workspace_memory` appends markdown.

## Milestone D0 — User-facing documentation

**Goal:** Align public docs with behavior so Phase 0 exit criterion “document current memory limitations” is satisfied.

**Deliverables**

- Update [docs/app/memory.md](docs/app/memory.md) and [docs/app/model-context.md](docs/app/model-context.md): AGENTS.md injection, token-budgeted history, conversation summaries path, archive tools, what is not yet structured memory.

**Exit:** Docs describe the shipped Phase 0–1 system accurately; no placeholder language that contradicts the code.

---

## Milestone P1-close — Finish Phase 1 per MEMORY_PLAN

**Goal:** Match the illustrative conversation-summary record: include **important decisions** alongside summary, open loops, and covered message ids.

**Deliverables**

1. Extend the summary file schema (prefer `schemaVersion: 2` with migration on read: v1 → v2 adds empty `importantDecisions: []`).
2. Update the compaction system prompt in [src/lib/conversation/working-memory.ts](src/lib/conversation/working-memory.ts) so the model outputs `importantDecisions` (short strings, durable choices from the folded slice).
3. Parse and persist `importantDecisions` in the summary file.
4. Inject `importantDecisions` into the working-memory system section in [src/lib/ai/chat-turn-args.ts](src/lib/ai/chat-turn-args.ts) wherever summary and open loops are already shown.
5. Add eager tool `get_conversation_summary` reading the current conversation’s `.summary.json`. Tool schema follows AGENTS.md Zod rules.

**Exit:** Phase 1 steps 4–5 in MEMORY_PLAN are satisfied; archive tools remain as implemented.

---

## Milestone P2a — Structured semantic memory (files + tools + injection)

**Goal:** Phase 2 steps 1–4, 6–7 in MEMORY_PLAN: durable memory as structured workspace files, explicit remember flows, human overview, `MEMORY.md` still injected as transitional.

**Deliverables**

1. **Record schema** (Zod): Align fields with MEMORY_PLAN “Semantic memory record” (`schemaVersion`, `id`, `kind`, `scope`, `text`, `summary`, `confidence`, `status`, `tags`, `sourceRefs`, timestamps, `supersedes`). Single module under `src/lib/memory/` for types + validation.
2. **Paths:** Constants for `.braian/memory/`, subfolders per kind, `memory/index.md`.
3. **Store:** Create/read/list/update JSON via existing workspace file APIs; ensure directories exist on first write; regenerate **`memory/index.md`** after mutating writes (compact list: id, kind, summary, status, path).
4. **Tools** (eager, registered next to existing workspace memory tools in [src/lib/ai/chat-turn-args.ts](src/lib/ai/chat-turn-args.ts)):
   - `search_workspace_memory`
   - `open_memory_entry`
   - `remember_workspace_fact`
   - `remember_workspace_preference`  
   Tool inputs use only OpenAI-safe Zod constructs per AGENTS.md.
5. **Turn assembly:** Add a **structured semantic memory** system block: load active entries, apply token cap, insert in the order specified in MEMORY_PLAN “Context Assembly Per Turn” relative to session summary and open loops (structured memory at step 6 in the plan: after open loops, before recent verbatim turns). If the current code orders sections differently, **adjust order to match the plan** while keeping AGENTS.md and user profile placement coherent.
6. **Compatibility:** Continue loading `.braian/MEMORY.md` as today until P7.

**Exit:** Phase 2 exit criteria in MEMORY_PLAN are met for file-based semantic memory and explicit remember; monolithic markdown is no longer the only durable path.

---

## Milestone P2b — Derived SQLite index for semantic memory

**Goal:** Phase 2 step 5; MEMORY_PLAN “Derived SQLite / Vector Index” for memory entries only.

**Deliverables**

1. **Migration** in [src-tauri/src/db.rs](src-tauri/src/db.rs): new table `memory_entries` (or equivalent name) with at minimum: `workspace_id`, `entry_id`, `kind`, `summary`, `status`, `relative_path`, `updated_at_ms`.
2. **Tauri commands:** Rebuild index by scanning `.braian/memory/**/*.json` for a workspace; **upsert after every successful TS write**; expose rebuild for repair after crashes or manual file edits.
3. **TS integration:** After successful file write in the semantic store, call upsert; on workspace open or first use, ensure consistency via rebuild if needed.
4. **`search_workspace_memory`:** Use SQLite for fast listing/filtering where helpful; always reconcile with file content for `open_memory_entry`.

**Exit:** Derived index exists; files remain source of truth; rebuild reproduces the table.

---

## Milestone P2c — Suggested promote queue

**Goal:** MEMORY_PLAN “Promotion And Update Logic” / “Suggested promote flow” and suggested order item “memory suggestion queue”.

**Deliverables**

1. **Storage:** Pending suggestions as JSON files under `.braian/memory/_suggestions/<suggestion-id>.json` (fields: candidate text, proposed kind, confidence, source refs, created at, status pending or superseded).
2. **Writers:** Hook the existing memory review path ([src/lib/memory/](src/lib/memory/)) so review can emit suggestion files instead of only touching `MEMORY.md` where appropriate.
3. **Activation:** New tool or UI action path to promote a suggestion to a real record (writes under the kind folder and updates index). No automatic activation without user confirmation through UI or explicit confirm tool.

**Exit:** Suggestions are durable and reviewable; promotion creates canonical structured records.

---

## Milestone P3 — Validation and staleness

**Goal:** Full Phase 3 in MEMORY_PLAN.

**Deliverables**

1. **Tools:** `forget_memory_entry`, `mark_memory_stale`, `validate_memory_entry` (and wire names into tool map / diagnostics).
2. **Provenance:** Enforce `sourceRefs` on writes from tools; support file and conversation refs as in the plan.
3. **Staleness:** When related workspace files change (reuse existing workspace activity or git snapshot signals where available), mark affected entries stale or queue for review; respect `supersedes` / status transitions.
4. **UI:** Ship a minimal stale indicator in existing workspace memory surfaces in P3; full staleness UX is completed in P6.

**Exit:** Entries can be stale, superseded, forgotten, or validated with updated `lastValidatedAt`.

---

## Milestone P4 — Codebase memory index

**Goal:** Full Phase 4 in MEMORY_PLAN with **provider embeddings** for semantic chunk retrieval.

**Deliverables**

1. **Chunking:** Pipeline that splits workspace files into chunks with path + line/byte span metadata.
2. **Indexes:** Lexical and symbol/path indexes stored in SQLite; **chunk embeddings** via configured LLM provider embedding API; store vectors or provider-specific embedding payloads per chosen storage strategy in SQLite or auxiliary table as implemented in Rust.
3. **Hybrid ranking:** Combine lexical + semantic + recency (and git weighting if available from existing workspace git integration).
4. **Tools:** `search_codebase_index`, `get_related_files_for_memory` exposed to the agent eagerly where other memory tools live.
5. **Linking:** Semantic memory records can store related file paths; retrieval uses index to suggest evidence.

**Exit:** Phase 4 exit criteria in MEMORY_PLAN: hybrid workspace-aware code retrieval; memory entries can point to code evidence.

---

## Milestone P5 — Preference memory (scopes)

**Goal:** Full Phase 5 in MEMORY_PLAN. Builds on `remember_workspace_preference` and structured preference files.

**Deliverables**

1. **Models:** Three scopes with defined storage: **global** (app data directory JSON), **workspace** (`.braian/preferences/workspace-preferences.json` plus structured preference records under `.braian/memory/preferences/` as already used), **session** (ephemeral or session-scoped file under `.braian/` if persisted per session id).
2. **Injection:** Merge preferences into context assembly per MEMORY_PLAN order after AGENTS.md and user profile as specified in the plan.
3. **Repeated correction:** Detector writes **preference candidates** into the P2c suggestion queue rather than auto-writing durable prefs.
4. **Editing:** CRUD via APIs used by P6 UI; session scope may be read-only in UI if product prefers.

**Exit:** Workspace and global preferences are durable, inspectable, and injected; session scope is defined and applied for the chat session.

---

## Milestone P6 — Full memory management UI

**Goal:** Phase 6 and “V1 UI sections” in MEMORY_PLAN.

**Deliverables**

1. **Sections:** Instructions (`AGENTS.md` detection and viewer), Workspace memory (structured entries + transitional `MEMORY.md` view), Preferences (global + workspace + session summary), Conversation summaries (per-chat summary + open loops + important decisions), Suggestions (P2c queue).
2. **Capabilities:** Search and filters by kind, status, scope, source; inspect provenance and related files; edit text; promote, demote, forget; mark stale and validate; browse summaries; show why an entry appeared in last turn (trace from chat-turn-args logging or a small “last inclusion” cache); export and open-in-folder for `.braian/memory`.

**Exit:** Users can see, edit, and audit memory without relying on raw JSON editing.

---

## Milestone P7 — Migration completion (`MEMORY.md`)

**Goal:** MEMORY_PLAN migration steps 5–6.

**Deliverables**

1. **Primary store:** Structured `.braian/memory` is the source of truth for durable workspace memory content.
2. **`MEMORY.md`:** Regenerate `.braian/MEMORY.md` from structured records after writes (same path, compatibility for tools and git). Workspaces that only have a legacy hand-written `MEMORY.md` and empty structured storage run a **one-time import** on first open that creates structured records from the legacy file content before generation takes over.
3. **Turn injection:** After P7, the model receives the **structured semantic memory system block** built from JSON only. Generated `.braian/MEMORY.md` is **not** injected into the prompt; it exists for humans, git, and external tools. AGENTS.md, user profile, working memory, and verbatim turns follow MEMORY_PLAN “Context Assembly Per Turn” order.

**Exit:** Migration plan in MEMORY_PLAN is complete; no reliance on a single handwritten markdown file as the database.

---

## Verification and success

- **Automated tests:** Add or extend Vitest for semantic record parsing, tool schemas, compaction summary shape, and pure ranking helpers. Rust tests for SQLite migrations where non-trivial.
- **Manual QA:** Follow [TESTING.md](TESTING.md) and extend scenarios when P4–P6 land.
- **Success criteria:** Match MEMORY_PLAN “Success Criteria” and “Bottom Line” sections when all milestones are complete.

---

## Implementation order (strict)

Execute milestones in this order: **D0 → P1-close → P2a → P2b → P2c → P3 → P4 → P5 → P6 → P7**.

No parallel forks are required; P2b must follow P2a; P6 assumes P2c and P3 data model; P7 is last.

---

## MEMORY_PLAN.md maintenance

After each milestone ships, append or update the **Repository status** subsection under “Phased Desktop Implementation Plan” in [MEMORY_PLAN.md](MEMORY_PLAN.md) with the milestone id, key file paths, and the date, so the living doc stays aligned with this roadmap.
