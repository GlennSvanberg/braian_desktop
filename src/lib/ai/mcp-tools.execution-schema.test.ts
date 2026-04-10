import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'

import { stripPropertyNamesFromJsonSchema } from '@/lib/ai/mcp-tools'

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: true })
addFormats(ajv)

describe('MCP execution schema (strip propertyNames + Ajv)', () => {
  it('stripPropertyNamesFromJsonSchema removes propertyNames recursively', () => {
    const raw = {
      type: 'object',
      propertyNames: { pattern: '^[a-z]+$' },
      properties: {
        entity: { type: 'string' },
        nested: {
          type: 'object',
          propertyNames: { minLength: 1 },
          properties: { a: { type: 'number' } },
        },
      },
    }
    const out = stripPropertyNamesFromJsonSchema(raw) as Record<string, unknown>
    expect('propertyNames' in out).toBe(false)
    expect(
      'propertyNames' in ((out.properties as Record<string, unknown>).nested as object),
    ).toBe(false)
  })

  it('Ajv.compile accepts stripped schema for typical MCP object args', () => {
    const raw = {
      type: 'object',
      required: ['project', 'ids'],
      properties: {
        project: { type: 'string' },
        ids: { type: 'array', items: { type: 'integer' } },
      },
    }
    const stripped = stripPropertyNamesFromJsonSchema(
      JSON.parse(JSON.stringify(raw)),
    ) as Record<string, unknown>
    expect(() => ajv.compile(stripped)).not.toThrow()
  })
})
