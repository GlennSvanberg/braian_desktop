import { PanelLeftOpen } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useSidebar } from '@/components/ui/sidebar'

/**
 * When the main navigation sidebar is collapsed (off-canvas), the header sits to the
 * right of the file explorer — so a “show nav” control in the header felt misplaced.
 * This rail sits immediately left of the file panel, where the sidemenu column was.
 */
export function MainSidebarExpandRail() {
  const { open, setOpen, isMobile, openMobile, setOpenMobile } = useSidebar()

  const collapsed = isMobile ? !openMobile : !open
  if (!collapsed) return null

  const onExpand = () => {
    if (isMobile) setOpenMobile(true)
    else setOpen(true)
  }

  return (
    <div
      className="box-border flex h-svh w-11 min-w-11 shrink-0 flex-col border-r border-sidebar-border/50 bg-sidebar pt-2 text-sidebar-foreground"
    >
      <div className="flex h-14 shrink-0 items-center justify-center border-b border-sidebar-border/50">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-sidebar-foreground/80 hover:text-sidebar-foreground"
          title="Show navigation"
          onClick={onExpand}
        >
          <PanelLeftOpen className="size-4" />
          <span className="sr-only">Show navigation</span>
        </Button>
      </div>
    </div>
  )
}
