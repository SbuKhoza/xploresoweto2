"use strict"
const { randomBytes, createHash, timingSafeEqual } = require("node:crypto")
const sha256hex = (s) => createHash("sha256").update(String(s)).digest("hex")
const newToken = () => randomBytes(32).toString("base64url") // 256 bits of entropy
const safeEqualHex = (a, b) => {
  const x = Buffer.from(String(a), "hex"), y = Buffer.from(String(b), "hex")
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y)
}
module.exports = { sha256hex, newToken, safeEqualHex }
