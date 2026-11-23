"use strict"
// Luna calibration. YOU run this locally, with the key in YOUR environment. It is never run by tests, CI or Claude.
//   PowerShell:  $env:OPENAI_API_KEY = Read-Host "OpenAI key"   (then)   npm run luna:calibrate
//   Offline:     npm run luna:hashes      (refreshes hashes after a template/instruction change; sets status "uncalibrated"; makes NO network call)
// What it does: sends each fixed payload ONCE (about 3 paid calls in total, the third only if "none" reasoning is refused), records the input-token
// count the API reports for each, picks the reasoning effort ("none", else "low"), and writes src/ai/luna/calibration.json.
// Until every payload has a measured count within the 3,000-token limit, the backend skips Luna and Malloya answers deterministically.
// It prints token counts and verdicts only: never the key, never full responses.
const fs = require("node:fs")
const path = require("node:path")
const prompt = require("../src/ai/luna/prompt")
const provider = require("../src/ai/luna/provider")
const { validateRewrite } = require("../src/ai/luna/validate")
const { MODEL, CEILINGS } = require("../src/ai/luna/constants")

const MANIFEST = path.join(__dirname, "..", "src", "ai", "luna", "calibration.json")
const NOTE = "Run `npm run luna:calibrate` (needs OPENAI_API_KEY in your local environment; makes about 3 paid calls). Until every payload has inputTokens, Luna is skipped and Malloya answers deterministically."

function manifestFrom(payloads, measured, effort) {
  return { status: measured ? "calibrated" : "uncalibrated", model: MODEL, reasoningEffort: measured ? effort : null, calibratedAt: measured ? new Date().toISOString() : null, note: NOTE,
    payloads: Object.fromEntries(payloads.map((p) => [p.id, { sha256: p.sha256, inputTokens: measured ? measured[p.id] : null }])) }
}
async function calibrate({ call = provider.callResponses, write = (m) => fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + "\n"), out = console.log, hashesOnly = false } = {}) {
  const payloads = prompt.allPayloads()
  if (hashesOnly) { write(manifestFrom(payloads, null)); out(`hashes refreshed for ${payloads.length} payloads; status is now "uncalibrated" (Luna stays off until you run the paid calibration)`); return { ok: true, calls: 0 } }
  let effort = "none", calls = 0; const measured = {}
  for (const p of payloads) {
    let res = (calls++, await call({ payload: p, maxOutputTokens: CEILINGS.maxOutputTokens, reasoningEffort: effort, timeoutMs: 20000 }))
    if (!res.ok && res.kind === "bad_request" && effort === "none" && Object.keys(measured).length === 0) { out('reasoning "none" was refused for this model; trying "low" once'); effort = "low"; res = (calls++, await call({ payload: p, maxOutputTokens: CEILINGS.maxOutputTokens, reasoningEffort: effort, timeoutMs: 20000 })) }
    if (!res.ok) { out(`FAILED for ${p.id}: ${res.kind}. Nothing was written.`); return { ok: false, calls } }
    if (!res.usage || !Number.isInteger(res.usage.input) || res.usage.input <= 0) { out(`FAILED for ${p.id}: the API reported no input-token usage. Nothing was written.`); return { ok: false, calls } }
    if (res.usage.input > CEILINGS.maxInputTokens) { out(`FAILED for ${p.id}: ${res.usage.input} input tokens exceeds the ${CEILINGS.maxInputTokens} limit. Nothing was written.`); return { ok: false, calls } }
    const verdict = validateRewrite(prompt.TEMPLATES[p.templateId], res.text)
    measured[p.id] = res.usage.input
    out(`${p.id}: input=${res.usage.input} output=${res.usage.output} cached=${res.usage.cached} reasoning=${res.usage.reasoning} effort=${effort} validator=${verdict.ok ? "accepted" : "refused:" + verdict.reason}`)
  }
  write(manifestFrom(payloads, measured, effort)); out(`calibrated ${payloads.length} payloads with ${calls} call(s); reasoning effort "${effort}". Review and commit src/ai/luna/calibration.json.`)
  return { ok: true, calls }
}
module.exports = { calibrate, manifestFrom }

if (require.main === module) {
  const hashesOnly = process.argv.includes("--hashes-only")
  if (!hashesOnly && !provider.hasKey()) { console.error("OPENAI_API_KEY is not set in this shell. Nothing was sent."); process.exit(2) }
  calibrate({ hashesOnly }).then((r) => process.exit(r.ok ? 0 : 1)).catch(() => { console.error("calibration failed unexpectedly. Nothing was written."); process.exit(1) })
}
