"use strict"
const { setup } = require("./helpers")
const cfgMod = require("../src/ai/config")
const log = require("../src/ai/log")

// Fresh in-memory Firebase + AI config without caching + captured logs. No network, no emulator, no production connection.
function setupAi() {
  const env = setup()
  cfgMod.setConfigCacheTtlForTests(0)
  env.logs = []
  log.setLogSinkForTests((e) => env.logs.push(e))
  return env
}
module.exports = { setupAi }
