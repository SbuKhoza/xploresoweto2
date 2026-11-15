import AsyncStorage from "@react-native-async-storage/async-storage"

// One-time, targeted clean-up for devices that ran a build connected to the previous Firebase project: stale cached content,
// the cached user object and old Firebase session keys must not be shown against the new project. Runs once per epoch; it only
// removes this app's own cache/session keys, never unrelated data. Bump STORAGE_EPOCH to force another clean-up later.
const STORAGE_EPOCH = "xploresoweto-v1"
const EPOCH_KEY = "@xs/storage-epoch"
const NEW_API_KEY = "AIzaSyCwRLeFV0lxbez-G3YONR-WIcdgF3xSUpg"
const OWN_PREFIXES = ["collection_", "doc_", "offline_", "cache_", "enrollment:"]

export const applyStorageEpoch = async () => {
  try {
    if ((await AsyncStorage.getItem(EPOCH_KEY)) === STORAGE_EPOCH) return false
    const keys = await AsyncStorage.getAllKeys()
    const stale = keys.filter(
      (k) => k === "user" || OWN_PREFIXES.some((p) => k.startsWith(p)) || (k.startsWith("firebase:") && !k.includes(NEW_API_KEY)),
    )
    if (stale.length) await AsyncStorage.multiRemove(stale)
    await AsyncStorage.setItem(EPOCH_KEY, STORAGE_EPOCH)
    return true
  } catch {
    return false // never block app start because of cache housekeeping
  }
}
