"use strict"
// Provider abstraction. A provider is `{ name, generate(request) -> response }` where
//   request  = { model, system:[{text, cache?}], messages, tools:[{name, description, inputSchema}], maxTokens, effort, timeoutMs, signal }
//   messages = { role, content:string } | { role:'assistant', raw } (replayed unchanged) | { role:'user', toolResults:[{toolUseId, content, isError}] }
//   response = { text, toolCalls:[{id,name,input}], stopReason:'end'|'tool_use'|'max_tokens'|'refusal'|'pause'|'other',
//                usage:{inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens}, assistantMessage, model, providerRequestId }
//   errors   = ProviderError (kind, retryable), never a vendor class
// Adding another provider = one new adapter file + one line in `factories`; nothing else in the app changes.
const { ProviderError } = require("../errors")
const { createAnthropicProvider } = require("./anthropic")

let override = null
const cached = {}
const factories = {
  anthropic: () => createAnthropicProvider({ apiKey: require("../secrets").ANTHROPIC_API_KEY.value() }),
}
function getProvider(name) {
  if (override) return override
  if (!factories[name]) throw new ProviderError("not_configured", `unknown provider ${name}`)
  return (cached[name] = cached[name] || factories[name]())
}
const setProviderForTests = (p) => { override = p }
module.exports = { getProvider, setProviderForTests }
