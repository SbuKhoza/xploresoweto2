"use strict"
const assert = require("node:assert/strict")
const { makeFakeAdmin, Ts } = require("./fake")
const fb = require("../src/lib/firebase")
const clock = require("../src/lib/clock")
const { permissionsForRole } = require("../src/lib/org")

const T0 = Date.UTC(2026, 10, 14, 10, 0, 0) // 14 Nov 2026 10:00 UTC
function setup() {
  const env = makeFakeAdmin()
  fb.setAdminForTests(env.admin)
  env.time = { now: T0 }
  clock.setClockForTests(() => new Date(env.time.now))
  env.seed = (path, data) => { env.db.store.set(path, cloneSeed(data)); env.db._bump(path) }
  env.get = (path) => env.db._read(path)
  env.list = (col) => env.db._list(col).map((p) => ({ id: p.split("/")[1], ...env.db._read(p) }))
  env.addUser = (uid, o = {}) => env.auth.addUser({ uid, email: `${uid}@example.com`, emailVerified: true, ...o })
  return env
}
const cloneSeed = (v) => (v instanceof Ts ? new Ts(v.ms) : Array.isArray(v) ? v.map(cloneSeed) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cloneSeed(x)])) : v)

// A callable request as Firebase delivers it. verified=false models an unverified email; claims model custom claims in the ID token.
const req = (uid, data = {}, { verified = true, claims = {}, email } = {}) => ({
  auth: uid ? { uid, token: { email: email || `${uid}@example.com`, email_verified: verified, ...claims } } : undefined,
  data,
})
const anon = (data) => ({ auth: undefined, data })

async function rejects(promise, code, msgPart) {
  await assert.rejects(promise, (e) => {
    assert.equal(e.code, code, `expected ${code} but got ${e.code}: ${e.message}`)
    if (msgPart) assert.match(e.message, new RegExp(msgPart))
    return true
  })
}
const makeSuperAdmin = (env, uid, { active = true, role = "super_admin", claim = true } = {}) => {
  env.addUser(uid, claim ? { customClaims: { superAdmin: true } } : {})
  env.seed(`super-admin/${uid}`, { uid, email: `${uid}@example.com`, role, active, displayName: "SA" })
  return (data, opts = {}) => req(uid, data, { claims: claim ? { superAdmin: true } : {}, ...opts })
}
const makeOrg = (env, orgId, { type = "restaurant", approved = true, name = "Org" } = {}) =>
  env.seed(`organisations/${orgId}`, { name, organisationType: type, description: "", ownerUid: null, verificationStatus: "verified", approvalStatus: approved ? "approved" : "suspended", active: approved, contact: {} })
const addMember = (env, orgId, uid, role, { active = true } = {}) => {
  env.addUser(uid)
  env.seed(`organisation-members/${orgId}_${uid}`, { organisationId: orgId, userId: uid, displayName: uid, role, permissions: permissionsForRole(role), active, status: active ? "active" : "removed" })
}
module.exports = { setup, req, anon, rejects, makeSuperAdmin, makeOrg, addMember, T0, Ts }
