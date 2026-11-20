"use strict"
// The engine's internal, READ-ONLY query layer. Everything here runs on the server; the caller's identity is never an argument.
// There is deliberately no query that writes, books, or reads another user's records or any organisation/booking/application data.
// Arguments are built by the engine from the user's message, but they still pass the same strict validation as before (closed
// schemas, collections only from an enum, no free-form filters), so a bug in the extractor cannot widen what can be read.
const { sanitizeText, normalizeName } = require("../sanitize")
const { LISTING_COLLECTIONS, BOOKABLE_COLLECTIONS } = require("../constants")
const { DISTANCE_NOTE } = require("../geo")
const log = require("../log")
const { validateArgs } = require("./schema")
const { loadActive, getVisible } = require("./data")
const N = require("./normalize")

const ID = /^[A-Za-z0-9_.-]{1,128}$/
const STOP = new Set(["the", "a", "an", "and", "or", "in", "at", "to", "of", "for", "with", "near", "me", "is", "are", "what", "where", "can", "i", "do", "find", "show", "soweto", "good", "best", "some"])
const tokens = (s) => normalizeName(s).split(" ").filter((t) => t.length >= 2 && !STOP.has(t))
const has = (hay, t) => hay.includes(t)
const ev = (o) => o // evidence entries are plain objects (see normalize.js)

const QUERIES = {
  getListing: {
    schema: { collection: { type: "string", enum: [...LISTING_COLLECTIONS], required: true }, id: { type: "string", pattern: ID, required: true } },
    async run(a, ctx) {
      const row = await getVisible(a.collection, a.id)
      if (!row) return { data: { found: false, note: "That listing does not exist or is not currently available." }, evidence: [] }
      const s = N.summarizeListing(a.collection, row.id, row.data, ctx, { longDescription: true })
      return { data: { found: true, listing: s.model }, evidence: [ev(s.evidence)] }
    },
  },
  getListingRating: {
    schema: { collection: { type: "string", enum: [...LISTING_COLLECTIONS], required: true }, id: { type: "string", pattern: ID, required: true } },
    async run(a, ctx) {
      const row = await getVisible(a.collection, a.id)
      if (!row) return { data: { found: false }, evidence: [] }
      const s = N.summarizeListing(a.collection, row.id, row.data, ctx)
      return { data: { found: true, ref: s.model.ref, name: s.model.name, rating: s.model.rating, reviewCount: s.model.reviewCount, note: "Aggregated rating only; individual review text is never available." }, evidence: [ev(s.evidence)] }
    },
  },
  searchEvents: {
    schema: {
      when: { type: "string", enum: ["today", "this_weekend", "next_7_days", "upcoming", "date"], required: true },
      date: { type: "string", max: 10, pattern: /^\d{4}-\d{2}-\d{2}$/, description: "Required when when='date' (YYYY-MM-DD)" },
      query: { type: "string", max: 100 }, category: { type: "string", max: 40 }, limit: { type: "integer", min: 1, max: 8 },
    },
    async run(a, ctx) {
      if (a.when === "date" && !a.date) throw new Error("date required")
      const now = ctx.now.getTime(), today = N.sastDayStartMs(now), DAY = 86400000
      const dow = N.sastParts(now).dow
      const win = { today: [today, today + DAY], next_7_days: [today, today + 7 * DAY], upcoming: [today, Infinity],
        this_weekend: dow === 0 ? [today, today + DAY] : dow === 6 ? [today, today + 2 * DAY] : [today + (6 - dow) * DAY, today + (8 - dow) * DAY],
        date: a.date ? [N.toMillis(a.date), N.toMillis(a.date) + DAY] : [0, 0] }[a.when]
      const rows = await loadActive("events", ctx.cfg, 300)
      const qt = tokens(a.query || ""), cat = normalizeName(a.category || "")
      const found = []
      for (const r of rows) {
        const d = r.data, start = N.toMillis(N.pick(d, "date", "startDate", "eventDate"))
        if (Number.isNaN(start)) continue
        if (start < today || start < win[0] || start >= win[1]) continue // never past events, always inside the window
        const title = sanitizeText(N.pick(d, "title", "name"), 120), category = sanitizeText(d.category, 40), loc = sanitizeText(N.pick(d, "location", "venue"), 140)
        const hay = normalizeName(`${title} ${category} ${d.description || ""}`)
        if (qt.length && !qt.some((t) => hay.includes(t))) continue
        if (cat && !normalizeName(category).includes(cat)) continue
        found.push({ start, ref: `event:events/${r.id}`, title, date: N.ymd(start), time: sanitizeText(d.time, 30) || null, location: loc || null, category: category || null, description: sanitizeText(d.description, 200) || null, image: N.firstImage(d) || (typeof d.imageUrl === "string" && /^https:/.test(d.imageUrl) ? d.imageUrl : null) })
      }
      found.sort((x, y) => x.start - y.start)
      const top = found.slice(0, a.limit || 6)
      return { data: { when: a.when, results: top.map(({ start, image, ...m }) => m), notes: top.length ? [] : ["No approved events were found for that period."] }, evidence: top.map((e) => ({ ref: e.ref, kind: "event", name: e.title, dateText: `${e.date}${e.time ? ` ${e.time}` : ""}`, address: e.location, category: e.category, descText: e.description || "", imageUrl: e.image, priceText: null, priceNumbers: [], hoursText: null, openStatus: "unknown", rating: null, reviewCount: null, approxKm: null })) }
    },
  },
  getAnnouncements: {
    schema: { limit: { type: "integer", min: 1, max: 5 } },
    async run(a, ctx) {
      const now = ctx.now.getTime(), rows = await loadActive("announcements", ctx.cfg, 100)
      const items = rows.map((r) => ({ r, s: N.toMillis(r.data.startsAt), e: N.toMillis(r.data.expiresAt), p: N.toMillis(N.pick(r.data, "publishedAt", "createdAt")) }))
        .filter(({ s, e }) => (Number.isNaN(s) || s <= now) && (Number.isNaN(e) || e > now)).sort((x, y) => (y.r.data.pinned === true) - (x.r.data.pinned === true) || (y.p || 0) - (x.p || 0)).slice(0, a.limit || 5)
      return { data: { results: items.map(({ r }) => ({ ref: `announcement:announcements/${r.id}`, title: sanitizeText(r.data.title, 100), type: sanitizeText(r.data.type, 30) || null, message: sanitizeText(r.data.message, 300) })), notes: items.length ? [] : ["There are no current announcements."] },
        evidence: items.map(({ r }) => ({ ref: `announcement:announcements/${r.id}`, kind: "announcement", name: sanitizeText(r.data.title, 100), descText: sanitizeText(r.data.message, 300), priceNumbers: [], hoursText: null, openStatus: "unknown" })) }
    },
  },
  getNews: {
    schema: { query: { type: "string", max: 100 }, limit: { type: "integer", min: 1, max: 5 } },
    async run(a, ctx) {
      const rows = await loadActive("news", ctx.cfg, 100), qt = tokens(a.query || "")
      const items = rows.map((r) => ({ r, t: N.toMillis(N.pick(r.data, "publishedAt", "date", "createdAt")) })).filter(({ r }) => !qt.length || qt.some((t) => normalizeName(`${r.data.title} ${r.data.summary}`).includes(t))).sort((x, y) => (y.t || 0) - (x.t || 0)).slice(0, a.limit || 4)
      return { data: { results: items.map(({ r, t }) => ({ ref: `news:news/${r.id}`, title: sanitizeText(r.data.title, 120), summary: sanitizeText(N.pick(r.data, "summary", "excerpt", "description"), 250), category: sanitizeText(r.data.category, 40) || null, date: Number.isNaN(t) ? null : N.ymd(t) })), notes: items.length ? [] : ["No news items were found."] },
        evidence: items.map(({ r }) => ({ ref: `news:news/${r.id}`, kind: "news", name: sanitizeText(r.data.title, 120), descText: sanitizeText(N.pick(r.data, "summary", "excerpt", "description"), 250), priceNumbers: [], hoursText: null, openStatus: "unknown" })) }
    },
  },
  getEmergencyServices: {
    schema: { category: { type: "string", max: 40 }, query: { type: "string", max: 60 } },
    async run(a, ctx) {
      const rows = await loadActive("emergency", ctx.cfg, 100), cat = normalizeName(a.category || ""), qt = tokens(a.query || "")
      const items = rows.filter((r) => (!cat || normalizeName(r.data.category).includes(cat)) && (!qt.length || qt.some((t) => normalizeName(`${r.data.name} ${r.data.category}`).includes(t)))).sort((x, y) => (x.data.order ?? 999) - (y.data.order ?? 999)).slice(0, 20)
      return { data: { results: items.map((r) => ({ ref: `emergency:emergency/${r.id}`, name: sanitizeText(r.data.name, 80), number: sanitizeText(r.data.number, 30), type: sanitizeText(r.data.type, 20) || null, category: sanitizeText(r.data.category, 40) || null })), notes: items.length ? [] : ["No emergency contacts are listed for that request."] },
        evidence: items.map((r) => ({ ref: `emergency:emergency/${r.id}`, kind: "emergency", name: sanitizeText(r.data.name, 80), descText: sanitizeText(r.data.number, 30), priceNumbers: [], hoursText: null, openStatus: "unknown" })) }
    },
  },
  getTransport: {
    schema: { mode: { type: "string", max: 30 }, query: { type: "string", max: 60 }, limit: { type: "integer", min: 1, max: 8 } },
    async run(a, ctx) {
      const rows = await loadActive("transport", ctx.cfg, 100), mode = normalizeName(a.mode || ""), qt = tokens(a.query || "")
      const items = rows.filter((r) => (!mode || normalizeName(r.data.mode).includes(mode)) && (!qt.length || qt.some((t) => normalizeName(`${r.data.routeName} ${r.data.origin} ${r.data.destination} ${r.data.operator}`).includes(t)))).sort((x, y) => (x.data.order ?? 999) - (y.data.order ?? 999)).slice(0, a.limit || 6)
      const m = (r) => ({ ref: `transport:transport/${r.id}`, route: sanitizeText(r.data.routeName, 100), mode: sanitizeText(r.data.mode, 30) || null, operator: sanitizeText(r.data.operator, 60) || null, from: sanitizeText(r.data.origin, 60) || null, to: sanitizeText(r.data.destination, 60) || null, frequency: sanitizeText(r.data.frequency, 60) || null, fare: sanitizeText(r.data.fare, 40) || null, status: sanitizeText(r.data.status, 40) || null })
      return { data: { results: items.map(m), notes: items.length ? [] : ["No matching transport services are listed."] },
        evidence: items.map((r) => { const t = N.parsePrice(r.data.fare); return { ref: `transport:transport/${r.id}`, kind: "transport", name: sanitizeText(r.data.routeName, 100), descText: sanitizeText(`${r.data.origin || ""} ${r.data.destination || ""} ${r.data.frequency || ""}`, 200), priceText: t.text, priceNumbers: t.numbers, hoursText: null, openStatus: "unknown" } }) }
    },
  },
  getLoadshedding: {
    schema: { suburb: { type: "string", max: 80, min: 2, required: true } },
    async run(a, ctx) {
      const rows = await loadActive("loadshedding", ctx.cfg, 500), q = normalizeName(a.suburb)
      const hit = rows.find((r) => normalizeName(r.data.suburb) === q) || rows.find((r) => normalizeName(r.data.suburb).includes(q))
      if (!hit) return { data: { found: false, note: "No schedule is stored for that suburb." }, evidence: [] }
      const stages = {}
      for (const [k, v] of Object.entries(hit.data.schedule || {})) if (/^stage_[1-8]$/.test(k) && v && typeof v === "object") stages[k] = Object.fromEntries(Object.entries(v).slice(0, 7).map(([day, rs]) => [sanitizeText(day, 12), (Array.isArray(rs) ? rs : []).slice(0, 6).map((x) => sanitizeText(x, 20))]))
      return { data: { found: true, ref: `loadshedding:loadshedding/${hit.id}`, suburb: sanitizeText(hit.data.suburb, 80), stages, note: "The current loadshedding stage is not known here; ask the user or point them to the Eskom screen." }, evidence: [{ ref: `loadshedding:loadshedding/${hit.id}`, kind: "loadshedding", name: sanitizeText(hit.data.suburb, 80), descText: JSON.stringify(stages).slice(0, 400), priceNumbers: [], hoursText: null, openStatus: "unknown" }] }
    },
  },
  searchKnowledge: {
    schema: { query: { type: "string", max: 120, min: 2, required: true }, limit: { type: "integer", min: 1, max: 5 } },
    async run(a, ctx) {
      const rows = (await loadActive("homescreen", ctx.cfg, 300)).filter((r) => String(r.data.type || "").toLowerCase() === "township")
      const flat = (v) => (v === undefined || v === null ? [] : typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(flat) : typeof v === "object" ? [[v.year || v.date, v.name || v.title, v.role, v.description || v.text || v.detail].filter(Boolean).join(": ")] : [String(v)])
      const SECTIONS = [["overview", ["overview", "description", "about"]], ["history", ["history"]], ["people", ["people", "celebrities", "notablePeople"]], ["landmarks", ["landmarks"]], ["facts", ["facts", "funFacts"]]]
      const passages = []
      for (const r of rows) {
        const township = sanitizeText(N.pick(r.data, "name", "title"), 80)
        for (const [section, keys] of SECTIONS) {
          const text = sanitizeText(flat(N.pick(r.data, ...keys)).join(" "), 700)
          if (text) passages.push({ ref: `kb:homescreen/${r.id}#${section}`, township, section, text })
        }
        const meta = sanitizeText([r.data.established && `Established ${r.data.established}`, r.data.namedAfter && `Named after ${r.data.namedAfter}`].filter(Boolean).join(". "), 200)
        if (meta) passages.push({ ref: `kb:homescreen/${r.id}#basics`, township, section: "basics", text: meta })
      }
      const qt = tokens(a.query)
      const scored = passages.map((p) => { const h = normalizeName(`${p.township} ${p.section} ${p.text}`); const t = normalizeName(p.township); return { p, s: qt.reduce((n, w) => n + (h.includes(w) ? 1 : 0) + (t.includes(w) ? 2 : 0), 0) } }).filter((x) => x.s > 0).sort((x, y) => y.s - x.s).slice(0, a.limit || 3)
      return { data: { results: scored.map(({ p }) => ({ ref: p.ref, title: `${p.township} (${p.section})`, text: p.text, source: "XploreSoweto township guide (platform content, authored by XploreSoweto)" })), notes: scored.length ? [] : ["The curated knowledge base has no passage on that topic. General knowledge may be used, but it must be labelled as unverified."] },
        evidence: scored.map(({ p }) => ({ ref: p.ref, kind: "kb", name: p.township, sourceTitle: "XploreSoweto township guide", descText: p.text, priceNumbers: [], hoursText: null, openStatus: "unknown" })) }
    },
  },
  checkBookable: {
    schema: { collection: { type: "string", enum: [...BOOKABLE_COLLECTIONS], required: true }, id: { type: "string", pattern: ID, required: true } },
    async run(a) {
      const row = await getVisible(a.collection, a.id)
      if (!row) return { data: { bookable: false, reason: "not_found_or_unavailable" }, evidence: [] }
      if (typeof row.data.organisationId !== "string") return { data: { bookable: false, reason: "not_linked_to_a_provider", note: "This is an information-only listing: direct the user to its contact details." }, evidence: [] }
      return { data: { bookable: true, mode: "request", note: "The user can submit a booking REQUEST in the app. The provider accepts or declines it; nothing is confirmed until the provider responds." }, evidence: [] }
    },
  },
}

const withTimeout = (p, ms) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("query_timeout")), ms); p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) }) })
const queryNames = () => Object.keys(QUERIES)

// Never throws: returns { ok:false, error } for an unknown query, invalid arguments, a timeout or any failure.
async function runQuery(name, rawArgs, ctx) {
  if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(QUERIES, name)) return { ok: false, error: "unknown_query" }
  const q = QUERIES[name]
  let args
  try { args = validateArgs(q.schema, rawArgs) } catch (e) { return { ok: false, error: "invalid_arguments", detail: String(e.message).slice(0, 160) } }
  const ms = (ctx.cfg.retrieval && ctx.cfg.retrieval.queryTimeoutMs) || 8000
  try { return { ok: true, ...(await withTimeout(q.run(args, ctx), ms)) } } catch (e) {
    log.warn("ai.query.failed", { tool: name, code: e && e.message === "query_timeout" ? "timeout" : "error" })
    return { ok: false, error: e && e.message === "query_timeout" ? "query_timeout" : "query_failed" }
  }
}
module.exports = { QUERIES, queryNames, runQuery, tokens }
