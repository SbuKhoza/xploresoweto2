"use strict"
// Read-only audit and dry-run-first repair: pure logic against an in-memory fake Firestore, plus guards that stop BEFORE any network access.
const test = require("node:test"), assert = require("node:assert/strict")
const fs = require("fs"), path = require("path")
const { spawnSync } = require("child_process")
const A = require("../scripts/lib/listing_audit")
const SCRIPTS = path.join(__dirname, "..", "scripts")

function fakeDb(seed) {
  const cols = JSON.parse(JSON.stringify(seed)); const log = { gets: 0, updates: [], sets: 0, deletes: 0 }
  const ref = (c, id) => ({ c, id, path: `${c}/${id}` })
  const snap = (c, id) => ({ exists: !!(cols[c] || {})[id], id, data: () => (cols[c] || {})[id] })
  return {
    cols, log,
    collection: (c) => ({ get: async () => { log.gets += 1; return { docs: Object.keys(cols[c] || {}).map((id) => snap(c, id)) } }, doc: (id) => ref(c, id) }),
    runTransaction: async (fn) => fn({ get: async (r) => snap(r.c, r.id), update: (r, patch) => { log.updates.push([r.path, patch]); Object.assign(cols[r.c][r.id], patch) }, set: () => { log.sets += 1 }, delete: () => { log.deletes += 1 } }),
  }
}
const seed = () => ({
  restaurants: {
    a: { name: "A", isSample: true, hours: "9-5", images: ["https://x/y.jpg"] },
    b: { name: "B", synthetic: true, tags: null, specialDishes: "kota", images: [null, "junk"], coordinates: { latitude: "x" } },
    mine: { name: "Created by staff", images: undefined }, // not sample-marked: never repaired
  },
  business: { c: { name: "C", isSample: true, services: [{ name: "Wi-Fi", icon: "wifi" }], images: [] } },
  transport: { t: { routeName: "R", isSample: true, departures: ["06:00"], stops: ["A", "B"] }, u: { routeName: "U", isSample: true } },
})

test("auditDoc: finds missing, null, wrong-type and invalid entries without echoing values", () => {
  const f = A.auditDoc("restaurants", seed().restaurants.b)
  const codes = Object.fromEntries(f.map((x) => [x.field, x.code]))
  assert.equal(codes.tags, "null-list"); assert.equal(codes.specialDishes, "wrong-type-list"); assert.equal(codes.images, "invalid-entries"); assert.equal(codes.coordinates, "bad-coordinates"); assert.equal(codes.tableOptions, "missing-list")
  assert.ok(!JSON.stringify(f).includes("kota") && !JSON.stringify(f).includes("junk"), "no document values in findings")
  assert.deepEqual(A.auditDoc("restaurants", "nope").map((x) => x.code), ["not-an-object"])
  assert.equal(A.auditDoc("transport", { routeName: "x" }).find((x) => x.field === "mode").repairable, false)
})
test("planRepair: adds only empty lists and the document's own hours text; never replaces or invents", () => {
  assert.deepEqual(A.planRepair("restaurants", seed().restaurants.a), { tags: [], specialDishes: [], tableOptions: [], openingHours: "9-5" })
  assert.deepEqual(A.planRepair("restaurants", seed().restaurants.b), { tags: [], tableOptions: [] }) // wrong-type / invalid entries are NOT touched
  assert.deepEqual(A.planRepair("business", seed().business.c), {})
  assert.deepEqual(A.planRepair("restaurants", { name: "x", openingHours: "keep", hours: "other", tags: [], specialDishes: [], tableOptions: [], images: [] }), {})
})
test("runAudit is read-only: only get() is used and nothing is written", async () => {
  const db = fakeDb(seed()); const before = JSON.stringify(db.cols)
  const r = await A.runAudit(db)
  assert.equal(JSON.stringify(db.cols), before); assert.deepEqual([db.log.updates.length, db.log.sets, db.log.deletes], [0, 0, 0])
  assert.ok(r.counts.documents >= 6 && r.counts.repairable >= 3 && r.counts.needReview >= 1)
  assert.ok(r.documents.every((d) => !("data" in d)))
})
test("dry run (buildPlan) writes nothing and ignores unmarked records", async () => {
  const db = fakeDb(seed()); const before = JSON.stringify(db.cols)
  const plan = await A.buildPlan(db)
  assert.equal(JSON.stringify(db.cols), before); assert.equal(db.log.updates.length, 0)
  assert.ok(!plan.rows.some((r) => r.path === "restaurants/mine"))
  assert.deepEqual(plan.rows.map((r) => r.path).sort(), ["restaurants/a", "restaurants/b", "transport/u"])
  assert.match(plan.hash, /^[0-9a-f]{64}$/)
})
test("apply refuses without the exact approved hash, and with a stale one", async () => {
  const db = fakeDb(seed())
  await assert.rejects(A.applyPlan(db, {}), /Approval does not match/)
  await assert.rejects(A.applyPlan(db, { approvedHash: "0".repeat(64) }), /Approval does not match/)
  assert.equal(db.log.updates.length, 0)
  const { hash } = await A.buildPlan(db)
  db.cols.restaurants.b.tags = ["edited"] // plan changed after approval → plan hash changes → refused
  await assert.rejects(A.applyPlan(db, { approvedHash: hash }), /Approval does not match/)
  assert.equal(db.log.updates.length, 0)
})
test("apply with the approved hash adds only missing fields, preserves values, and is idempotent", async () => {
  const db = fakeDb(seed()); const { hash } = await A.buildPlan(db)
  const r = await A.applyPlan(db, { approvedHash: hash })
  assert.ok(r.written >= 2 && r.fields >= 4)
  assert.equal(db.cols.restaurants.a.name, "A"); assert.deepEqual(db.cols.restaurants.a.images, ["https://x/y.jpg"]); assert.equal(db.cols.restaurants.a.openingHours, "9-5"); assert.equal(db.cols.restaurants.a.hours, "9-5")
  assert.equal(db.cols.restaurants.b.specialDishes, "kota"); assert.deepEqual(db.cols.restaurants.b.images, [null, "junk"])
  assert.equal("tags" in db.cols.restaurants.mine, false)
  assert.deepEqual([db.log.sets, db.log.deletes], [0, 0])
  const again = await A.buildPlan(db); assert.equal(again.rows.length, 0)
})
test("apply never overwrites a value that appears between the plan and the write", async () => {
  const db = fakeDb(seed()); const { hash } = await A.buildPlan(db)
  const orig = db.runTransaction
  db.runTransaction = async (fn) => { if (db.cols.restaurants.a && !db.cols.restaurants.a.tags) db.cols.restaurants.a.tags = ["added by staff"]; return orig(fn) }
  await A.applyPlan(db, { approvedHash: hash })
  assert.deepEqual(db.cols.restaurants.a.tags, ["added by staff"])
})
test("scripts: guards stop before any network access; production and unknown projects are refused", () => {
  const env = { ...process.env }; for (const k of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT", "GCP_PROJECT", "FIREBASE_CONFIG", "FIRESTORE_EMULATOR_HOST", "GOOGLE_APPLICATION_CREDENTIALS"]) delete env[k]
  const run = (s, a) => spawnSync(process.execPath, [path.join(SCRIPTS, s), ...a], { env, encoding: "utf8", timeout: 30000 })
  for (const s of ["audit-listings.js", "repair-listings.js"]) {
    for (const args of [[], ["--project", "xploresoweto"], ["--project", "xploresoweto", "--production", "--confirm-project", "xploresoweto"], ["--project", "other-project"]]) {
      const r = run(s, args); assert.notEqual(r.status, 0, `${s} ${args.join(" ")}`); assert.match(r.stderr, /ERROR/)
    }
  }
  const r = run("repair-listings.js", ["--project", "xploresoweto-staging", "--apply"]); assert.notEqual(r.status, 0); assert.match(r.stderr, /--approve-plan/)
})
test("static guards: audit has no write calls; repair is staging-only, dry-run by default, ADC only, no key files", () => {
  const audit = fs.readFileSync(path.join(SCRIPTS, "audit-listings.js"), "utf8") + fs.readFileSync(path.join(SCRIPTS, "lib", "listing_audit.js"), "utf8").split("async function applyPlan")[0]
  assert.doesNotMatch(audit, /\b(tx|batch|ref|doc)\.(set|update|delete|create)\(|\.(set|delete|create|add|batch|runTransaction)\(/)
  const rep = fs.readFileSync(path.join(SCRIPTS, "repair-listings.js"), "utf8")
  assert.match(rep, /never writes to production/); assert.match(rep, /--approve-plan/); assert.doesNotMatch(rep, /serviceAccount|credential\.cert|\.json["']/)
  assert.doesNotMatch(fs.readFileSync(path.join(SCRIPTS, "lib", "listing_audit.js"), "utf8"), /\.set\(|\.delete\(/)
})
