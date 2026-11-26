"use strict"
// Well-known Soweto streets and landmarks, for RECOGNITION ONLY: so "vilakazi st", "Vilakazi Street" and "vilakasi" are understood as one
// destination. This file holds names and spellings, never facts: everything Malloya says about a place still comes from stored records.
// To add one, add a row. `words` are the lower-case distinctive words used to match a stored record's name/address/description.
const LANDMARKS = [
  { name: "Vilakazi Street", words: ["vilakazi"], aliases: ["vilakazi street", "vilakazi"] },
  { name: "Orlando Towers", words: ["orlando", "towers"], aliases: ["orlando towers"] },
  { name: "Walter Sisulu Square", words: ["sisulu"], aliases: ["walter sisulu square", "sisulu square", "kliptown square"] },
  { name: "Maponya Mall", words: ["maponya"], aliases: ["maponya mall", "maponya"] },
  { name: "FNB Stadium", words: ["fnb", "stadium"], aliases: ["fnb stadium", "soccer city"] },
]
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()
const landmarkWords = () => LANDMARKS.flatMap((l) => [...l.words, ...l.aliases.flatMap((a) => a.split(" "))]).filter((w) => w.length >= 6)
// -> canonical names found in already-cleaned text (abbreviations expanded, spelling repaired)
function findLandmarks(text) {
  const padded = ` ${norm(text)} `
  return LANDMARKS.filter((l) => l.aliases.some((a) => padded.includes(` ${a} `))).map((l) => l.name)
}
const termsFor = (placeName) => { const l = LANDMARKS.find((x) => x.name.toLowerCase() === String(placeName).toLowerCase()); return l ? l.words : null }
module.exports = { LANDMARKS, findLandmarks, termsFor, landmarkWords }
