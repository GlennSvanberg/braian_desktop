import { createFileRoute, notFound } from '@tanstack/react-router'

import { InAppDocMarkdown } from '@/components/app/in-app-doc-markdown'
import { InAppDocsShell } from '@/components/app/in-app-docs-layout'
import { getInAppDoc } from '@/lib/in-app-docs/registry'

export const Route = createFileRoute('/_shell/docs/$slug')({
  component: DocsTopicPage,
  beforeLoad: ({ params }) => {
    const doc = getInAppDoc(params.slug)
    if (!doc) throw notFound()
    return { doc }
  },
})

function DocsTopicPage() {
  const { doc } = Route.useRouteContext()

  return (
    <InAppDocsShell title={doc.title} description={doc.description}>
      <InAppDocMarkdown markdown={doc.body} />
    </InAppDocsShell>
  )
}
