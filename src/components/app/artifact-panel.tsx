import { FileText, ImageIcon, Table2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type ArtifactPanelProps = {
  title?: string
}

export function ArtifactPanel({ title = 'Untitled artifact' }: ArtifactPanelProps) {
  return (
    <div className="bg-card border-border flex h-full min-h-0 flex-col rounded-xl border shadow-sm">
      <div className="border-border flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="text-text-3 text-xs font-medium tracking-wide uppercase">
            Artifact
          </p>
          <h2 className="text-text-1 truncate text-sm font-semibold">{title}</h2>
        </div>
        <Badge variant="secondary" className="shrink-0 font-normal">
          Preview
        </Badge>
      </div>
      <Tabs defaultValue="document" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="border-border shrink-0 border-b px-2 pt-2">
          <TabsList className="bg-muted/60 grid w-full grid-cols-3">
            <TabsTrigger value="document" className="gap-1.5 text-xs">
              <FileText className="size-3.5" />
              Document
            </TabsTrigger>
            <TabsTrigger value="code" className="gap-1.5 text-xs">
              <Table2 className="size-3.5" />
              Data
            </TabsTrigger>
            <TabsTrigger value="visual" className="gap-1.5 text-xs">
              <ImageIcon className="size-3.5" />
              Visual
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent
          value="document"
          className="m-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          <ScrollArea className="min-h-0 flex-1">
            <article className="text-text-2 space-y-4 px-4 py-4 text-sm leading-relaxed">
              <p className="text-text-1 text-base font-medium">
                Cowork-style surface
              </p>
              <p>
                This panel stands in for rendered artifacts: briefs, memos,
                specs, or anything the assistant produces alongside chat. The
                layout keeps conversation on the left and a stable canvas on the
                right.
              </p>
              <ul className="text-text-2 list-inside list-disc space-y-2 pl-1">
                <li>Swap this body for your real artifact renderer.</li>
                <li>Tabs suggest multiple artifact types in one session.</li>
                <li>Resize the split to match user preference.</li>
              </ul>
            </article>
          </ScrollArea>
        </TabsContent>
        <TabsContent
          value="code"
          className="m-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          <ScrollArea className="min-h-0 flex-1">
            <pre className="text-text-2 font-mono text-xs leading-relaxed">
              <code className="block p-4">{`// Placeholder structured output
{
  "workspace": "demo",
  "rows": [
    { "id": 1, "label": "Idea", "status": "draft" },
    { "id": 2, "label": "Spec", "status": "review" }
  ]
}`}</code>
            </pre>
          </ScrollArea>
        </TabsContent>
        <TabsContent
          value="visual"
          className="m-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          <div className="text-text-3 flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm">
            <div className="from-accent-500/15 to-accent-600/5 border-accent-500/20 flex aspect-video w-full max-w-sm items-center justify-center rounded-lg border bg-linear-to-br">
              <ImageIcon className="text-accent-500 size-10 opacity-80" />
            </div>
            <p>Charts, images, or embedded previews will render here.</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
