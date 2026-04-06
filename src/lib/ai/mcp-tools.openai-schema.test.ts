import { describe, expect, it } from 'vitest'

import { normalizeMcpToolInputJsonSchemaForOpenAi } from '@/lib/ai/mcp-tools'

describe('normalizeMcpToolInputJsonSchemaForOpenAi', () => {
  it('sets additionalProperties false on items object when type is object|null union', () => {
    const raw = {
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: {
            type: ['object', 'null'],
            properties: {
              designation: { type: 'string' },
            },
            required: ['designation'],
          },
        },
      },
      required: ['rows'],
    }

    const out = normalizeMcpToolInputJsonSchemaForOpenAi(raw) as Record<
      string,
      unknown
    >
    const rows = out.properties as Record<string, unknown>
    const rowsProp = rows.rows as Record<string, unknown>
    const items = rowsProp.items as Record<string, unknown>

    expect(items.additionalProperties).toBe(false)
  })

  it('sets additionalProperties false when properties exist but type is omitted', () => {
    const raw = {
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: {
            properties: {
              a: { type: 'number' },
            },
          },
        },
      },
    }

    const out = normalizeMcpToolInputJsonSchemaForOpenAi(raw) as Record<
      string,
      unknown
    >
    const props = out.properties as Record<string, unknown>
    const items = (props.rows as Record<string, unknown>).items as Record<
      string,
      unknown
    >

    expect(items.additionalProperties).toBe(false)
    expect(items.type).toBe('object')
  })

  it('still sets additionalProperties on items when rows uses a nullable array type union', () => {
    const raw = {
      type: 'object',
      properties: {
        rows: {
          type: ['array', 'null'],
          items: {
            type: ['object', 'null'],
            properties: {
              designation: { type: 'string' },
            },
          },
        },
      },
      required: ['rows'],
    }

    const out = normalizeMcpToolInputJsonSchemaForOpenAi(raw) as Record<
      string,
      unknown
    >
    const rows = (out.properties as Record<string, unknown>).rows as Record<
      string,
      unknown
    >
    expect(rows.type).toEqual(['array', 'null'])
    const items = rows.items as Record<string, unknown>
    expect(items.additionalProperties).toBe(false)
  })

  it('fixes object shape nested only under allOf inside items', () => {
    const raw = {
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: {
            allOf: [
              {
                type: 'object',
                properties: {
                  designation: { type: 'string' },
                },
              },
            ],
          },
        },
      },
    }

    const out = normalizeMcpToolInputJsonSchemaForOpenAi(raw) as Record<
      string,
      unknown
    >
    const items = (
      (out.properties as Record<string, unknown>).rows as Record<string, unknown>
    ).items as Record<string, unknown>
    const branch = (items.allOf as unknown[])[0] as Record<string, unknown>
    expect(branch.additionalProperties).toBe(false)
  })
})
