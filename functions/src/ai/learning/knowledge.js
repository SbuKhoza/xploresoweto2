"use strict"
// What the engine may use at run time: ACTIVE approved knowledge only, loaded read-only, cached ~60 s per instance, empty when
// learning use is switched off or the read fails (a failure can only make Malloya behave as it did before, never differently).
const fb = require("../../lib/firebase")
const clock = require("../../lib/clock")
const { AI_COL } = require("../constants")
const { LEARNABLE_INTENTS } = require("./vocab")
const { validSignature } = require("./screen")

const EMPTY = Object.freeze({ phrases: new Map(), answers: new Map(), aliases: [] })
let cache = { at: 0, value: EMPTY }, ttlMs = 60000
let gen = 0 // bumped on every invalidation: a load that started BEFORE an approval/revocation must not cache its stale result afterwards
const invalidate = () => { gen += 1; cache = { at: 0, value: EMPTY } }
const setTtlForTests = (ms) => { ttlMs = ms; invalidate() }

async function loadActive(cfg) {
  if (!cfg || !cfg.learning || cfg.learning.use !== true) return EMPTY
  const now = clock.now().getTime()
  if (cache.at && now - cache.at < ttlMs) return cache.value
  const myGen = gen
  const value = { phrases: new Map(), answers: new Map(), aliases: [] }
  try {
    const snap = await fb.db().collection(AI_COL.knowledge).where("status", "==", "active").limit(500).get()
    for (const d of snap.docs.slice().sort((x, y) => (x.id < y.id ? -1 : 1))) { // lowest id wins any tie, so the result never depends on read order
      const k = d.data()
      if (k.status !== "active") continue
      const meta = { id: d.id, version: k.version }
      // Everything is re-validated on load: a hand-edited or damaged record can only be ignored, never widen what the engine does.
      if (k.type === "phrase_intent" && LEARNABLE_INTENTS.includes(k.intent) && Array.isArray(k.sigs)) k.sigs.filter(validSignature).forEach((s) => { if (!value.phrases.has(s)) value.phrases.set(s, { ...meta, intent: k.intent }) })
      else if (k.type === "answer" && typeof k.text === "string" && k.text.length <= 500 && Array.isArray(k.sigs)) k.sigs.filter(validSignature).forEach((s) => { if (!value.answers.has(s)) value.answers.set(s, { ...meta, text: k.text }) })
      else if (k.type === "place_alias" && !value.aliases.some((a) => a.alias === k.alias) && typeof k.alias === "string" && /^[a-z]+(?: [a-z]+){0,3}$/.test(k.alias) && typeof k.canonical === "string") value.aliases.push({ ...meta, alias: k.alias, canonical: k.canonical })
    }
    value.aliases.sort((a, b) => b.alias.length - a.alias.length)
  } catch (e) { require("../log").error("ai.learning.load_failed", { code: e && e.code }); return EMPTY }
  if (myGen === gen) cache = { at: now, value }
  return value
}
module.exports = { loadActive, invalidate, setTtlForTests, EMPTY }
