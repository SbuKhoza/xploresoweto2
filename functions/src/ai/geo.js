"use strict"
// Straight-line ("as the crow flies") distance only. NEVER presented as driving distance or travel time.
const DISTANCE_NOTE = "Approximate straight-line distance, not driving distance or travel time."
const validCoords = (c) => c && typeof c.latitude === "number" && typeof c.longitude === "number" && Math.abs(c.latitude) <= 90 && Math.abs(c.longitude) <= 180
const readCoords = (doc) => {
  const c = doc && (doc.coordinates || doc.coords || doc.location)
  if (!c || typeof c !== "object") return null
  const lat = c.latitude ?? c.lat, lng = c.longitude ?? c.lng ?? c.lon
  const out = { latitude: typeof lat === "string" ? parseFloat(lat) : lat, longitude: typeof lng === "string" ? parseFloat(lng) : lng }
  return validCoords(out) ? out : null
}
function haversineKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}
const approxKm = (a, b) => Math.round(haversineKm(a, b) * 10) / 10
module.exports = { DISTANCE_NOTE, validCoords, readCoords, haversineKm, approxKm }
