import type { Extension } from '@codemirror/state'
import { cpp } from '@codemirror/lang-cpp'
import { css } from '@codemirror/lang-css'
import { go } from '@codemirror/lang-go'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'

/**
 * CodeMirror language extensions inferred from workspace-relative path (extension).
 * Unknown extensions → no grammar (plain text, still themed).
 */
export function getLanguageExtensionsForPath(relativePath: string): Extension[] {
  const seg = relativePath.replace(/\\/g, '/').split('/').pop() ?? ''
  const dot = seg.lastIndexOf('.')
  const ext = dot >= 0 ? seg.slice(dot + 1).toLowerCase() : ''

  switch (ext) {
    case 'ts':
      return [javascript({ typescript: true })]
    case 'tsx':
      return [javascript({ typescript: true, jsx: true })]
    case 'js':
    case 'mjs':
    case 'cjs':
      return [javascript()]
    case 'jsx':
      return [javascript({ jsx: true })]
    case 'json':
      return [json()]
    case 'html':
    case 'htm':
      return [html()]
    case 'vue':
      return [html()]
    case 'css':
      return [css()]
    case 'scss':
    case 'less':
    case 'sass':
      return [css()]
    case 'md':
    case 'mdx':
      return [markdown()]
    case 'py':
      return [python()]
    case 'rs':
      return [rust()]
    case 'xml':
    case 'svg':
      return [xml()]
    case 'sql':
      return [sql()]
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'h':
    case 'hpp':
    case 'hh':
      return [cpp()]
    case 'go':
      return [go()]
    case 'yaml':
    case 'yml':
      return [yaml()]
    default:
      return []
  }
}
