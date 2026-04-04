import { z } from 'zod'

import { PAGE_ID_PATTERN } from './constants'

const idField = z.string().min(1).max(64)

const pageIdField = z
  .string()
  .min(1)
  .max(64)
  .regex(
    PAGE_ID_PATTERN,
    'pageId must start with a letter or digit and contain only letters, digits, and hyphens',
  )

export const kpiTileSchema = z.object({
  id: idField,
  kind: z.literal('kpi'),
  label: z.string().min(1).max(120),
  value: z.string().min(1).max(200),
  hint: z.string().max(300).optional(),
})

export const markdownTileSchema = z.object({
  id: idField,
  kind: z.literal('markdown'),
  body: z.string().max(50_000),
})

export const pageLinkTileSchema = z.object({
  id: idField,
  kind: z.literal('page_link'),
  pageId: pageIdField,
  label: z.string().min(1).max(120),
  description: z.string().max(300).optional(),
})

export const externalLinkTileSchema = z.object({
  id: idField,
  kind: z.literal('external_link'),
  label: z.string().min(1).max(120),
  href: z.string().url().max(2000),
})

export const linkRegionTileSchema = z.discriminatedUnion('kind', [
  pageLinkTileSchema,
  externalLinkTileSchema,
])

export const mainTileSchema = z.discriminatedUnion('kind', [
  markdownTileSchema,
  kpiTileSchema,
  pageLinkTileSchema,
])

export const dashboardManifestSchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string().max(200).optional(),
  updatedAtMs: z.number().int().optional(),
  regions: z.object({
    insights: z.array(kpiTileSchema).max(8),
    links: z.array(linkRegionTileSchema).max(16),
    main: z.array(mainTileSchema).max(24),
  }),
})

export const workspacePageSchema = z.object({
  schemaVersion: z.literal(1),
  pageId: pageIdField,
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  tiles: z.array(mainTileSchema).max(32),
})

export type KpiTile = z.infer<typeof kpiTileSchema>
export type MarkdownTile = z.infer<typeof markdownTileSchema>
export type PageLinkTile = z.infer<typeof pageLinkTileSchema>
export type ExternalLinkTile = z.infer<typeof externalLinkTileSchema>
export type LinkRegionTile = z.infer<typeof linkRegionTileSchema>
export type MainTile = z.infer<typeof mainTileSchema>
export type DashboardManifest = z.infer<typeof dashboardManifestSchema>
export type WorkspacePage = z.infer<typeof workspacePageSchema>

export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ')
}
