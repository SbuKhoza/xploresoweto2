// Malloya "help it learn" controls. Pure (no React Native / Firebase) so it is unit-tested with `node --test`.
// The app never decides what is recorded: every outcome shown to the person comes from the server's answer (see feedbackOutcome), and
// the settings shown come from aiGetUsage().learning. Wording is the owner's to approve (privacy policy + POPIA review) before collection is switched on.
import { LUNA_DELETE_ALL_NOTE } from "./notice.js"

export const LEARNING_NOTICE_VERSION = 1 // must match LEARNING_NOTICE_VERSION in functions/src/ai/constants.js; bump together when the wording changes
export const LEARNING_NOTICE_TITLE = "Help Malloya learn"
export const LEARNING_NOTICE_TEXT =
  "When Malloya can't answer something, or you tell it an answer didn't help, a short, anonymised version of your question can be counted. " +
  "Names, numbers, contact details and anything that looks personal are removed first, and if that can't be done safely nothing is kept. " +
  "What is kept is not linked to your account, can't be traced back to you, and is only used by the XploreSoweto team to improve Malloya's answers. " +
  "Because it isn't linked to you, it can't be removed later, even if you delete your conversations or your data. " +
  "You can opt out at any time. Please don't enter passwords or sensitive personal details in the chat."
export const OPT_OUT_LABEL = "Help Malloya learn from questions it can't answer"

// Supported intents a person can pick when an answer missed the mark. `intent` values must be accepted by the server (CORRECTION_INTENTS).
export const CORRECTION_CHOICES = Object.freeze([
  { intent: "find_restaurants", label: "Places to eat" },
  { intent: "find_accommodation", label: "Places to stay" },
  { intent: "find_attractions", label: "Things to see" },
  { intent: "find_activities", label: "Things to do" },
  { intent: "find_events", label: "Events" },
  { intent: "plan_trip", label: "Plan a trip" },
  { intent: "ask_price", label: "Prices" },
  { intent: "ask_hours", label: "Opening hours" },
])

// learning = the `learning` block of aiGetUsage ({ available, noticeVersion, optedOut }) or undefined (older backend, or the call failed).
// -> what the screen may show. Nothing is offered that the server did not confirm.
export function learningPanel(learning) {
  const known = !!(learning && typeof learning === "object" && learning.noticeVersion === LEARNING_NOTICE_VERSION && typeof learning.optedOut === "boolean")
  const available = known && learning.available === true
  const optedOut = known && learning.optedOut === true
  return {
    showSettings: known, // the person can always see and change their choice once the server has reported it
    available, optedOut,
    participating: available && !optedOut,
    canGiveFeedback: available && !optedOut, // feedback buttons are hidden when nothing would be recorded
    status: !known ? "" : !available ? "Learning is switched off right now, so nothing is being collected." : optedOut ? "You've opted out. Nothing from your chats is counted." : "On. Only anonymised, de-personalised questions are counted.",
  }
}

export function feedbackPayload({ conversationId, messageId, rating, correctionIntent }) {
  if (!/^c_[a-f0-9]{24}$/.test(String(conversationId || ""))) throw new Error("invalid-conversation-id")
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(String(messageId || ""))) throw new Error("invalid-message-id")
  if (rating !== "helpful" && rating !== "unhelpful") throw new Error("invalid-rating")
  const p = { conversationId, messageId, rating }
  if (correctionIntent !== undefined && correctionIntent !== null) {
    if (rating !== "unhelpful" || !CORRECTION_CHOICES.some((c) => c.intent === correctionIntent)) throw new Error("invalid-correction")
    p.correctionIntent = correctionIntent
  }
  return p
}
export function optOutPayload(optOut) {
  if (typeof optOut !== "boolean") throw new Error("invalid-optOut")
  return { optOut }
}

// Turns the server's answer into what is shown. `recorded` is true ONLY when the server says so; every other outcome says plainly that nothing was kept.
export function feedbackOutcome(result) {
  const r = result && typeof result === "object" ? result : {}
  if (r.recorded === true) return { recorded: true, tone: "ok", text: "Thanks. Your report was counted anonymously." }
  const why = {
    "not-needed": "Thanks! Positive ratings aren't stored, so nothing was recorded.",
    duplicate: "You've already reported this one, so nothing new was recorded.",
    off: "Feedback isn't being collected right now, so nothing was recorded.",
    "opted-out": "You've opted out of helping Malloya learn, so nothing was recorded.",
    "not-safe-to-keep": "Nothing was recorded: that message can't be safely anonymised (it may contain personal details).",
    "user-cap": "You've reached today's feedback limit, so nothing was recorded.",
    "daily-cap": "Feedback is at capacity for today, so nothing was recorded.",
  }[r.reason]
  return { recorded: false, tone: "info", text: why || "Nothing was recorded." }
}

export const deleteConversationNote = (learningActive) =>
  "This permanently deletes this conversation from our servers." +
  (learningActive ? " Anonymous counts of questions Malloya couldn't answer can't be traced to you, so they aren't affected." : "")
export const deleteAllNote = () => `${LUNA_DELETE_ALL_NOTE} Your "help Malloya learn" choice is kept too.`
export const ERASE_LABEL = "Erase all my Malloya data"
export const ERASE_NOTE =
  "This deletes all your conversations, your AI Service Notice choice and Malloya's records about you. It can't be undone. " +
  "Your \"help Malloya learn\" choice and your daily usage counters are kept (the counters protect against abuse and cost). Anonymous counts can't be traced to you, so they aren't removed."
export const ERASE_CONFIRM = "ERASE-MY-AI-DATA" // what the server requires: a deliberate action, never sent by accident
export const erasePayload = () => ({ confirm: ERASE_CONFIRM })
