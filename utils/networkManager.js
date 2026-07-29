import NetInfo from "@react-native-community/netinfo"
import { fetchWithOfflineSupport } from "./offlineData"

// Enhanced network management with better sync strategies
const COLLECTIONS_TO_SYNC = [
  "users",
  "accommodations",
  "restaurants",
  "attractions",
  "emergency", // Changed from "emergencies" to match your collection name
  "transports",
  "businesses",
  "healthcare",
  "recreations",
]

// Sync priority levels
const SYNC_PRIORITIES = {
  HIGH: ["users", "emergency"], // Changed from "emergencies" to match your collection name
  MEDIUM: ["accommodations", "restaurants", "attractions"],
  LOW: ["transports", "businesses", "healthcare", "recreations"],
}

// Setup enhanced network listener
export const setupNetworkListener = (callback = () => {}) => {
  let wasOffline = false

  return NetInfo.addEventListener((state) => {
    const isConnected = state.isConnected && state.isInternetReachable

    // If connection was restored after being offline
    if (isConnected && wasOffline) {
      console.log("🌐 Connection restored - starting sync")
      syncDataWithServer()
      callback(true)
    } else if (!isConnected) {
      console.log("📱 Gone offline")
      wasOffline = true
      callback(false)
    } else if (isConnected) {
      callback(true)
    }

    wasOffline = !isConnected
  })
}

// Enhanced sync with priority-based loading
export const syncDataWithServer = async () => {
  console.log("🔄 Starting data synchronization...")

  try {
    // Sync high priority collections first
    console.log("⚡ Syncing high priority data...")
    await Promise.all(
      SYNC_PRIORITIES.HIGH.map((collection) =>
        fetchWithOfflineSupport(collection, { forceRefresh: true }).catch((error) =>
          console.error(`❌ Error syncing ${collection}:`, error),
        ),
      ),
    )

    // Then medium priority
    console.log("🔶 Syncing medium priority data...")
    await Promise.all(
      SYNC_PRIORITIES.MEDIUM.map((collection) =>
        fetchWithOfflineSupport(collection, { forceRefresh: true }).catch((error) =>
          console.error(`❌ Error syncing ${collection}:`, error),
        ),
      ),
    )

    // Finally low priority
    console.log("🔸 Syncing low priority data...")
    await Promise.all(
      SYNC_PRIORITIES.LOW.map((collection) =>
        fetchWithOfflineSupport(collection, { forceRefresh: true }).catch((error) =>
          console.error(`❌ Error syncing ${collection}:`, error),
        ),
      ),
    )

    console.log("✅ Data synchronization completed successfully")
  } catch (error) {
    console.error("❌ Error during data sync:", error)
  }
}

// Sync specific collection with retry logic
export const syncCollection = async (collectionName, maxRetries = 3) => {
  let retries = 0

  while (retries < maxRetries) {
    try {
      await fetchWithOfflineSupport(collectionName, { forceRefresh: true })
      console.log(`✅ Successfully synced ${collectionName}`)
      return true
    } catch (error) {
      retries++
      console.error(`❌ Sync attempt ${retries} failed for ${collectionName}:`, error)

      if (retries < maxRetries) {
        // Exponential backoff
        const delay = Math.pow(2, retries) * 1000
        console.log(`⏳ Retrying ${collectionName} in ${delay}ms...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  console.error(`❌ Failed to sync ${collectionName} after ${maxRetries} attempts`)
  return false
}

// Check network status
export const isOnline = async () => {
  try {
    const networkState = await NetInfo.fetch()
    return networkState.isConnected && networkState.isInternetReachable
  } catch (error) {
    console.error("❌ Error checking network status:", error)
    return false
  }
}

// Get detailed network information
export const getNetworkInfo = async () => {
  try {
    const state = await NetInfo.fetch()
    return {
      isConnected: state.isConnected,
      isInternetReachable: state.isInternetReachable,
      type: state.type,
      isWifiEnabled: state.isWifiEnabled,
      details: state.details,
    }
  } catch (error) {
    console.error("❌ Error getting network info:", error)
    return null
  }
}

// Sync all collections (useful for manual refresh)
export const syncAllCollections = async () => {
  console.log("🔄 Starting full sync of all collections...")

  const results = {}

  for (const collection of COLLECTIONS_TO_SYNC) {
    try {
      const success = await syncCollection(collection)
      results[collection] = success
    } catch (error) {
      console.error(`❌ Error syncing ${collection}:`, error)
      results[collection] = false
    }
  }

  const successCount = Object.values(results).filter(Boolean).length
  const totalCount = COLLECTIONS_TO_SYNC.length

  console.log(`✅ Sync completed: ${successCount}/${totalCount} collections synced successfully`)
  return results
}

// Get sync status for all collections
export const getSyncStatus = async () => {
  const status = {}

  for (const collection of COLLECTIONS_TO_SYNC) {
    try {
      const online = await isOnline()
      status[collection] = {
        online,
        priority: Object.keys(SYNC_PRIORITIES).find((key) => SYNC_PRIORITIES[key].includes(collection)),
        lastChecked: new Date().toISOString(),
      }
    } catch (error) {
      status[collection] = {
        online: false,
        priority: "UNKNOWN",
        error: error.message,
        lastChecked: new Date().toISOString(),
      }
    }
  }

  return status
}

// Setup automatic background sync (call this in your app initialization)
export const setupBackgroundSync = (intervalMinutes = 15) => {
  const interval = setInterval(
    async () => {
      const online = await isOnline()
      if (online) {
        console.log("🔄 Running background sync...")
        await syncDataWithServer()
      }
    },
    intervalMinutes * 60 * 1000,
  )

  return () => clearInterval(interval)
}
