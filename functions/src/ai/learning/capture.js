"use strict"
// Turns "Malloya could not help" into a bounded, screened candidate. The message text is screened into a signature in memory and dropped:
// the text, the uid and the conversation id are never written to a candidate. Everything here is best effort and can NEVER fail a chat.
const log = require("../log")
const { signature } = require("./screen")
const store = require("./store")

const CORRECTIONS = require("./vocab").CORRECTION_INTENTS
async function fromTurn({ uid, message, signals, cfg, requestId }) {
  try {
    const L = cfg.learning // a cheap early exit only: the authoritative check is re-done inside the recording transaction
    if (!L || L.collect !== true || L.privacyAcknowledged !== true || !Array.isArray(signals) || !signals.length) return { recorded: 0 }
    if (await store.isOptedOut(uid)) return { recorded: 0 }
    const sg = signature(message)
    if (!sg.ok) return { recorded: 0, skipped: sg.reason } // fail closed: no safe signature, no candidate
    let n = 0
    for (const s of signals.slice(0, 2)) { const r = await store.recordSignal({ uid, kind: s.kind, sig: sg.sig, hintIntent: s.hintIntent, dedupeKey: `chat:${requestId}` }); if (r.recorded) n += 1 }
    return { recorded: n }
  } catch (e) { log.warn("ai.learning.capture_failed", { code: e && e.code }); return { recorded: 0, skipped: "error" } }
}
// Explicit feedback. Structured only (a rating and, optionally, which supported intent the person meant): no free text is accepted.
async function fromFeedback({ uid, userText, messageId, rating, correctionIntent, hintIntent, cfg }) {
  const L = cfg.learning
  if (!L || L.collect !== true || L.privacyAcknowledged !== true) return { recorded: false, reason: "off" }
  if (await store.isOptedOut(uid)) return { recorded: false, reason: "opted-out" }
  if (rating !== "unhelpful") return { recorded: false, reason: "not-needed" }
  const sg = signature(userText)
  if (!sg.ok) return { recorded: false, reason: "not-safe-to-keep" }
  const sugg = CORRECTIONS.includes(correctionIntent) ? correctionIntent : null
  return store.recordSignal({ uid, kind: sugg ? "feedback_correction" : "feedback_unhelpful", sig: sg.sig, hintIntent, suggestedIntent: sugg, dedupeKey: `fb:${messageId}` })
}
module.exports = { fromTurn, fromFeedback }
