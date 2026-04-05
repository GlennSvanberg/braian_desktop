# Testing Braian Desktop

This document covers **automated tests**, the **headless `braian-ai` CLI** (evaluate the AI pipeline without the UI), and how that ties to **manual chat QA** in [`testcases.md`](testcases.md).

## Quick reference

| Goal | Command |
|------|---------|
| Unit / integration tests | `npm run test` |
| Print built model request (JSON, no network) | `npm run ai:dump -- --user "…"` (see below) |
| One-shot model reply from Node | `npm run ai:stream -- --user "…"` (requires API env vars) |
| Full product QA (tools, canvas, disk) | `npm run tauri:dev` + [`testcases.md`](testcases.md) |

---

## Headless CLI: `braian-ai`

**Entrypoint:** [`src/cli/braian-ai.ts`](src/cli/braian-ai.ts)  
**Purpose:** Reuse the same **`buildTanStackChatTurnArgs`** / streaming path as the desktop app so you can inspect **system prompts, messages, and tool definitions** or run a **single provider turn** from Node—without opening the WebView.

**Help:**

```bash
npx tsx src/cli/braian-ai.ts --help
```

**NPM shortcuts** (pass CLI flags after `--`):

```bash
npm run ai:dump -- --user "Your message"
npm run ai:stream -- --user "Your message"
```

### Command: `dump-request`

Builds the turn exactly like the app (for the given context) and prints a **JSON snapshot** to stdout: system sections, message list, tool metadata, provider/model, settings warnings. The snapshot **does not include** the API key.

- **No network** — safe for CI and quick diffing of prompts.
- Use **`--allow-incomplete-settings`** to build a snapshot when `BRAIAN_AI_API_KEY` (or model) is missing; otherwise missing settings produce warnings or errors like the app.

**Examples:**

```bash
# Default context: detached workspace, document mode, no saved conversation
npm run ai:dump -- --user "hello" --allow-incomplete-settings

# Saved conversation + workspace (tools like open_document_canvas appear when conversationId is set)
npm run ai:dump -- --user "Update the doc" --context ./path/to/context.json --allow-incomplete-settings
```

### Command: `stream`

Calls the configured provider using **Node `fetch`** (no CORS). By default **tools are stripped** so the model cannot invoke Tauri-only workspace handlers from Node.

- Set **`BRAIAN_AI_API_KEY`**, **`BRAIAN_AI_MODEL`** (or rely on defaults), and **`BRAIAN_AI_BASE_URL`** when using `openai_compatible`.
- **`--tools`** registers real tools; workspace tools will **fail** at execution without the desktop runtime—use only when you know the turn stays textual (e.g. profile-style tools) or for debugging.
- **`--trace`** prints each stream chunk as one JSON line on **stderr**; assistant text still goes to **stdout**.

**Example:**

```bash
set BRAIAN_AI_PROVIDER=openai
set BRAIAN_AI_API_KEY=sk-...
set BRAIAN_AI_MODEL=gpt-4o-mini
npm run ai:stream -- --user "Say hi in one sentence."
```

(On Unix, use `export VAR=value`.)

### Environment variables

| Variable | Meaning |
|----------|---------|
| `BRAIAN_AI_PROVIDER` | `openai` (default), `anthropic`, `gemini`, `openai_compatible` |
| `BRAIAN_AI_API_KEY` | Provider API key (required for `stream`) |
| `BRAIAN_AI_MODEL` | Model id; default is the catalog’s first model for the provider |
| `BRAIAN_AI_BASE_URL` | Required for `openai_compatible` |

### Flags (both commands unless noted)

| Flag | Description |
|------|-------------|
| `--user <text>` \| `-` | User message; `-` reads message body from stdin |
| `--context <path>` | JSON file (see below) |
| `--history <path>` | JSON array of `{ "role": "user" \| "assistant", "content": string }` |
| `--allow-incomplete-settings` | **`dump-request` only** — allow building args without a valid key/model |
| `--tools` | **`stream` only** — do not strip tools (see warning above) |
| `--trace` | **`stream` only** — chunk log on stderr |

### `--context` JSON shape

The file is validated against a small schema in the CLI. Typical fields (see [`ChatTurnContext`](src/lib/ai/types.ts)):

| Field | Type | Notes |
|-------|------|--------|
| `workspaceId` | string | Required. Use `__braian_detached__` for “no workspace folder” behavior; real ids for workspace-scoped prompts |
| `conversationId` | string \| null | `null` = unsaved chat → **no** document canvas tools |
| `agentMode` | `"document"` \| `"code"` \| `"app"` | Document = triage + lazy code/dashboard tools; code = eager coding tools, lazy dashboard; app = eager coding + eager dashboard + app-builder instructions |
| `turnKind` | `"profile"` | Optional; profile coach turn (sidebar → You) |
| `appHarnessEnabled` | boolean | Optional **legacy**; merged into `agentMode` (`true` → treat as App when paired with document/code) — prefer setting `agentMode` to `"app"` |
| `documentCanvasSnapshot` | `{ body, title?, revision?, selection? }` \| null | Optional; `revision` defaults to `0` in CLI if omitted |
| `contextFiles` | array | Optional; `{ relativePath, text, displayName?, fileTruncated? }` — same idea as file attachments in the UI |

If `--context` is omitted, the CLI uses a **detached** workspace, `conversationId: null`, `agentMode: document`.

### CLI limitations (vs `tauri:dev`)

- **Workspace tools** (`read_workspace_file`, `run_workspace_command`, etc.) execute via Tauri **`invoke`** in the app; under Node they **throw** unless you only use modes that never call them.
- **`.braian/MEMORY.md`** is read through the same API; without Tauri the memory block is usually **empty** in dumps. Real injection on disk is verified in the app or with a **mocked** unit test (see below).
- **Skill catalog** on disk is not loaded in Node (`isTauri()` is false); dumps use **embedded / empty catalog** text, same as a web preview.

For behavior that depends on **real files, canvas write-back, and command execution**, follow [`testcases.md`](testcases.md) in the desktop app.

---

## Automated tests

```bash
npm run test
```

- **General:** Vitest across `src/**/*.test.ts` (see `test` in [`vite.config.ts`](vite.config.ts)).
- **CLI vs [`testcases.md`](testcases.md):** [`src/cli/braian-ai.testcases.integration.test.ts`](src/cli/braian-ai.testcases.integration.test.ts) runs **`dump-request` in a subprocess** with JSON contexts aligned to manual cases §§1–5 (tool lists and system text—**no** live LLM calls).
- **Memory §5 (file content):** [`src/lib/ai/chat-turn-args.test.ts`](src/lib/ai/chat-turn-args.test.ts) includes a **`testcases.md §5`** example with a mocked `workspaceReadTextFile` for `MEMORY.md`.

[`testcases.md`](testcases.md) has a short **“Automated alignment”** section linking these files.

### CI / pre-merge checklist (recommended)

Run from the repo root:

```bash
npm run test
npm run build
npx tsc --noEmit
```

For the Rust shell:

```bash
cd src-tauri && cargo check
```

These cover the headless CLI tests, the web/Tauri client build, TypeScript (including paths Vitest does not compile), and Tauri commands. **Live LLM calls** are not part of CI; use `ai:stream` locally with your key when you need that.

Some environments (e.g. Node started with experimental `localStorage` / `--localstorage-file` in `NODE_OPTIONS`) may print a harmless warning during `npm run test`; the suite should still pass. The CLI integration tests drop `NODE_OPTIONS` for the `tsx` subprocess to avoid extra noise there.

**Parallel work (e.g. MCP):** after merging branches that touch chat tools, workspace APIs, or `buildTanStackChatTurnArgs`, re-run the checklist above and, if prompts or tool lists changed, update expectations in [`src/cli/braian-ai.testcases.integration.test.ts`](src/cli/braian-ai.testcases.integration.test.ts) / [`src/lib/ai/chat-turn-args.test.ts`](src/lib/ai/chat-turn-args.test.ts).

---

## Manual chat QA

See **[`testcases.md`](testcases.md)** for end-to-end scenarios (CSV → Excel, document canvas, unsaved chat guardrails, workspace reads, `MEMORY.md`). Run **`npm run tauri:dev`**, configure Settings (provider, model, key), and use a real workspace as described there.

---

## Related docs

- App and stack commands: [`AGENTS.md`](AGENTS.md)  
- AI layer decisions: [`docs/AI.md`](docs/AI.md)
