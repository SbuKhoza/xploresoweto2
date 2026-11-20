// Email-verification gate and optional-location consent helpers (pure).
// Gate: the backend requires a verified email. When we KNOW the user is unverified we do not call it at all.
export const canCallAssistant = (user) => ({ allowed: !!user && user.emailVerified === true, reason: !user ? "auth" : user.emailVerified === true ? null : "verify" })

// Only these phrasings mean the answer would be better with a position; everything else never prompts.
const NEARBY_RE = /\b(near\s?(me|by)|nearby|nearest|closest|close to me|around me|around here|close by|walking distance|how far|distance)\b/i
export const needsLocationHint = (text) => NEARBY_RE.test(String(text || ""))

// consent: "unknown" | "granted-once" | "declined". Location is only fetched when the user has just agreed for this message.
export function locationDecision({ text, consent }) {
  if (!needsLocationHint(text)) return "skip"          // never ask, never read
  if (consent === "declined") return "skip"            // respect the earlier choice; the assistant still answers without it
  return "ask"                                          // show the explanation; the user chooses Share once / Not now
}
