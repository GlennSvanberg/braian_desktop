import type * as React from 'react'

export type WorkspaceFilePointerPayload = {
  relativePath: string
  displayName: string
  isDir: boolean
}

const CHAT_DROP_ZONE_SELECTOR = '[data-braian-file-drop-zone="1"]'
const EXPLORER_MOVE_TARGET_SELECTOR = '[data-braian-explorer-move-target="1"]'
const DRAG_THRESHOLD_PX = 8

/** Lucide-style file glyph (stroke), static — displayName is set via textContent only. */
const FILE_GHOST_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`
const FOLDER_GHOST_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.16 3.5A2 2 0 0 0 7.47 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`

let dropHandler: ((payload: WorkspaceFilePointerPayload) => void) | null = null
let explorerMoveHandler:
  | ((payload: WorkspaceFilePointerPayload, destParentRelative: string) => void)
  | null = null

let ghostEl: HTMLDivElement | null = null

function syncGhostPosition(clientX: number, clientY: number) {
  if (!ghostEl) return
  const pad = 14
  ghostEl.style.transform = `translate(${clientX + pad}px, ${clientY + pad}px)`
}

function mountGhost(payload: WorkspaceFilePointerPayload, clientX: number, clientY: number) {
  unmountGhost()
  const el = document.createElement('div')
  el.className = 'braian-ws-file-drag-ghost'
  el.setAttribute('role', 'presentation')
  const icon = payload.isDir ? FOLDER_GHOST_ICON_SVG : FILE_GHOST_ICON_SVG
  el.innerHTML = `<span class="braian-ws-file-drag-ghost-row">${icon}<span class="braian-ws-file-drag-ghost-name"></span></span>`
  const nameSlot = el.querySelector('.braian-ws-file-drag-ghost-name')
  if (nameSlot) nameSlot.textContent = payload.displayName
  el.style.transform = 'translate(0px, 0px)'
  document.body.appendChild(el)
  ghostEl = el
  syncGhostPosition(clientX, clientY)
}

function unmountGhost() {
  ghostEl?.remove()
  ghostEl = null
}

type Pending = {
  payload: WorkspaceFilePointerPayload
  startX: number
  startY: number
}

let pending: Pending | null = null
let session: {
  payload: WorkspaceFilePointerPayload
  lastX: number
  lastY: number
} | null = null

function normRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** Only the active chat composer should register; avoids duplicate applies (e.g. Strict Mode). */
export function registerWorkspaceFilePointerDropHandler(
  handler: (payload: WorkspaceFilePointerPayload) => void,
): () => void {
  dropHandler = handler
  return () => {
    if (dropHandler === handler) dropHandler = null
  }
}

/** File tree registers to handle in-explorer moves (chat drop zone is checked first). */
export function registerWorkspaceExplorerMoveHandler(
  handler: (payload: WorkspaceFilePointerPayload, destParentRelative: string) => void,
): () => void {
  explorerMoveHandler = handler
  return () => {
    if (explorerMoveHandler === handler) explorerMoveHandler = null
  }
}

/**
 * In-app “drag” from Explorer / workspace file rows. WebView2 HTML5 DnD onto `<textarea>` is
 * unreliable; this uses pointer move + release + `elementFromPoint` instead.
 * Call from `onPointerDownCapture` on a file row (left button only).
 */
export function workspaceFilePointerDragMaybeStartOnPointerDown(
  e: React.PointerEvent,
  payload: WorkspaceFilePointerPayload,
): void {
  if (e.button !== 0) return
  if (pending !== null || session !== null) return

  pending = {
    payload,
    startX: e.clientX,
    startY: e.clientY,
  }

  const onMove = (ev: PointerEvent) => {
    if (pending) {
      const dx = ev.clientX - pending.startX
      const dy = ev.clientY - pending.startY
      if (dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
        session = {
          payload: pending.payload,
          lastX: ev.clientX,
          lastY: ev.clientY,
        }
        pending = null
        document.body.classList.add('braian-ws-file-pointer-drag')
        mountGhost(session.payload, ev.clientX, ev.clientY)
      }
      return
    }
    if (session) {
      session.lastX = ev.clientX
      session.lastY = ev.clientY
      syncGhostPosition(ev.clientX, ev.clientY)
    }
  }

  const teardown = () => {
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onCancel, true)
    document.removeEventListener('keydown', onKeyDown, true)
  }

  const resetChrome = () => {
    document.body.classList.remove('braian-ws-file-pointer-drag')
    unmountGhost()
  }

  const onUp = () => {
    teardown()
    resetChrome()

    if (session) {
      const el = document.elementFromPoint(session.lastX, session.lastY)
      if (el?.closest(CHAT_DROP_ZONE_SELECTOR)) {
        if (!session.payload.isDir) {
          dropHandler?.(session.payload)
        }
      } else {
        const moveTarget = el?.closest(EXPLORER_MOVE_TARGET_SELECTOR)
        if (moveTarget && explorerMoveHandler) {
          const raw = moveTarget.getAttribute('data-explorer-dest-dir') ?? ''
          const destParentRelative = raw
          const from = normRel(session.payload.relativePath)
          const destNorm = normRel(destParentRelative)

          if (from === destNorm) {
            pending = null
            session = null
            return
          }
          if (
            session.payload.isDir &&
            (destNorm === from || destNorm.startsWith(`${from}/`))
          ) {
            pending = null
            session = null
            return
          }
          explorerMoveHandler(session.payload, destParentRelative)
        }
      }
    }
    pending = null
    session = null
  }

  const onCancel = () => {
    teardown()
    resetChrome()
    pending = null
    session = null
  }

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return
    if (!pending && !session) return
    onCancel()
  }

  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onCancel, true)
  document.addEventListener('keydown', onKeyDown, true)
}
