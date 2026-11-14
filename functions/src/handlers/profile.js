"use strict"
const fb = require("../lib/firebase")
const { COL } = require("../lib/constants")
const V = require("../lib/validate")
const G = require("../lib/guards")

const FIELDS = ["displayName", "greeting", "kasi", "phone", "city"]
const publicProfile = (p) => ({ uid: p.uid, displayName: p.displayName || null, greeting: p.greeting || null, kasi: p.kasi || null, enrolled: p.enrolled === true })

// Creates users/{uid} if (and only if) it does not exist. Safe to call any number of times, from any device:
// it never overwrites an existing profile and never accepts roles, permissions or verification status.
async function ensureUserProfile(request) {
  const ctx = await G.requireAuth(request)
  const d = V.object(request.data)
  V.onlyKeys(d, FIELDS)
  const input = {
    displayName: V.optStr(d.displayName, "displayName", { max: 60 }),
    greeting: V.optStr(d.greeting, "greeting", { max: 60 }),
    kasi: V.optStr(d.kasi, "kasi", { max: 60 }),
    phone: V.optPhone(d.phone),
    city: V.optStr(d.city, "city", { max: 60 }),
  }
  const ref = fb.db().collection(COL.users).doc(ctx.uid)
  const FV = fb.FieldValue()
  return fb.db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (snap.exists) return { created: false, profile: publicProfile(snap.data()) }
    const tokenName = typeof ctx.token.name === "string" ? ctx.token.name.trim().slice(0, 60) : ""
    const displayName = input.displayName || tokenName || (ctx.email ? ctx.email.split("@")[0].slice(0, 60) : "Explorer")
    const doc = {
      uid: ctx.uid,
      email: ctx.email,
      displayName,
      greeting: input.greeting ?? null,
      kasi: input.kasi ?? null,
      phone: input.phone ?? null,
      city: input.city ?? null,
      photoURL: null,
      enrolled: false,
      enrolledAt: null,
      createdAt: FV.serverTimestamp(),
      updatedAt: FV.serverTimestamp(),
      schemaVersion: 1,
    }
    tx.set(ref, doc)
    return { created: true, profile: publicProfile(doc) }
  })
}
module.exports = { ensureUserProfile }
