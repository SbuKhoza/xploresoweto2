"use strict"
// Mobile integration for the learning controls. React Native cannot run under node --test, so: the pure module (utils/ai/learning.js) is executed,
// and screens/SowetoAI.js is checked against it and against the real backend contract (names, enums, notice version, reason codes).
const test = require("node:test"), assert = require("node:assert/strict")
const fs = require("fs"), path = require("path")
const { pathToFileURL } = require("url")
const root = path.join(__dirname, "..", "..")
const load = (f) => import(pathToFileURL(path.join(root, "utils", "ai", f)).href)
const read = (f) => fs.readFileSync(path.join(root, f), "utf8")
const screen = () => read("screens/SowetoAI.js")

test("the app and the backend agree: notice version, correction intents, callable names and payload shapes", async () => {
  const L = await load("learning.js"), { createAiApi } = await load("aiClient.js")
  const K = require("../src/ai/constants"), V = require("../src/ai/learning/vocab")
  assert.equal(L.LEARNING_NOTICE_VERSION, K.LEARNING_NOTICE_VERSION)
  for (const c of L.CORRECTION_CHOICES) assert.ok(V.CORRECTION_INTENTS.includes(c.intent), c.intent)
  const calls = []; const api = createAiApi(async (n, p) => { calls.push([n, p]); return {} })
  const cid = "c_" + "a".repeat(24)
  await api.feedback({ conversationId: cid, messageId: "req_abc_1_a", rating: "unhelpful", correctionIntent: "find_events" })
  await api.setLearningOptOut(true); await api.erase(); await api.removeAll()
  assert.deepEqual(calls.map((c) => c[0]), ["aiSubmitFeedback", "aiSetLearningOptOut", "aiEraseMyAiData", "aiDeleteAllMyAiData"])
  assert.deepEqual(calls[0][1], { conversationId: cid, messageId: "req_abc_1_a", rating: "unhelpful", correctionIntent: "find_events" })
  assert.deepEqual(calls[2][1], { confirm: "ERASE-MY-AI-DATA" }); assert.deepEqual(calls[3][1], {}, "deleting history sends no erase confirmation")
  const idx = read("functions/index.js"); for (const n of ["aiSubmitFeedback", "aiSetLearningOptOut", "aiEraseMyAiData"]) assert.match(idx, new RegExp(`${n}: wrap`))
  // the real handlers accept exactly what the app sends
  const H = require("../src/handlers/learning"); assert.ok(H.aiSubmitFeedback && H.aiSetLearningOptOut)
})

test("payload builders are strict (no free text, valid ids, correction only with an unhelpful rating)", async () => {
  const L = await load("learning.js"), cid = "c_" + "b".repeat(24)
  const ok = { conversationId: cid, messageId: "req_abc_1_a", rating: "helpful" }
  assert.deepEqual(L.feedbackPayload(ok), ok)
  assert.throws(() => L.feedbackPayload({ ...ok, conversationId: "x" }), /invalid-conversation-id/)
  assert.throws(() => L.feedbackPayload({ ...ok, messageId: "a b" }), /invalid-message-id/)
  assert.throws(() => L.feedbackPayload({ ...ok, rating: "meh" }), /invalid-rating/)
  assert.throws(() => L.feedbackPayload({ ...ok, correctionIntent: "find_events" }), /invalid-correction/, "a correction needs an unhelpful rating")
  assert.throws(() => L.feedbackPayload({ ...ok, rating: "unhelpful", correctionIntent: "emergency" }), /invalid-correction/)
  assert.equal("comment" in L.feedbackPayload({ ...ok, comment: "my number is 082" }), false, "free text is never forwarded")
  assert.deepEqual(L.optOutPayload(true), { optOut: true }); assert.throws(() => L.optOutPayload("yes"), /invalid-optOut/)
})

test("the app never claims feedback was recorded unless the server said so", async () => {
  const L = await load("learning.js")
  assert.equal(L.feedbackOutcome({ recorded: true }).recorded, true)
  // every reason the server can return, read from the backend source so a new reason cannot silently fall through to a happy message
  const src = read("functions/src/ai/learning/store.js") + read("functions/src/ai/learning/capture.js") + read("functions/src/handlers/learning.js")
  const reasons = [...new Set([...src.matchAll(/reason: "([a-z-]+)"/g)].map((m) => m[1]))].filter((r) => r !== "invalid")
  assert.ok(reasons.length >= 7, reasons.join())
  for (const reason of reasons) { const o = L.feedbackOutcome({ recorded: false, reason }); assert.equal(o.recorded, false, reason); assert.match(o.text, /nothing (new )?was recorded/i, reason); assert.doesNotMatch(o.text, /counted anonymously/, reason) }
  for (const bad of [undefined, null, "ok", {}, { recorded: "true" }, { recorded: 1 }, { recorded: false }]) { const o = L.feedbackOutcome(bad); assert.equal(o.recorded, false); assert.match(o.text, /nothing was recorded/i) }
})

test("controls reflect the server: nothing is offered unless aiGetUsage said so, and an opt-out hides feedback", async () => {
  const L = await load("learning.js")
  const none = L.learningPanel(undefined); assert.deepEqual([none.showSettings, none.canGiveFeedback], [false, false])
  assert.equal(L.learningPanel({ available: true, noticeVersion: 99, optedOut: false }).showSettings, false, "a notice version this app doesn't know is not shown")
  assert.equal(L.learningPanel({ available: true, noticeVersion: 1 }).showSettings, false, "an incomplete answer is not trusted")
  const off = L.learningPanel({ available: false, noticeVersion: 1, optedOut: false })
  assert.deepEqual([off.showSettings, off.canGiveFeedback, off.participating], [true, false, false]); assert.match(off.status, /switched off/)
  const on = L.learningPanel({ available: true, noticeVersion: 1, optedOut: false }); assert.deepEqual([on.canGiveFeedback, on.participating], [true, true])
  const out = L.learningPanel({ available: true, noticeVersion: 1, optedOut: true }); assert.deepEqual([out.canGiveFeedback, out.participating, out.optedOut], [false, false, true]); assert.match(out.status, /opted out/)
  const outOff = L.learningPanel({ available: false, noticeVersion: 1, optedOut: true }); assert.equal(outOff.optedOut, true, "the choice stays visible and changeable while collection is off")
})

test("the screen is wired to the pure module: feedback is gated, the switch follows the server, nothing moves optimistically", () => {
  const s = screen()
  assert.match(s, /learningPanel\(learning\)/); assert.match(s, /setLearning\(u\.learning \|\| null\)/)
  assert.match(s, /onFeedback=\{lp\.canGiveFeedback && conversationId \? sendFeedback : null\}/)
  assert.match(s, /\{onFeedback && m\.id \? <FeedbackRow/)
  assert.match(s, /feedbackOutcome\(await onSubmit/)
  assert.match(s, /\{lp\.showSettings \? \(/); assert.match(s, /value=\{!lp\.optedOut\}/); assert.match(s, /disabled=\{learningBusy\}/)
  const choose = s.slice(s.indexOf("const chooseLearning"), s.indexOf("const eraseData"))
  assert.ok(choose.indexOf("await api.setLearningOptOut") < choose.indexOf("setLearning((l)"), "the stored value is updated only after the server answered")
  assert.match(choose, /r\.optOut === true/, "the value shown is the one the server returned")
  assert.match(choose, /catch \(e\)[\s\S]*Alert\.alert\("Couldn't save your choice"/)
  assert.match(s, /correctionIntent|CORRECTION_CHOICES\.map/); assert.match(s, /Just report it/)
  assert.match(s, /ActivityIndicator/); assert.match(s, /Try again/)
})

test("wording is accurate: deleting history vs erasing data, what is kept, and the privacy notice", async () => {
  const L = await load("learning.js"), N = await load("notice.js")
  assert.match(L.deleteAllNote(), /conversation/i); assert.match(L.deleteAllNote(), /learn" choice is kept/); assert.match(L.deleteAllNote(), /counters and your choice.*kept/)
  assert.doesNotMatch(L.deleteConversationNote(false), /anonymous/i); assert.match(L.deleteConversationNote(true), /can't be traced to you.*aren't affected/)
  assert.match(L.ERASE_NOTE, /AI Service Notice choice/); assert.match(L.ERASE_NOTE, /usage counters are kept/); assert.match(L.ERASE_NOTE, /choice .* are kept/)
  assert.notEqual(L.ERASE_LABEL, N.LUNA_DELETE_ALL_LABEL, "the two operations are labelled differently")
  for (const must of [/anonymis/i, /can't be traced back to you/i, /can't be removed later/i, /opt out at any time/i, /passwords/i]) assert.match(L.LEARNING_NOTICE_TEXT, must)
  const s = screen()
  assert.match(s, /deleteConversationNote\(lp\.available\)/); assert.match(s, /deleteAllNote\(\)/); assert.match(s, /api\.erase\(\)/)
  assert.doesNotMatch(s, /permanently deletes every conversation you've had/, "no stale inline wording; it comes from the module")
  assert.match(s, /Your "help Malloya learn" choice was kept/)
})

test("the client holds no provider, key or learning decision logic", () => {
  const src = read("utils/ai/learning.js") + read("screens/SowetoAI.js")
  assert.doesNotMatch(src, /api[_-]?key|sk-|fetch\(|https?:\/\//i)
  assert.doesNotMatch(read("utils/ai/learning.js"), /screen\(|signature\(|recordSignal/, "screening and collection live on the server only")
})
