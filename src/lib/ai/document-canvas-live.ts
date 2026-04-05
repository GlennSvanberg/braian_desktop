/**
 * Fresh markdown from the MDX editor (may be ahead of debounced thread state).
 * Registered per chat session from MarkdownDocumentCanvas.
 */
export type DocumentCanvasLivePayload = {
  body: string
}

type Getter = () => DocumentCanvasLivePayload | null

const liveBySessionKey = new Map<string, Getter>()

export function setDocumentCanvasLiveGetter(sessionKey: string, getter: Getter) {
  liveBySessionKey.set(sessionKey, getter)
}

export function clearDocumentCanvasLiveGetter(sessionKey: string) {
  liveBySessionKey.delete(sessionKey)
}

/** Latest in-editor markdown for this session, if a canvas is mounted. */
export function getDocumentCanvasLivePayload(
  sessionKey: string,
): DocumentCanvasLivePayload | null {
  const g = liveBySessionKey.get(sessionKey)
  if (!g) return null
  try {
    return g()
  } catch {
    return null
  }
}
