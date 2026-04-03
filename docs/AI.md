# AI layer — decisions and reasoning

This document records **why** Braian Desktop uses **TanStack AI** for the LLM integration layer, and how that choice fits the rest of the stack. Product vision (artifacts, workspace, MCP) stays in [`NOTES.md`](../NOTES.md).

## Decision

**Use [TanStack AI](https://tanstack.com/ai/latest)** as the primary TypeScript SDK for chat streaming, multi-provider configuration (bring-your-own-key), and tool/function calling.

The package set is still **alpha**; expect API adjustments as the library matures. Revisit this doc when upgrading major versions.

## Alternatives considered

| Option | Why not the default (for us) |
|--------|------------------------------|
| **Vercel AI SDK** (`ai` + `@ai-sdk/*`) | Mature and widely used; excellent default for many apps. We prefer **one TanStack-shaped surface** (Start / Router / Query / AI) and direct alignment with the same project values (open SDK, multi-provider, no middleman). |
| **LangChain.js / LangGraph** | Strong for heavy RAG and complex graphs. Likely **more abstraction than needed** for the first Braian loops (chat + tools + Tauri commands). Revisit if orchestration becomes graph-heavy. |
| **OpenRouter-only** | Single HTTP surface, but keys and features are **OpenRouter-shaped**, not always equivalent to native provider APIs. BYOK may mean “direct OpenAI / Anthropic / Google keys” for some users. |
| **Custom HTTP per provider** | Maximum control, but duplicates streaming, tool protocols, and retries across vendors—**high maintenance** for little unique benefit. |

## Why TanStack AI fits Braian

1. **Stack coherence** — Same ecosystem as TanStack Start and Router already in the repo; one mental model and documentation hub for app authors.
2. **Multi-provider, BYOK** — Unified interface across providers (e.g. OpenAI, Anthropic, Google Gemini, Ollama per upstream docs) without vendor-specific call sites scattered through the UI.
3. **TypeScript-first** — Tool definitions, streaming, and adapters stay in the same language as the React UI and server functions.
4. **Server-agnostic** — Fits a **Tauri** app: model calls can run where we choose (e.g. TanStack server functions, a small local helper, or carefully scoped client-side invocations), without requiring a hosted “AI backend” product.
5. **Tools and execution** — Built-in direction toward tool loops and structured outputs matches Braian’s plan: **chat agent**, specialized behaviors (code/workspace vs document editing), and **Tauri commands** (or MCP) as the real implementation of filesystem and execution—not raw trust in the webview.

## Non-goals (for this layer)

- **TanStack AI does not replace Tauri** — Keys, path sandboxing, subprocess execution, and SQLite remain Rust-side concerns; the LLM layer only orchestrates calls and tools.
- **Not a commitment to every provider on day one** — Enable providers as product needs and adapter support dictate; keep provider config in local settings / SQLite per product design.

## Implementation hints (for agents editing the repo)

- Prefer a **thin internal facade** (e.g. `streamChat`, provider factory from stored settings) so UI and artifact adapters do not import provider SDKs directly everywhere.
- Preserve existing **chunk / artifact shapes** from [`src/lib/ai/types.ts`](../src/lib/ai/types.ts) where possible so `ArtifactPanel` and stores stay stable.
- Shell-shaped tools (`run_command` with workspace-scoped cwd) can sit **behind** Tauri `invoke` for safety; see discussions in [`AGENTS.md`](../AGENTS.md).

## Agent skill (usage patterns)

TanStack AI is young; for **coding-agent–oriented** guidance (APIs, tools, providers), install the community skill from [skills.sh](https://skills.sh/):

```bash
npx skills add tanstack-skills/tanstack-skills@tanstack-ai
```

- Listing: [tanstack-ai on skills.sh](https://skills.sh/tanstack-skills/tanstack-skills/tanstack-ai)  
- Search for updates: `npx skills find "tanstack ai"`

Other hits from the same search are mostly **TanStack Start** or **TanStack Table**, not the AI SDK—use the package id above for AI specifically.

## References

- TanStack AI: [https://tanstack.com/ai/latest](https://tanstack.com/ai/latest)
- Repo agent conventions: [`AGENTS.md`](../AGENTS.md)
- Product and artifact notes: [`NOTES.md`](../NOTES.md)
