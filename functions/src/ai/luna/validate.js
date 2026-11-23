"use strict"
// Validation of Luna's output. It is deliberately NARROW and fail-closed: it cannot prove two sentences mean the same thing, so it only
// accepts text built from a tiny closed vocabulary of greetings / thanks / generic offers to help. Anything else -> the original wording.
// Tests demonstrate that risky changes are REJECTED; they do not claim semantic equivalence.
const VOCAB = new Set(("hi hello hey welcome there to soweto thanks thank you you're youre happy glad pleasure anytime sure of course no problem " +
  "feel free ask me anything else about what would like do how can i help with and it a the is my your again great nice good hope are well so let know here if need something today").split(" "))
const MAX_SEGMENT_CHARS = 100
const ALLOWED_CHARS = /^[A-Za-z'’!?., -]+$/
// Defence in depth on top of the vocabulary (these words are not in it, but must stay out even if the vocabulary is ever extended).
const FORBIDDEN = [/\bi(?:'ll| will)\b/i, /\bwe(?:'ll| will)?\b/i, /\b(?:promise|guarantee|always|never|definitely|certainly|best|must|should|urgent|hurry|now|limited|offer|book|booking|reserve|price|cost|discount|open|closed|available|recommend|safe)\b/i,
  /(?<!feel )\bfree\b/i, /\bcan i (?:book|get|find|arrange|order)\b/i]

function parseJson(text) {
  if (typeof text !== "string" || !text.trim() || text.length > 4000) return null
  try { const v = JSON.parse(text); return v && typeof v === "object" && !Array.isArray(v) ? v : null } catch (e) { return null }
}
const words = (s) => (s.toLowerCase().replace(/’/g, "'").match(/[a-z']+/g) || [])

// -> { ok:true, segments } | { ok:false, reason }
function validateRewrite(template, outputText) {
  const rwIds = template.segments.filter((s) => s.rw).map((s) => s.id)
  const doc = parseJson(outputText)
  if (!doc) return { ok: false, reason: "not-json" }
  if (Object.keys(doc).length !== 1 || !doc.segments || typeof doc.segments !== "object" || Array.isArray(doc.segments)) return { ok: false, reason: "shape" }
  const got = Object.keys(doc.segments)
  if (got.length !== rwIds.length || !rwIds.every((i) => got.includes(i))) return { ok: false, reason: "segment-ids" }
  const out = {}
  for (const seg of template.segments.filter((s) => s.rw)) {
    const raw = doc.segments[seg.id]
    if (typeof raw !== "string") return { ok: false, reason: "not-string" }
    const t = raw.normalize("NFC").trim()
    if (t.length < 2 || t.length > MAX_SEGMENT_CHARS) return { ok: false, reason: "length" }
    if (!ALLOWED_CHARS.test(t)) return { ok: false, reason: "characters" } // no digits, symbols, links, currency, emoji, markdown or line breaks
    if ((seg.text.endsWith("?") && !t.endsWith("?")) || (!seg.text.endsWith("?") && t.includes("?"))) return { ok: false, reason: "question-shape" }
    if ((t.match(/[!?.]/g) || []).length > 2) return { ok: false, reason: "punctuation" }
    const w = words(t)
    if (!w.length || w.some((x) => !VOCAB.has(x))) return { ok: false, reason: "vocabulary" }
    if (FORBIDDEN.some((re) => re.test(t))) return { ok: false, reason: "forbidden-phrase" }
    out[seg.id] = t
  }
  return { ok: true, segments: out }
}
module.exports = { validateRewrite, VOCAB, MAX_SEGMENT_CHARS }
