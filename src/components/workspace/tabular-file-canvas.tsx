import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { TabularColumn, TabularRow } from '@/lib/artifacts/types'
import {
  parseDelimitedTextToTable,
  TABULAR_FILE_PANEL_MAX_BYTES,
  TABULAR_FILE_PANEL_MAX_DATA_ROWS,
} from '@/lib/tabular/parse-delimited'
import { workspaceReadTextFile } from '@/lib/workspace-api'
import { cn } from '@/lib/utils'

type TabularFileCanvasProps = {
  workspaceId: string
  relativePath: string
  title?: string
  /** Max data rows (excluding header); defaults to panel constant. */
  maxRows?: number
  className?: string
}

function formatCell(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

function DataTable({
  columns,
  rows,
}: {
  columns: TabularColumn[]
  rows: TabularRow[]
}) {
  return (
    <table className="w-full min-w-max border-collapse text-left text-sm">
      <thead>
        <tr className="bg-muted/50 border-border border-b">
          {columns.map((col) => (
            <th
              key={col.id}
              className="text-text-1 whitespace-nowrap px-3 py-2.5 font-medium"
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr
            key={ri}
            className="border-border hover:bg-muted/30 border-b last:border-b-0"
          >
            {columns.map((col) => (
              <td
                key={col.id}
                className="text-text-2 whitespace-nowrap px-3 py-2.5"
              >
                {formatCell(row[col.id] ?? null)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function TabularFileCanvas({
  workspaceId,
  relativePath,
  title,
  maxRows,
  className,
}: TabularFileCanvasProps) {
  const cap = maxRows ?? TABULAR_FILE_PANEL_MAX_DATA_ROWS
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [columns, setColumns] = useState<TabularColumn[]>([])
  const [rows, setRows] = useState<TabularRow[]>([])
  const [truncated, setTruncated] = useState(false)
  const [rowCapReached, setRowCapReached] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { text, truncated: readTruncated } = await workspaceReadTextFile(
        workspaceId,
        relativePath,
        TABULAR_FILE_PANEL_MAX_BYTES,
      )
      const parsed = parseDelimitedTextToTable(text, cap)
      setColumns(parsed.columns)
      setRows(parsed.rows)
      setTruncated(readTruncated)
      setRowCapReached(parsed.rowCapReached)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setColumns([])
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [workspaceId, relativePath, cap])

  useEffect(() => {
    void load()
  }, [load, reloadTick])

  const onRefresh = () => {
    setReloadTick((n) => n + 1)
  }

  const heading = title?.trim() || relativePath.split('/').pop() || relativePath

  return (
    <div
      className={cn('flex min-h-0 flex-1 flex-col gap-2', className)}
      data-testid="tabular-file-canvas"
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-0.5">
        <div className="min-w-0">
          <p className="text-text-1 text-sm font-semibold">{heading}</p>
          <p className="text-text-3 font-mono text-xs tracking-tight">
            {relativePath}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw
            className={cn('size-3.5', loading && 'animate-spin')}
            aria-hidden
          />
          Refresh from disk
        </Button>
      </div>
      {error ? (
        <p className="text-destructive px-0.5 text-sm">{error}</p>
      ) : null}
      {truncated ? (
        <p className="text-text-3 px-0.5 text-xs">
          File read was capped by size limit; table may be incomplete. Split the
          file or raise limits in a future version.
        </p>
      ) : null}
      {rowCapReached && !error ? (
        <p className="text-text-3 px-0.5 text-xs">
          Showing first {cap.toLocaleString()} data rows (file may contain more).
        </p>
      ) : null}
      {loading && !error ? (
        <p className="text-text-3 px-0.5 text-sm">Loading…</p>
      ) : null}
      {!loading && !error && columns.length > 0 ? (
        <ScrollArea className="min-h-0 flex-1 rounded-lg border border-border">
          <DataTable columns={columns} rows={rows} />
        </ScrollArea>
      ) : null}
      {!loading && !error && columns.length === 0 ? (
        <p className="text-text-3 px-0.5 text-sm">No rows parsed.</p>
      ) : null}
    </div>
  )
}
