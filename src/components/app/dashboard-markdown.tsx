import { useMemo } from 'react'

import { cn } from '@/lib/utils'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import { Link } from '@tanstack/react-router'
import remarkGfm from 'remark-gfm'

function dashboardMarkdownComponents(): Components {
  return {
    a({ href, children, className, node: _node, ...props }) {
      if (href?.startsWith('/dashboard/page/')) {
        const pageId = href.slice('/dashboard/page/'.length).split('/')[0]
        if (pageId) {
          return (
            <Link
              to="/dashboard/page/$pageId"
              params={{ pageId }}
              className={className}
            >
              {children}
            </Link>
          )
        }
      }
      if (href?.startsWith('/')) {
        return (
          <Link to={href} className={className}>
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

export function DashboardMarkdown({
  markdown,
  className,
}: {
  markdown: string
  className?: string
}) {
  const components = useMemo(() => dashboardMarkdownComponents(), [])
  return (
    <div className={cn('in-app-doc-markdown', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
