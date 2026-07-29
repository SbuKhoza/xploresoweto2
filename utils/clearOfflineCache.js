import AsyncStorage from "@react-native-async-storage/async-storage"

// Clear all offline cache
export const clearAllOfflineCache = async () => {
  try {
    const keys = await AsyncStorage.getAllKeys()
    const offlineKeys = keys.filter(
      (key) =>
        key.startsWith("offline_") ||
        key.startsWith("cache_") ||
        key.includes("accommodations") ||
        key.includes("restaurants") ||
        key.includes("emergency") ||
        key.includes("xplore-menu"),
    )

    if (offlineKeys.length > 0) {
      await AsyncStorage.multiRemove(offlineKeys)
      console.log("Cleared offline cache keys:", offlineKeys)
    }
  } catch (error) {
    console.error("Error clearing offline cache:", error)
  }
}

// Clear specific collection cache
export const clearCollectionCache = async (collectionName) => {
  try {
    const keys = await AsyncStorage.getAllKeys()
    const collectionKeys = keys.filter(
      (key) =>
        key.includes(collectionName) ||
        key.startsWith(`offline_${collectionName}`) ||
        key.startsWith(`cache_${collectionName}`),
    )

    if (collectionKeys.length > 0) {
      await AsyncStorage.multiRemove(collectionKeys)
      console.log(`Cleared ${collectionName} cache keys:`, collectionKeys)
    }
  } catch (error) {
    console.error(`Error clearing ${collectionName} cache:`, error)
  }
}

// Force refresh data from Firebase
export const forceRefreshFromFirebase = async (collectionName) => {
  try {
    // Clear the cache first
    await clearCollectionCache(collectionName)

    // The next data fetch will get fresh data from Firebase
    console.log(`Cache cleared for ${collectionName}, next fetch will be from Firebase`)
  } catch (error) {
    console.error(`Error force refreshing ${collectionName}:`, error)
  }
}
