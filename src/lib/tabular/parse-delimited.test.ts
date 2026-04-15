import { describe, expect, it } from 'vitest'

import {
  formatDelimitedHeadForModelContext,
  isDelimitedDataFilePath,
  parseDelimitedLine,
  parseDelimitedTextToTable,
  sniffDelimiter,
} from './parse-delimited'

describe('isDelimitedDataFilePath', () => {
  it('recognizes csv and tsv', () => {
    expect(isDelimitedDataFilePath('data/sample.csv')).toBe(true)
    expect(isDelimitedDataFilePath('dir/foo.tsv')).toBe(true)
    expect(isDelimitedDataFilePath('FOO.CSV')).toBe(true)
    expect(isDelimitedDataFilePath('x.txt')).toBe(false)
    expect(isDelimitedDataFilePath('x.xlsx')).toBe(false)
  })
})

describe('sniffDelimiter', () => {
  it('prefers tab when more tabs than commas', () => {
    expect(sniffDelimiter('a\tb\tc')).toBe('\t')
  })
  it('uses comma by default', () => {
    expect(sniffDelimiter('a,b,c')).toBe(',')
  })
})

describe('parseDelimitedLine', () => {
  it('splits simple comma row', () => {
    expect(parseDelimitedLine('a,b,c', ',')).toEqual(['a', 'b', 'c'])
  })
  it('handles quoted commas', () => {
    expect(parseDelimitedLine('"a,b",c', ',')).toEqual(['a,b', 'c'])
  })
  it('handles doubled quotes', () => {
    expect(parseDelimitedLine('"say ""hi""",x', ',')).toEqual(['say "hi"', 'x'])
  })
})

describe('parseDelimitedTextToTable', () => {
  it('parses header and rows', () => {
    const csv = 'Name,Age\nAlice,30\nBob,25\n'
    const t = parseDelimitedTextToTable(csv, 10)
    expect(t.columns.map((c) => c.label)).toEqual(['Name', 'Age'])
    expect(t.rows).toHaveLength(2)
    expect(t.rows[0]).toMatchObject({ c0: 'Alice', c1: '30' })
    expect(t.rowCapReached).toBe(false)
  })

  it('caps data rows', () => {
    const csv = 'A\n1\n2\n3\n4\n'
    const t = parseDelimitedTextToTable(csv, 2)
    expect(t.rows).toHaveLength(2)
    expect(t.rowCapReached).toBe(true)
  })
})

describe('formatDelimitedHeadForModelContext', () => {
  it('includes markdown table and path', () => {
    const text = 'X,Y\n1,2\n'
    const out = formatDelimitedHeadForModelContext({
      relativePath: 'd/a.csv',
      text,
      fileTruncatedByRead: false,
      maxDataRows: 5,
    })
    expect(out).toContain('d/a.csv')
    expect(out).toContain('| X | Y |')
    expect(out).toContain('| 1 | 2 |')
    expect(out).toContain('preview only')
  })
})
