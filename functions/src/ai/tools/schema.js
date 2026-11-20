"use strict"
// Minimal strict argument validation for tool inputs. The model's arguments are untrusted input: unknown keys are rejected,
// every value is type- and range-checked, and collection names can only be chosen from an enum. There is no free-form query,
// filter object or path argument anywhere, so the model cannot express an arbitrary database query.
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
function validateArgs(schema, input) {
  const src = input === undefined || input === null ? {} : input
  if (!isObj(src)) throw new Error("arguments must be an object")
  for (const k of Object.keys(src)) if (!Object.prototype.hasOwnProperty.call(schema, k)) throw new Error(`unknown argument "${k}"`)
  const out = {}
  for (const [name, f] of Object.entries(schema)) {
    const v = src[name]
    if (v === undefined || v === null) { if (f.required) throw new Error(`"${name}" is required`); continue }
    switch (f.type) {
      case "string":
        if (typeof v !== "string") throw new Error(`"${name}" must be text`)
        if (v.length > (f.max || 100)) throw new Error(`"${name}" is too long`)
        if (f.min && v.trim().length < f.min) throw new Error(`"${name}" is too short`)
        if (f.enum && !f.enum.includes(v)) throw new Error(`"${name}" must be one of: ${f.enum.join(", ")}`)
        if (f.pattern && !f.pattern.test(v)) throw new Error(`"${name}" has an invalid format`)
        out[name] = v.trim(); break
      case "integer": case "number":
        if (typeof v !== "number" || !Number.isFinite(v) || (f.type === "integer" && !Number.isInteger(v))) throw new Error(`"${name}" must be a ${f.type}`)
        if ((f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max)) throw new Error(`"${name}" is out of range`)
        out[name] = v; break
      case "boolean":
        if (typeof v !== "boolean") throw new Error(`"${name}" must be true or false`)
        out[name] = v; break
      case "stringArray":
        if (!Array.isArray(v) || v.length > (f.maxItems || 5) || v.some((x) => typeof x !== "string" || x.length > (f.itemMax || 40))) throw new Error(`"${name}" must be a short list of short text`)
        out[name] = v.map((x) => x.trim()).filter(Boolean); break
      default: throw new Error(`unsupported schema type for "${name}"`)
    }
  }
  return out
}
function toJsonSchema(schema) {
  const properties = {}, required = []
  for (const [name, f] of Object.entries(schema)) {
    const p = f.type === "stringArray" ? { type: "array", items: { type: "string", maxLength: f.itemMax || 40 }, maxItems: f.maxItems || 5 } : { type: f.type === "integer" ? "integer" : f.type }
    if (f.type === "string") { p.maxLength = f.max || 100; if (f.enum) p.enum = f.enum }
    if (f.min !== undefined && f.type !== "string") p.minimum = f.min
    if (f.max !== undefined && f.type !== "string") p.maximum = f.max
    if (f.description) p.description = f.description
    properties[name] = p
    if (f.required) required.push(name)
  }
  return { type: "object", properties, required, additionalProperties: false }
}
module.exports = { validateArgs, toJsonSchema }
