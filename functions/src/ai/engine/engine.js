"use strict"
// The XploreSoweto database-powered engine. NO language model, NO external API. One message in -> one structured, template-composed answer out.
//   detect language -> extract entities -> detect intents -> merge follow-up context -> route -> retrieve (public, allow-listed, bounded)
//   -> filter + rank (explainable) -> itinerary (if asked) -> compose from templates -> new context
// A future language model, if ever approved, could only be an optional wording layer over this output (see docs/stage2/FUTURE_OPTIONAL_LLM.md);
// retrieval, ranking, itineraries and safety never depend on it.
const { detectLanguage } = require("../language")
const { sanitizeText } = require("../sanitize")
const { runQuery } = require("../retrieval/queries")
const { loadCategory, loadPlaces, mentionedItems, getItemByRef, nm } = require("../retrieval/listings")
const { extract } = require("./entities")
const { detectIntents, intentDef } = require("./intents")
const nlp = require("./nlp")
const social = require("./social")
const { termsFor } = require("./landmarks")
const L = require("./lexicon")
const { rank, tokens } = require("./ranking")
const { buildItinerary } = require("./itinerary")
const ctxMod = require("./context")
const screen = require("../learning/screen")
const learnedKnowledge = require("../learning/knowledge")
const C = require("./compose")
const locales = { en: require("./locales/en") }

const VISITOR = ["attractions", "restaurants", "recreation", "accommodations", "business"]
const SERVICES = ["healthcare", "publicservice"] // clinics and public offices: searchable like any listing, but not part of trip plans
const FINDABLE = [...VISITOR, ...SERVICES]
const GENERIC = new Set(["want", "need", "looking", "look", "please", "give", "tell", "get", "place", "places", "spot", "spots", "thing", "things", "nice", "great", "cheap", "cheaper", "cheapest", "like", "love", "would", "could", "should", "let", "know", "about", "have", "has", "there", "here", "around", "visit", "visiting", "trip", "plan", "day", "days", "half", "full", "tomorrow", "today", "tonight", "weekend", "budget", "enjoy", "recommend", "suggest", "list", "which", "how", "much", "many", "open", "near", "nearby", "yes", "ok", "okay", "just", "also", "more", "other", "another", "else", "free", "enjoy", "options", "option", "serving", "serve", "serves", "selling", "sells", "offering", "with", "that", "for", "any", "some", "need", "show", "on", "this", "whats", "happening", "upcoming", "coming", "events", "event", "next", "week", "month", "heard", "traveling", "travelling", "wife", "husband", "partner", "couple", "going", "told", "hear", "street", "road", "avenue", "sounds", "amazing", "interesting", "know", "want", "wanna"])
const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }
// "the second one", "number 3", "option two", "the last one", "the other one" -> a 0-based position in the list that was just shown (or null)
function ordinalIndex(t, n) {
  if (!n) return null
  const words = [[/\b(first|1st|top)\b/, 0], [/\b(second|2nd)\b/, 1], [/\b(third|3rd)\b/, 2], [/\b(fourth|4th)\b/, 3], [/\b(fifth|5th)\b/, 4], [/\b(sixth|6th)\b/, 5]]
  for (const [re, i] of words) if (re.test(t)) return i < n ? i : null
  if (/\b(last|final|bottom)\b/.test(t)) return n - 1
  const m = /\b(?:number|option|no\.?|item|choice|#)\s*(\d|one|two|three|four|five|six)\b/.exec(t)
  if (m) { const k = /^\d$/.test(m[1]) ? +m[1] : WORD_NUM[m[1]]; return k >= 1 && k <= n ? k - 1 : null }
  if (/\bthe other one\b/.test(t) && n === 2) return 1
  return null
}
const MEAL_AND_ACTIVITY = { activity: ["attractions", "recreation"], meal: ["restaurants"], stay: ["accommodations"] }

const interestWords = (names) => Object.fromEntries(names.filter((k) => L.INTERESTS[k]).map((k) => [k, L.INTERESTS[k].words]))
const categoriesFor = (interests) => [...new Set(interests.flatMap((k) => (L.INTERESTS[k] ? L.INTERESTS[k].categories : [])))]
const maxResults = (cfg) => (cfg.retrieval && cfg.retrieval.maxResults) || 6
const budgetMax = (b, party) => (!b ? null : b.perPerson && party && party.total ? b.max * party.total : b.max)

function queryTerms(message, { intentHits = [], placeWords = [] }) {
  const drop = new Set([...GENERIC, ...intentHits.flatMap((h) => tokens(h)), ...placeWords.flatMap((p) => nm(p).split(" ")),
    ...Object.values(L.CATEGORIES).flatMap((c) => c.words.flatMap((w) => nm(w).split(" ")))])
  return [...new Set(tokens(message).filter((t) => !drop.has(t) && !/^\d+$/.test(t) && !/^r\d+/.test(t)))].slice(0, 5)
}
// A place the user named that is not in the township guide: accepted ONLY if some retrieved record's own address contains it.
function guessPlace(message, items) {
  const m = / (?:in|near|at|around) ([a-z][a-z ]{2,30})/i.exec(` ${nm(message)}`)
  if (!m) return null
  const words = m[1].trim().split(" ").slice(0, 3)
  for (let n = words.length; n >= 1; n--) { const cand = words.slice(0, n).join(" "); if (cand.length >= 4 && !GENERIC.has(cand) && !["soweto", "gauteng", "south africa", "johannesburg"].includes(cand) && items.some((it) => it.h.addr.includes(cand))) return cand }
  return null
}
// A place the user asked for that we know nothing about ("in Kliptown"): kept so the answer can say it matched nothing there,
// instead of silently answering for all of Soweto. Words that are not places (the, tonight, me, ...) never count.
const NOT_PLACE = new Set(["the", "a", "an", "my", "our", "this", "that", "me", "us", "you", "here", "there", "town", "area", "city", "soweto", "gauteng", "johannesburg", "south africa", "the evening", "the morning", "the afternoon", "tonight", "tomorrow", "today", "general", "total", "advance", "person", "people", "order"])
function askedPlace(message) {
  const m = / (?:in|near|at|around) ([a-z][a-z ]{3,30})/i.exec(` ${nm(message)}`)
  if (!m) return null
  const words = []
  for (const w of m[1].trim().split(" ")) { if (["for", "with", "under", "on", "and", "that", "which", "please", "by", "from", "to", "tomorrow", "today", "tonight", "this", "next"].includes(w)) break; words.push(w); if (words.length === 3) break }
  const cand = words.join(" ")
  if (cand.length < 4 || NOT_PLACE.has(cand) || NOT_PLACE.has(words[0]) || GENERIC.has(words[0])) return null
  return cand
}
const toBlockless = (r) => r

// ---- retrieval helpers ------------------------------------------------------------------------------------------------------
async function loadMany(collections, ctx) {
  const items = [], flags = { truncated: false, scanned: 0 }
  for (const col of collections) {
    const r = await loadCategory(col, ctx)
    items.push(...r.items); flags.truncated = flags.truncated || r.truncated; flags.scanned += r.scanned
  }
  return { items, ...flags }
}
function rankWithFallback(items, crit) {
  let r = rank(items, crit), relaxed = null
  if (!r.ranked.length && (crit.queryTerms.length || Object.keys(crit.interestWords || {}).length)) {
    const loose = rank(items, { ...crit, queryTerms: [], interestWords: {} })
    if (loose.ranked.length) { relaxed = crit.queryTerms.length ? { terms: crit.queryTerms.join(" ") } : { terms: Object.keys(crit.interestWords).join(" and ") }; r = loose }
  }
  return { r, relaxed }
}
const entriesOf = (ranked, n) => ranked.slice(0, n).map((e) => ({ item: e.item, reasons: e.reasons, flags: e.flags, score: e.score }))

// ---- the pipeline -----------------------------------------------------------------------------------------------------------
// Public entry: loads ACTIVE approved knowledge (empty unless a Super Admin approved something and learning use is on), runs the engine,
// and attaches `signals`: what could not be answered, as KINDS only (the caller screens the text; nothing here stores anything).
const ASKS = new Set(["find_restaurants", "find_accommodation", "find_attractions", "find_activities", "find_businesses", "ask_place", "ask_price", "ask_hours", "explore_place", "recommend", "discover_things"])
async function respond(args) {
  const learned = await learnedKnowledge.loadActive(args.cfg)
  const out = await respondCore(args, learned)
  const signals = []
  if (out.fallback) signals.push({ kind: out.intent === "unknown" ? "unsupported_intent" : "no_match", hintIntent: out.intent })
  else if (!out.clarification && ASKS.has(out.intent) && !(out.evidence || []).length && !out.learned) signals.push({ kind: "missing_knowledge", hintIntent: out.intent })
  return { ...out, signals }
}
// One pass over the text, longest alias first, so a substituted name is never itself rewritten by another alias.
const applyAliases = (text, aliases) => {
  if (!aliases.length) return text
  const by = new Map(aliases.map((a) => [a.alias, a.canonical]))
  const alt = aliases.map((a) => a.alias.replace(/ /g, "\\s+")).join("|")
  return text.replace(new RegExp(`(^|[^a-z0-9])(${alt})(?![a-z0-9])`, "gi"), (m, pre, hit) => pre + by.get(hit.toLowerCase().replace(/\s+/g, " ")))
}

async function respondCore({ message: rawMessage, context, location, cfg, now }, learned) {
  const language = detectLanguage(rawMessage)
  const cleaned = applyAliases(nlp.clean(rawMessage), learned.aliases) // abbreviations ("Vilakazi St"), typing shortcuts and misspellings are repaired before anything is matched
  let soc = social.classify(cleaned) // greetings / thanks / farewells / acknowledgements; a request after them ("Hi, where can I stay?") is still answered
  if (!soc.kind && language === "en" && soc.stripped.length && soc.rest && /^(greeting|thanks|farewell)$/.test(soc.stripped[0]) && !detectIntents(soc.rest).length) {
    const e = extract(soc.rest, { now, places: [] }) // "thanks, my email is ..." has no request in it: it is still a thanks (and nothing after it is used)
    if (!(e.interests.length || e.categories.length || e.budget || e.party || e.duration || e.date || e.landmarks.length)) soc = { ...soc, kind: soc.stripped[0] }
  }
  const message = soc.kind ? cleaned : soc.stripped.length && soc.rest ? soc.rest : cleaned
  const Lc = locales.en // English only: isiZulu is detected, answered in English, and never claimed (see docs)
  const ctx = { cfg, now, location: location || null }
  const intents = detectIntents(message)
  let primary = intents[0] || null
  const sg = learned.phrases.size || learned.answers.size ? screen.signature(message) : { ok: false }
  const lPhrase = sg.ok ? learned.phrases.get(sg.sig) : null, lAnswer = sg.ok ? learned.answers.get(sg.sig) : null
  const usedLearning = []
  // An approved phrase only fills a gap: never over a clear built-in match, never over an emergency, and only to a supported, side-effect-free intent.
  if (lPhrase && (!primary || primary.score < 3) && !intents.some((i) => i.id === "emergency") && intentDef(lPhrase.intent)) {
    primary = { id: lPhrase.intent, score: 0, hits: [], category: intentDef(lPhrase.intent).category || null, attribute: intentDef(lPhrase.intent).attribute || null }
    usedLearning.push({ id: lPhrase.id, version: lPhrase.version, type: "phrase_intent" })
  }
  const prev = ctxMod.sanitize(context)
  const result = (o, extra = {}) => ({ ...(usedLearning.length ? { learned: usedLearning } : {}), language, languageFallback: language !== "en", intent: extra.intent || (primary ? primary.id : "unknown"), ...o })
  const zuBlock = language === "zu" && !soc.kind ? [C.block("unverified", Lc.notSupportedLanguage)] : []
  const KEEP_INTENT = new Set(["greeting", "thanks", "farewell", "acknowledge", "help", "emergency", "provide_details"])
  const done = (composed, { slots = {}, refs = [], pending = null, intent } = {}) => result({ ...composed, blocks: intent === "emergency" ? composed.blocks : [...zuBlock, ...composed.blocks],
    context: ctxMod.next(prev, { slots, refs, pending, lastIntent: composed.fallback || KEEP_INTENT.has(intent) ? prev.lastIntent : intent, misses: composed.fallback ? prev.misses + 1 : KEEP_INTENT.has(intent) ? prev.misses : 0 }) }, { intent })

  // ---- social turns (no reads at all)
  if (soc.kind === "greeting" || soc.kind === "thanks") return done(C.composeStatic({ L: Lc, key: soc.kind }), { intent: soc.kind })
  if (soc.kind === "farewell") return done(C.composeSocial({ L: Lc, kind: "farewell", prev }), { intent: "farewell" })
  if (soc.kind === "acknowledge") return done(C.composeSocial({ L: Lc, kind: "acknowledge", prev }), { intent: "acknowledge" })
  // ---- no-data intents first (no reads at all)
  if (primary && ["greeting", "thanks"].includes(primary.id) && intents.length === 1) return done(C.composeStatic({ L: Lc, key: primary.id }), { intent: primary.id })
  if (primary && primary.id === "help" && intents.every((i) => ["help"].includes(i.id))) return done(C.composeStatic({ L: Lc, key: "help" }), { intent: "help" })

  // ---- emergency: stored numbers, never a model, never a chat
  if (primary && primary.id === "emergency") {
    const q = await runQuery("getEmergencyServices", {}, ctx)
    return done(C.composeEmergency({ L: Lc, results: q.ok ? q.data.results : [] }), { intent: "emergency" })
  }

  const places = await safe(() => loadPlaces(ctx), [])
  const ents = extract(message, { now, places })
  const pendingPlan = prev.pending === "plan" && (!primary || ["recommend", "discover_things"].includes(primary.id) || primary.score < 4) && (ents.interests.length || ents.budget || ents.duration || ents.party || ents.categories.length)
  // The CURRENT message decides what is wanted; earlier context only fills in details (place, party, budget...) it does not state.
  const named = ents.landmarks[0] || (ents.places[0] || null)
  const hasDetails = !!(ents.party || ents.budget || ents.duration || (ents.date && !ents.date.past) || ents.interests.length)
  const strong = primary && primary.id !== "explore_place" && primary.score >= 3
  let id = pendingPlan ? "plan_trip" : primary ? primary.id : "unknown"
  if (!pendingPlan && named && (!strong || id === "explore_place" || (id === "plan_trip" && primary.score < 7 && !hasDetails && !ents.categories.length))) id = "explore_place"
  else if (!pendingPlan && !strong && !named && hasDetails && !ents.categories.length) id = prev.lastIntent && /^find_/.test(prev.lastIntent) ? prev.lastIntent : "provide_details"
  if ((!primary || primary.id !== id) && intentDef(id)) primary = { id, score: 0, hits: [], category: intentDef(id).category || null, attribute: intentDef(id).attribute || null } // an intent taken from the previous turn
  const planning = ["plan_trip", "build_itinerary"].includes(id)
  const asking = ["ask_place", "ask_price", "ask_hours", "ask_services", "ask_directions", "booking_request"].includes(id)
  const isFind = /^find_(restaurants|accommodation|attractions|businesses|healthcare|publicservice|activities)$/.test(id) || ["recommend", "discover_things"].includes(id)
  const carry = planning || pendingPlan ? ["budget", "party", "date", "duration", "interests", "place"] : isFind ? ["place", "party", ...(ents.refersToPrevious || id === prev.lastIntent ? ["budget"] : [])] : id === "pick_best" ? ["budget", "party", "interests"] : id === "explore_place" || id === "provide_details" ? ["party"] : []
  const slots = ctxMod.merge(ents, prev, { carry })

  const notes = []
  if (ents.unsupported.includes("currency")) notes.push(C.block("unverified", Lc.currencyNote))
  if (ents.date && ents.date.past) notes.push(C.block("unverified", Lc.datePast(ents.date.label)))
  const withNotes = (composed, carriedList = slots.carried) => {
    const extra = [...notes]
    return { ...composed, blocks: [...extra, ...composed.blocks] }
  }
  const remembered = { budget: ents.budget, party: ents.party, date: ents.date && !ents.date.past ? ents.date : null, duration: ents.duration, interests: ents.interests, categories: ents.categories, place: ents.places[0] || null }
  const refsOf = (composed) => [...new Set(composed.evidence.filter((e) => e && e.ref && String(e.ref).startsWith("listing:")).map((e) => e.ref))].slice(0, ctxMod.MAX_REFS)
  const finish = (composed, o = {}) => { const c = withNotes(composed, o.carried); return done(c, { slots: remembered, refs: c.keepRefs ? [] : refsOf(c), pending: c.clarification && planning ? "plan" : null, intent: id }) }

  // ---- a destination the person named or heard about (street, landmark, township), or details given without a request
  if (id === "provide_details") return finish(C.composeAcknowledge({ L: Lc, partyTotal: ents.party && ents.party.total ? ents.party.total : slots.party ? slots.party.total : null }))
  if (id === "explore_place") {
    if (!named) return finish(C.composeClarify({ L: Lc, text: Lc.exploreWhich, followUps: [Lc.follow.cats, Lc.follow.stay, Lc.follow.see] }))
    return finish(await explore({ Lc, ctx, place: named, party: slots.party || ents.party, message, cfg }))
  }

  // ---- "which one would you recommend?": the best of what was JUST shown, ranked on stored data (never a new search, never invented)
  if (id === "pick_best") {
    const shown = await candidatesFromPrev(prev, ctx)
    if (!shown.length) return finish(C.composeClarify({ L: Lc, text: Lc.pickNoneShown, followUps: [Lc.follow.cats, Lc.follow.stay, Lc.follow.see] }))
    const r = rank(shown, { queryTerms: [], interestWords: interestWords(slots.interests), budgetMax: budgetMax(slots.budget, slots.party), useDistance: !!ctx.location })
    const top = r.ranked[0]
    if (!top) return finish(C.composeClarify({ L: Lc, text: Lc.pickNoneFit, followUps: [Lc.follow.cats, Lc.follow.stay, Lc.follow.see] }))
    return finish(C.composePick({ L: Lc, entry: top, count: shown.length }))
  }

  // ---- events
  if (id === "find_events") {
    const when = ents.date && !ents.date.past ? (ents.date.kind === "weekend" ? "this_weekend" : "date") : "upcoming"
    const q = await runQuery("searchEvents", { when, ...(when === "date" ? { date: ents.date.iso } : {}), ...(queryTerms(message, { intentHits: primary.hits }).length ? { query: queryTerms(message, { intentHits: primary.hits }).join(" ").slice(0, 100) } : {}), limit: maxResults(cfg) }, ctx)
    return finish(C.composeEvents({ L: Lc, results: q.ok ? q.data.results : [] }))
  }

  // ---- transport, news, announcements, load shedding and the township guide (public collections, each through its read-only query)
  const infoTerms = () => queryTerms(message, { intentHits: primary ? primary.hits : [], placeWords: ents.places })
  if (id === "find_transport") {
    const mode = (/\b(minibus|taxi|taxis)\b/i.exec(message) ? "taxi" : /\brea vaya\b/i.test(message) ? "rea vaya" : /\b(train|trains|metrorail|gautrain)\b/i.test(message) ? "train" : /\b(bus|buses)\b/i.test(message) ? "bus" : "")
    const q = infoTerms().join(" ").slice(0, 60)
    // Leftover words ("how", "latest") are not search terms unless they actually match a record, so try narrow -> broad.
    const attempts = [{ ...(mode ? { mode } : {}), ...(q ? { query: q } : {}) }, ...(mode && q ? [{ mode }] : []), {}]
    let r = null, wider = false
    for (const [i, args] of attempts.entries()) {
      r = await runQuery("getTransport", args, ctx)
      if (r.ok && r.data.results.length) { wider = !!mode && !args.mode; break }
      if (!r.ok) break
    }
    return finish(C.composeTransport({ L: Lc, results: r.ok ? r.data.results : [], wider }))
  }
  if (id === "find_news") { const q = infoTerms().join(" ").slice(0, 100); let r = q ? await runQuery("getNews", { query: q }, ctx) : null; if (!r || !r.ok || !r.data.results.length) r = await runQuery("getNews", {}, ctx); return finish(C.composeNews({ L: Lc, results: r.ok ? r.data.results : [] })) }
  if (id === "find_announcements") { const r = await runQuery("getAnnouncements", {}, ctx); return finish(C.composeAnnouncements({ L: Lc, results: r.ok ? r.data.results : [] })) }
  if (id === "loadshedding") {
    const m = /\b(?:in|for|at)\s+([A-Za-z][A-Za-z .'-]{2,40})$/i.exec(message.trim().replace(/[?.!]+$/, ""))
    const suburb = ents.places[0] || (m ? m[1].trim() : "")
    if (!suburb || suburb.length < 2) return finish(C.composeClarify({ L: Lc, text: Lc.loadsheddingAsk, followUps: [] }))
    const r = await runQuery("getLoadshedding", { suburb }, ctx)
    return finish(C.composeLoadshedding({ L: Lc, suburb, data: r.ok ? r.data : null }))
  }
  if (id === "find_townships") return finish(C.composeTownships({ L: Lc, names: places }))

  // ---- planning and itineraries
  if (planning) return finish(await planTrip({ Lc, ctx, slots, ents, message, prev }), { carried: slots.carried })

  // ---- compare
  if (id === "compare") {
    const items = await resolveMany({ message, prev, ents, ctx })
    if (items.length < 2) return finish(C.composeClarify({ L: Lc, text: Lc.compareNeedTwo, followUps: [Lc.follow.cats, Lc.follow.stay] }))
    return finish(C.composeCompare({ L: Lc, items: items.slice(0, 3) }))
  }

  // ---- questions about one place, and booking requests
  if (asking) {
    const attributes = new Set(intents.filter((i) => i.attribute).map((i) => i.attribute))
    if (id === "ask_place") attributes.add("about")
    const wantsBooking = intents.some((i) => i.id === "booking_request")
    const pluralRef = /\b(these|those|them|which (one|of)|lowest|cheapest|cheaper|the cheaper)\b/i.test(message)
    const item = await resolveOne({ message, prev, ents, ctx, preferNamed: pluralRef })
    if (!item && pluralRef) { // "which of these is cheapest": compare what was just shown, or say that nothing was
      const shown = await candidatesFromPrev(prev, ctx)
      return finish(shown.length >= 2 ? C.composeCompare({ L: Lc, items: shown.slice(0, 3) }) : C.composeClarify({ L: Lc, text: Lc.compareNoneShown(shown.length), followUps: [Lc.follow.cats, Lc.follow.stay, Lc.follow.see] }))
    }
    if (!item) {
      if (ents.landmarks[0]) return finish(await explore({ Lc, ctx, place: ents.landmarks[0], party: slots.party || ents.party, message, cfg }))
      if (id === "ask_place" || id === "ask_directions") { // maybe a township / history question
        const q = await runQuery("searchKnowledge", { query: queryTerms(message, { intentHits: primary.hits }).join(" ") || message.slice(0, 100) }, ctx)
        const rel = relevantKb(q.ok ? q.data.results : [], queryTerms(message, { intentHits: primary.hits }))
        if (rel.length) return finish(C.composeKnowledge({ L: Lc, results: rel }))
      }
      return finish(C.composeClarify({ L: Lc, text: wantsBooking ? Lc.bookingNoPlace : Lc.askWhich, followUps: [Lc.follow.cats, Lc.follow.stay, Lc.follow.see] }))
    }
    if (wantsBooking) attributes.delete("about")
    return finish(C.composeAsk({ L: Lc, item, attributes, wantsBooking }))
  }

  // ---- tours and guides (no dedicated collection exists; searches the words in stored text)
  if (id === "find_tours" || id === "find_tour_guides") {
    const what = id === "find_tours" ? "tours" : "tour guides"
    const { items } = await loadMany(["attractions", "recreation", "business"], ctx)
    const re = id === "find_tours" ? /\btours?\b/ : /\bguides?\b/
    const hit = items.filter((it) => re.test(it.h.all))
    const r = rank(hit, { queryTerms: [], interestWords: {}, budgetMax: budgetMax(slots.budget, slots.party), useDistance: !!ctx.location })
    return finish(C.composeTours({ L: Lc, what, matches: entriesOf(r.ranked, maxResults(cfg)) }))
  }

  // ---- finding places by category (also recommend and discover)
  const hinted = primary && primary.category ? [primary.category] : ents.categories.filter((c) => FINDABLE.includes(c))
  const interestCats = categoriesFor(ents.interests).filter((c) => VISITOR.includes(c))
  let cols = hinted.length ? hinted : id === "discover_things" ? ["attractions", "recreation"] : interestCats.length ? interestCats : null
  if (id === "unknown" && !cols) {
    const q = await runQuery("searchKnowledge", { query: message.slice(0, 120).length >= 2 ? message.slice(0, 120) : "soweto" }, ctx)
    const rel = relevantKb(q.ok ? q.data.results : [], queryTerms(message, { intentHits: [] }))
    if (lAnswer) { usedLearning.push({ id: lAnswer.id, version: lAnswer.version, type: "answer" }); return finish(C.composeLearned({ L: Lc, text: lAnswer.text })) }
    if (rel.length) return finish(C.composeKnowledge({ L: Lc, results: rel }))
    return finish(C.composeFallback({ L: Lc, misses: prev.misses }))
  }
  if (!cols) {
    if (lAnswer) { usedLearning.push({ id: lAnswer.id, version: lAnswer.version, type: "answer" }); return finish(C.composeLearned({ L: Lc, text: lAnswer.text })) }
    return finish(C.composeFallback({ L: Lc, misses: prev.misses }))
  }
  cols = cols.slice(0, 3)
  const loaded = await loadMany(cols, ctx)
  const place = slots.place || guessPlace(message, loaded.items) || askedPlace(message)
  let pool = loaded.items, relaxedPlace = null
  if (place) { const inPlace = loaded.items.filter((it) => matchesPlace(it, place)); if (inPlace.length) pool = inPlace; else relaxedPlace = place }
  const terms = queryTerms(message, { intentHits: primary ? primary.hits : [], placeWords: place ? [place] : [] })
  const crit = { queryTerms: terms, interestWords: interestWords(ents.interests), place, budgetMax: budgetMax(slots.budget, slots.party), minRating: null, accessibleOnly: ents.constraints.accessible, openNow: ents.constraints.openNow, useDistance: !!ctx.location }
  const { r, relaxed } = rankWithFallback(pool, crit)
  const label = cols.length === 1 ? Lc.categoryLabel[cols[0]] : "places"
  const entries = entriesOf(r.ranked, maxResults(cfg))
  const wantsBooking = intents.some((i) => i.id === "booking_request")
  const composed = C.composeFind({ L: Lc, lead: cols.length === 1 ? Lc.lead[cols[0]] : null, followUps: followsFor(cols, entries), party: slots.party && slots.party.total, budget: slots.budget && !slots.budget.perPerson ? slots.budget.max : null, label, entries, where: place && !relaxedPlace ? place : null, relaxed: relaxed || (relaxedPlace ? { place: relaxedPlace } : null), truncated: loaded.truncated, scanned: loaded.scanned, excluded: r.excluded, noLocation: ents.constraints.nearMe && !ctx.location, distanceNote: r.distanceNote, wantsBooking })
  return finish(composed)
}

// ---- resolving which place(s) the user means ---------------------------------------------------------------------------------
async function candidatesFromPrev(prev, ctx, { positional = false } = {}) {
  const items = []
  for (const ref of prev.lastRefs) { const it = await safe(() => getItemByRef(ref, ctx), null); if (it || positional) items.push(it) }
  return items
}
async function resolveOne({ message, prev, ents, ctx, preferNamed = false }) {
  const last = await candidatesFromPrev(prev, ctx)
  const t = message.toLowerCase()
  let found = mentionedItems(message, last)
  if (found.length) return found[0]
  const cols = (ents.categories.filter((c) => FINDABLE.includes(c)).length ? ents.categories.filter((c) => FINDABLE.includes(c)) : FINDABLE).slice(0, 7)
  found = mentionedItems(message, (await loadMany(cols, ctx)).items)
  if (found.length) return found[0]
  if (preferNamed) return null // a plural question ("which of these...") is about the whole last answer, not its first item
  if (last.length) {
    const pos = await candidatesFromPrev(prev, ctx, { positional: true }) // keeps list positions even if one place has since been removed
    const i = ordinalIndex(t, pos.length)
    if (i !== null) return pos[i] || null
    if (ents.refersToPrevious && last.length) return last[0]
  }
  return null
}
async function resolveMany({ message, prev, ents, ctx }) {
  const last = await candidatesFromPrev(prev, ctx)
  const cols = (ents.categories.filter((c) => FINDABLE.includes(c)).length ? ents.categories.filter((c) => FINDABLE.includes(c)) : FINDABLE).slice(0, 7)
  const loaded = await loadMany(cols, ctx)
  const named = mentionedItems(message, [...last, ...loaded.items])
  const uniq = []
  for (const it of named) if (!uniq.some((u) => u.ref === it.ref)) uniq.push(it)
  if (uniq.length >= 2) return uniq
  if (last.length >= 2 && /\b(these|those|them|the ones|both|they)\b/i.test(message)) return last.slice(0, 3)
  if (ents.categories.length && !uniq.length) { // "compare hotels": the top three by the same ranking used for searches
    const r = rank(loaded.items, { queryTerms: [], interestWords: interestWords(ents.interests), budgetMax: budgetMax(ents.budget, ents.party), useDistance: !!ctx.location })
    return r.ranked.slice(0, 3).map((e) => e.item)
  }
  return uniq
}

// ---- trip planning -----------------------------------------------------------------------------------------------------------
async function planTrip({ Lc, ctx, slots, ents, message, prev }) {
  const interests = slots.interests, hasBudget = !!slots.budget
  // "Plan a day using these": build from the places that were just shown, not from a fresh search.
  const shown = /\b(these|those|them)\b/i.test(message) && prev ? await candidatesFromPrev(prev, ctx) : []
  if (shown.length) {
    const by = (cols) => rank(shown.filter((i) => cols.includes(i.collection)), { queryTerms: [], interestWords: {}, budgetMax: budgetMax(slots.budget, slots.party), useDistance: !!ctx.location }).ranked
    const total = budgetMax(slots.budget, slots.party)
    const plan = buildItinerary({ duration: slots.duration, budget: slots.budget ? { ...slots.budget, max: total } : null, party: slots.party, interests,
      pools: { activity: by(["attractions", "recreation", "business"]), meal: by(["restaurants"]), stay: by(["accommodations"]) } })
    if (plan.days.some((d) => d.stops.length)) {
      plan.assumptions.push("I used the places I just showed you.")
      return C.composePlan({ L: Lc, plan, dateLabel: slots.date ? slots.date.label : null })
    } // too little was shown to fill a day: plan from a fresh search instead
  }
  if (!interests.length && !ents.categories.length) return C.composeClarify({ L: Lc, text: hasBudget ? Lc.clarifyPlanBudgetOnly : Lc.clarifyPlan, followUps: [Lc.follow.interests, Lc.follow.party] })
  const duration = slots.duration
  const wantStay = duration && duration.kind === "multi_day"
  const actCols = [...new Set(["attractions", "recreation", ...categoriesFor(interests).filter((c) => ["business"].includes(c))])]
  const need = [...actCols, "restaurants", ...(wantStay ? ["accommodations"] : [])]
  const loaded = await loadMany(need, ctx)
  const by = (cols) => loaded.items.filter((i) => cols.includes(i.collection))
  const total = budgetMax(slots.budget, slots.party)
  const base = { queryTerms: [], budgetMax: total, useDistance: !!ctx.location, place: slots.place }
  const nonFood = interests.filter((k) => k !== "food")
  const act = rankWithFallback(by(actCols), { ...base, interestWords: interestWords(nonFood) })
  const meal = rankWithFallback(by(["restaurants"]), { ...base, interestWords: interests.includes("food") ? interestWords(["food"]) : {} })
  const stay = wantStay ? rankWithFallback(by(["accommodations"]), base) : { r: { ranked: [] } }
  const plan = buildItinerary({ duration, budget: slots.budget ? { ...slots.budget, max: total } : null, party: slots.party, interests,
    pools: { activity: act.r.ranked, meal: meal.r.ranked, stay: stay.r.ranked } })
  if (slots.budget && slots.budget.perPerson && !(slots.party && slots.party.total)) plan.assumptions.push("Your budget is per person and you didn't say how many people, so I treated it as one person.")
  if (act.relaxed) plan.assumptions.push(`Few records match ${act.relaxed.terms}, so some activities are simply the highest-ranked ones.`)
  if (loaded.truncated) plan.caveats.push(Lc.truncated(loaded.scanned))
  const composed = C.composePlan({ L: Lc, plan, dateLabel: slots.date ? slots.date.label : null })
  if (!interests.length) composed.blocks.unshift(C.block("unverified", Lc.clarifyPlanBudgetOnly))
  if (ents.constraints.nearMe && !ctx.location) composed.blocks.push(C.block("unverified", Lc.noLocation))
  return composed
}

// ---- helpers added for natural-language handling ----------------------------------------------------------------------------
// A record is "in" a place when every distinctive word of the place (e.g. "vilakazi") appears in its own name, address, category or text.
function matchesPlace(item, place) {
  const terms = termsFor(place) || [nm(place)]
  return terms.every((t) => item.h.all.includes(t))
}
// Township-guide passages are accepted only when they really mention what was asked about (whole word), never on a stray substring.
function relevantKb(results, terms) {
  const words = terms.filter((t) => t.length >= 4)
  if (!words.length) return []
  return results.filter((r) => { const h = ` ${nm(`${r.title} ${r.text}`)} `; return words.some((w) => h.includes(` ${w} `) || h.includes(` ${w}s `)) })
}
function followsFor(cols, entries) {
  const F = locales.en.follow, c = cols.length === 1 ? cols[0] : null
  const other = c === "restaurants" ? F.stay : c === "accommodations" ? F.cats : F.stay
  if (!entries.length) return [c === "restaurants" ? F.stay : F.cats, c === "attractions" ? F.events : F.see, c === "restaurants" || c === "accommodations" ? F.attractions : F.stay].filter((x, i, a) => a.indexOf(x) === i)
  if (entries.length === 1) return [F.details, F.directions, other]
  return [F.details, F.cheaper, other]
}
async function explore({ Lc, ctx, place, party, message, cfg }) {
  const loaded = await loadMany(VISITOR, ctx)
  const here = loaded.items.filter((it) => matchesPlace(it, place))
  const r = rank(here, { queryTerms: [], interestWords: {}, budgetMax: null, useDistance: !!ctx.location })
  const entries = entriesOf(r.ranked, maxResults(cfg))
  const q = await runQuery("searchKnowledge", { query: place.slice(0, 100) }, ctx)
  const kb = relevantKb(q.ok ? q.data.results : [], (termsFor(place) || nm(place).split(" ")).filter((t) => t.length >= 4))
  return C.composeExplore({ L: Lc, place, party: party && party.total ? party.total : null, entries, kb })
}

async function safe(fn, fallback) { try { return await fn() } catch (e) { return fallback } }
module.exports = { respond, queryTerms, guessPlace }
