import { describe, expect, it } from 'vitest'

import { shouldSkipSecretsPath, shouldSkipWalkDirName } from '@/lib/retrieval/path-rules'

describe('shouldSkipSecretsPath', () => {
  it('skips .env and variants', () => {
    expect(shouldSkipSecretsPath('.env')).toBe(true)
    expect(shouldSkipSecretsPath('foo/.env')).toBe(true)
    expect(shouldSkipSecretsPath('foo/.env.local')).toBe(true)
    expect(shouldSkipSecretsPath('prod.env')).toBe(true)
  })

  it('allows normal source files', () => {
    expect(shouldSkipSecretsPath('src/env.ts')).toBe(false)
    expect(shouldSkipSecretsPath('environment.md')).toBe(false)
  })
})

describe('shouldSkipWalkDirName', () => {
  it('matches heavy dirs', () => {
    expect(shouldSkipWalkDirName('node_modules')).toBe(true)
    expect(shouldSkipWalkDirName('.git')).toBe(true)
    expect(shouldSkipWalkDirName('src')).toBe(false)
  })
})
