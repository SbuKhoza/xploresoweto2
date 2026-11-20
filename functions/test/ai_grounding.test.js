"use strict"
const { test } = require("node:test")
const assert = require("node:assert/strict")
const C = require("../src/ai/config")
const { validateAnswer, parseModelOutput, BOOKING_SAFE, NO_ANSWER } = require("../src/ai/grounding")
const { DISTANCE_NOTE } = require("../src/ai/geo")
const { detectLanguage } = require("../src/ai/language")

const cfg = C.DEFAULTS
const R1 = "listing:restaurants/r1", A1 = "listing:accommodations/a1", KB = "kb:homescreen/orlando#history"
const evidence = () => new Map([
  [R1, { ref: R1, kind: "listing", name: "Gogo's Kitchen", priceText: "R80 - R150", priceNumbers: [80, 150], hoursText: "08:00 - 17:00", descText: "Home cooking in Orlando West", approxKm: 2.4 }],
  [A1, { ref: A1, kind: "listing", name: "Vilakazi Guest House", priceText: "R900", priceNumbers: [900], hoursText: "Check-in 14:00", descText: "Quiet rooms" }],
  [KB, { ref: KB, kind: "kb", name: "Orlando", sourceTitle: "XploreSoweto township guide", descText: "Orlando was established in 1931." }],
])
const ans = (blocks, extra = {}) => JSON.stringify({ language: "en", blocks, cards: [], mentions: [], followUps: [], ...extra })
const v = (blocks, extra, opts = {}) => validateAnswer(ans(blocks, extra), { evidence: evidence(), cfg, ...opts })
const text = (r) => r.blocks.map((b) => b.text).join(" ")

test("supported facts are kept and labelled verified", () => {
  const r = v([{ type: "verified", text: "Gogo's Kitchen serves home cooking for R80 - R150. It is open 08:00 - 17:00.", refs: [R1] }], { cards: [R1], mentions: ["Gogo's Kitchen"] })
  assert.equal(r.blocks[0].type, "verified"); assert.match(r.blocks[0].text, /R80/); assert.match(r.blocks[0].text, /08:00/)
  assert.deepEqual(r.cards, [R1]); assert.equal(r.report.strippedSentences, 0)
})
test("invented prices are removed, supported ones kept", () => {
  const r = v([{ type: "verified", text: "Meals cost R80 - R150. A full platter is R450.", refs: [R1] }])
  assert.match(text(r), /R80/); assert.doesNotMatch(text(r), /R450/)
  // Documented limit: the check is on the NUMBER against the cited evidence, so it cannot tell WHAT a real number is attached to.
})
test("a price that belongs to a different listing than the one cited is removed", () => {
  const r = v([{ type: "verified", text: "Gogo's Kitchen charges R900 per person.", refs: [R1] }])
  assert.equal(r.blocks[0].type, "unverified"); assert.equal(r.blocks[0].text, NO_ANSWER)
})
test("invented opening hours are removed; stated ones that match the evidence are kept; 24-hour claims need evidence", () => {
  const r = v([{ type: "verified", text: "It opens at 08:00. It closes at 23:00. It is open 24 hours.", refs: [R1] }])
  assert.match(text(r), /08:00/); assert.doesNotMatch(text(r), /23:00|24 hours/)
  const t = (s) => text(v([{ type: "general", text: s, refs: [] }]))
  assert.doesNotMatch(t("Most places there open at 9am."), /9am/) // no evidence for 9 in the cited/union set? (union has 8,17,14): removed
})
test("availability claims are never allowed", () => {
  for (const s of ["The table is available tonight.", "They still have rooms available.", "It is fully booked.", "There are no vacancies.", "Walk-ins are welcome.", "The room is available on Friday."]) {
    const r = v([{ type: "verified", text: `${s} Gogo's Kitchen is in Orlando West.`, refs: [R1] }])
    assert.doesNotMatch(text(r), /available|booked|vacanc|walk-in|Walk-in/i, s)
    assert.match(text(r), /Orlando West/)
  }
})
test("booking confirmations are replaced by the safe statement, whatever the wording", () => {
  for (const s of ["I have booked your table.", "I've reserved a room for you.", "Your booking is confirmed.", "Your reservation has been made.", "You're all set.", "Consider it booked.", "I will book it now."]) {
    const r = v([{ type: "general", text: s, refs: [] }])
    assert.equal(r.report.bookingSanitised, true, s); assert.ok(r.blocks.some((b) => b.text === BOOKING_SAFE), s); assert.doesNotMatch(r.blocks.filter((b) => b.text !== BOOKING_SAFE).map((b) => b.text).join(" "), /booked|confirmed|reserved|all set/i, s)
  }
})
test("travel-time claims are removed; the approximate distance note is attached when distances are used", () => {
  const r = v([{ type: "verified", text: "Gogo's Kitchen is about 2.4 km away in a straight line. It is a 10 minute drive. Or 25 minutes by taxi.", refs: [R1] }], { cards: [R1] })
  assert.match(text(r), /2\.4 km/); assert.doesNotMatch(text(r), /minute/); assert.equal(r.distanceNote, DISTANCE_NOTE)
})
test("labels are earned: verified needs platform evidence, knowledge needs knowledge-base evidence", () => {
  const r = v([
    { type: "verified", text: "Tourists love Soweto.", refs: [] }, { type: "verified", text: "Orlando was established in 1931.", refs: [KB] },
    { type: "knowledge", text: "Orlando has a long history.", refs: [R1] }, { type: "knowledge", text: "Orlando was established in 1931.", refs: [KB] }, { type: "verified", text: "Fake.", refs: ["listing:restaurants/ghost"] },
  ])
  assert.deepEqual(r.blocks.map((b) => b.type), ["general", "general", "general", "knowledge", "general"]); assert.equal(r.report.downgradedBlocks, 4)
  assert.deepEqual(r.blocks[3].sources, ["XploreSoweto township guide"])
})
test("a named listing that no tool returned is removed (even when the label says general)", () => {
  const r = v([{ type: "general", text: "Try Mama Zulu's Shisanyama for great braai. Gogo's Kitchen is nearby.", refs: [] }], { mentions: ["Mama Zulu's Shisanyama", "Gogo's Kitchen"] })
  assert.doesNotMatch(text(r), /Mama Zulu/); assert.match(text(r), /Gogo's Kitchen/); assert.equal(r.report.droppedMentions, 1)
})
test("cards can only reference evidence from this turn and only listings/events; unknown or foreign refs are dropped", () => {
  const r = v([{ type: "verified", text: "Here are options.", refs: [R1] }], { cards: [R1, "listing:restaurants/ghost", "listing:users/x", KB, "../../etc", 5, R1] })
  assert.deepEqual(r.cards, [R1]); assert.ok(r.report.droppedCards >= 3)
})
test("booking offers need a checkBookable=true result for that exact listing", () => {
  const ask = (bookable) => v([{ type: "verified", text: "You can request a booking.", refs: [A1] }], { cards: [A1], bookingOffers: [A1, R1] }, { bookable })
  assert.deepEqual(ask(new Set()).bookingOffers, []); assert.deepEqual(ask(new Set([A1])).bookingOffers, [A1]); assert.deepEqual(ask(new Set([R1, A1])).bookingOffers, [A1, R1].filter((x) => true))
})
test("non-JSON model output is shown only as filtered general text; empty results give the honest fallback", () => {
  const r = validateAnswer("Sure! Your booking is confirmed for R999 at 10:00.", { evidence: new Map(), cfg })
  assert.equal(r.report.parseFailed, true); assert.ok(r.blocks.every((b) => b.type !== "verified")); assert.doesNotMatch(text(r), /R999|10:00/)
  assert.equal(validateAnswer(ans([]), { evidence: new Map(), cfg }).blocks[0].text, NO_ANSWER)
})
test("output is bounded and sanitised: block count, length, markup/links, follow-ups, unknown block types, language", () => {
  const long = "Gogo's Kitchen is a place. ".repeat(200)
  const r = v(Array.from({ length: 12 }, () => ({ type: "weird", text: `<b>hi</b> [x](https://evil.example) ${long}`, refs: [] })), { followUps: ["a", "b", "c", "d", "e"], language: "xx" })
  assert.ok(r.blocks.length <= 6); assert.ok(r.blocks.every((b) => b.type === "general" && b.text.length <= 1200)); assert.doesNotMatch(text(r), /<b>|evil\.example|\]\(/)
  assert.equal(r.followUps.length, 3); assert.equal(r.language, "en")
  assert.equal(validateAnswer(ans([{ type: "general", text: "Sawubona." }], { language: "zu" }), { evidence: new Map(), cfg }).language, "zu")
  const off = C.merge(cfg, { languages: { zu: { enabled: false, verified: false } } })
  assert.equal(validateAnswer(ans([{ type: "general", text: "Sawubona." }], { language: "zu" }), { evidence: new Map(), cfg: off }).language, "en")
})
test("parseModelOutput tolerates code fences and surrounding text, rejects arrays and garbage", () => {
  assert.deepEqual(parseModelOutput('```json\n{"a":1}\n```'), { a: 1 }); assert.deepEqual(parseModelOutput('Here: {"a":1} done'), { a: 1 })
  assert.equal(parseModelOutput("[1,2]"), null); assert.equal(parseModelOutput("no json"), null); assert.equal(parseModelOutput(null), null); assert.equal(parseModelOutput("{bad"), null)
})
test("language detection: isiZulu and English, and short/ambiguous input defaults to English", () => {
  assert.equal(detectLanguage("Sawubona, ngicela ungitshele ngezindawo zokudla eSoweto"), "zu")
  assert.equal(detectLanguage("Ngifuna indawo yokulala eSoweto"), "zu")
  assert.equal(detectLanguage("Where can I eat in Orlando West?"), "en"); assert.equal(detectLanguage("hi"), "en"); assert.equal(detectLanguage(""), "en");
})
