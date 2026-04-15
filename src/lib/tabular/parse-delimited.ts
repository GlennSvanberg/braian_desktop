import type { TabularColumn, TabularRow } from '@/lib/artifacts/types'

/** Extensions treated as delimiter-separated text for preview + Data panel. */
export const DELIMITED_DATA_EXTENSIONS = ['.csv', '.tsv'] as const

export function isDelimitedDataFilePath(relativePath: string): boolean {
  const lower = relativePath.trim().toLowerCase()
  return DELIMITED_DATA_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function sniffDelimiter(sampleLine: string): ',' | '\t' {
  const tabCount = (sampleLine.match(/\t/g) ?? []).length
  const commaCount = (sampleLine.match(/,/g) ?? []).length
  if (tabCount > commaCount) return '\t'
  return ','
}

/**
 * Parse one line of RFC 4180-style CSV/TSV (quoted fields, doubled quotes).
 */
export function parseDelimitedLine(line: string, delimiter: ',' | '\t'): string[] {
  const out: string[] = []
  let cur = ''
  let i = 0
  let inQuotes = false
  while (i < line.length) {
    const c = line[i]!
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      cur += c
      i += 1
      continue
    }
    if (c === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (c === delimiter) {
      out.push(cur)
      cur = ''
      i += 1
      continue
    }
    cur += c
    i += 1
  }
  out.push(cur)
  return out
}

/** Split into physical lines (records); newlines inside quoted fields stay in the line. */
function splitIntoLines(text: string): string[] {
  const lines: string[] = []
  let cur = ''
  let i = 0
  let inQuotes = false
  while (i < text.length) {
    const c = text[i]!
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '""'
          i += 2
          continue
        }
        inQuotes = false
        cur += c
        i += 1
        continue
      }
      cur += c
      i += 1
      continue
    }
    if (c === '"') {
      inQuotes = true
      cur += c
      i += 1
      continue
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') {
        i += 1
      }
      lines.push(cur)
      cur = ''
      i += 1
      continue
    }
    cur += c
    i += 1
  }
  lines.push(cur)
  return lines
}

export type ParsedDelimitedTable = {
  columns: TabularColumn[]
  rows: TabularRow[]
  /** True if fewer data rows were returned than exist (capped by maxDataRows). */
  rowCapReached: boolean
}

/**
 * Parse delimited text into columns + row objects. First line = headers.
 * Caps data rows at `maxDataRows` (excluding header).
 */
export function parseDelimitedTextToTable(
  text: string,
  maxDataRows: number,
): ParsedDelimitedTable {
  const stripped = text.replace(/^\uFEFF/, '')
  const rawLines = splitIntoLines(stripped).filter((ln) => ln.length > 0)
  if (rawLines.length === 0) {
    return {
      columns: [{ id: 'c0', label: 'Column 1' }],
      rows: [],
      rowCapReached: false,
    }
  }
  const delimiter = sniffDelimiter(rawLines[0]!)
  const headerCells = parseDelimitedLine(rawLines[0]!, delimiter)
  const columns: TabularColumn[] = headerCells.map((h, i) => {
    const label = h.trim() === '' ? `Column ${i + 1}` : h.trim()
    return { id: `c${i}`, label }
  })
  const idByIndex = columns.map((c) => c.id)
  const dataLineCount = rawLines.length - 1
  const take = Math.min(maxDataRows, dataLineCount)
  const rows: TabularRow[] = []
  for (let r = 0; r < take; r++) {
    const line = rawLines[r + 1]!
    const cells = parseDelimitedLine(line, delimiter)
    const row: TabularRow = {}
    for (let i = 0; i < idByIndex.length; i++) {
      row[idByIndex[i]!] = cells[i] ?? null
    }
    rows.push(row)
  }
  return {
    columns,
    rows,
    rowCapReached: dataLineCount > take,
  }
}

/** Default rows shown in the model context preview (not the Data panel). */
export const MODEL_CONTEXT_HEAD_MAX_ROWS = 20

/** Max bytes read when building model context preview for CSV/TSV. */
export const MODEL_CONTEXT_DELIMITED_MAX_BYTES = 384_000

/** Max data rows to render in the file-backed Data panel (excluding header). */
export const TABULAR_FILE_PANEL_MAX_DATA_ROWS = 10_000

/** Max bytes read when loading the Data panel from disk. */
export const TABULAR_FILE_PANEL_MAX_BYTES = 6_000_000

/**
 * Build markdown + notes for the model from a delimited file read (possibly truncated at byte cap).
 */
export function formatDelimitedHeadForModelContext(input: {
  relativePath: string
  displayName?: string
  text: string
  fileTruncatedByRead: boolean
  maxDataRows?: number
}): string {
  const maxDataRows = input.maxDataRows ?? MODEL_CONTEXT_HEAD_MAX_ROWS
  const { columns, rows, rowCapReached } = parseDelimitedTextToTable(
    input.text,
    maxDataRows,
  )
  const label = input.displayName?.trim() || input.relativePath
  const lines: string[] = [
    `### Attached data file (preview): \`${input.relativePath}\``,
    `Display name: ${label}`,
    '',
    `This is a **preview only** (first ${maxDataRows} data rows max). The full file is on disk; use workspace tools or the Data panel if you need the complete grid.`,
    '',
  ]
  if (input.fileTruncatedByRead) {
    lines.push(
      '[Note: file read was truncated by byte limit — preview may be incomplete.]',
      '',
    )
  }
  if (columns.length === 0 || rows.length === 0) {
    lines.push('_(No tabular rows parsed in preview range.)_')
    return lines.join('\n')
  }
  lines.push('| ' + columns.map((c) => escapeMdCell(c.label)).join(' | ') + ' |')
  lines.push('| ' + columns.map(() => '---').join(' | ') + ' |')
  for (const row of rows) {
    lines.push(
      '| ' +
        columns.map((c) => escapeMdCell(row[c.id] ?? '')).join(' | ') +
        ' |',
    )
  }
  lines.push('')
  if (rowCapReached) {
    lines.push(`_(More rows exist in the file; not shown in this preview.)_`)
  }
  return lines.join('\n')
}

function escapeMdCell(v: string | number | boolean | null): string {
  if (v === null || v === undefined) return ''
  const s = String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ')
  return s
}
