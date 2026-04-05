# Connections (MCP)

Braian uses the **Model Context Protocol (MCP)** shape for **workspace connections**: small programs or HTTP endpoints that *could* extend what an assistant can do (extra tools, resources, prompts). In the app UI this feature is labeled **Connections** so it stays approachable; the on-disk format matches what **Cursor** uses for MCP servers.

## Where configuration lives

- **File:** `.braian/mcp.json` inside the **active workspace** folder (created when you add a connection or when the app seeds `.braian`).
- **Shape:** A top-level **`mcpServers`** object. Each **key** is a server name (for example `github`, `p360-rest`); each **value** is the JSON object for that server—the same object you would put under `mcpServers` in Cursor.

### Stdio servers (local CLI)

The process is started with **`command`** and optional **`args`**, **`env`**, and optional **`cwd`** (relative to the workspace root; must stay inside the workspace).

### Remote servers (HTTP)

The entry uses **`url`** and optional **`headers`** instead of `command` / `args`. This matches Cursor-style remote MCP configuration.

### Braian-only: on/off without editing Cursor JSON

Cursor’s usual file does not define a standard **disabled** flag per server. Braian keeps each server’s entry identical to what you would copy into Cursor, and stores **off** state separately:

```json
{
  "mcpServers": { "my-server": { "command": "npx", "args": ["-y", "…"] } },
  "braian": {
    "disabledMcpServers": ["my-server"]
  }
}
```

A server is **on** in Braian when its name is **not** listed in `braian.disabledMcpServers`. The **Connections** screen **Copy for Cursor** action copies only `{ "mcpServers": … }` so you can paste into Cursor without the Braian overlay.

## Status indicators (green / red)

The **Connections** list can **check** each configured server:

- **Stdio:** The desktop app starts the server, runs a short **MCP JSON-RPC** handshake over the process’s stdin/stdout (`initialize` → `notifications/initialized` → `tools/list`), then stops the process. A **green** status means that succeeded; the subtitle shows how many **tools** were discovered. Expand **Show tool names** to see the list. A **red** status means spawn, protocol, or timeout failure; use **Error — Show output** to see a trimmed message (including stderr when useful).
- **Remote:** The app uses the **Streamable HTTP** style: **POST** requests to your **`url`** with JSON-RPC 2.0 (`initialize` → `notifications/initialized` → `tools/list`), sending your **`headers`** and honoring **`Mcp-Session-Id`** when the server sets it. **Green** means the full handshake and tool listing succeeded (same tool count and expandable names as stdio). **Red** means the HTTP transport or MCP protocol failed—open **Error — Show output** for the message.

**Check status** refreshes all probes. Probes also run when the workspace connection list changes.

## In chat (assistant tools)

When a server is **on** in Braian (not in `braian.disabledMcpServers`), its MCP tools are offered to the model in **workspace chats** (desktop app only):

- Tool names are namespaced as `mcp__<server>__<tool>` (safe slugged identifiers).
- Each turn, the app calls **`tools/list`** on enabled servers (stdio and remote), builds TanStack tools, then tears down MCP sessions when the reply stream finishes so local processes are not left running.
- If one server fails listing, other servers still work; you may see a short warning in the turn’s settings warnings.
- **Remote** servers use the same JSON-RPC POST session as the status check; very custom gateways may need a URL that speaks MCP over HTTP as above.

Workspace file, command, canvas, skills, and dashboard tools stay separate; routing instructions remind the model to use `mcp__*` tools for external systems and built-in tools for files under the workspace.

## Security and Git

- **`env`** and **`headers`** often hold API keys or tokens. If the workspace is a Git repository, **do not commit secrets**—use `.gitignore` on `mcp.json` if needed, or keep tokens in environment variables your shell provides and reference them only indirectly.
- Servers run **on your machine** with the privileges of the desktop app; keep `.braian/mcp.json` to sources you trust.

## Editing connections

Use the **gear icon** next to a workspace name in the sidebar (**Workspace settings**), then manage **Connections** there. You can use the **form**, the **JSON** editor for the single server object, or paste a snippet from another tool; **Save** validates the JSON object before writing the file.

## Related

- [Tools](/docs/tools) — built-in assistant tools (files, commands, skills, dashboard)
- [Capabilities](/docs/capabilities) — workspace scope and limits
- [Overview](/docs/overview) — workspaces and desktop vs browser
- [Model context](/docs/model-context) — what the model sees each turn (including MCP tool definitions when Connections are enabled)
