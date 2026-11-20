"use strict"
// Cost = tokens x (USD per million tokens) = micro-USD, exactly. Prices come from config (verified table, runtime-overridable).
function priceFor(model, promptTokens, cfg) {
  const m = cfg.pricing.models[model]
  if (!m) return cfg.pricing.fallback // unknown model: assume the expensive rates so the budget can only err on the safe side
  return m.long && promptTokens > m.long.thresholdTokens ? m.long : m
}
function costMicros(model, usage, cfg) {
  const i = usage.inputTokens || 0, o = usage.outputTokens || 0, cw = usage.cacheWriteTokens || 0, cr = usage.cacheReadTokens || 0
  const p = priceFor(model, i + cw + cr, cfg)
  return Math.ceil(i * p.inputPerMTok + o * p.outputPerMTok + cw * p.cacheWritePerMTok + cr * p.cacheReadPerMTok)
}
// Worst case for one chat turn, used to RESERVE budget before calling the provider (released/settled afterwards).
// Every loop iteration re-sends the whole prompt, and tool results accumulate, so input grows each iteration.
function estimateWorstCaseMicros({ model, baseChars, maxOutputTokens, iterations, toolResultMaxChars }, cfg) {
  const base = Math.ceil(baseChars / 2.5), tool = Math.ceil(toolResultMaxChars / 2.5)
  const inputTokens = iterations * base + (tool * iterations * (iterations - 1)) / 2
  const p = priceFor(model, base + tool * iterations, cfg)
  return Math.ceil(inputTokens * p.inputPerMTok + iterations * maxOutputTokens * p.outputPerMTok)
}
const addUsage = (a, b) => ({ inputTokens: a.inputTokens + (b.inputTokens || 0), outputTokens: a.outputTokens + (b.outputTokens || 0), cacheReadTokens: a.cacheReadTokens + (b.cacheReadTokens || 0), cacheWriteTokens: a.cacheWriteTokens + (b.cacheWriteTokens || 0) })
const zeroUsage = () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
module.exports = { priceFor, costMicros, estimateWorstCaseMicros, addUsage, zeroUsage }
