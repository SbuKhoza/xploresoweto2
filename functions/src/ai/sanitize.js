"use strict"
// Text that came from the database (listing descriptions, events, news, knowledge) is UNTRUSTED: it may have been written by
// a provider trying to steer the model. We cannot make injection impossible by cleaning text, so we (1) strip markup and links,
// (2) truncate hard, (3) always deliver it to the model inside a clearly delimited, instruction-free data envelope, and
// (4) give the model no write-capable tools. This is layer (1) and (2).
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const SA_ID = /\b\d{13}\b/g
function sanitizeText(value, max = 300) {
  if (value === null || value === undefined) return ""
  let s = typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : ""
  s = s.replace(/<[^>]*>/g, " ")                       // markup
    .replace(/\[([^\]]*)\]\((?:[^)]*)\)/g, "$1")      // markdown links -> label only
    .replace(/https?:\/\/\S+/gi, "[link removed]")    // raw links
    .replace(EMAIL, "[email removed]")                 // personal contact details are never repeated in an answer
    .replace(SA_ID, "[number removed]")               // 13-digit runs look like a South African ID number
    .replace(CONTROL, " ").replace(/\s+/g, " ").trim()
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}
const normalizeName = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim()
module.exports = { sanitizeText, normalizeName }
