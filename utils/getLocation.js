// utils/getLocation.js
//
// Works on phones WITHOUT Google Play services (e.g. Huawei Nova 9 SE and other HMS-only devices).
//
// expo-location's classic API (getCurrentPositionAsync / getLastKnownPositionAsync) is Google-only on
// Android and fails there with "LocationServices.API is not available". Since SDK 58 expo-location also
// ships a "next" API whose default provider is Google → Android LocationManager (no Google needed).
// That needs the native module `LocationModuleNext`, which only exists in a build made AFTER
// expo-location ~58 was installed — so after updating run:   npx expo run:android
//
// Strategy: use "next" when the installed native app has it, otherwise the classic API.
// If neither works we return null and the screen falls back to typing a suburb.
import * as Location from "expo-location"
import { requireOptionalNativeModule } from "expo"

let gmsUnavailable = false // classic API proved unusable on this device
let warnedRebuild = false

// null-safe check (does not log an error when the module is absent, unlike requiring expo-location/next)
const nextAvailable = () => {
  try {
    return !!requireOptionalNativeModule("LocationModuleNext")
  } catch {
    return false
  }
}

/** Ask for "while using the app" location permission. */
export const requestLocationPermission = async () => {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== "granted") {
      console.log("Permission to access location was denied")
      return false
    }
    return true
  } catch (e) {
    console.warn("Location permission request failed:", e?.message || e)
    return false
  }
}

const isGmsError = (e) =>
  /LocationServices\.API|SERVICE_INVALID|Google Play|ConnectionResult|Location request has been rejected/i.test(String(e?.message || e))

const viaNext = async () => {
  const { Location: LocationNext } = require("expo-location/next") // only reached when the native module exists
  const pos = await LocationNext.getPosition({ maxCachedAge: 120, timeout: 20 })
  return pos?.coordinates ? { latitude: pos.coordinates.latitude, longitude: pos.coordinates.longitude } : null
}

const viaClassic = async () => {
  const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
  return { latitude: loc.coords.latitude, longitude: loc.coords.longitude }
}

/** Current { latitude, longitude }, or null if it can't be determined. Never throws. */
export const getUserLocation = async () => {
  if (!(await requestLocationPermission())) return null

  if (nextAvailable()) {
    try {
      const coords = await viaNext()
      if (coords) return coords
    } catch (e) {
      console.warn("Location (next) failed:", e?.message || e)
    }
  }

  if (!gmsUnavailable) {
    try {
      return await viaClassic()
    } catch (e) {
      if (isGmsError(e)) gmsUnavailable = true
      console.warn("Location (classic) failed:", e?.message || e)
    }
  }

  if (gmsUnavailable && !nextAvailable() && !warnedRebuild) {
    warnedRebuild = true
    console.warn(
      "No location provider: this device has no Google Play services and the installed app build lacks " +
        "expo-location's LocationModuleNext. Rebuild the native app (npx expo run:android) to enable the Android provider."
    )
  }
  return null
}

/**
 * Coordinates → suburb name (e.g. "Orlando East"), or null.
 * Uses OpenStreetMap Nominatim: Android's built-in Geocoder also needs Google services.
 */
export const reverseGeocode = async (latitude, longitude) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&addressdetails=1` +
      `&lat=${latitude}&lon=${longitude}`
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "Accept-Language": "en", "User-Agent": "XploreSoweto/1.0 (mobile app)" },
    })
    if (res.ok) {
      const a = (await res.json())?.address || {}
      const name = a.suburb || a.neighbourhood || a.quarter || a.city_district || a.village || a.town || a.city
      if (name) return name
    }
  } catch (e) {
    console.warn("Reverse geocode (OSM) failed:", e?.message || e)
  } finally {
    clearTimeout(timer)
  }

  // Last resort: the platform geocoder (works on iOS and Google-enabled Android)
  try {
    const [place] = await Location.reverseGeocodeAsync({ latitude, longitude })
    return place?.district || place?.subregion || place?.city || null
  } catch {
    return null
  }
}