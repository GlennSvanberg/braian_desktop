import overviewMd from '../../../docs/app/overview.md?raw'
import toolsMd from '../../../docs/app/tools.md?raw'
import memoryMd from '../../../docs/app/memory.md?raw'
import capabilitiesMd from '../../../docs/app/capabilities.md?raw'
import dashboardMd from '../../../docs/app/dashboard.md?raw'

export type InAppDocSlug =
  | 'overview'
  | 'tools'
  | 'memory'
  | 'capabilities'
  | 'dashboard'

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
    slug: 'dashboard',
    title: 'Dashboard & in-app pages',
    description:
      'Workspace board.json, pages, tile types, and Document / Code / App chat modes.',
    body: dashboardMd,
  },
  {
    slug: 'tools',
    title: 'Tools',
    description: 'Canvas, workspace files, commands, and code-agent tools.',
    body: toolsMd,
  },
  {
    slug: 'memory',
    title: 'Memory',
    description: 'Workspace MEMORY.md, injection, and how it updates.',
    body: memoryMd,
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
