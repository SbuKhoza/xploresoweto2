// Pure (no React Native / Firebase imports) client logic for the Soweto assistant, so it can be unit-tested with `node --test`.
// The Firebase callable is injected: in the app it is utils/callable.js `callFunction`.

export const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/
export const MAX_MESSAGE_CHARS_FALLBACK = 1000

// Builds the exact aiChat payload. Only the fields the backend accepts: message, requestId, conversationId?, location?{latitude,longitude}.
export function buildChatPayload({ message, requestId, conversationId, location }) {
  const text = typeof message === "string" ? message.trim() : ""
  if (!text) throw new Error("empty-message")
  if (!REQUEST_ID_RE.test(String(requestId || ""))) throw new Error("invalid-request-id")
  const payload = { message: text, requestId }
  if (conversationId) payload.conversationId = conversationId
  if (location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)) {
    payload.location = { latitude: location.latitude, longitude: location.longitude } // nothing else is forwarded
  }
  return payload
}

// Tracks the one in-flight / failed message. A NEW message gets a new requestId; retrying the SAME text keeps it.
export function createSendState(makeId) {
  let pending = null // { text, requestId }
  let inFlight = false
  return {
    get inFlight() { return inFlight },
    get pending() { return pending },
    // Returns the requestId to use, or null when a send is already running (duplicate-send guard).
    begin(text) {
      const t = String(text || "").trim()
      if (!t || inFlight) return null
      if (!pending || pending.text !== t) pending = { text: t, requestId: makeId() }
      inFlight = true
      return pending.requestId
    },
    succeed() { inFlight = false; pending = null },
    fail() { inFlight = false }, // pending is kept so Retry reuses the same requestId
    reset() { inFlight = false; pending = null },
  }
}

export function createAiApi(call) {
  return {
    chat: (args) => call("aiChat", buildChatPayload(args)),
    usage: () => call("aiGetUsage", {}),
    list: () => call("aiListConversations", {}),
    open: (conversationId) => call("aiGetConversation", { conversationId }),
    remove: (conversationId) => call("aiDeleteConversation", { conversationId }),
    removeAll: () => call("aiDeleteAllMyAiData", {}),
  }
}
