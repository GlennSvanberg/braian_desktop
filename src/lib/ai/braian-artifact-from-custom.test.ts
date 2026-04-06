import { describe, expect, it } from 'vitest'

import {
  braianArtifactFromCustomValue,
  coerceTabularCellValue,
} from './braian-artifact-from-custom'

describe('coerceTabularCellValue', () => {
  it('preserves primitives', () => {
    expect(coerceTabularCellValue(null)).toBe(null)
    expect(coerceTabularCellValue('a')).toBe('a')
    expect(coerceTabularCellValue(3)).toBe(3)
    expect(coerceTabularCellValue(true)).toBe(true)
  })

  it('stringifies objects and arrays', () => {
    expect(coerceTabularCellValue({ x: 1 })).toBe('{"x":1}')
    expect(coerceTabularCellValue([1, 2])).toBe('[1,2]')
  })
})

describe('braianArtifactFromCustomValue', () => {
  it('parses document', () => {
    expect(
      braianArtifactFromCustomValue({
        kind: 'document',
        body: '# Hi',
        title: 'T',
        canvasRevision: 2.7,
      }),
    ).toEqual({
      kind: 'document',
      body: '# Hi',
      title: 'T',
      canvasRevision: 2,
    })
  })

  it('rejects document without body string', () => {
    expect(braianArtifactFromCustomValue({ kind: 'document', body: 1 })).toBe(null)
  })

  it('parses tabular with optional fields', () => {
    expect(
      braianArtifactFromCustomValue({
        kind: 'tabular',
        title: 'Sheet',
        sourceLabel: 'from Book.xlsx',
        columns: [
          { id: 'a', label: 'A', type: 'number' },
          { id: 'b', label: 'B' },
        ],
        rows: [{ a: 1, b: 'x' }, { a: null, b: true }],
      }),
    ).toEqual({
      kind: 'tabular',
      title: 'Sheet',
      sourceLabel: 'from Book.xlsx',
      columns: [
        { id: 'a', label: 'A', type: 'number' },
        { id: 'b', label: 'B' },
      ],
      rows: [
        { a: 1, b: 'x' },
        { a: null, b: true },
      ],
    })
  })

  it('coerces odd cell values in tabular rows', () => {
    const r = braianArtifactFromCustomValue({
      kind: 'tabular',
      columns: [{ id: 'c', label: 'C' }],
      rows: [{ c: { nested: 1 } }],
    })
    expect(r).toMatchObject({
      kind: 'tabular',
      rows: [{ c: '{"nested":1}' }],
    })
  })

  it('rejects tabular with invalid columns or rows', () => {
    expect(
      braianArtifactFromCustomValue({
        kind: 'tabular',
        columns: [],
        rows: [],
      }),
    ).toBe(null)
    expect(
      braianArtifactFromCustomValue({
        kind: 'tabular',
        columns: [{ id: 'a', label: 'A' }],
        rows: 'not-array',
      }),
    ).toBe(null)
    expect(
      braianArtifactFromCustomValue({
        kind: 'tabular',
        columns: [{ id: 'a' }],
        rows: [{}],
      }),
    ).toBe(null)
  })

  it('parses visual', () => {
    expect(
      braianArtifactFromCustomValue({
        kind: 'visual',
        title: 'Img',
        prompt: 'p',
        imageSrc: 'data:image/png;base64,AA',
        alt: 'a',
      }),
    ).toEqual({
      kind: 'visual',
      title: 'Img',
      prompt: 'p',
      imageSrc: 'data:image/png;base64,AA',
      alt: 'a',
    })
  })

  it('parses minimal visual', () => {
    expect(braianArtifactFromCustomValue({ kind: 'visual' })).toEqual({
      kind: 'visual',
    })
  })

  it('parses tabular-multi', () => {
    expect(
      braianArtifactFromCustomValue({
        kind: 'tabular-multi',
        title: 'Multi',
        sections: [
          {
            title: 'S1',
            sourceLabel: 'a.csv',
            columns: [{ id: 'x', label: 'X' }],
            rows: [{ x: 1 }],
          },
        ],
      }),
    ).toEqual({
      kind: 'tabular-multi',
      title: 'Multi',
      sections: [
        {
          title: 'S1',
          sourceLabel: 'a.csv',
          columns: [{ id: 'x', label: 'X' }],
          rows: [{ x: 1 }],
        },
      ],
    })
  })

  it('rejects tabular-multi with empty or invalid sections', () => {
    expect(
      braianArtifactFromCustomValue({
        kind: 'tabular-multi',
        sections: [],
      }),
    ).toBe(null)
    expect(
      braianArtifactFromCustomValue({
        kind: 'tabular-multi',
        sections: [{ columns: [], rows: [] }],
      }),
    ).toBe(null)
  })

  it('returns null for unknown kind', () => {
    expect(braianArtifactFromCustomValue({ kind: 'app-preview' })).toBe(null)
    expect(braianArtifactFromCustomValue(null)).toBe(null)
  })
})
