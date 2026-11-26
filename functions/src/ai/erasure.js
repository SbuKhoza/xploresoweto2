"use strict"
// The AI account-erasure lifecycle. Two DIFFERENT operations, deliberately separate:
//   * deleting conversations (conversations.js: one, or all history) touches conversations and messages ONLY. It keeps the user's learning
//     opt-out, their Luna notice choice and their usage counters.
//   * erasing the user's AI data (this file) additionally removes: the Luna notice record, learning throttle/de-duplication records, any
//     registered personal-memory store, and (only when the account itself is being closed) the learning opt-out flag.
// NEVER erased, by design (financial and abuse safeguards): the per-user daily usage counters (`ai-usage`) and Luna's request/budget records
// (`luna_u_*`, `luna_g_*`, `luna_r_*`). They hold counts and hashes, no message text; removing them would let someone reset their daily
// limit by erasing, and would break the idempotency that stops a request being billed twice. Anonymous learning candidates are aggregates with
// no identifier and cannot be withdrawn individually.
const fb = require("../lib/firebase")
const conv = require("./conversations")
const learning = require("./learning/store")
const { AI_COL } = require("./constants")

// Future personal memory registers itself here (name, async (uid) => count). Erasure then covers it without further changes. None exists today:
// no permanent personal memory is implemented.
const erasers = new Map()
const registerEraser = (name, fn) => { if (typeof name !== "string" || typeof fn !== "function") throw new Error("invalid-eraser"); erasers.set(name, fn) }

async function eraseAiAccountData(uid, { accountClosed = false } = {}) {
  const out = { conversations: (await conv.deleteAllForUser(uid)).conversations }
  await fb.db().collection(AI_COL.consent).doc(uid).delete()
  out.learning = await learning.eraseUser(uid, { accountClosed })
  out.memory = {}
  for (const [name, fn] of erasers) out.memory[name] = await fn(uid)
  return out
}
module.exports = { eraseAiAccountData, registerEraser }
