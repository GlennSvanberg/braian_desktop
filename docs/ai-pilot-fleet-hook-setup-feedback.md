# AI Pilot Fleet hook — setup feedback (vs. original instructions)

This document records what had to change from the **original one-shot prompt** (`.cursor/hooks.json` + `track-agent.sh` + `chmod`) so the hook actually loads in Cursor and runs on **Windows** without errors.

---

## 1. `hooks.json` must include `"version": 1`

**Original:** Top-level object had only `"hooks": { ... }`.

**Change:** Cursor’s documented schema requires a `**version`** field (currently `1`). Without it, the file may be ignored and **Settings → Hooks** can show **no hook configured** even after reload.

**Reference:** [Cursor Hooks docs](https://cursor.com/docs/hooks) — all examples use `"version": 1`.

---

## 2. Hook `command` format

**Original:** `"command": "bash .cursor/hooks/track-agent.sh"`.

**Working state:** The docs typically use the **script path** as the command (e.g. `.cursor/hooks/format.sh`) relative to the **project root** for project hooks.

For this repo we ended on:

```json
"command": "node .cursor/hooks/track-agent.mjs"
```

because of Windows behavior (see below). The important part is a **single, valid command** Cursor can spawn from the project root.

---

## 3. Windows: `.sh` triggered “Open with…”

**Issue:** On Windows, `.sh` is not executed like on Unix. Cursor spawning `.cursor/hooks/track-agent.sh` (or `bash` not being resolved the same way) led to the OS **“Open with”** dialog instead of running the tracker.

**Change:** Added a **cross-platform Node** hook script: `.cursor/hooks/track-agent.mjs`, and pointed `hooks.json` at `node .cursor/hooks/track-agent.mjs`. Node is already required for this project, so this avoids shell association issues and works on Windows, macOS, and Linux.

The original `**track-agent.sh`** remains in the repo as an optional Unix-oriented reference; the **live** hook is the `.mjs` file.

---

## 4. Windows: `chmod` in the original steps

**Original step:** `chmod +x .cursor/hooks/track-agent.sh`.

**Reality:** Native **PowerShell** often has no `chmod`. It worked when run via **Git Bash**, e.g. `"/c/Program Files/Git/bin/bash.exe" -c "chmod +x ..."`.

Once the hook moved to **Node**, the executable bit on `.sh` is no longer required for the Cursor hook path.

---

## 5. First-time pilot registration vs. hook stdin

**Original bash:** On first run, `read -p "Choose your pilot handle"` and interactive registration.

**Hook reality:** Cursor **command hooks receive JSON on stdin** (for `afterAgentResponse`, the payload includes assistant `text`, per docs). The hook environment is **not** a normal interactive TTY for prompts, so the original “ask for handle inside the hook” pattern is unreliable.

**Change in `track-agent.mjs`:**

- **One-time registration in a real terminal:**  
`node .cursor/hooks/track-agent.mjs --register`
- **Optional non-interactive first run:** set env `**AI_PILOT_HANDLE`** so the script can register without a prompt when `~/.ai-pilot-config` is missing.

The hook **drains stdin** so the process does not block on unread pipe data.

---

## 6. Behavior preserved from the original design

- Same `**~/.ai-pilot-config`** format (`PILOT_ID=…`, `API_TOKEN=…`).
- Same **Supabase** URLs for register and ingest.
- Same **environment variables** used when present (`CURSOR_AGENT_MODEL`, token counts, etc.), with sensible defaults.

---

## 7. Files involved (current)


| File                            | Role                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `.cursor/hooks.json`            | Declares `afterAgentResponse` → `node .cursor/hooks/track-agent.mjs`, with `"version": 1`. |
| `.cursor/hooks/track-agent.mjs` | Cross-platform implementation used by Cursor.                                              |
| `.cursor/hooks/track-agent.sh`  | Legacy/reference bash script; not used by `hooks.json` after the Node migration.           |


---

## Summary checklist for anyone repeating this setup

1. Include `**"version": 1`** in `hooks.json`.
2. On **Windows**, prefer **Node** (or another always-runnable command) over relying on `.sh` execution or file associations.
3. Do **first-time registration** outside the hook (`--register` or `AI_PILOT_HANDLE`), not with `read` inside the hook.
4. **Drain stdin** in the hook script so the hook protocol is satisfied.

