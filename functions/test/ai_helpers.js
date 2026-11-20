"use strict"
const { setup } = require("./helpers")
const cfgMod = require("../src/ai/config")
const log = require("../src/ai/log")

// Fresh in-memory Firebase + AI config without caching + captured logs
function setupAi() {
  const env = setup()
  cfgMod.setConfigCacheTtlForTests(0)
  env.logs = []
  log.setLogSinkForTests((e) => env.logs.push(e))
  return env
}
const usage = (o = {}) => ({ inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, ...o })
// A provider response in the neutral shape
const resp = (o = {}) => ({
  text: o.text || "", toolCalls: o.toolCalls || [], stopReason: o.stopReason || (o.toolCalls && o.toolCalls.length ? "tool_use" : "end"),
  rawStopReason: null, usage: usage(o.usage), assistantMessage: { role: "assistant", raw: [{ type: "text", text: o.text || "" }, ...(o.toolCalls || []).map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input }))] },
  model: o.model || "claude-haiku-5-5", providerRequestId: "req_test",
})
const toolCall = (name, input = {}, id) => ({ id: id || `tu_${name}`, name, input })
const answer = (blocks, extra = {}, o = {}) => resp({ ...o, text: JSON.stringify({ language: "en", blocks, cards: [], mentions: [], followUps: [], ...extra }) })
// Scripted provider: each call consumes the next step (a response, an Error to throw, or a function(req, n)); the last step repeats.
function scripted(steps) {
  const calls = []
  let i = 0
  return { name: "fake", calls, async generate(req) {
    calls.push(JSON.parse(JSON.stringify(req)))
    const step = steps[Math.min(i++, steps.length - 1)]
    const r = typeof step === "function" ? step(req, calls.length) : step
    if (r instanceof Error) throw r
    return r
  } }
}
module.exports = { setupAi, resp, answer, toolCall, scripted, usage }
