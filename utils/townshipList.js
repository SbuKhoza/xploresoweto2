// Soweto townships / areas a user can pick as their "kasi" during enrollment.
// Names only. Add or remove freely. Any township saved in Firestore
// (homescreen collection, type "township") is added to this list automatically.
export const SOWETO_KASIS = [
  "Braamfischerville",
  "Chiawelo",
  "Diepkloof",
  "Dlamini",
  "Dobsonville",
  "Thulani/Snakepark",
  "Dube",
  "Emndeni",
  "Jabavu",
  "Jabulani",
  "Kliptown",
  "Klipspruit",
  "Mapetla",
  "Meadowlands",
  "Mofolo",
  "Molapo",
  "Moletsane",
  "Moroka",
  "Naledi",
  "Noordgesig",
  "Orlando East",
  "Orlando West",
  "Phiri",
  "Pimville",
  "Power Park",
  "Protea Glen",
  "Protea North",
  "Protea South",
  "Rockville",
  "Senaoane",
  "Slovo Park",
  "Tladi",
  "White City",
  "Zola",
  "Zondi",
]

const norm = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()

/** Built-in kasis + any extra names (e.g. from Firestore), de-duplicated and sorted A–Z. */
export const getKasiOptions = (extraNames = []) => {
  const seen = new Set()
  const out = []
  ;[...SOWETO_KASIS, ...extraNames].forEach((n) => {
    const name = String(n || "").trim()
    const k = norm(name)
    if (!k || seen.has(k)) return
    seen.add(k)
    out.push(name)
  })
  return out.sort((a, b) => a.localeCompare(b))
}