import overviewMd from '../../../docs/app/overview.md?raw'
import toolsMd from '../../../docs/app/tools.md?raw'
import memoryMd from '../../../docs/app/memory.md?raw'
import capabilitiesMd from '../../../docs/app/capabilities.md?raw'
import dashboardMd from '../../../docs/app/dashboard.md?raw'
import modelContextMd from '../../../docs/app/model-context.md?raw'
import mcpMd from '../../../docs/app/mcp.md?raw'
import workspaceHistoryMd from '../../../docs/app/workspace-history.md?raw'

export type InAppDocSlug =
  | 'overview'
  | 'tools'
  | 'memory'
  | 'capabilities'
  | 'dashboard'
  | 'model-context'
  | 'mcp'
  | 'workspace-history'

export type InAppDocMeta = {
  slug: InAppDocSlug
  title: string
  description: string
}

const entries: readonly (InAppDocMeta & { body: string })[] = [
  {
    slug: 'overview',
    title: 'Overview',
    description: 'Workspaces, chat, canvas, and where the app runs.',
    body: overviewMd,
  },
  {
    slug: 'model-context',
    title: 'Model context',
    description:
      'System section order, skills, user profile injection, and the context manager.',
    body: modelContextMd,
  },
  {
    slug: 'tools',
    title: 'Tools',
    description:
      'Canvas, workspace files, commands, skills, webapp helpers, and code-agent tools.',
    body: toolsMd,
  },
  {
    slug: 'mcp',
    title: 'Connections (MCP)',
    description:
      'Per-workspace MCP servers in .braian/mcp.json, Cursor-compatible config, and status checks.',
    body: mcpMd,
  },
  {
    slug: 'dashboard',
    title: 'Workspace dashboard',
    description:
      'Dashboard route: Dashboard (hub), Apps, App settings, Workspace settings; Vite project under .braian/webapp.',
    body: dashboardMd,
  },
  {
    slug: 'memory',
    title: 'Memory',
    description: 'Workspace MEMORY.md, injection, and how it updates.',
    body: memoryMd,
  },
  {
    slug: 'workspace-history',
    title: 'Workspace snapshots',
    description:
      'Optional Git checkpoints per workspace: config, automatic commits, restore, and limits.',
    body: workspaceHistoryMd,
  },
  {
    slug: 'capabilities',
    title: 'Capabilities',
    description: 'BYOK, scope, limits, and what the app is not.',
    body: capabilitiesMd,
  },
] as const

const bySlug = new Map<InAppDocSlug, (typeof entries)[number]>(
  entries.map((e) => [e.slug, e]),
)

export function listInAppDocs(): readonly InAppDocMeta[] {
  return entries.map(({ slug, title, description }) => ({
    slug,
    title,
    description,
  }))
}

export function getInAppDoc(
  slug: string,
): (InAppDocMeta & { body: string }) | undefined {
  if (!isInAppDocSlug(slug)) return undefined
  return bySlug.get(slug)
}

export function isInAppDocSlug(s: string): s is InAppDocSlug {
  return bySlug.has(s as InAppDocSlug)
}
