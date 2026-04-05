import { useCallback, useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Copy, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useWorkspace } from '@/components/app/workspace-context'
import {
  workspaceMcpConfigGet,
  workspaceMcpConfigSet,
} from '@/lib/connections-api'
import {
  disabledSetFromDoc,
  isRemoteServer,
  isServerEnabled,
  isServerEntryValid,
  serverSummaryLine,
  type McpServerEntryJson,
  type WorkspaceMcpConfigDocument,
} from '@/lib/mcp-config-types'
import { isTauri } from '@/lib/tauri-env'

export const Route = createFileRoute('/_shell/connections')({
  component: ConnectionsPage,
})

type ConnKind = 'stdio' | 'remote'

type KvRow = { key: string; value: string }

function emptyKv(): KvRow[] {
  return [{ key: '', value: '' }]
}

function kvToRecord(rows: KvRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows) {
    const k = r.key.trim()
    if (!k) continue
    out[k] = r.value
  }
  return out
}

function recordToKv(rec: Record<string, string> | undefined): KvRow[] {
  if (!rec || Object.keys(rec).length === 0) return emptyKv()
  return Object.entries(rec).map(([key, value]) => ({ key, value }))
}

function argsToText(args: unknown): string {
  if (!Array.isArray(args)) return ''
  return args.filter((a) => typeof a === 'string').join('\n')
}

function parseArgsText(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

function cloneDoc(d: WorkspaceMcpConfigDocument): WorkspaceMcpConfigDocument {
  return {
    mcpServers: { ...d.mcpServers },
    braian: d.braian?.disabledMcpServers?.length
      ? { disabledMcpServers: [...d.braian.disabledMcpServers] }
      : undefined,
  }
}

function hydrateFormFromEntry(
  entry: McpServerEntryJson,
  setters: {
    setDraftKind: (k: ConnKind) => void
    setDraftCommand: (s: string) => void
    setDraftArgs: (s: string) => void
    setDraftUrl: (s: string) => void
    setDraftEnvRows: (r: KvRow[]) => void
    setDraftHeaderRows: (r: KvRow[]) => void
  },
) {
  const remote = isRemoteServer(entry)
  setters.setDraftKind(remote ? 'remote' : 'stdio')
  setters.setDraftCommand(
    typeof entry.command === 'string' ? entry.command : '',
  )
  setters.setDraftArgs(argsToText(entry.args))
  setters.setDraftUrl(typeof entry.url === 'string' ? entry.url : '')
  const env =
    entry.env &&
    typeof entry.env === 'object' &&
    !Array.isArray(entry.env)
      ? (entry.env as Record<string, unknown>)
      : {}
  const envStr: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string') envStr[k] = v
  }
  setters.setDraftEnvRows(recordToKv(envStr))
  const headers =
    entry.headers &&
    typeof entry.headers === 'object' &&
    !Array.isArray(entry.headers)
      ? (entry.headers as Record<string, unknown>)
      : {}
  const hdrStr: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === 'string') hdrStr[k] = v
  }
  setters.setDraftHeaderRows(recordToKv(hdrStr))
}

function ConnectionsPage() {
  const { activeWorkspaceId, activeWorkspace } = useWorkspace()
  const tauri = isTauri()
  const [doc, setDoc] = useState<WorkspaceMcpConfigDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toggleBusy, setToggleBusy] = useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftKind, setDraftKind] = useState<ConnKind>('stdio')
  const [draftCommand, setDraftCommand] = useState('')
  const [draftArgs, setDraftArgs] = useState('')
  const [draftUrl, setDraftUrl] = useState('')
  const [draftEnvRows, setDraftEnvRows] = useState<KvRow[]>(emptyKv())
  const [draftHeaderRows, setDraftHeaderRows] = useState<KvRow[]>(emptyKv())
  /** Extra keys preserved when editing via form; refreshed when JSON is applied. */
  const [draftMergeBase, setDraftMergeBase] = useState<McpServerEntryJson>({})
  const [draftJsonText, setDraftJsonText] = useState('{}')
  const [jsonFieldError, setJsonFieldError] = useState<string | null>(null)
  /** When true, form edits rewrite the JSON panel; when false, JSON is being edited directly. */
  const [syncJsonFromForm, setSyncJsonFromForm] = useState(true)
  const [dialogError, setDialogError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!tauri || !activeWorkspaceId) {
      setDoc(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const d = await workspaceMcpConfigGet(activeWorkspaceId)
      setDoc(d)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
      setDoc(null)
    } finally {
      setLoading(false)
    }
  }, [activeWorkspaceId, tauri])

  useEffect(() => {
    void reload()
  }, [reload])

  const persist = useCallback(
    async (next: WorkspaceMcpConfigDocument) => {
      if (!activeWorkspaceId) return
      setSaving(true)
      try {
        await workspaceMcpConfigSet(activeWorkspaceId, next)
        setDoc(cloneDoc(next))
      } finally {
        setSaving(false)
      }
    },
    [activeWorkspaceId],
  )

  const touchForm = useCallback(() => {
    setSyncJsonFromForm(true)
    setJsonFieldError(null)
  }, [])

  const openAdd = () => {
    setEditingName(null)
    setDraftName('')
    setDraftKind('stdio')
    setDraftCommand('')
    setDraftArgs('')
    setDraftUrl('')
    setDraftEnvRows(emptyKv())
    setDraftHeaderRows(emptyKv())
    setDraftMergeBase({})
    setDialogError(null)
    setJsonFieldError(null)
    setSyncJsonFromForm(true)
    setDialogOpen(true)
  }

  const openEdit = (name: string, entry: McpServerEntryJson) => {
    setEditingName(name)
    setDraftName(name)
    const copy: McpServerEntryJson = { ...entry }
    setDraftMergeBase(copy)
    hydrateFormFromEntry(copy, {
      setDraftKind,
      setDraftCommand,
      setDraftArgs,
      setDraftUrl,
      setDraftEnvRows,
      setDraftHeaderRows,
    })
    setDialogError(null)
    setJsonFieldError(null)
    setSyncJsonFromForm(true)
    setDialogOpen(true)
  }

  const mergeFormIntoServerEntry = useCallback(
    (mergeBase: McpServerEntryJson): McpServerEntryJson => {
      const base: McpServerEntryJson = { ...mergeBase }
      if (draftKind === 'stdio') {
        delete base.url
        delete base.headers
        base.command = draftCommand.trim()
        const args = parseArgsText(draftArgs)
        if (args.length) base.args = args
        else delete base.args
        const env = kvToRecord(draftEnvRows)
        if (Object.keys(env).length) base.env = env
        else delete base.env
      } else {
        delete base.command
        delete base.args
        delete base.env
        base.url = draftUrl.trim()
        const headers = kvToRecord(draftHeaderRows)
        if (Object.keys(headers).length) base.headers = headers
        else delete base.headers
      }
      return base
    },
    [
      draftKind,
      draftCommand,
      draftArgs,
      draftUrl,
      draftEnvRows,
      draftHeaderRows,
    ],
  )

  useEffect(() => {
    if (!dialogOpen || !syncJsonFromForm) return
    const entry = mergeFormIntoServerEntry(draftMergeBase)
    setDraftJsonText(JSON.stringify(entry, null, 2))
  }, [
    dialogOpen,
    syncJsonFromForm,
    draftMergeBase,
    mergeFormIntoServerEntry,
  ])

  const applyJsonFromEditor = (): boolean => {
    const raw = draftJsonText.trim()
    if (raw === '') {
      setJsonFieldError('JSON cannot be empty.')
      return false
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      setJsonFieldError(
        e instanceof SyntaxError ? e.message : 'Invalid JSON.',
      )
      return false
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setJsonFieldError('Root value must be a JSON object.')
      return false
    }
    const obj = parsed as McpServerEntryJson
    if (!isServerEntryValid(obj)) {
      setJsonFieldError(
        'Need a non-empty "command" (stdio) or "url" (remote).',
      )
      return false
    }
    setJsonFieldError(null)
    setDraftMergeBase({ ...obj })
    hydrateFormFromEntry(obj, {
      setDraftKind,
      setDraftCommand,
      setDraftArgs,
      setDraftUrl,
      setDraftEnvRows,
      setDraftHeaderRows,
    })
    setSyncJsonFromForm(true)
    return true
  }

  const submitDialog = async () => {
    if (!doc) return
    const name = draftName.trim()
    if (!name) {
      setDialogError('Server name is required.')
      return
    }
    let entry: McpServerEntryJson
    try {
      const parsed = JSON.parse(draftJsonText.trim())
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        setDialogError('Server config must be a single JSON object.')
        return
      }
      entry = parsed as McpServerEntryJson
    } catch {
      setDialogError('Invalid JSON in the server config editor.')
      return
    }
    if (!isServerEntryValid(entry)) {
      setDialogError(
        'Set a non-empty "command" (stdio) or "url" (remote) in the JSON.',
      )
      return
    }
    if (!editingName && doc.mcpServers[name]) {
      setDialogError('A server with this name already exists.')
      return
    }
    const next = cloneDoc(doc)
    if (editingName && editingName !== name) {
      delete next.mcpServers[editingName]
      const dis = disabledSetFromDoc(next)
      if (dis.has(editingName)) {
        dis.delete(editingName)
        dis.add(name)
        next.braian =
          dis.size > 0 ? { disabledMcpServers: [...dis].sort() } : undefined
      }
    }
    next.mcpServers[name] = entry
    setDialogError(null)
    try {
      await persist(next)
      setDialogOpen(false)
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : String(e))
    }
  }

  const removeServer = async (name: string) => {
    if (!doc) return
    const ok = window.confirm(`Remove connection “${name}”?`)
    if (!ok) return
    const next = cloneDoc(doc)
    delete next.mcpServers[name]
    const dis = disabledSetFromDoc(next)
    dis.delete(name)
    next.braian =
      dis.size > 0 ? { disabledMcpServers: [...dis].sort() } : undefined
    try {
      await persist(next)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e))
    }
  }

  const onToggle = async (name: string, enabled: boolean) => {
    if (!doc || !activeWorkspaceId) return
    setToggleBusy(name)
    try {
      const dis = disabledSetFromDoc(doc)
      if (enabled) dis.delete(name)
      else dis.add(name)
      const next = cloneDoc(doc)
      next.braian =
        dis.size > 0 ? { disabledMcpServers: [...dis].sort() } : undefined
      await persist(next)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e))
    } finally {
      setToggleBusy(null)
    }
  }

  const copyForCursor = async () => {
    if (!doc) return
    const text = JSON.stringify({ mcpServers: doc.mcpServers }, null, 2)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      window.alert('Could not copy to clipboard.')
    }
  }

  const serverNames = doc
    ? Object.keys(doc.mcpServers).sort((a, b) => a.localeCompare(b))
    : []

  const noWorkspace = !activeWorkspaceId || !activeWorkspace

  return (
    <div className="bg-background flex min-h-0 flex-1 flex-col overflow-auto p-4 md:p-6">
      <div className="mx-auto w-full max-w-lg space-y-6">
        <div>
          <h1 className="text-text-1 text-lg font-semibold tracking-tight">
            Connections
          </h1>
          <p className="text-text-3 mt-1 text-sm leading-relaxed">
            Configure stdio and remote tools for this workspace. Settings live
            in{' '}
            <code className="text-text-2 text-xs">.braian/mcp.json</code> using
            the same <code className="text-text-2 text-xs">mcpServers</code>{' '}
            shape as Cursor. Tokens in <code className="text-text-2">env</code>{' '}
            or <code className="text-text-2">headers</code> may be committed if
            you use Git—avoid secrets in tracked files.
          </p>
        </div>

        {!tauri ? (
          <p className="text-text-3 border-border rounded-xl border p-4 text-sm">
            Editing connections requires the Braian desktop app. Web preview
            cannot read or write workspace files.
          </p>
        ) : null}

        {tauri && noWorkspace ? (
          <p className="text-text-3 border-border rounded-xl border p-4 text-sm">
            Choose a workspace in the sidebar to manage connections.
          </p>
        ) : null}

        {loadError ? (
          <p className="text-destructive text-sm">{loadError}</p>
        ) : null}

        {tauri && activeWorkspaceId && loading ? (
          <div className="text-text-3 flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading…
          </div>
        ) : null}

        {tauri && activeWorkspace && doc && !loading ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={openAdd}
                disabled={saving}
              >
                <Plus className="size-4" aria-hidden />
                Add connection
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void copyForCursor()}
                disabled={serverNames.length === 0}
              >
                <Copy className="size-4" aria-hidden />
                Copy for Cursor
              </Button>
            </div>

            <div className="border-border space-y-3 rounded-xl border p-4 shadow-sm md:p-5">
              <h2 className="text-text-1 text-base font-semibold tracking-tight">
                {activeWorkspace.name}
              </h2>
              {serverNames.length === 0 ? (
                <p className="text-text-3 text-sm">
                  No connections yet. Add one to populate{' '}
                  <code className="text-text-2 text-xs">.braian/mcp.json</code>.
                </p>
              ) : (
                <ul className="space-y-3">
                  {serverNames.map((name) => {
                    const entry = doc.mcpServers[name]!
                    const remote = isRemoteServer(entry)
                    const enabled = isServerEnabled(name, doc)
                    const busy = toggleBusy === name
                    return (
                      <li
                        key={name}
                        className="border-border flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-text-1 font-medium">
                              {name}
                            </span>
                            <Badge variant="secondary">
                              {remote ? 'Remote' : 'Stdio'}
                            </Badge>
                          </div>
                          <p className="text-text-3 font-mono text-xs break-all">
                            {serverSummaryLine(name, entry)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <label className="text-text-2 flex cursor-pointer items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="border-border text-accent-600 size-4 shrink-0 rounded"
                              checked={enabled}
                              disabled={busy || saving}
                              onChange={(e) =>
                                void onToggle(name, e.target.checked)
                              }
                            />
                            <span>{enabled ? 'On' : 'Off'}</span>
                          </label>
                          {busy ? (
                            <Loader2
                              className="text-text-3 size-4 animate-spin"
                              aria-label="Saving"
                            />
                          ) : null}
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-8"
                            aria-label={`Edit ${name}`}
                            onClick={() => openEdit(name, entry)}
                            disabled={saving}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="text-destructive size-8"
                            aria-label={`Remove ${name}`}
                            onClick={() => void removeServer(name)}
                            disabled={saving}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </>
        ) : null}
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setJsonFieldError(null)
        }}
      >
        <DialogContent className="flex max-h-[min(92vh,880px)] w-[min(100vw-1.5rem,56rem)] max-w-[56rem] flex-col overflow-hidden p-6 sm:max-w-[56rem]">
          <DialogHeader>
            <DialogTitle>
              {editingName ? 'Edit connection' : 'Add connection'}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-2">
            <div className="space-y-2">
              <label
                htmlFor="conn-name"
                className="text-text-2 text-sm font-medium"
              >
                Server name
              </label>
              <Input
                id="conn-name"
                placeholder="e.g. github"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                disabled={!!editingName}
                autoComplete="off"
              />
              <p className="text-text-3 text-xs">
                Used as the key under{' '}
                <code className="text-text-2">mcpServers</code> in{' '}
                <code className="text-text-2">.braian/mcp.json</code>.
              </p>
            </div>
            <div className="grid gap-6 md:grid-cols-2 md:items-start">
              <div className="space-y-4">
                <p className="text-text-2 text-sm font-medium">Form</p>
                <div className="space-y-2">
                  <span className="text-text-2 text-sm font-medium">Type</span>
                  <div className="flex flex-wrap gap-4">
                    <label className="text-text-2 flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="conn-kind"
                        checked={draftKind === 'stdio'}
                        onChange={() => {
                          touchForm()
                          setDraftKind('stdio')
                        }}
                      />
                      Stdio (local)
                    </label>
                    <label className="text-text-2 flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="conn-kind"
                        checked={draftKind === 'remote'}
                        onChange={() => {
                          touchForm()
                          setDraftKind('remote')
                        }}
                      />
                      Remote (URL)
                    </label>
                  </div>
                </div>
                {draftKind === 'stdio' ? (
                  <>
                    <div className="space-y-2">
                      <label
                        htmlFor="conn-command"
                        className="text-text-2 text-sm font-medium"
                      >
                        Command
                      </label>
                      <Input
                        id="conn-command"
                        placeholder="npx"
                        value={draftCommand}
                        onChange={(e) => {
                          touchForm()
                          setDraftCommand(e.target.value)
                        }}
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-2">
                      <label
                        htmlFor="conn-args"
                        className="text-text-2 text-sm font-medium"
                      >
                        Arguments (one per line)
                      </label>
                      <Textarea
                        id="conn-args"
                        rows={4}
                        placeholder={`-y\n@modelcontextprotocol/server-filesystem\n.`}
                        value={draftArgs}
                        onChange={(e) => {
                          touchForm()
                          setDraftArgs(e.target.value)
                        }}
                        className="font-mono text-sm"
                      />
                    </div>
                    <KvEditor
                      label="Environment variables"
                      rows={draftEnvRows}
                      setRows={setDraftEnvRows}
                      onInteraction={touchForm}
                    />
                  </>
                ) : (
                  <>
                    <div className="space-y-2">
                      <label
                        htmlFor="conn-url"
                        className="text-text-2 text-sm font-medium"
                      >
                        URL
                      </label>
                      <Input
                        id="conn-url"
                        placeholder="https://…"
                        value={draftUrl}
                        onChange={(e) => {
                          touchForm()
                          setDraftUrl(e.target.value)
                        }}
                        autoComplete="off"
                      />
                    </div>
                    <KvEditor
                      label="Headers"
                      rows={draftHeaderRows}
                      setRows={setDraftHeaderRows}
                      onInteraction={touchForm}
                    />
                  </>
                )}
              </div>
              <div className="border-border flex min-h-0 flex-col gap-2 md:border-l md:pl-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-text-2 text-sm font-medium">
                      Server config (JSON)
                    </p>
                    <p className="text-text-3 mt-0.5 text-xs leading-relaxed">
                      Exact object stored under{' '}
                      <code className="text-text-2">mcpServers[&quot;…&quot;]</code>.
                      Paste from docs or Cursor; use Apply after editing JSON, or
                      Save validates this text.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      applyJsonFromEditor()
                    }}
                  >
                    Apply JSON
                  </Button>
                </div>
                <Textarea
                  id="conn-json"
                  aria-label="Server entry JSON"
                  rows={16}
                  value={draftJsonText}
                  spellCheck={false}
                  onChange={(e) => {
                    setSyncJsonFromForm(false)
                    setDraftJsonText(e.target.value)
                    setJsonFieldError(null)
                  }}
                  onBlur={() => {
                    if (!syncJsonFromForm) {
                      applyJsonFromEditor()
                    }
                  }}
                  className="font-mono text-xs min-h-[220px] flex-1 resize-y md:min-h-[280px]"
                />
                {jsonFieldError ? (
                  <p className="text-destructive text-xs">{jsonFieldError}</p>
                ) : !syncJsonFromForm ? (
                  <p className="text-text-3 text-xs">
                    JSON is being edited directly—form will update when you
                    blur this field or click Apply JSON.
                  </p>
                ) : null}
              </div>
            </div>
            {dialogError ? (
              <p className="text-destructive text-sm">{dialogError}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void submitDialog()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function KvEditor({
  label,
  rows,
  setRows,
  onInteraction,
}: {
  label: string
  rows: KvRow[]
  setRows: (r: KvRow[]) => void
  onInteraction?: () => void
}) {
  return (
    <div className="space-y-2">
      <span className="text-text-2 text-sm font-medium">{label}</span>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-2">
            <Input
              placeholder="Name"
              value={row.key}
              onChange={(e) => {
                onInteraction?.()
                const next = [...rows]
                next[i] = { ...next[i]!, key: e.target.value }
                setRows(next)
              }}
              autoComplete="off"
            />
            <Input
              placeholder="Value"
              value={row.value}
              onChange={(e) => {
                onInteraction?.()
                const next = [...rows]
                next[i] = { ...next[i]!, value: e.target.value }
                setRows(next)
              }}
              autoComplete="off"
            />
          </div>
        ))}
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          onInteraction?.()
          setRows([...rows, { key: '', value: '' }])
        }}
      >
        Add row
      </Button>
    </div>
  )
}
