"use strict"
// The ONLY text ever sent to Luna: fixed instructions plus a few fixed, fact-free phrases taken from Malloya's own templates.
// The user's message, ids, emails, phones, coordinates, tokens and database records are never part of a payload.
// The set of possible payloads is CLOSED and enumerable (templates x languages); each has a hash and a measured token count in
// calibration.json, and a test fails when a template or the instructions change without recalibration.
const crypto = require("node:crypto")
const en = require("../engine/locales/en")
const { MODEL, BYTE_CEILING } = require("./constants")

// Segment lists must join back to the exact deterministic template; "rw" segments may be reworded, the rest are pinned byte-for-byte.
const TEMPLATES = Object.freeze({
  greeting: Object.freeze({
    intent: "greeting",
    segments: Object.freeze([
      Object.freeze({ id: "open", rw: true, text: "Hi!" }),
      Object.freeze({ id: "pinned", rw: false, text: " I can help you find attractions, restaurants, places to stay and local businesses in Soweto, and suggest a plan for your visit using what is listed on XploreSoweto. " }),
      Object.freeze({ id: "ask", rw: true, text: "What would you like to do?" }),
    ]),
    deterministic: en.greeting,
  }),
  thanks: Object.freeze({
    intent: "thanks",
    segments: Object.freeze([Object.freeze({ id: "all", rw: true, text: "You're welcome! Ask me anything else about Soweto." })]),
    deterministic: en.thanks,
  }),
})
const LANGUAGES = Object.freeze(["en"]) // Malloya only has English wording today (isiZulu is detected and answered in English)

const INSTRUCTIONS = [
  "You lightly rephrase short, friendly conversational phrases for a Soweto travel assistant named Malloya.",
  "You receive JSON: {\"language\":\"en\",\"segments\":{\"<id>\":\"<phrase>\"}}. Return JSON {\"segments\":{\"<id>\":\"<phrase>\"}} with exactly the same ids.",
  "Rules: keep each phrase's meaning and language; keep questions as questions and statements as statements; keep each phrase short.",
  "Use only greetings, thanks, welcomes and generic offers to help. Never add facts, names, numbers, places, prices, times, links, promises, recommendations, urgency, offers, bookings or abilities.",
  "If you are unsure, return the phrase unchanged.",
].join("\n")

const joinSegments = (tpl, rewritten) => tpl.segments.map((s) => (s.rw && rewritten && typeof rewritten[s.id] === "string" ? rewritten[s.id] : s.text)).join("")
const schemaFor = (tpl) => {
  const ids = tpl.segments.filter((s) => s.rw).map((s) => s.id)
  return { type: "object", additionalProperties: false, required: ["segments"], properties: { segments: { type: "object", additionalProperties: false, required: ids, properties: Object.fromEntries(ids.map((i) => [i, { type: "string" }])) } } }
}

// -> payload description for (template, language), or null when that combination is not in the calibrated universe.
function buildPayload(templateId, language) {
  const tpl = TEMPLATES[templateId]
  if (!tpl || !LANGUAGES.includes(language)) return null
  const original = Object.fromEntries(tpl.segments.filter((s) => s.rw).map((s) => [s.id, s.text]))
  const input = JSON.stringify({ language, segments: original })
  const schema = schemaFor(tpl)
  const body = { model: MODEL, instructions: INSTRUCTIONS, input, schema }
  const sha256 = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex")
  const bytes = Buffer.byteLength(INSTRUCTIONS) + Buffer.byteLength(input) + Buffer.byteLength(JSON.stringify(schema))
  return { id: `${templateId}:${language}`, templateId, language, instructions: INSTRUCTIONS, input, schema, original, sha256, bytes, withinByteCeiling: bytes <= BYTE_CEILING }
}
const allPayloads = () => LANGUAGES.flatMap((l) => Object.keys(TEMPLATES).map((t) => buildPayload(t, l)))

// The deterministic block must be EXACTLY one of the known templates; anything else is never sent anywhere.
function matchTemplate(intent, blocks, language) {
  if (!LANGUAGES.includes(language) || !Array.isArray(blocks) || blocks.length !== 1) return null
  const tpl = TEMPLATES[intent]
  if (!tpl || !blocks[0] || blocks[0].text !== tpl.deterministic) return null
  if (joinSegments(tpl, null) !== tpl.deterministic) return null
  return tpl
}
module.exports = { TEMPLATES, LANGUAGES, INSTRUCTIONS, buildPayload, allPayloads, matchTemplate, joinSegments }
