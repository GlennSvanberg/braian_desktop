/** Lets non-React code (e.g. chat session store) refresh sidebar conversation lists after disk updates. */
let refreshConversations: (() => Promise<void>) | null = null

export function registerConversationListRefresh(fn: () => Promise<void>) {
  refreshConversations = fn
}

export function unregisterConversationListRefresh() {
  refreshConversations = null
}

export function requestConversationListRefresh() {
  return refreshConversations?.() ?? Promise.resolve()
}
