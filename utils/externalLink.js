// Optional external website links on News and Events (CMS field `externalUrl`).
// Re-validated here even though the CMS validates on save (documents can be edited elsewhere): only absolute http(s) addresses are ever opened.
// Nothing is generated or guessed from titles; nothing opens without an explicit tap; the page opens in the device browser.
import { Alert, Linking } from "react-native"

const MAX_LENGTH = 2048

/** The address to open, or "" when the value is missing or not a safe absolute http(s) URL. Never throws. */
export const toExternalUrl = (raw) => {
  try {
    if (typeof raw !== "string") return ""
    const value = raw.trim()
    if (!value || value.length > MAX_LENGTH) return ""
    if (/\s/.test(value) || [...value].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) return ""
    if (!/^https?:\/\/[^/?#\s]+/i.test(value)) return ""
    const u = new URL(value)
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname || u.username || u.password) return ""
    if (u.hostname !== "localhost" && !u.hostname.includes(".") && !u.hostname.includes(":")) return ""
    return value
  } catch { return "" }
}

/** Opens the page in the external browser after validating it again. Resolves true when the browser was asked to open it. */
export const openExternalUrl = async (raw) => {
  const url = toExternalUrl(raw)
  if (!url) { Alert.alert("Link unavailable", "This link can't be opened."); return false }
  try {
    await Linking.openURL(url)
    return true
  } catch {
    Alert.alert("Couldn't open the link", "No browser was available to open this page. Please try again later.")
    return false
  }
}
