// The AI Service Notice and the user's choice about it. Pure (no React Native / Firebase), so it is unit-tested with `node --test`.
// This is the ONLY app file that names the AI provider: the notice has to say so. No key, endpoint or model setting exists in the app.
// The text states exactly what Phase 1 sends (fixed Malloya template text + a language code; see functions/src/ai/luna/prompt.js and the
// payload tests). It makes no retention or security promise. If a later phase sends anything more, this wording and LUNA_NOTICE_VERSION MUST change.
// Wording is the owner's to approve (privacy policy + POPIA review) before the feature is switched on for anyone.
export const LUNA_NOTICE_VERSION = 1 // must match NOTICE_VERSION in functions/src/ai/luna/constants.js; bump together when the wording changes
export const LUNA_NOTICE_TITLE = "AI Service Notice"
export const LUNA_NOTICE_TEXT =
  "Malloya may use OpenAI's GPT-6 Luna to improve the wording of some of its own conversational replies, such as greetings and thanks. " +
  "When this is used, only a short piece of template text written by Malloya, and a language code, is sent to OpenAI. Your messages, account details and location are not sent. " +
  "Please do not enter passwords, payment details or other sensitive personal information in the chat. Your conversations are handled in accordance with XploreSoweto's privacy policy."
export const LUNA_DELETE_ALL_LABEL = "Delete all my conversations"
export const LUNA_DELETE_ALL_NOTE = "This permanently deletes every conversation you've had with Malloya. It can't be undone. Your daily usage counters and your choice about the AI Service Notice are kept."

// luna = the `luna` block of aiGetUsage ({ available, noticeVersion, consent:{active} }) or undefined (older backend).
// -> { visible, on, showNotice }: visible = the backend offers the feature at all; on = the user has accepted the CURRENT notice.
export function lunaPanel(luna) {
  const available = !!(luna && luna.available === true && luna.noticeVersion === LUNA_NOTICE_VERSION)
  const on = available && !!(luna.consent && luna.consent.active === true)
  return { visible: available, on, showNotice: available && !on }
}
export function consentPayload(action) {
  if (action === "accept") return { action, noticeVersion: LUNA_NOTICE_VERSION }
  if (action === "withdraw") return { action }
  throw new Error("invalid-action")
}
