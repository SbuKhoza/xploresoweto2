"use strict"
// Client-side assistant logic (pure ESM modules under utils/ai). React Native components cannot run under node --test;
// these tests cover the payload, request-id lifecycle, error mapping, block normalisation, verification gate and location consent.
const test = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const fs = require("node:fs")
const { pathToFileURL } = require("node:url")
const root = path.join(__dirname, "..", "..")
const load = (f) => import(pathToFileURL(path.join(root, "utils", "ai", f)).href)

test("chat payload: only accepted fields, trimmed, valid requestId", async () => {
  const { buildChatPayload } = await load("aiClient.js")
  assert.deepEqual(buildChatPayload({ message: "  hi  ", requestId: "abcd1234" }), { message: "hi", requestId: "abcd1234" })
  const p = buildChatPayload({ message: "near me", requestId: "abcd1234", conversationId: "c_" + "a".repeat(24), location: { latitude: -26.2, longitude: 27.9, accuracy: 5, altitude: 1 } })
  assert.deepEqual(Object.keys(p).sort(), ["conversationId", "location", "message", "requestId"])
  assert.deepEqual(p.location, { latitude: -26.2, longitude: 27.9 }) // accuracy/altitude never forwarded
  assert.throws(() => buildChatPayload({ message: "  ", requestId: "abcd1234" }), /empty-message/)
  assert.throws(() => buildChatPayload({ message: "x", requestId: "short" }), /invalid-request-id/)
  assert.equal("location" in buildChatPayload({ message: "x", requestId: "abcd1234", location: { latitude: NaN, longitude: 1 } }), false)
})

test("app request ids satisfy the backend format", async () => {
  const { newRequestId } = await import(pathToFileURL(path.join(root, "utils", "requestId.js")).href)
  const { REQUEST_ID_RE } = await load("aiClient.js")
  for (let i = 0; i < 200; i++) assert.match(newRequestId(), REQUEST_ID_RE)
})

test("send state: new id per message, same id on retry, no duplicate sends", async () => {
  const { createSendState } = await load("aiClient.js")
  let n = 0
  const s = createSendState(() => `req-${++n}-xxxxxxxx`)
  const id1 = s.begin("Plan a day")
  assert.equal(id1, "req-1-xxxxxxxx")
  assert.equal(s.begin("Plan a day"), null)           // in flight: ignored
  assert.equal(s.begin("Something else"), null)
  s.fail()
  assert.equal(s.begin("Plan a day"), id1)            // retry of the same message reuses the id
  s.succeed()
  assert.equal(s.begin("Plan a day"), "req-2-xxxxxxxx") // a new deliberate send gets a new id
  s.fail()
  assert.equal(s.begin("Different text"), "req-3-xxxxxxxx") // editing the failed text is a new message
  assert.equal(s.begin(""), null)
})

test("api wrapper calls the right callables with the right payloads", async () => {
  const { createAiApi } = await load("aiClient.js")
  const calls = []
  const api = createAiApi(async (n, d) => { calls.push([n, d]); return {} })
  await api.chat({ message: "hi", requestId: "abcd1234" }); await api.usage(); await api.list(); await api.open("c_x"); await api.remove("c_x"); await api.removeAll()
  assert.deepEqual(calls.map((c) => c[0]), ["aiChat", "aiGetUsage", "aiListConversations", "aiGetConversation", "aiDeleteConversation", "aiDeleteAllMyAiData"])
  assert.deepEqual(calls[3][1], { conversationId: "c_x" })
})

test("error mapping covers limits, validation, availability, auth and verification", async () => {
  const { describeAiError } = await load("errors.js")
  const E = (code, rawMessage, details) => ({ code, rawMessage, details })
  const daily = describeAiError(E("resource-exhausted", "daily-limit", { limit: 50, resetsInSeconds: 7200 }))
  assert.equal(daily.kind, "daily"); assert.equal(daily.retry, false); assert.match(daily.text, /50/); assert.match(daily.text, /2 hours/)
  const burst = describeAiError(E("resource-exhausted", "rate-limited", { retryAfterSeconds: 12 }))
  assert.equal(burst.kind, "burst"); assert.equal(burst.retry, true); assert.match(burst.text, /12 seconds/)
  assert.equal(describeAiError(E("invalid-argument", "message-too-long", { maxChars: 1000 })).kind, "too-long")
  assert.equal(describeAiError(E("invalid-argument", "invalid-message")).kind, "invalid")
  assert.equal(describeAiError(E("unavailable", "ai-disabled")).kind, "disabled")
  assert.equal(describeAiError(E("aborted", "request-in-progress")).retry, true)
  assert.equal(describeAiError(E("unauthenticated")).kind, "auth")
  assert.equal(describeAiError(E("failed-precondition", "email-not-verified")).kind, "verify")
  assert.equal(describeAiError(E("internal", "ai-failed")).retry, true)
  // a real conversation error vs the callable simply not existing (bare Firebase NOT_FOUND)
  assert.equal(describeAiError(E("not-found", "conversation-not-found")).kind, "missing")
  assert.equal(describeAiError(E("not-found", "NOT_FOUND")).kind, "unreachable")
  assert.equal(describeAiError(E("not-found", undefined)).kind, "unreachable")
  assert.equal(describeAiError(E("deadline-exceeded")).kind, "server")
  assert.equal(describeAiError(null, { offline: true }).kind, "offline")
  assert.equal(describeAiError(undefined).kind, "server") // never throws
})

test("blocks: every type is styled, unknown types fall back, empty blocks dropped", async () => {
  const { normaliseBlocks, blockStyle } = await load("blocks.js")
  for (const t of ["verified", "suggestion", "knowledge", "unverified", "general"]) assert.ok(blockStyle(t))
  assert.equal(blockStyle("verified").label, "From our listings"); assert.equal(blockStyle("general").label, "")
  const out = normaliseBlocks([{ type: "verified", text: "a", refs: ["listing:restaurants/x"] }, { type: "weird", text: "b" }, { type: "general", text: "  " }, null, { type: "knowledge" }])
  assert.deepEqual(out.map((b) => b.type), ["verified", "general"])
  assert.deepEqual(out[0].refs, ["listing:restaurants/x"])
})

test("response -> chat item: cards use only returned fields; offers need an available card", async () => {
  const { assistantItemFromResponse, itemsFromConversation, screenForCard } = await load("blocks.js")
  const r = {
    conversationId: "c_" + "a".repeat(24), messageId: "m1",
    blocks: [{ type: "verified", text: "Try Wandie's.", refs: ["listing:restaurants/w"] }],
    cards: [
      { ref: "listing:restaurants/w", kind: "listing", title: "Wandie's", subtitle: "Restaurant · Dube", image: null, priceText: "R120-R250", rating: 4.6, reviewCount: 88, openNow: true, approxKm: 3.24, collection: "restaurants", id: "w" },
      { ref: "listing:accommodations/gone", kind: "listing", unavailable: true },
      { ref: "event:events/e1", kind: "event", title: "Jazz", subtitle: "Sat", priceText: null, rating: null, reviewCount: null, openNow: null, approxKm: null, collection: "events", id: "e1" },
    ],
    bookingOffers: [{ ref: "listing:restaurants/w", title: "Wandie's" }, { ref: "listing:accommodations/gone", title: "Gone" }],
    followUps: ["a", "b", "c", "d", ""], languageNotice: "isiZulu is not supported yet. This answer is in English.", distanceNote: "Approximate straight-line distance, not driving distance or travel time.",
    bookingNote: "Booking is a request only: the provider accepts or declines it, and nothing is confirmed until they respond.", usage: { dailyLimit: 50, remainingToday: 49 }, duplicate: false,
  }
  const it = assistantItemFromResponse(r)
  assert.equal(it.cards[0].status, "Open now"); assert.equal(it.cards[0].distance, "~3.2 km (straight line)")
  assert.equal(it.cards[0].priceText, "R120-R250"); assert.equal(it.cards[2].rating, null); assert.equal(it.cards[2].status, null)
  assert.equal(it.cards[1].unavailable, true)
  assert.deepEqual(it.bookingOffers.map((o) => o.ref), ["listing:restaurants/w"]) // the unavailable listing's offer is dropped
  assert.equal(it.followUps.length, 3); assert.equal(it.bookingNote, r.bookingNote)
  assert.deepEqual(screenForCard(it.cards[0]), { tab: "Xplore", screen: "Restaurants" })
  assert.deepEqual(screenForCard(it.cards[2]), { tab: "Community", screen: "Events" })
  assert.equal(screenForCard(it.cards[1]), null)
  assert.deepEqual(assistantItemFromResponse({}).cards, []) // tolerant of missing fields
  const hist = itemsFromConversation({ messages: [{ role: "user", text: "hi" }, { role: "assistant", blocks: [{ type: "general", text: "hello" }], cards: [], followUps: ["x"] }] })
  assert.deepEqual(hist.map((m) => m.role), ["user", "assistant"]); assert.deepEqual(hist[1].followUps, ["x"])
})

test("email-verification gate blocks calls for unverified or signed-out users", async () => {
  const { canCallAssistant } = await load("gates.js")
  assert.deepEqual(canCallAssistant(null), { allowed: false, reason: "auth" })
  assert.deepEqual(canCallAssistant({ emailVerified: false }), { allowed: false, reason: "verify" })
  assert.deepEqual(canCallAssistant({ emailVerified: true }), { allowed: true, reason: null })
})

test("location is optional: only nearby phrasing asks, a decline is respected, nothing else prompts", async () => {
  const { needsLocationHint, locationDecision } = await load("gates.js")
  for (const t of ["Find restaurants near me.", "what's nearby", "closest hotel", "how far is Vilakazi Street"]) assert.equal(needsLocationHint(t), true, t)
  for (const t of ["What events are happening?", "Plan a day exploring Soweto.", "Where can I experience Soweto culture?"]) assert.equal(needsLocationHint(t), false, t)
  assert.equal(locationDecision({ text: "restaurants near me", consent: "unknown" }), "ask")
  assert.equal(locationDecision({ text: "restaurants near me", consent: "declined" }), "skip")
  assert.equal(locationDecision({ text: "plan a day", consent: "unknown" }), "skip")
})

test("app code stays provider-free and only uses the ai* callables; no direct Firestore access to AI data", () => {
  const files = ["screens/SowetoAI.js", ...fs.readdirSync(path.join(root, "utils", "ai")).map((f) => "utils/ai/" + f)]
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), "utf8")
    assert.doesNotMatch(src, /anthropic|openai|gemini|api[_-]?key/i, f)
    assert.doesNotMatch(src, /firebase\/firestore|ai-conversations/, f)
    for (const m of src.matchAll(/callFunction\(\s*"([A-Za-z]+)"|call\(\s*"([A-Za-z]+)"/g)) assert.match(m[1] || m[2], /^ai[A-Z]/, f)
  }
})

test("feature flag exists, is off by default and gates route and Home card", () => {
  const read = (f) => fs.readFileSync(path.join(root, f), "utf8")
  assert.match(read("utils/features.js"), /aiAssistant: process\.env\.EXPO_PUBLIC_AI_ASSISTANT === "true"/)
  assert.match(read("App.js"), /FEATURES\.aiAssistant && <Stack\.Screen name="SowetoAI"/)
  assert.match(read("screens/Home.js"), /FEATURES\.aiAssistant && \(/)
})

test("Malloya naming, greeting from enrollment, and the old Xplore guide card is gone", () => {
  const read = (f) => fs.readFileSync(path.join(root, f), "utf8")
  const ai = read("screens/SowetoAI.js")
  assert.match(ai, />Malloya</); assert.match(ai, /I'm Malloya/); assert.match(ai, /enrollment\?\.greeting/)
  assert.doesNotMatch(read("screens/Home.js"), /goXploreItem\("XploreMain"\)[\s\S]{0,200}Ultimate Guide/)
  assert.doesNotMatch(read("screens/Home.js"), /Discover places, people and experiences/)
})
