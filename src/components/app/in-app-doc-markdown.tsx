import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import { Link } from '@tanstack/react-router'
import remarkGfm from 'remark-gfm'

function createDocMarkdownComponents(): Components {
  return {
    a({ href, children, className, node: _node, ...props }) {
      if (href?.startsWith('/')) {
        const to = href
        const isDocsTopic =
          to.startsWith('/docs/') && to !== '/docs' && to.split('/').length === 3
        if (isDocsTopic) {
          const slug = to.slice('/docs/'.length)
          return (
            <Link
              to="/docs/$slug"
              params={{ slug }}
              className={className}
            >
              {children}
            </Link>
          )
        }
        if (to === '/docs' || to === '/docs/') {
          return (
            <Link to="/docs" className={className}>
              {children}
            </Link>
          )
        }
        return (
          <Link to={to} className={className}>
            {children}
          </Link>
        )
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={className}
          {...props}
        >
          {children}
        </a>
      )
    },
  }
}

export function InAppDocMarkdown({ markdown }: { markdown: string }) {
  const components = useMemo(() => createDocMarkdownComponents(), [])
  return (
    <div className="in-app-doc-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
