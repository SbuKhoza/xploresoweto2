"use strict"
// The privacy screen. Text goes IN, a "signature" comes OUT, and the text is then discarded. Fails CLOSED: anything doubtful -> { ok: false }.
//   * a signature holds only allow-listed words (vocab.js) and the placeholders <x> (unknown word), <n> (small number), <place> (a known landmark)
//   * so no name, street, number, email, link or free sentence can ever be stored; two different messages can share a signature, which is the point
//   * this same function is used when approved knowledge is matched at run time, so what an admin approves is exactly what is matched
const { ALLOWED, STOP, PLACEHOLDERS, SENSITIVE, SENSITIVE_MORE, DISCLOSURE, PII_PATTERNS } = require("./vocab")
const { LANDMARKS } = require("../engine/landmarks")

const MAX_CHARS = 200, MAX_TOKENS = 12, MIN_CONTENT = 2, MAX_UNKNOWN = 2
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const ALIASES = LANDMARKS.flatMap((l) => l.aliases).sort((a, b) => b.length - a.length)
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9<>@#.+()-]+/g, " ").replace(/\s+/g, " ").trim()
const no = (reason) => ({ ok: false, reason })

// Number words in the languages Malloya sees, so "zero eight two ..." cannot smuggle a phone or ID number past a digit check.
const NUMBER_WORDS = new Set(("zero one two three four five six seven eight nine ten oh nil nul een twee drie vier vyf ses sewe agt nege tien " +
  "kunye kubili kuthathu kune kuhlanu isithupha isikhombisa isishiyagalombili isishiyagalolunye lunye bili thathu ne hlanu tshumi " +
  "nngwe pedi tharo nne tlhano thataro supa robedi robong lesome").split(" "))
const ZERO_WIDTH = /[­؜᠎​-‏‪-‮⁠-⁯﻿︀-️]/
const LEET = { 0: "0", o: "0", l: "1", i: "1", "|": "1", z: "2", s: "5", b: "8", g: "9" }
// Pre-checks that need the text exactly as typed. Returns a reason to refuse, or null. Fail closed: anything unexpected is a refusal.
function refuse(raw) {
  if (ZERO_WIDTH.test(raw)) return "hidden-characters"
  if (/\p{Nd}/u.test(raw.replace(/[0-9]/g, ""))) return "non-ascii-digits" // Arabic-Indic, fullwidth etc.: never accepted
  const t = raw.normalize("NFKC").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase() // fold accents and compatibility forms ("ｓｉｐｈｏ@…")
  if (/[^\p{Script=Latin}\p{N}\p{P}\p{S}\p{Z}\n\t]/u.test(t)) return "unsupported-script"
  if (t.length < raw.length / 3) return "unexpected-input"
  if (/\p{Extended_Pictographic}/u.test(t)) return "unexpected-input"
  if (SENSITIVE.test(t) || SENSITIVE_MORE.test(t) || DISCLOSURE.test(t)) return "sensitive"
  const squashed = t.replace(/[\s._()\-+,/\\|*#~]+/g, "")
  if (PII_PATTERNS.some((re) => re.test(t))) return "personal-data"
  if (/(?:\bdot\b|\(dot\)|\[dot\]|\bpunkt\b)\s*(?:com|org|net|co|za|gov|edu|io|app)\b/.test(t) || /(?:\bat\b|\(at\)|\[at\])\s*[a-z0-9]+\s*(?:\bdot\b|\(dot\)|\[dot\]|\.)/.test(t)) return "personal-data" // "sipho at gmail dot com"
  if (/https?|www|\.com|\.co\.za|@/.test(squashed)) return "personal-data"
  if ((t.match(/\d/g) || []).length >= 7 || /\d{5,}/.test(squashed)) return "personal-data" // any 7+ digits anywhere, or a 5+ run once separators are removed
  const words = t.replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean)
  if (words.filter((w) => /^\d+$/.test(w) || NUMBER_WORDS.has(w)).reduce((n, w) => n + (/^\d+$/.test(w) ? w.length : 1), 0) >= 6) return "spelled-out-number"
  for (const w of words) { // leetspeak digits ("o82 l23 4567", "zer0 eight2"): a chunk with real digits whose look-alike form is a long digit run
    if (/\d/.test(w) && w.length >= 4 && /^[0-9olizsbg|]+$/.test(w) && w.replace(/[olizsbg|]/g, (c) => LEET[c]).replace(/\D/g, "").length >= 6) return "personal-data"
    if (w.length > 25) return "unexpected-input" // encoded blobs, tokens, hashes
  }
  if (/[A-Za-z0-9+/=_-]{24,}/.test(raw)) return "unexpected-input"
  if (/ignore (all |any |the )?(previous|above|prior)|system prompt|jailbreak|<\/?\w+|\{\{|\$\{|`|\bselect\b.+\bfrom\b|\bdrop table\b/i.test(t)) return "instruction-like"
  return null
}

function signature(text) {
  if (typeof text !== "string") return no("not-text")
  if (!text.trim() || text.length > MAX_CHARS) return no("length")
  if (CONTROL.test(text)) return no("control")
  let reason
  try { reason = refuse(text) } catch (e) { return no("screen-error") } // any failure inside the screen is a refusal
  if (reason) return no(reason)
  const lower = text.normalize("NFKC").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase()
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
