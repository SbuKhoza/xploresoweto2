"use strict"
// Audit entries are written in the SAME transaction/batch as the change they describe, and only when state actually
// changed (idempotent no-op retries return before reaching this), so retries never produce duplicate entries.
// Entries hold uids, organisation ids and role names only (no personal data) and are server-write-only.
const fb = require("./firebase")
const { COL } = require("./constants")

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
function entry({ action, actorUid, targetUid = null, organisationId = null, details = {} }) {
  return { action, actorUid, targetUid, organisationId, details: clean(details), at: fb.FieldValue().serverTimestamp() }
}
const ref = () => fb.db().collection(COL.audit).doc()
module.exports = {
  writeAudit: (writer, e) => writer.set(ref(), entry(e)), // writer: a transaction or a batch
}
