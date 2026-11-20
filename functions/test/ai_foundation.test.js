"use strict"
const { test, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const { setupAi } = require("./ai_helpers")
const C = require("../src/ai/config")
const { sanitizeText, normalizeName } = require("../src/ai/sanitize")
const geo = require("../src/ai/geo")
const log = require("../src/ai/log")

let env
beforeEach(() => { env = setupAi() })

// ---------------------------------------------------------------- configuration (no model, price, token or budget settings exist)
test("config: defaults are valid and carry the proposed Stage 2B limits (50/day, 5/min, 90 days)", async () => {
  assert.deepEqual(C.validateConfig(C.DEFAULTS), [])
  const c = await C.getAiConfig()
  assert.deepEqual([c.limits.dailyMessages, c.limits.burstPerMinute, c.retention.days], [50, 5, 90])
  for (const k of ["provider", "models", "pricing", "budget", "effort", "maxOutputTokens", "loop"]) assert.ok(!(k in c), `${k} must not exist`)
  assert.equal(c.languages.zu.enabled, false) // isiZulu is not implemented and is not claimed
})
test("config: an empty database works (defaults)", async () => { assert.equal((await C.getAiConfig()).enabled, true) })
test("config: valid overrides in ai-config/default take effect without a redeploy", async () => {
  env.seed("ai-config/default", { limits: { dailyMessages: 25 }, retrieval: { maxResults: 4 } })
  const c = await C.getAiConfig()
  assert.deepEqual([c.limits.dailyMessages, c.limits.burstPerMinute, c.retrieval.maxResults, c.retrieval.scanLimit], [25, 5, 4, 150])
})
test("config: an INVALID or out-of-bounds stored override is ignored entirely (defaults stay in force)", async () => {
  for (const bad of [{ limits: { dailyMessages: 5000 } }, { limits: { burstPerMinute: 0 } }, { retrieval: { scanLimit: 100000 } }, { retention: { days: 9999 } }, { enabled: "yes" }]) {
    env.seed("ai-config/default", bad); C.invalidateConfigCache()
    const c = await C.getAiConfig()
    assert.equal(c.limits.dailyMessages, 50); assert.equal(c.retrieval.scanLimit, 150); assert.equal(c.enabled, true)
  }
  assert.ok(env.logs.some((l) => l.event === "ai.config.invalid_ignored"))
})
test("config: non-editable keys (provider, models, unknown) cannot be injected through the stored document", async () => {
  env.seed("ai-config/default", { provider: "evil", models: { x: 1 }, secretKey: "x", limits: { dailyMessages: 12 } })
  const c = await C.getAiConfig()
  assert.ok(!("provider" in c) && !("models" in c) && !("secretKey" in c)); assert.equal(c.limits.dailyMessages, 12)
})

// ---------------------------------------------------------------- sanitisation, geo, logging
test("sanitize: strips markup, links and control characters, collapses space and truncates", () => {
  assert.equal(sanitizeText("<b>Hi</b>\u0000 [click](http://evil.example/x)  see https://evil.example/y now"), "Hi click see [link removed] now")
  assert.equal(sanitizeText("x".repeat(500), 20).length, 20); assert.equal(sanitizeText(null), ""); assert.equal(sanitizeText({ a: 1 }), "")
  assert.equal(normalizeName("  Sakhumzi  Restaurant! "), "sakhumzi restaurant")
})
test("geo: straight-line distance is plausible, coordinates are read in either shape, and the label forbids travel-time claims", () => {
  const km = geo.haversineKm({ latitude: -26.2041, longitude: 28.0473 }, { latitude: -25.7479, longitude: 28.2293 })
  assert.ok(km > 50 && km < 62, String(km))
  assert.deepEqual(geo.readCoords({ coordinates: { lat: "-26.2", lng: "28.0" } }), { latitude: -26.2, longitude: 28.0 }); assert.equal(geo.readCoords({ coordinates: { latitude: 99, longitude: 0 } }), null)
  assert.match(geo.DISTANCE_NOTE, /not driving distance or travel time/)
})
test("log: only allow-listed scalar fields are emitted; message text, query text and raw uids can never appear", () => {
  const seen = []; log.setLogSinkForTests((e) => seen.push(e))
  log.info("ai.chat", { requestId: "r1", uidHash: log.uidHash("user-secret-uid"), message: "my private question", text: "x", args: { q: 1 }, location: { latitude: 1 }, content: "y", intent: "find_restaurants", count: 5 })
  const out = JSON.stringify(seen[0])
  assert.ok(!/private question|user-secret-uid|latitude/.test(out)); assert.equal(seen[0].count, 5); assert.equal(seen[0].intent, "find_restaurants"); assert.equal(log.uidHash("user-secret-uid"), log.uidHash("user-secret-uid")); assert.equal(log.uidHash("a").length, 12)
})
