/**
 * Cursor-compatible workspace MCP config at `.braian/mcp.json`.
 * @see https://cursor.com/docs/context/mcp
 */

/** Stdio MCP server entry (Cursor shape). */
export type McpStdioServerEntry = {
  command: string
  args?: string[]
  env?: Record<string, string>
}

/** Remote MCP server entry (Cursor shape). */
export type McpRemoteServerEntry = {
  url: string
  headers?: Record<string, string>
}

/** Single server: stdio or remote; extra keys preserved when round-tripping. */
export type McpServerEntryJson = Record<string, unknown>

export type BraianMcpOverlay = {
  /** Server names disabled in Braian only; omitted from "Copy for Cursor". */
  disabledMcpServers?: string[]
  /** Optional default per-chat active servers for newly created conversations. */
  defaultActiveMcpServers?: string[]
}

export type WorkspaceMcpConfigDocument = {
  mcpServers: Record<string, McpServerEntryJson>
  braian?: BraianMcpOverlay
}

export const EMPTY_MCP_CONFIG: WorkspaceMcpConfigDocument = {
  mcpServers: {},
}

export function isRemoteServer(entry: McpServerEntryJson): boolean {
  const u = entry.url
  return typeof u === 'string' && u.trim().length > 0
}

export function serverSummaryLine(
  name: string,
  entry: McpServerEntryJson,
): string {
  if (isRemoteServer(entry)) {
    const url = String(entry.url ?? '')
    return url.length > 80 ? `${url.slice(0, 77)}…` : url
  }
  const cmd = typeof entry.command === 'string' ? entry.command : ''
  const args = Array.isArray(entry.args)
    ? entry.args.filter((a) => typeof a === 'string')
    : []
  const tail = args.length ? ` ${args.join(' ')}` : ''
  const line = `${cmd}${tail}`.trim() || name
  return line.length > 100 ? `${line.slice(0, 97)}…` : line
}

export function isServerEntryValid(entry: McpServerEntryJson): boolean {
  if (isRemoteServer(entry)) return true
  const c = entry.command
  return typeof c === 'string' && c.trim().length > 0
}

export function disabledSetFromDoc(
  doc: WorkspaceMcpConfigDocument,
): Set<string> {
  const raw = doc.braian?.disabledMcpServers ?? []
  return new Set(raw.filter((n) => typeof n === 'string' && n.length > 0))
}

export function defaultActiveSetFromDoc(
  doc: WorkspaceMcpConfigDocument,
): Set<string> {
  const raw = doc.braian?.defaultActiveMcpServers ?? []
  return new Set(raw.filter((n) => typeof n === 'string' && n.length > 0))
}

export function isServerEnabled(
  name: string,
  doc: WorkspaceMcpConfigDocument,
): boolean {
  return !disabledSetFromDoc(doc).has(name)
}
