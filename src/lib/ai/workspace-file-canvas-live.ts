/**
 * Fresh text from the workspace file editor (may be ahead of debounced thread state).
 * Registered per chat session from WorkspaceTextFileCanvas.
 */
export type WorkspaceFileCanvasLivePayload = {
  body: string
}

type Getter = () => WorkspaceFileCanvasLivePayload | null

const liveBySessionKey = new Map<string, Getter>()

export function setWorkspaceFileCanvasLiveGetter(
  sessionKey: string,
  getter: Getter,
) {
  liveBySessionKey.set(sessionKey, getter)
}

export function clearWorkspaceFileCanvasLiveGetter(sessionKey: string) {
  liveBySessionKey.delete(sessionKey)
}

export function getWorkspaceFileCanvasLivePayload(
  sessionKey: string,
): WorkspaceFileCanvasLivePayload | null {
  const g = liveBySessionKey.get(sessionKey)
  if (!g) return null
  try {
    return g()
  } catch {
    return null
  }
}
