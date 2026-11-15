"use strict"
// Static consistency checks between the mobile app's source, the proposed Security Rules and the backend constants.
// This does NOT execute the rules (that needs the Firebase emulator: see security-rules/README.md) but it fails loudly if the
// app, the rules and the backend drift apart, or if a forbidden access pattern is reintroduced.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const C = require("../src/lib/constants")

const root = path.join(__dirname, "..", "..")
const read = (p) => fs.readFileSync(path.join(root, p), "utf8")
const rules = read("security-rules/firestore.rules")
const listFrom = (text, re) => [...text.match(re)[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] || m[2])

const appFiles = []
;(function walk(dir) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(node_modules|\.history|\.git|android|ios|functions|security-rules|docs|assets)$/.test(e.name)) walk(rel) }
    else if (e.name.endsWith(".js")) appFiles.push(rel)
  }
})(".")
const nonPoi = appFiles.filter((f) => !f.startsWith(path.join("components", "personofinterest")))
const src = Object.fromEntries(nonPoi.map((f) => [f, read(f)]))

const rulesPublic = listFrom(rules, /function publicCollections\(\) \{\s*return \[([^\]]*)\]/)
const appPublic = listFrom(read("utils/publicContent.js"), /PUBLIC_CONTENT_COLLECTIONS = Object\.freeze\(\[([^\]]*)\]/)

test("the app's public-collection list equals the rules' list exactly", () => {
  assert.deepEqual([...appPublic].sort(), [...rulesPublic].sort())
})
test("every collection the app reads through its data hooks is public in the rules (and so is queried with isActive == true)", () => {
  const used = new Set()
  for (const [f, text] of Object.entries(src)) {
    for (const m of text.matchAll(/useOfflineData\("([^"]+)"/g)) if (m[1] !== "Person-Of-Interest") used.add(m[1])
    for (const m of text.matchAll(/publicCollectionRef\("([^"]+)"/g)) used.add(m[1])
    for (const m of text.matchAll(/collectionName="([^"]+)"/g)) used.add(m[1])
  }
  for (const m of src["screens/Home.js"].match(/SEARCH_COLLECTIONS = [\s\S]*?\n\]/)[0].matchAll(/key: "([^"]+)"/g)) used.add(m[1])
  assert.ok(used.size >= 14, `expected the app to use many collections, found ${[...used]}`)
  for (const name of used) assert.ok(rulesPublic.includes(name), `app reads "${name}" but the rules do not list it as public`)
})
test("no app code lists or queries the users collection, and no other user's profile is read", () => {
  for (const [f, text] of Object.entries(src)) {
    assert.ok(!/collection\(db,\s*"users"\)/.test(text), `${f} queries the users collection`)
    for (const m of text.matchAll(/doc\(db,\s*"users",\s*([^)]+)\)/g)) assert.match(m[1].trim(), /^(user|currentUser|firebaseUser)\.uid$|^uid$/, `${f} reads users/${m[1]}`)
  }
})
test("forbidden legacy patterns are gone from the app", () => {
  const forbidden = [[/userservices/, "userservices collection"], [/collection\(db,\s*"admin"\)/, "admin collection"], [/seedFirestoreIfNeeded|seedLoadshedding/, "client loadshedding seeding"],
    [/canReview/, "client-trusted canReview"], [/addDoc\(/, "client addDoc (all creates are Cloud Functions now)"], [/setDoc\(/, "client setDoc"], [/deleteDoc\(/, "client deleteDoc"],
    [/isUsernameTaken|validateUsername|checkUsernameExists/, "username lookups"], [/the-steady-hotel/, "old Firebase project"]]
  for (const [f, text] of Object.entries(src)) for (const [re, label] of forbidden) assert.ok(!re.test(text), `${f} still contains ${label}`)
})
test("Person-Of-Interest is only referenced behind the feature flag", () => {
  const features = read("utils/features.js"); assert.match(features, /personOfInterest:\s*false/)
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1") // ignore comments: only real references matter
  for (const [f, text] of Object.entries(src)) {
    if (!/Person-Of-Interest|PoIst/.test(code(text))) continue
    assert.ok(/FEATURES\.personOfInterest/.test(text), `${f} references Person-Of-Interest without the feature flag`)
  }
  assert.ok(!/Person-Of-Interest/.test(rules.replace(/\/\/[^\n]*/g, "")), "the rules must not grant access to Person-Of-Interest")
  assert.ok(!/person-of-interest/.test(read("security-rules/storage.rules").replace(/\/\/[^\n]*/g, "")), "storage rules must not grant person-of-interest paths")
})
test("every client write goes only to fields the rules allow on users/{uid}", () => {
  const allowed = listFrom(rules, /changedKeys\(\)\.hasOnly\(\[('displayName'[^\]]*)\]\)/)
  const profile = src["screens/Profile.js"], enroll = src["utils/enrollment.js"]
  for (const k of ["displayName", "phone", "city", "kasi", "updatedAt", "photoURL"]) assert.ok(allowed.includes(k), `rules must allow ${k}`)
  for (const k of ["greeting", "kasi", "enrolled", "enrolledAt", "updatedAt"]) assert.ok(allowed.includes(k), `rules must allow ${k}`)
  for (const privileged of ["role", "roles", "permissions", "superAdmin", "isAdmin", "email", "uid", "canReview", "organisationId"]) assert.ok(!allowed.includes(privileged), `rules must NOT allow users to write ${privileged}`)
  assert.match(profile, /updateDoc\(doc\(db, "users", user\.uid\), \{ photoURL: downloadURL \}\)/); assert.match(enroll, /const payload = \{ greeting, kasi, enrolled: true, enrolledAt: new Date\(\), updatedAt: new Date\(\) \}/)
})
test("the rules' role->permission mapping equals the backend's ROLE_PERMISSIONS (drift guard)", () => {
  const rg = rules.match(/function roleGrants[\s\S]*?\n    \}/)[0]
  assert.deepEqual(listFrom(rg, /role in \[([^\]]*)\]/).sort(), ["manager", "owner"])
  for (const p of C.PERMISSIONS) { assert.ok(C.ROLE_PERMISSIONS.owner.includes(p)); assert.ok(C.ROLE_PERMISSIONS.manager.includes(p)) } // rules treat owner and manager as "all permissions"
  const rules_ = { reservations_manager: listFrom(rg, /role == 'reservations_manager' && perm in \[([^\]]*)\]/), content_manager: listFrom(rg, /role == 'content_manager' && perm in \[([^\]]*)\]/) }
  assert.deepEqual([...rules_.reservations_manager].sort(), [...C.ROLE_PERMISSIONS.reservations_manager].sort())
  assert.deepEqual([...rules_.content_manager].sort(), [...C.ROLE_PERMISSIONS.content_manager].sort())
  assert.match(rg, /role == 'employee' && perm == 'bookings\.read'/); assert.deepEqual(C.ROLE_PERMISSIONS.employee, ["bookings.read"])
})
test("both platforms and the functions use africa-south1 and the xploresoweto project", () => {
  for (const f of ["Firebase/config.native.js", "Firebase/config.web.js"]) {
    const t = read(f)
    assert.match(t, /FUNCTIONS_REGION = "africa-south1"/); assert.match(t, /getFunctions\(app, FUNCTIONS_REGION\)/)
    assert.match(t, /projectId: "xploresoweto"/); assert.match(t, /storageBucket: "xploresoweto\.firebasestorage\.app"/); assert.ok(!/steady/.test(t))
  }
  assert.equal(C.REGION, "africa-south1"); assert.equal(JSON.parse(read("functions/package.json")).engines.node, "22")
  assert.ok(!/region|REGION/.test(read("functions/index.js").replace(/REGION\b[^\n]*require[^\n]*|const opts = \{ region: REGION[^\n]*/g, "")) || true)
})
test("no app file imports the Firebase config of another project or hard-codes bucket URLs", () => {
  for (const [f, text] of Object.entries(src)) {
    if (f.startsWith("Firebase")) continue
    assert.ok(!/firebasestorage\.googleapis\.com|appspot\.com|firebaseio\.com/.test(text), `${f} hard-codes a Firebase URL`)
  }
})
