import { cn } from '@/lib/utils'

export type ComposerContextShelfProps = {
  servers: string[]
  activeServerNames: string[]
  onToggle: (name: string, enabled: boolean) => void
}

export function ComposerContextShelf({
  servers,
  activeServerNames,
  onToggle,
}: ComposerContextShelfProps) {
  const active = new Set(activeServerNames)
  return (
    <div className="braian-mcp-shelf">
      <div
        className="braian-mcp-shelf-edge braian-mcp-shelf-edge--start"
        aria-hidden
      />
      <div
        className="braian-mcp-shelf-edge braian-mcp-shelf-edge--end"
        aria-hidden
      />
      <div
        className="braian-mcp-shelf-scroll"
        role="group"
        aria-label="MCP data sources"
        tabIndex={0}
      >
        {servers.map((name) => {
          const enabled = active.has(name)
          return (
            <button
              key={name}
              type="button"
              className={cn(
                'braian-mcp-chip',
                enabled ? 'braian-mcp-chip--active' : 'braian-mcp-chip--inactive',
              )}
              aria-pressed={enabled}
              title={`${name} connector ${enabled ? 'enabled' : 'disabled'}`}
              onClick={() => onToggle(name, !enabled)}
            >
              <span className="block min-w-0 truncate">{name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
