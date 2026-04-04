/** True when dev mock AI is enabled (no real provider calls). */
export function isMockAiMode(): boolean {
  try {
    return (
      import.meta.env.DEV &&
      typeof globalThis.localStorage !== 'undefined' &&
      globalThis.localStorage.getItem('braian.mockAi') === '1'
    )
  } catch {
    return false
  }
}
