/** Machine-readable header prefix for indexed chunk bodies. */

export function formatFileChunkHeader(
  relativePath: string,
  lineStart: number,
  lineEnd: number,
): string {
  return `[source=file path=${relativePath} lines=${lineStart}-${lineEnd}]`
}

export function formatConversationChunkHeader(
  conversationId: string,
  messageStart: number,
  messageEnd: number,
): string {
  return `[source=conversation conversationId=${conversationId} messages=${messageStart}-${messageEnd}]`
}

export function formatMemoryChunkHeader(relativePath: string, entryId: string): string {
  return `[source=memory path=${relativePath} entryId=${entryId}]`
}
