"use strict"
// The privacy screen. Text goes IN, a "signature" comes OUT, and the text is then discarded. Fails CLOSED: anything doubtful -> { ok: false }.
//   * a signature holds only allow-listed words (vocab.js) and the placeholders <x> (unknown word), <n> (small number), <place> (a known landmark)
//   * so no name, street, number, email, link or free sentence can ever be stored; two different messages can share a signature, which is the point
//   * this same function is used when approved knowledge is matched at run time, so what an admin approves is exactly what is matched
const { ALLOWED, STOP, PLACEHOLDERS, SENSITIVE, PII_PATTERNS } = require("./vocab")
const { LANDMARKS } = require("../engine/landmarks")

const MAX_CHARS = 200, MAX_TOKENS = 12, MIN_CONTENT = 2, MAX_UNKNOWN = 2
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const ALIASES = LANDMARKS.flatMap((l) => l.aliases).sort((a, b) => b.length - a.length)
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9<>@#.+()-]+/g, " ").replace(/\s+/g, " ").trim()
const no = (reason) => ({ ok: false, reason })

function signature(text) {
  if (typeof text !== "string") return no("not-text")
  if (!text.trim() || text.length > MAX_CHARS) return no("length")
  if (CONTROL.test(text)) return no("control")
  const lower = text.toLowerCase()
  if (SENSITIVE.test(lower)) return no("sensitive")
  if (PII_PATTERNS.some((re) => re.test(lower))) return no("personal-data")
  let s = ` ${lower.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ")} `
  for (const a of ALIASES) s = s.split(` ${a} `).join(" <place> ")
  const out = []
  let unknown = 0, content = 0
  for (const raw of s.trim().split(" ")) {
    if (!raw) continue
    let t
    if (PLACEHOLDERS.has(raw)) t = raw
    else if (ALLOWED.has(raw)) { t = raw; if (!STOP.has(raw)) content += 1 }
    else if (/^r?\d{1,3}$/.test(raw)) t = "<n>"
    else { t = "<x>"; unknown += 1 }
    if (PLACEHOLDERS.has(t) && out[out.length - 1] === t) continue // "<x> <x>" -> "<x>"
    out.push(t)
  }
  if (out.length > MAX_TOKENS) return no("too-long")
  if (content < MIN_CONTENT) return no("too-little-safe-content")
  if (unknown > MAX_UNKNOWN) return no("too-many-unknown-words")
  return { ok: true, sig: out.join(" ") }
}
// An admin-supplied signature must be exactly what the screen could have produced (so nothing outside the vocabulary can be injected).
function validSignature(sig) {
  if (typeof sig !== "string" || sig.length > 120 || !sig.trim()) return false
  const toks = sig.split(" ")
  if (toks.length > MAX_TOKENS || toks.some((t) => !(PLACEHOLDERS.has(t) || ALLOWED.has(t)))) return false
  return toks.filter((t) => ALLOWED.has(t) && !STOP.has(t)).length >= MIN_CONTENT
}
module.exports = { signature, validSignature, MAX_CHARS }
