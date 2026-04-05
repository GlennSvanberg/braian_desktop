import {
  getConversationById,
  type MockCanvasKind,
} from '@/lib/mock-workspace-data'

import type { WorkspaceArtifactPayload } from './types'

export function getMockArtifactPayloadForChat(
  conversationId: string | null,
  opts?: { title?: string; canvasKind?: MockCanvasKind },
): WorkspaceArtifactPayload {
  const conv = conversationId ? getConversationById(conversationId) : null
  const kind = opts?.canvasKind ?? conv?.canvasKind ?? 'document'
  const chatTitle = opts?.title ?? conv?.title ?? 'New chat'

  switch (kind) {
    case 'tabular':
      return tabularForConversation(conversationId, chatTitle)
    case 'visual':
      return visualForConversation(conversationId, chatTitle)
    case 'document':
    default:
      return documentForConversation(conversationId, chatTitle)
  }
}

function documentForConversation(
  conversationId: string | null,
  chatTitle: string,
): WorkspaceArtifactPayload {
  const bodies: Record<string, string> = {
    'conv-spec': [
      '# Product spec v2 — draft',
      '',
      '## Problem',
      'Teams lose context when switching between chat and static docs.',
      '',
      '## Proposal',
      'Keep a single canvas beside the thread: edit structure here, discuss in chat.',
      '',
      '## Open questions',
      '- Export format (Markdown vs DOCX)',
      '- Versioning per workspace',
    ].join('\n'),
    'conv-brand': [
      '# Brand refresh brief',
      '',
      '**Audience:** B2B ops leads who live in spreadsheets.',
      '',
      '**Voice:** Calm, direct, no jargon (no "RAG", "embeddings").',
      '',
      '**Visual:** Soft neutrals, one accent, plenty of whitespace.',
    ].join('\n'),
  }

  const body =
    bodies[conversationId ?? ''] ??
    [
      `# ${chatTitle}`,
      '',
      'This is a document canvas — same idea as ChatGPT canvas: long-form text you can refine with the assistant.',
      '',
      'When the real model is wired, tool output should set `kind: "document"` and a `body` string.',
    ].join('\n')

  return {
    kind: 'document',
    title: chatTitle,
    body,
    canvasRevision: 0,
  }
}

function tabularForConversation(
  conversationId: string | null,
  chatTitle: string,
): WorkspaceArtifactPayload {
  if (conversationId === 'conv-excel-merge') {
    return {
      kind: 'tabular-multi',
      title: 'Sales exports · multi-file canvas',
      sections: [
        {
          title: 'Q1 export',
          sourceLabel: 'Q1_sales.xlsx',
          columns: [
            { id: 'sku', label: 'SKU', type: 'string' },
            { id: 'product', label: 'Product', type: 'string' },
            { id: 'revenue', label: 'Revenue', type: 'number' },
            { id: 'units', label: 'Units', type: 'number' },
          ],
          rows: [
            {
              sku: 'A-100',
              product: 'Widget Pro',
              revenue: 12400,
              units: 62,
            },
            {
              sku: 'B-220',
              product: 'Cable kit',
              revenue: 3180,
              units: 106,
            },
            {
              sku: 'C-015',
              product: 'Mount bracket',
              revenue: 890,
              units: 89,
            },
          ],
        },
        {
          title: 'Q2 export',
          sourceLabel: 'Q2_sales.xlsx',
          columns: [
            { id: 'sku', label: 'SKU', type: 'string' },
            { id: 'product', label: 'Product', type: 'string' },
            { id: 'revenue', label: 'Revenue', type: 'number' },
            { id: 'units', label: 'Units', type: 'number' },
          ],
          rows: [
            {
              sku: 'A-100',
              product: 'Widget Pro',
              revenue: 13850,
              units: 67,
            },
            {
              sku: 'B-220',
              product: 'Cable kit',
              revenue: 4020,
              units: 134,
            },
            {
              sku: 'D-900',
              product: 'Power supply',
              revenue: 2100,
              units: 42,
            },
          ],
        },
        {
          title: 'Merged by assistant',
          sourceLabel: 'merged_by_ai.xlsx',
          columns: [
            { id: 'sku', label: 'SKU', type: 'string' },
            { id: 'product', label: 'Product', type: 'string' },
            { id: 'q1_revenue', label: 'Q1 revenue', type: 'number' },
            { id: 'q2_revenue', label: 'Q2 revenue', type: 'number' },
            { id: 'total_revenue', label: 'Total', type: 'number' },
          ],
          rows: [
            {
              sku: 'A-100',
              product: 'Widget Pro',
              q1_revenue: 12400,
              q2_revenue: 13850,
              total_revenue: 26250,
            },
            {
              sku: 'B-220',
              product: 'Cable kit',
              q1_revenue: 3180,
              q2_revenue: 4020,
              total_revenue: 7200,
            },
            {
              sku: 'C-015',
              product: 'Mount bracket',
              q1_revenue: 890,
              q2_revenue: null,
              total_revenue: 890,
            },
            {
              sku: 'D-900',
              product: 'Power supply',
              q1_revenue: null,
              q2_revenue: 2100,
              total_revenue: 2100,
            },
          ],
        },
      ],
    }
  }

  if (conversationId === 'conv-dashboards') {
    return {
      kind: 'tabular',
      title: 'Dashboard KPIs (sample)',
      sourceLabel: 'metrics_preview.csv',
      columns: [
        { id: 'widget', label: 'Widget', type: 'string' },
        { id: 'owner', label: 'Owner', type: 'string' },
        { id: 'status', label: 'Status', type: 'string' },
        { id: 'target', label: 'Target', type: 'number' },
      ],
      rows: [
        { widget: 'North star', owner: 'Sam', status: 'Live', target: 92 },
        { widget: 'Activation', owner: 'Riley', status: 'Draft', target: 48 },
        { widget: 'Retention', owner: 'Jordan', status: 'Review', target: 71 },
      ],
    }
  }

  return {
    kind: 'tabular',
    title: `${chatTitle} · table`,
    sourceLabel: 'planning_sheet.xlsx',
    columns: [
      { id: 'task', label: 'Task', type: 'string' },
      { id: 'owner', label: 'Owner', type: 'string' },
      { id: 'due', label: 'Due', type: 'date' },
      { id: 'pct', label: '% done', type: 'number' },
    ],
    rows: [
      { task: 'Stakeholder review', owner: 'Alex', due: '2026-04-04', pct: 80 },
      { task: 'Data import dry run', owner: 'Sam', due: '2026-04-06', pct: 40 },
      { task: 'Launch checklist', owner: 'Jamie', due: '2026-04-10', pct: 15 },
    ],
  }
}

function visualForConversation(
  conversationId: string | null,
  chatTitle: string,
): WorkspaceArtifactPayload {
  const prompts: Record<string, string> = {
    'conv-ideas':
      'Flat vector hero illustration: laptop, coffee, soft sunrise palette, friendly workspace.',
    'conv-paper':
      'Abstract cover art for a research summary: nodes and gentle gradients, scholarly, minimal text.',
  }
  const prompt =
    prompts[conversationId ?? ''] ??
    'Concept art: modern office dashboard on a monitor, isometric, muted blues and warm accent.'

  return {
    kind: 'visual',
    title: `${chatTitle} · visual`,
    prompt,
    alt: 'Generated preview placeholder',
  }
}
