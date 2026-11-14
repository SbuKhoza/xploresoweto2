"use strict"
const { HttpsError } = require("firebase-functions/v2/https")
const bad = (m) => new HttpsError("invalid-argument", m)
const CONTROL = /[\u0000-\u001f\u007f]/

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
function object(v, name = "data") { if (v === undefined || v === null) return {}; if (!isObject(v)) throw bad(`Invalid ${name}`); return v }
function onlyKeys(obj, allowed, name = "data") {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw bad(`Unknown field "${k}" in ${name}`)
}
function str(v, name, { min = 1, max = 200 } = {}) {
  if (typeof v !== "string") throw bad(`${name} must be text`)
  const t = v.trim()
  if (t.length < min || t.length > max) throw bad(`${name} must be ${min}-${max} characters`)
  if (CONTROL.test(t)) throw bad(`${name} contains invalid characters`)
  return t
}
function optStr(v, name, { max = 200 } = {}) {
  if (v === undefined || v === null || v === "") return undefined
  return str(v, name, { min: 1, max })
}
function docId(v, name = "id") {
  const s = str(v, name, { max: 200 })
  if (!/^[A-Za-z0-9_.-]+$/.test(s) || s === "." || s === "..") throw bad(`Invalid ${name}`)
  return s
}
function requestId(v) {
  const s = str(v, "requestId", { min: 8, max: 64 })
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw bad("Invalid requestId")
  return s
}
function oneOf(v, name, list) { if (!list.includes(v)) throw bad(`Invalid ${name}`); return v }
function intRange(v, name, min, max) {
  if (!Number.isInteger(v) || v < min || v > max) throw bad(`${name} must be a whole number ${min}-${max}`)
  return v
}
function email(v, name = "email") {
  const s = str(v, name, { max: 254 }).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad(`Invalid ${name}`)
  return s
}
function optPhone(v, name = "phone") {
  if (v === undefined || v === null || v === "") return undefined
  const s = str(v, name, { max: 20 })
  if (!/^[0-9+()\-\s]{7,20}$/.test(s)) throw bad(`Invalid ${name}`)
  return s
}
function ymd(v, name) {
  const s = str(v, name, { min: 10, max: 10 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw bad(`Invalid ${name}`)
  return s
}
function storagePaths(v, name, prefix, max) {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v) || v.length > max) throw bad(`${name} must be a list of at most ${max} items`)
  return v.map((p) => {
    const s = str(p, name, { max: 300 })
    if (!s.startsWith(prefix) || s.includes("..") || s.includes("//")) throw bad(`Invalid ${name}`)
    return s
  })
}
const maskEmail = (e) => { const [u, d] = String(e).split("@"); return `${u.slice(0, 1)}***@${d}` }

module.exports = { bad, isObject, object, onlyKeys, str, optStr, docId, requestId, oneOf, intRange, email, optPhone, ymd, storagePaths, maskEmail }
