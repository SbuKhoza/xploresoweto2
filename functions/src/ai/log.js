"use strict"
// Structured logging that CANNOT carry message content: only allow-listed scalar fields are emitted. User ids are hashed.
const logger = require("firebase-functions/logger")
const { sha256hex } = require("../lib/crypto")
const ALLOWED = new Set(["requestId", "uidHash", "purpose", "model", "iterations", "toolCalls", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "costMicros", "latencyMs", "outcome", "code", "kind", "flags", "problems", "fraction", "threshold", "spentMicros", "reservedMicros", "retryable", "status", "attempt", "tool", "count", "providerRequestId"])
let sink = null
const setLogSinkForTests = (fn) => { sink = fn }
const uidHash = (uid) => sha256hex(`uid:${uid}`).slice(0, 12)
const clean = (fields = {}) => Object.fromEntries(Object.entries(fields).filter(([k, v]) => ALLOWED.has(k) && (v === null || ["string", "number", "boolean"].includes(typeof v) || (Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number")))).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 120) : v]))
const emit = (level) => (event, fields) => { const f = clean(fields); if (sink) sink({ level, event, ...f }); else logger[level](event, f) }
module.exports = { info: emit("info"), warn: emit("warn"), error: emit("error"), uidHash, setLogSinkForTests }
