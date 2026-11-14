"use strict"
// In-memory stand-in for the parts of firebase-admin the functions use. It models the behaviours that matter for correctness:
// optimistic-concurrency transactions (retry on conflict), reads-before-writes, create() on existing docs failing, update() on
// missing docs failing, FieldValue sentinels, and equality queries. It is NOT the Firebase emulator and does not run Security Rules.
const clock = require("../src/lib/clock")

class Ts {
  constructor(ms) { this.ms = ms }
  toMillis() { return this.ms }
  toDate() { return new Date(this.ms) }
  static fromMillis(ms) { return new Ts(ms) }
  static fromDate(d) { return new Ts(d.getTime()) }
}
const SERVER = { __fv: "serverTimestamp" }
const DELETE = { __fv: "delete" }
const FieldValue = { serverTimestamp: () => SERVER, delete: () => DELETE }

const clone = (v) => {
  if (v instanceof Ts) return new Ts(v.ms)
  if (Array.isArray(v)) return v.map(clone)
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]))
  return v
}
const eq = (a, b) => (a instanceof Ts && b instanceof Ts ? a.ms === b.ms : a === b)
const nowTs = () => new Ts(clock.now().getTime())
const resolveValue = (v) => (v === SERVER ? nowTs() : v && typeof v === "object" && !(v instanceof Ts) && !Array.isArray(v) ? resolveObject(v) : Array.isArray(v) ? v.map(resolveValue) : v)
const resolveObject = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== DELETE).map(([k, x]) => [k, resolveValue(x)]))
const assertNoUndefined = (o, p = "") => {
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) throw new Error(`Firestore would reject undefined at ${p}${k}`)
    if (v && typeof v === "object" && !(v instanceof Ts) && v !== SERVER && v !== DELETE) assertNoUndefined(Array.isArray(v) ? Object.fromEntries(v.map((x, i) => [i, x])) : v, `${p}${k}.`)
  }
}

class FakeFirestore {
  constructor() { this.store = new Map(); this.ver = new Map(); this.colVer = new Map(); this.seq = 0 }
  collection(name) { return new Col(this, name) }
  batch() { return new Batch(this) }
  _read(path) { const d = this.store.get(path); return d ? clone(d) : undefined }
  _version(path) { return this.ver.get(path) || 0 }
  _bump(path) { this.ver.set(path, this._version(path) + 1); const c = path.split("/")[0]; this.colVer.set(c, (this.colVer.get(c) || 0) + 1) }
  _write(op) {
    const { type, path, data } = op
    const cur = this.store.get(path)
    if (type === "create") { if (cur) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 }); }
    if (type === "update" && !cur) throw Object.assign(new Error(`NOT_FOUND: ${path}`), { code: 5 })
    if (type === "delete") { this.store.delete(path); this._bump(path); return }
    assertNoUndefined(data)
    if (type === "set" || type === "create") this.store.set(path, clone(resolveObject(data)))
    else {
      const next = clone(cur)
      for (const [k, v] of Object.entries(data)) { if (v === DELETE) delete next[k]; else next[k] = resolveValue(v) }
      this.store.set(path, next)
    }
    this._bump(path)
  }
  _list(col) { return [...this.store.keys()].filter((p) => p.startsWith(`${col}/`) && p.split("/").length === 2) }
  async runTransaction(fn) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const tx = new Tx(this)
      const result = await fn(tx)
      if (tx.conflict()) continue // someone else committed to something we read: retry like Firestore does
      tx.ops.forEach((op) => this._write(op))
      return result
    }
    throw Object.assign(new Error("ABORTED: too much contention"), { code: 10 })
  }
}
class Col {
  constructor(db, name) { this.db = db; this.name = name }
  doc(id) { return new DocRef(this.db, this.name, id || `auto${++this.db.seq}`) }
  where(f, op, v) { return new Query(this.db, this.name, []).where(f, op, v) }
  limit(n) { return new Query(this.db, this.name, []).limit(n) }
  get() { return new Query(this.db, this.name, []).get() }
}
class DocRef {
  constructor(db, col, id) { this.db = db; this.col = col; this.id = id; this.path = `${col}/${id}` }
  async get() { const d = this.db._read(this.path); return new DocSnap(this, d) }
  async set(data) { this.db._write({ type: "set", path: this.path, data }) }
  async update(data) { this.db._write({ type: "update", path: this.path, data }) }
}
class DocSnap { constructor(ref, d) { this.ref = ref; this.id = ref.id; this.exists = d !== undefined; this._d = d } data() { return this._d ? clone(this._d) : undefined } }
class Query {
  constructor(db, col, filters, lim) { this.db = db; this.col = col; this.filters = filters; this.lim = lim }
  where(f, op, v) { if (op !== "==") throw new Error(`fake supports == only (got ${op})`); return new Query(this.db, this.col, [...this.filters, [f, v]], this.lim) }
  limit(n) { return new Query(this.db, this.col, this.filters, n) }
  async get() {
    let paths = this.db._list(this.col).filter((p) => { const d = this.db.store.get(p); return this.filters.every(([f, v]) => eq(d[f], v)) })
    if (this.lim) paths = paths.slice(0, this.lim)
    return new QuerySnap(paths.map((p) => new DocSnap(new DocRef(this.db, this.col, p.split("/")[1]), this.db._read(p))))
  }
}
class QuerySnap { constructor(docs) { this.docs = docs; this.size = docs.length; this.empty = docs.length === 0 } forEach(fn) { this.docs.forEach(fn) } }
class Tx {
  constructor(db) { this.db = db; this.ops = []; this.reads = []; this.colReads = [] }
  async get(refOrQuery) {
    if (this.ops.length) throw new Error("Firestore transactions require all reads to be executed before all writes")
    if (refOrQuery instanceof DocRef) { this.reads.push([refOrQuery.path, this.db._version(refOrQuery.path)]); return refOrQuery.get() }
    this.colReads.push([refOrQuery.col, this.db.colVer.get(refOrQuery.col) || 0])
    return refOrQuery.get()
  }
  set(ref, data) { this.ops.push({ type: "set", path: ref.path, data }); return this }
  create(ref, data) { this.ops.push({ type: "create", path: ref.path, data }); return this }
  update(ref, data) { this.ops.push({ type: "update", path: ref.path, data }); return this }
  conflict() { return this.reads.some(([p, v]) => this.db._version(p) !== v) || this.colReads.some(([c, v]) => (this.db.colVer.get(c) || 0) !== v) }
}
class Batch {
  constructor(db) { this.db = db; this.ops = [] }
  set(ref, data) { this.ops.push({ type: "set", path: ref.path, data }); return this }
  update(ref, data) { this.ops.push({ type: "update", path: ref.path, data }); return this }
  async commit() { this.ops.forEach((op) => this.db._write(op)) }
}

class FakeAuth {
  constructor() { this.users = new Map(); this.revoked = [] }
  addUser(u) { this.users.set(u.uid, { customClaims: undefined, emailVerified: false, displayName: null, ...u }); return u.uid }
  async getUser(uid) { const u = this.users.get(uid); if (!u) throw Object.assign(new Error("no user"), { code: "auth/user-not-found" }); return { ...u } }
  async getUserByEmail(email) { const u = [...this.users.values()].find((x) => x.email === email); if (!u) throw Object.assign(new Error("no user"), { code: "auth/user-not-found" }); return { ...u } }
  async setCustomUserClaims(uid, claims) { this.users.get(uid).customClaims = claims || undefined }
  async revokeRefreshTokens(uid) { this.revoked.push(uid) }
}
class FakeBucket {
  constructor() { this.name = "xploresoweto.firebasestorage.app"; this.files = new Set(); this.copies = [] }
  put(path) { this.files.add(path); return this }
  file(path) { const b = this; return { path, async copy(dest) { if (!b.files.has(path)) throw new Error(`source missing: ${path}`); b.files.add(dest.path); b.copies.push([path, dest.path]) } } }
}
function makeFakeAdmin() {
  const db = new FakeFirestore(), auth = new FakeAuth(), bucket = new FakeBucket()
  const firestore = () => db
  firestore.FieldValue = FieldValue
  firestore.Timestamp = Ts
  return { admin: { firestore, auth: () => auth, storage: () => ({ bucket: () => bucket }), apps: [{}], initializeApp() {} }, db, auth, bucket }
}
module.exports = { makeFakeAdmin, Ts }
