"use strict"
// Listing retrieval for the engine. Public collections only (LISTING_COLLECTIONS allow-list), active + published records only,
// records of unapproved/inactive organisations hidden (all enforced in data.js). Bounded: a category scan is capped and the cap is
// REPORTED, because Firestore has no full-text search and a capped scan may be incomplete.
const { loadActive, getVisible } = require("./data")
const N = require("./normalize")
const { LISTING_COLLECTIONS } = require("../constants")
const { sanitizeText, normalizeName } = require("../sanitize")

const nm = (s) => normalizeName(String(s || "").replace(/['’`]/g, "")) // "Wandie's" -> "wandies"
const scanLimit = (ctx) => (ctx.cfg.retrieval && ctx.cfg.retrieval.scanLimit) || 150

const toItem = (collection, r, ctx) => {
  const s = N.summarizeListing(collection, r.id, r.data, ctx)
  const m = s.model
  return { collection, id: r.id, ref: m.ref, model: m, evidence: s.evidence, coords: s.coords, price: s.price,
    h: { name: nm(m.name), cat: nm(`${m.category || ""} ${m.tags.join(" ")}`), desc: nm(m.description || ""), addr: nm(m.address || ""), all: nm(`${m.name} ${m.category || ""} ${m.tags.join(" ")} ${m.description || ""} ${m.address || ""}`) } }
}

// -> { items, truncated, scanned }. Never reads a collection outside the allow-list.
async function loadCategory(collection, ctx) {
  if (!LISTING_COLLECTIONS.includes(collection)) throw new Error("collection_not_allowed")
  const rows = await loadActive(collection, ctx.cfg, scanLimit(ctx))
  return { items: rows.map((r) => toItem(collection, r, ctx)), truncated: rows.truncated === true, scanned: rows.scanned || rows.length }
}

// Names of townships/places from the curated township guide (homescreen docs with type "township"), used to recognise a place in a message.
async function loadPlaces(ctx) {
  const rows = (await loadActive("homescreen", ctx.cfg, 300)).filter((r) => String(r.data.type || "").toLowerCase() === "township")
  return [...new Set(rows.map((r) => sanitizeText(N.pick(r.data, "name", "title"), 80)).filter(Boolean))].slice(0, 100)
}

const STOP = new Set(["the", "a", "an", "and", "of", "in", "at", "restaurant", "guest", "house", "lodge", "hotel", "cafe", "museum", "centre", "center", "soweto"])
// Which loaded records does the message name? Exact (whole name appears) beats partial (every distinctive word of a multi-word name appears).
function mentionedItems(message, items) {
  const padded = ` ${nm(message)} `
  const inMsg = (t) => padded.includes(` ${t} `) || (t.length > 4 && t.endsWith("s") && padded.includes(` ${t.slice(0, -1)} `)) // "gogo" finds "Gogo's"
  const out = [], single = new Map(), addrs = ` ${items.map((i) => i.h.addr).join(" ")} `
  for (const it of items) {
    const n = it.h.name
    if (n.length < 3) continue
    if (padded.includes(` ${n} `)) { out.push({ item: it, match: "exact", len: n.length }); continue }
    const toks = n.split(" ").filter((t) => t.length >= 3 && !STOP.has(t))
    const got = toks.filter(inMsg)
    if (got.length >= 2 && got.length >= toks.length - 1) { out.push({ item: it, match: "partial", len: n.length }); continue }
    const hit = toks.filter((t) => t.length >= 4 && inMsg(t) && !addrs.includes(` ${t} `)) // a word that is also an area ("Orlando") never selects a place by itself
    if (hit.length === 1 && toks.length >= 1) for (const t of hit) single.set(t, [...(single.get(t) || []), it])
  }
  // one distinctive word of a name ("Gogo") counts only when it points at exactly ONE record, so an ambiguous word never guesses
  for (const list of single.values()) if (list.length === 1 && !out.some((o) => o.item.ref === list[0].ref)) out.push({ item: list[0], match: "partial", len: list[0].h.name.length })
  return out.sort((a, b) => (a.match === "exact" ? 0 : 1) - (b.match === "exact" ? 0 : 1) || b.len - a.len).map((x) => x.item)
}

async function getItemByRef(ref, ctx) {
  const m = /^listing:([a-z-]+)\/([A-Za-z0-9_.-]{1,128})$/.exec(String(ref))
  if (!m || !LISTING_COLLECTIONS.includes(m[1])) return null
  const row = await getVisible(m[1], m[2])
  return row ? toItem(m[1], row, ctx) : null
}
module.exports = { loadCategory, loadPlaces, mentionedItems, getItemByRef, nm }
