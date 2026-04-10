import { ImageIcon } from 'lucide-react'

import { WorkspaceWebappPreviewCore } from '@/components/app/workspace-webapp-preview-core'
import {
  MarkdownDocumentCanvas,
  type CanvasSelectionSubmitPayload,
} from '@/components/workspace/markdown-document-canvas'
import { WorkspaceTextFileCanvas } from '@/components/workspace/workspace-text-file-canvas'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { WorkspaceArtifactPayload } from '@/lib/artifacts/types'
import type { TabularSection } from '@/lib/artifacts/types'
import {
  isAppPreviewArtifact,
  isDocumentArtifact,
  isTabularArtifact,
  isTabularMultiArtifact,
  isVisualArtifact,
  isWorkspaceTextFileArtifact,
} from '@/lib/artifacts/types'
import type { AgentMode } from '@/lib/workspace-api'
import { cn } from '@/lib/utils'

type ArtifactPanelProps = {
  payload: WorkspaceArtifactPayload | null
  /** When `app`, the panel shows the workspace Vite webapp preview when workspace + session are set. */
  agentMode?: AgentMode
  appPreviewWorkspaceId?: string | null
  appPreviewSessionKey?: string | null
  appPreviewGenerating?: boolean
  isTauriRuntime?: boolean
  onDocumentBodyChange?: (body: string) => void
  /** Registers fresh markdown for AI context (session key from chat workbench). */
  documentLiveSessionKey?: string
  onCanvasSelectionAsk?: (payload: CanvasSelectionSubmitPayload) => void
  /** Workspace id for `workspace-file` artifact read/write (desktop project chats). */
  workspaceFileWorkspaceId?: string | null
  /** Session key for patching `workspace-file` artifact state. */
  workspaceFileSessionKey?: string | null
  workspaceFileLiveSessionKey?: string
}

function formatCell(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

function TabularTable({
  columns,
  rows,
}: {
  columns: { id: string; label: string }[]
  rows: Record<string, string | number | boolean | null>[]
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

function TabularCanvas({
  columns,
  rows,
}: {
  columns: { id: string; label: string }[]
  rows: Record<string, string | number | boolean | null>[]
}) {
  return (
    <ScrollArea className="min-h-0 flex-1 rounded-lg border border-border">
      <TabularTable columns={columns} rows={rows} />
    </ScrollArea>
  )
}

function TabularSectionBlock({ section }: { section: TabularSection }) {
  const heading = section.title ?? 'Table'
  const file = section.sourceLabel

  return (
    <section className="border-border flex flex-col gap-2 rounded-lg border bg-background/80">
      <header className="border-border flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b px-3 py-2.5">
        <h3 className="text-text-1 text-sm font-semibold">{heading}</h3>
        {file ? (
          <span className="text-text-3 font-mono text-xs tracking-tight">
            {file}
          </span>
        ) : null}
      </header>
      <div className="overflow-x-auto px-1 pb-2">
        <TabularTable columns={section.columns} rows={section.rows} />
      </div>
    </section>
  )
}

function TabularMultiCanvas({ sections }: { sections: TabularSection[] }) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-4 pr-2 pb-1">
        {sections.map((section, i) => (
          <TabularSectionBlock
            key={section.sourceLabel ?? section.title ?? `section-${i}`}
            section={section}
          />
        ))}
      </div>
    </ScrollArea>
  )
}

function VisualCanvas({
  prompt,
  imageSrc,
  alt,
}: {
  prompt?: string
  imageSrc?: string
  alt?: string
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {prompt ? (
        <p className="text-text-3 px-0.5 text-sm leading-relaxed">{prompt}</p>
      ) : null}
      <div
        className={cn(
          'border-border relative flex min-h-[200px] flex-1 flex-col items-center justify-center overflow-hidden rounded-xl border bg-linear-to-br shadow-inner',
          imageSrc
            ? 'from-muted/30 to-muted/10'
            : 'from-accent-500/12 via-accent-500/5 to-muted/20',
        )}
      >
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={alt ?? 'Generated image'}
            className="max-h-[min(60vh,420px)] w-full object-contain"
          />
        ) : (
          <>
            <div className="absolute inset-0 opacity-[0.07]">
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: `radial-gradient(circle at 20% 30%, var(--app-accent-500) 0%, transparent 45%),
                    radial-gradient(circle at 80% 70%, var(--color-ring) 0%, transparent 40%)`,
                }}
              />
            </div>
            <ImageIcon className="text-accent-500 relative size-14 opacity-70" />
            <p className="text-text-3 relative mt-3 max-w-sm px-6 text-center text-sm">
              Generated images will appear here once image creation is connected.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

export function ArtifactPanel({
  payload,
  agentMode = 'document',
  appPreviewWorkspaceId = null,
  appPreviewSessionKey = null,
  appPreviewGenerating = false,
  isTauriRuntime = false,
  onDocumentBodyChange,
  documentLiveSessionKey,
  onCanvasSelectionAsk,
  workspaceFileWorkspaceId = null,
  workspaceFileSessionKey = null,
  workspaceFileLiveSessionKey,
}: ArtifactPanelProps) {
  const showAppPreviewFromMode =
    agentMode === 'app' &&
    appPreviewWorkspaceId != null &&
    appPreviewSessionKey != null

  if (showAppPreviewFromMode) {
    return (
      <WorkspaceWebappPreviewCore
        workspaceId={appPreviewWorkspaceId}
        isTauriRuntime={isTauriRuntime}
        layout="artifact"
        variant="embedded"
        generating={appPreviewGenerating}
        className="h-full min-h-0"
      />
    )
  }

  if (!payload) {
    return (
      <div className="bg-card border-border flex h-full min-h-0 flex-col items-center justify-center rounded-xl border p-8 text-center shadow-sm">
        <p className="text-text-3 text-sm">Send a message to show content here.</p>
      </div>
    )
  }

  if (
    isAppPreviewArtifact(payload) &&
    appPreviewWorkspaceId != null &&
    appPreviewSessionKey != null
  ) {
    return (
      <WorkspaceWebappPreviewCore
        workspaceId={appPreviewWorkspaceId}
        isTauriRuntime={isTauriRuntime}
        layout="artifact"
        variant="embedded"
        generating={appPreviewGenerating}
        className="h-full min-h-0"
      />
    )
  }

  return (
    <div className="bg-card border-border flex h-full min-h-0 flex-col overflow-hidden rounded-xl border shadow-sm">
      <div className="flex min-h-0 flex-1 flex-col p-3 md:p-4">
        {isDocumentArtifact(payload) ? (
          <MarkdownDocumentCanvas
            markdown={payload.body}
            onMarkdownChange={onDocumentBodyChange}
            liveSessionKey={documentLiveSessionKey}
            onCanvasSelectionAsk={onCanvasSelectionAsk}
          />
        ) : null}
        {isWorkspaceTextFileArtifact(payload) &&
        workspaceFileWorkspaceId != null &&
        workspaceFileSessionKey != null ? (
          <WorkspaceTextFileCanvas
            workspaceId={workspaceFileWorkspaceId}
            relativePath={payload.relativePath}
            body={payload.body}
            truncated={payload.truncated}
            title={payload.title}
            sessionKey={workspaceFileSessionKey}
            liveSessionKey={workspaceFileLiveSessionKey}
          />
        ) : isWorkspaceTextFileArtifact(payload) ? (
          <p className="text-text-3 px-0.5 text-sm">
            Open this chat in a workspace folder to edit files from the side panel.
          </p>
        ) : null}
        {isTabularArtifact(payload) ? (
          <TabularCanvas columns={payload.columns} rows={payload.rows} />
        ) : null}
        {isTabularMultiArtifact(payload) ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            {payload.title ? (
              <p className="text-text-2 shrink-0 px-0.5 text-sm font-medium">
                {payload.title}
              </p>
            ) : null}
            <TabularMultiCanvas sections={payload.sections} />
          </div>
        ) : null}
        {isVisualArtifact(payload) ? (
          <VisualCanvas
            prompt={payload.prompt}
            imageSrc={payload.imageSrc}
            alt={payload.alt}
          />
        ) : null}
      </div>
    </div>
  )
}
