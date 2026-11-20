"use strict"
// Query processing: pulls structured facts out of ONE message. Rules:
//   * Nothing is invented. A value the message does not state is null; the engine then asks or says it assumed nothing.
//   * Rand only. Other currencies are reported, never converted (no exchange-rate data exists here).
//   * Dates are South African time (UTC+2), resolved relative to `now`.
//   * Purely deterministic: the same text and clock give the same result.
const { normalizeName } = require("../sanitize")
const { sastParts, sastDayStartMs, ymd } = require("../retrieval/normalize")
const L = require("./lexicon")

const DAY = 86400000
const pad = (t) => ` ${normalizeName(t)} `
const hasWord = (padded, w) => padded.includes(` ${normalizeName(w)} `)
const MAX_MONEY = 1_000_000

// ---- money ------------------------------------------------------------------------------------------------------------------
const NUM = "(\\d{1,3}(?:[ ,]\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)"
const MONEY_RE = new RegExp(`(?:\\b(?:r|zar)\\s?${NUM}(\\s?k\\b)?)|(?:\\b${NUM}(\\s?k)?\\s?(?:rands?|zar)\\b)`, "gi")
const toAmount = (num, k) => { const n = parseFloat(String(num).replace(/[ ,]/g, "")); return Number.isFinite(n) ? (k ? n * 1000 : n) : NaN }

function parseBudget(raw) {
  const text = String(raw)
  const matches = []
  for (const m of text.matchAll(MONEY_RE)) {
    const amount = m[1] !== undefined ? toAmount(m[1], m[2]) : toAmount(m[3], m[4])
    if (Number.isFinite(amount) && amount > 0 && amount <= MAX_MONEY) matches.push({ amount, index: m.index, end: m.index + m[0].length })
  }
  const foreign = L.FOREIGN_CURRENCY.test(text)
  if (!matches.length) return { budget: null, foreignCurrency: foreign }
  const first = matches[0], before = text.slice(Math.max(0, first.index - 28), first.index).toLowerCase(), after = text.slice(first.end, first.end + 22).toLowerCase()
  const perPerson = /\b(per person|pp|p\/p|each|a head|per head|per adult)\b/.test(after) || /\bper person\b/.test(before)
  const approx = /\b(around|about|roughly|approx(?:imately)?|circa)\b/.test(before)
  let kind = "total", min = first.amount, max = first.amount
  const second = matches[1]
  if (second && /^\s*(?:-|–|—|to|and)\s*$/.test(text.slice(first.end, second.index)) && second.amount >= first.amount) { kind = "range"; max = second.amount }
  else if (/\b(under|below|less than|max(?:imum)?|up to|no more than|at most|within|not more than|cheaper than)\b/.test(before)) { kind = "max"; min = 0 }
  return { budget: { amount: max, min, max, kind, perPerson, approx, currency: "ZAR" }, foreignCurrency: foreign }
}

// ---- people -----------------------------------------------------------------------------------------------------------------
function parseParty(raw) {
  const t = String(raw).toLowerCase()
  let total = null, children = null, m
  if ((m = t.match(/\bfamily of (\d{1,2})\b/))) total = +m[1]
  else if ((m = t.match(/\b(\d{1,2})\s*(?:people|persons|adults|guests|pax|of us|travell?ers|tourists|friends|visitors)\b/))) total = +m[1]
  else if (/\b(couple|two of us|the two of us)\b/.test(t)) total = 2
  else if (/\b(solo|alone|by myself|just me|on my own|only me)\b/.test(t)) total = 1
  else if ((m = t.match(/(?<![r\d.,])\bfor (\d{1,2})\b(?!\s*(?:hours?|hrs?|days?|nights?|minutes?|mins?|rand|km|%|weeks?|\d))/))) total = +m[1]
  if ((m = t.match(/\b(\d{1,2})\s*(?:kids|children|child|toddlers|teens|teenagers)\b/))) children = +m[1]
  if (total !== null && (total < 1 || total > 50)) total = null
  if (children !== null && (children < 1 || children > 30)) children = null
  if (total === null && children === null) return null
  return { total, children, adults: total !== null && children !== null ? Math.max(0, total - children) : null }
}

// ---- dates and times (SAST) -------------------------------------------------------------------------------------------------
function dateFrom(ms, label, kind, now) { const iso = ymd(ms); return { iso, label, kind, weekday: L.WEEKDAYS[sastParts(ms).dow], past: ms < sastDayStartMs(now) } }
function parseDate(raw, nowMs) {
  const t = String(raw).toLowerCase(), today = sastDayStartMs(nowMs), dow = sastParts(nowMs).dow
  let m
  if (/\bday after tomorrow\b/.test(t)) return dateFrom(today + 2 * DAY, "the day after tomorrow", "relative", nowMs)
  if (/\btomorrow\b/.test(t)) return dateFrom(today + DAY, "tomorrow", "relative", nowMs)
  if (/\b(today|tonight|this evening|this afternoon|this morning)\b/.test(t)) return dateFrom(today, "today", "relative", nowMs)
  if (/\bthis weekend\b/.test(t)) return dateFrom(dow === 6 || dow === 0 ? today : today + (6 - dow) * DAY, "this weekend", "weekend", nowMs)
  if ((m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) { const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]) - 2 * 3600000; return Number.isNaN(ms) || +m[2] > 12 || +m[3] > 31 ? null : dateFrom(ms, m[0], "explicit", nowMs) }
  const mon = L.MONTHS.join("|")
  let d = null, mi = -1
  if ((m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${mon})\\b(?:\\s+(\\d{4}))?`)))) { d = +m[1]; mi = L.MONTHS.indexOf(m[2]); var yr = m[3] ? +m[3] : null }
  else if ((m = t.match(new RegExp(`\\b(${mon})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`)))) { d = +m[2]; mi = L.MONTHS.indexOf(m[1]); yr = m[3] ? +m[3] : null }
  if (d !== null && d >= 1 && d <= 31) {
    const cur = sastParts(nowMs); let year = yr || cur.y
    let ms = Date.UTC(year, mi, d) - 2 * 3600000
    if (!yr && ms < today && today - ms > 14 * DAY) ms = Date.UTC(year + 1, mi, d) - 2 * 3600000 // "12 March" said in December means next March; a date from the last two weeks is reported as past, not moved a year
    if (new Date(ms + 2 * 3600000).getUTCDate() !== d) return null // 31 February and the like
    return dateFrom(ms, `${d} ${L.MONTHS[mi]}`, "explicit", nowMs)
  }
  if ((m = t.match(new RegExp(`\\b(?:(next|this|on)\\s+)?(${L.WEEKDAYS.join("|")})\\b`)))) {
    const target = L.WEEKDAYS.indexOf(m[2]); let diff = (target - dow + 7) % 7
    if (m[1] === "next" && diff === 0) diff = 7
    return dateFrom(today + diff * DAY, `${m[1] === "next" ? "next " : ""}${m[2]}`, "weekday", nowMs)
  }
  return null
}
function parseTime(raw) {
  const t = String(raw).toLowerCase()
  let m
  if ((m = t.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s?(am|pm)\b/))) { const h = (+m[1] % 12) + (m[3] === "pm" ? 12 : 0); return { hour: h, minute: m[2] ? +m[2] : 0, part: null, label: m[0].trim() } }
  if ((m = t.match(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/))) return { hour: +m[1], minute: +m[2], part: null, label: m[0] }
  const part = Object.keys(L.DAYPARTS).find((p) => new RegExp(`\\b${p}\\b`).test(t)) || (/\btonight\b/.test(t) ? "evening" : null)
  return part ? { hour: null, minute: null, part, label: part } : null
}
function parseDuration(raw) {
  const t = String(raw).toLowerCase()
  let m
  if (/\bhalf[- ]?day\b/.test(t)) return { kind: "half_day", days: 0.5 }
  if ((m = t.match(/\b(\d{1,2})[- ]?days?\b/)) && +m[1] >= 1 && +m[1] <= 14) return +m[1] === 1 ? { kind: "full_day", days: 1 } : { kind: "multi_day", days: +m[1] }
  if (/\b(full[- ]?day|whole day|all day|day trip|one day|a day)\b/.test(t)) return { kind: "full_day", days: 1 }
  if (/\b(a|one|1) week\b/.test(t)) return { kind: "multi_day", days: 7 }
  return null
}

// ---- topics -----------------------------------------------------------------------------------------------------------------
const collectKeys = (padded, table) => Object.keys(table).filter((k) => (table[k].words || table[k]).some((w) => hasWord(padded, w)))

function extract(text, { now = new Date(), places = [] } = {}) {
  const raw = String(text || ""), p = pad(raw), nowMs = now.getTime()
  const { budget, foreignCurrency } = parseBudget(raw)
  const categories = Object.keys(L.CATEGORIES).filter((k) => L.CATEGORIES[k].words.some((w) => hasWord(p, w)))
  const interests = collectKeys(p, L.INTERESTS)
  const experience = collectKeys(p, L.EXPERIENCE)
  const placeHits = places.filter((n) => n && hasWord(p, n)).slice(0, 3)
  const constraints = {
    accessible: /\b(wheelchair|accessible|disabled|disability|step[- ]free|mobility)\b/i.test(raw),
    openNow: /\b(open now|currently open|open right now|still open)\b/i.test(raw),
    nearMe: /\b(near me|nearby|close to me|around me|nearest|closest|walking distance)\b/i.test(raw),
  }
  const unsupported = []
  if (foreignCurrency && !budget) unsupported.push("currency")
  return {
    budget, party: parseParty(raw), date: parseDate(raw, nowMs), time: parseTime(raw), duration: parseDuration(raw),
    categories, interests, experience, places: placeHits, constraints,
    refersToPrevious: /\b(it|there|that place|this place|that one|this one|the first one|the second one|the third one|them|those|the cheaper one)\b/i.test(raw),
    unsupported,
  }
}

module.exports = { extract, parseBudget, parseParty, parseDate, parseTime, parseDuration }
