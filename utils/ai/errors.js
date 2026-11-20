// Maps callable errors (as produced by utils/callable.js: .code, .rawMessage, .details) to what the assistant UI should do.
// kind: auth | verify | daily | burst | invalid | too-long | disabled | busy | offline | missing | server
const mins = (s) => { const m = Math.ceil(s / 60); return m <= 1 ? "about a minute" : m < 90 ? `${m} minutes` : `${Math.round(m / 60)} hours` }

export function describeAiError(e, { offline = false } = {}) {
  if (offline) return { kind: "offline", title: "You're offline", text: "The assistant needs an internet connection. Your message is kept, so you can send it when you're back online.", retry: true }
  const code = e?.code || "internal"
  const raw = String(e?.rawMessage || "")
  const d = e?.details || {}
  if (code === "unauthenticated") return { kind: "auth", title: "Please sign in again", text: "Your session has expired. Sign in again to keep chatting.", retry: false }
  if (code === "failed-precondition" && /email-not-verified/.test(raw || e?.message || "")) return { kind: "verify", title: "Verify your email", text: "The assistant is available once your email address is verified.", retry: false }
  if (code === "resource-exhausted") {
    if (raw === "daily-limit" || Number.isFinite(d.resetsInSeconds)) {
      const when = Number.isFinite(d.resetsInSeconds) ? ` The allowance resets in ${mins(d.resetsInSeconds)}.` : ""
      return { kind: "daily", title: "Daily limit reached", text: `You've used today's assistant messages${Number.isFinite(d.limit) ? ` (${d.limit})` : ""}.${when}`, retry: false }
    }
    const s = Number.isFinite(d.retryAfterSeconds) ? Math.max(1, Math.ceil(d.retryAfterSeconds)) : null
    return { kind: "burst", title: "Slow down a little", text: s ? `You're sending messages quickly. Try again in ${s} second${s === 1 ? "" : "s"}.` : "You're sending messages quickly. Try again in a moment.", retry: true, retryAfterSeconds: s }
  }
  if (code === "invalid-argument") {
    if (raw === "message-too-long") return { kind: "too-long", title: "Message too long", text: `Please shorten your message${Number.isFinite(d.maxChars) ? ` to ${d.maxChars} characters or fewer` : ""}.`, retry: false }
    return { kind: "invalid", title: "That couldn't be sent", text: "The message looks invalid. Please rephrase it and try again.", retry: false }
  }
  if (code === "unavailable" && raw === "ai-disabled") return { kind: "disabled", title: "Assistant unavailable", text: "The Soweto assistant is switched off right now. Please try again later.", retry: false }
  if (code === "aborted") return { kind: "busy", title: "Still working on it", text: "Your previous message is still being processed. Wait a moment, then retry.", retry: true }
  if (code === "not-found") return { kind: "missing", title: "Conversation not found", text: "That conversation is no longer available. Start a new one.", retry: false }
  return { kind: "server", title: "Couldn't reach the assistant", text: "Something went wrong on our side or your connection dropped. Your message is kept; try again.", retry: true }
}
