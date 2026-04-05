import { describe, expect, it } from 'vitest'

import { applyDocumentCanvasPatches } from './document-canvas-patch'

describe('applyDocumentCanvasPatches', () => {
  it('applies a single unique replacement', () => {
    const r = applyDocumentCanvasPatches('hello world', [
      { find: 'world', replace: 'there' },
    ])
    expect(r).toEqual({ ok: true, markdown: 'hello there' })
  })

  it('applies ordered steps', () => {
    const r = applyDocumentCanvasPatches('a b c', [
      { find: 'a', replace: '1' },
      { find: 'b', replace: '2' },
    ])
    expect(r).toEqual({ ok: true, markdown: '1 2 c' })
  })

  it('rejects empty find', () => {
    const r = applyDocumentCanvasPatches('x', [{ find: '', replace: 'y' }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('EMPTY_FIND')
  })

  it('rejects not found', () => {
    const r = applyDocumentCanvasPatches('abc', [{ find: 'z', replace: 'q' }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('NOT_FOUND')
  })

  it('rejects ambiguous single match', () => {
    const r = applyDocumentCanvasPatches('foo foo', [{ find: 'foo', replace: 'x' }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('AMBIGUOUS')
  })

  it('replaceAll replaces every occurrence', () => {
    const r = applyDocumentCanvasPatches('foo foo', [
      { find: 'foo', replace: 'bar', replaceAll: true },
    ])
    expect(r).toEqual({ ok: true, markdown: 'bar bar' })
  })
})
