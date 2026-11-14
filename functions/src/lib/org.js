"use strict"
const { ROLE_PERMISSIONS } = require("./constants")
const clock = require("./clock")
function permissionsForRole(role) {
  const p = ROLE_PERMISSIONS[role]
  if (!p) throw new Error(`Unknown organisation role: ${role}`)
  return [...p]
}
const isExpired = (ts) => !ts || typeof ts.toMillis !== "function" || ts.toMillis() <= clock.now().getTime()
module.exports = { permissionsForRole, isExpired }
