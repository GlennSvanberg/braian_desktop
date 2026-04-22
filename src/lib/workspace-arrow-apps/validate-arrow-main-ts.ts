/**
 * Validates Braian workspace Arrow `main.ts` before it is written to disk.
 *
 * Layer 1: fast static rules (always run).
 * Layer 2: optional `@arrow-js/sandbox` compile + mount when `document` exists
 * (browser / Tauri webview) — catches bad imports and many runtime prep errors.
 */

const BANNED_IMPORT_RE = [
  { re: /@braian\//i, msg: 'Invalid import: @braian/* modules do not exist inside the Arrow VM.' },
  { re: /from\s+['"]react['"]/i, msg: 'Do not import React — Arrow apps are not React components.' },
  { re: /from\s+['"]react-dom['"]/i, msg: 'Do not import react-dom.' },
  { re: /from\s+['"]react\/jsx-runtime['"]/i, msg: 'Do not use React JSX runtime.' },
  { re: /from\s+['"]vue['"]/i, msg: 'Vue is not supported in the Arrow sandbox.' },
  { re: /from\s+['"]preact['"]/i, msg: 'Preact is not supported in the Arrow sandbox.' },
]

/** React-style DOM event props (Arrow uses @click, @input, etc.). */
const REACT_ON_PROP = /\bon[A-Z]\w*\s*=/

const RE_EXPORT_DEFAULT_FUNCTION = /\bexport\s+default\s+function\b/
const RE_EXPORT_DEFAULT_CLASS = /\bexport\s+default\s+class\b/

/** Must default-export the root template (possibly after imports). */
/** `export default html` … may break across lines before the opening backtick. */
const RE_EXPORT_DEFAULT_HTML = /\bexport\s+default\s+html[\s\n]*(?:`|\()/m

const RE_EXPORT_DEFAULT_COMPONENT_CALL =
  /\bexport\s+default\s+component\s*\(/m

export type ArrowMainTsValidation = {
  ok: true
} | {
  ok: false
  errors: string[]
}

/**
 * Static checks only — safe in Node, SSR, and workers.
 */
export function lintArrowMainTsSource(mainTs: string): string[] {
  const errors: string[] = []
  const trimmed = mainTs.trim()
  if (!trimmed) {
    errors.push('main.ts is empty.')
    return errors
  }

  for (const { re, msg } of BANNED_IMPORT_RE) {
    if (re.test(mainTs)) errors.push(msg)
  }

  if (REACT_ON_PROP.test(mainTs)) {
    errors.push(
      'Use Arrow event bindings like @click="${() => ...}" — not React onClick= / onChange=.',
    )
  }

  if (RE_EXPORT_DEFAULT_FUNCTION.test(mainTs)) {
    errors.push(
      'Do not `export default function …` — default export must be an Arrow `html`…` template (or `component(...)`), not a React-style component.',
    )
  }
  if (RE_EXPORT_DEFAULT_CLASS.test(mainTs)) {
    errors.push('Do not `export default class` — use a default-exported Arrow template.')
  }

  if (!/\bexport\s+default\b/m.test(mainTs)) {
    errors.push('Missing `export default` — the sandbox entry must default-export the root view.')
  } else if (
    !RE_EXPORT_DEFAULT_HTML.test(mainTs) &&
    !RE_EXPORT_DEFAULT_COMPONENT_CALL.test(mainTs)
  ) {
    errors.push(
      'Default export must start as `export default html`…` or `export default component(` — see app-builder skill.',
    )
  }

  return errors
}

/**
 * When running in a browser document, compile and mount once into a hidden node.
 * Returns human-readable errors (including sandbox `onError`).
 */
export async function sandboxSmokeTestArrowMainTs(mainTs: string): Promise<string[]> {
  if (typeof document === 'undefined') return []

  const out: string[] = []
  const host = document.createElement('div')
  host.setAttribute('data-arrow-validate', '1')
  host.style.cssText =
    'position:fixed;left:-9999px;top:0;width:4px;height:4px;overflow:hidden;pointer-events:none;visibility:hidden'
  document.body.appendChild(host)

  try {
    const { sandbox } = await import('@arrow-js/sandbox')
    const view = sandbox(
      {
        source: { 'main.ts': mainTs },
        shadowDOM: true,
        onError: (err) => {
          out.push(err instanceof Error ? err.message : String(err))
        },
      },
      {},
    )
    view(host)
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
  } catch (e) {
    out.push(e instanceof Error ? e.message : String(e))
  } finally {
    host.remove()
  }
  return out
}

export function validateArrowMainTsSync(mainTs: string): ArrowMainTsValidation {
  const errors = lintArrowMainTsSource(mainTs)
  if (errors.length === 0) return { ok: true }
  return { ok: false, errors }
}

export async function validateArrowMainTsFull(mainTs: string): Promise<ArrowMainTsValidation> {
  const staticErrors = lintArrowMainTsSource(mainTs)
  if (staticErrors.length > 0) return { ok: false, errors: staticErrors }

  const runtimeErrors = await sandboxSmokeTestArrowMainTs(mainTs)
  if (runtimeErrors.length > 0) {
    return {
      ok: false,
      errors: [
        'Arrow sandbox rejected main.ts (fix and retry):',
        ...runtimeErrors.map((e) => `  · ${e}`),
      ],
    }
  }
  return { ok: true }
}
