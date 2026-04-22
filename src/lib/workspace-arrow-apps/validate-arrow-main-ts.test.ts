import { describe, expect, it } from 'vitest'

import {
  lintArrowMainTsSource,
  validateArrowMainTsSync,
} from '@/lib/workspace-arrow-apps/validate-arrow-main-ts'

const VALID_MINIMAL = `
import { html, reactive } from '@arrow-js/core'
const s = reactive({ n: 0 })
export default html\`<button type="button" @click="\${() => s.n++}">\${() => s.n}</button>\`
`

describe('lintArrowMainTsSource', () => {
  it('accepts a minimal valid app', () => {
    expect(lintArrowMainTsSource(VALID_MINIMAL)).toEqual([])
    expect(validateArrowMainTsSync(VALID_MINIMAL).ok).toBe(true)
  })

  it('rejects @braian imports', () => {
    const bad = `import { html } from '@braian/arrow'\n${VALID_MINIMAL}`
    expect(lintArrowMainTsSource(bad).length).toBeGreaterThan(0)
  })

  it('rejects React imports', () => {
    const bad = `import { useState } from 'react'\n${VALID_MINIMAL}`
    expect(lintArrowMainTsSource(bad).length).toBeGreaterThan(0)
  })

  it('rejects onClick=', () => {
    const bad = VALID_MINIMAL.replace('@click', 'onClick')
    expect(lintArrowMainTsSource(bad).length).toBeGreaterThan(0)
  })

  it('rejects export default function', () => {
    const bad = `
import { html } from '@arrow-js/core'
export default function App() { return html\`<p>x</p>\` }
`
    expect(lintArrowMainTsSource(bad).length).toBeGreaterThan(0)
  })

  it('rejects missing export default html', () => {
    const bad = `
import { html } from '@arrow-js/core'
const x = html\`<p>y</p>\`
export default x
`
    expect(lintArrowMainTsSource(bad).length).toBeGreaterThan(0)
  })

  it('accepts export default html after newline', () => {
    const ok = `
import { html } from '@arrow-js/core'
export default
html\`<p>ok</p>\`
`
    expect(lintArrowMainTsSource(ok)).toEqual([])
  })

  it('accepts export default component(', () => {
    const ok = `
import { component, html } from '@arrow-js/core'
export default component(() => html\`<p>c</p>\`)
`
    expect(lintArrowMainTsSource(ok)).toEqual([])
  })
})
