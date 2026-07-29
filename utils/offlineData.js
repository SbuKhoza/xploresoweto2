import NetInfo from "@react-native-community/netinfo"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { collection, getDocs, query, where, doc, getDoc, orderBy, limit } from "firebase/firestore"
import { db } from "../Firebase/config"

// Enhanced offline data management with better error handling and caching strategies

// Add the missing isOnline function
export const isOnline = async () => {
  try {
    const networkState = await NetInfo.fetch()
    return networkState.isConnected && networkState.isInternetReachable
  } catch (error) {
    console.error("❌ Error checking network status:", error)
    return false
  }
}

// Store data for offline access with metadata
export const storeOfflineData = async (key, data, metadata = {}) => {
  try {
    const dataToStore = {
      data,
      metadata: {
        ...metadata,
        lastUpdated: Date.now(),
        version: metadata.version || 1,
      },
    }
    await AsyncStorage.setItem(key, JSON.stringify(dataToStore))
    console.log(`✅ Stored offline data for ${key}`)
  } catch (error) {
    console.error(`❌ Error storing offline data for ${key}:`, error)
  }
}

// Get stored offline data with metadata
export const getOfflineData = async (key) => {
  try {
    const storedData = await AsyncStorage.getItem(key)
    if (!storedData) return null

    const parsedData = JSON.parse(storedData)
    // Handle both old format (direct data) and new format (with metadata)
    if (parsedData.data && parsedData.metadata) {
      return parsedData
    } else {
      // Legacy format - convert to new format
      return {
        data: parsedData,
        metadata: {
          lastUpdated: 0,
          version: 1,
        },
      }
    }
  } catch (error) {
    console.error(`❌ Error retrieving offline data for ${key}:`, error)
    return null
  }
}

// Check if cached data is stale (older than specified minutes)
export const isDataStale = (metadata, maxAgeMinutes = 30) => {
  if (!metadata || !metadata.lastUpdated) return true
  const ageInMinutes = (Date.now() - metadata.lastUpdated) / (1000 * 60)
  return ageInMinutes > maxAgeMinutes
}

// Enhanced fetch with better offline support and background sync
export const fetchWithOfflineSupport = async (collectionName, options = {}) => {
  const { filters = [], forceRefresh = false, orderByField = null, limitCount = null, maxAgeMinutes = 30 } = options

  // Create a unique storage key based on collection and filters
  const filterString = filters.map((f) => `${f.field}_${f.operator}_${f.value}`).join("_")
  const storageKey = `collection_${collectionName}${filterString ? `_${filterString}` : ""}`

  try {
    const networkState = await NetInfo.fetch()
    const cachedResult = await getOfflineData(storageKey)

    // Return cached data immediately if offline
    if (!networkState.isConnected) {
      console.log(`📱 Offline: Using cached data for ${collectionName}`)
      return cachedResult?.data || []
    }

    // Check if we should fetch fresh data
    const shouldFetchFresh = forceRefresh || !cachedResult || isDataStale(cachedResult.metadata, maxAgeMinutes)

    if (shouldFetchFresh) {
      console.log(`🔄 Fetching fresh data for ${collectionName}`)

      // Build Firestore query
      let dataQuery = collection(db, collectionName)

      // Apply filters
      if (filters.length > 0) {
        const whereConditions = filters.map((filter) => where(filter.field, filter.operator, filter.value))
        dataQuery = query(dataQuery, ...whereConditions)
      }

      // Apply ordering
      if (orderByField) {
        dataQuery = query(dataQuery, orderBy(orderByField))
      }

      // Apply limit
      if (limitCount) {
        dataQuery = query(dataQuery, limit(limitCount))
      }

      const querySnapshot = await getDocs(dataQuery)
      const freshData = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))

      // Store fresh data with metadata
      await storeOfflineData(storageKey, freshData, {
        collectionName,
        filters,
        fetchedAt: Date.now(),
      })

      return freshData
    }

    // Return cached data and optionally refresh in background
    if (cachedResult?.data) {
      // Background refresh if data is getting stale
      if (isDataStale(cachedResult.metadata, maxAgeMinutes / 2)) {
        console.log(`🔄 Background refresh for ${collectionName}`)
        fetchWithOfflineSupport(collectionName, { ...options, forceRefresh: true }).catch((error) =>
          console.error(`Background refresh failed for ${collectionName}:`, error),
        )
      }

      return cachedResult.data
    }

    return []
  } catch (error) {
    console.error(`❌ Error in fetchWithOfflineSupport for ${collectionName}:`, error)

    // Always try to return cached data as fallback
    const fallbackData = await getOfflineData(storageKey)
    return fallbackData?.data || []
  }
}

// Enhanced single document fetch
export const fetchDocWithOfflineSupport = async (collectionName, docId, options = {}) => {
  const { forceRefresh = false, maxAgeMinutes = 30 } = options
  const storageKey = `doc_${collectionName}_${docId}`

  try {
    const networkState = await NetInfo.fetch()
    const cachedResult = await getOfflineData(storageKey)

    // Return cached data immediately if offline
    if (!networkState.isConnected) {
      console.log(`📱 Offline: Using cached document ${collectionName}/${docId}`)
      return cachedResult?.data || null
    }

    // Check if we should fetch fresh data
    const shouldFetchFresh = forceRefresh || !cachedResult || isDataStale(cachedResult.metadata, maxAgeMinutes)

    if (shouldFetchFresh) {
      console.log(`🔄 Fetching fresh document ${collectionName}/${docId}`)

      const docRef = doc(db, collectionName, docId)
      const docSnap = await getDoc(docRef)

      if (docSnap.exists()) {
        const freshData = {
          id: docSnap.id,
          ...docSnap.data(),
        }

        await storeOfflineData(storageKey, freshData, {
          collectionName,
          docId,
          fetchedAt: Date.now(),
        })

        return freshData
      }

      return null
    }

    // Return cached data and optionally refresh in background
    if (cachedResult?.data) {
      if (isDataStale(cachedResult.metadata, maxAgeMinutes / 2)) {
        console.log(`🔄 Background refresh for document ${collectionName}/${docId}`)
        fetchDocWithOfflineSupport(collectionName, docId, { forceRefresh: true }).catch((error) =>
          console.error(`Background refresh failed:`, error),
        )
      }

      return cachedResult.data
    }

    return null
  } catch (error) {
    console.error(`❌ Error fetching document ${collectionName}/${docId}:`, error)

    const fallbackData = await getOfflineData(storageKey)
    return fallbackData?.data || null
  }
}

// Clear all offline data (useful for logout or data reset)
export const clearAllOfflineData = async () => {
  try {
    const keys = await AsyncStorage.getAllKeys()
    const offlineKeys = keys.filter(
      (key) => key.startsWith("collection_") || key.startsWith("doc_") || key.startsWith("user"),
    )

    await AsyncStorage.multiRemove(offlineKeys)
    console.log("🗑️ Cleared all offline data")
  } catch (error) {
    console.error("❌ Error clearing offline data:", error)
  }
}

// Get storage usage statistics
export const getStorageStats = async () => {
  try {
    const keys = await AsyncStorage.getAllKeys()
    const offlineKeys = keys.filter((key) => key.startsWith("collection_") || key.startsWith("doc_"))

    let totalSize = 0
    const collections = {}

    for (const key of offlineKeys) {
      const data = await AsyncStorage.getItem(key)
      if (data) {
        const size = new Blob([data]).size
        totalSize += size

        const collectionName = key.split("_")[1]
        if (!collections[collectionName]) {
          collections[collectionName] = { count: 0, size: 0 }
        }
        collections[collectionName].count++
        collections[collectionName].size += size
      }
    }

    return {
      totalSize,
      totalItems: offlineKeys.length,
      collections,
    }
  } catch (error) {
    console.error("❌ Error getting storage stats:", error)
    return { totalSize: 0, totalItems: 0, collections: {} }
  }
}

// Declare the missing functions
const clearOfflineData = async (key) => {
  try {
    await AsyncStorage.removeItem(key)
  } catch (error) {
    console.warn("Error clearing offline data:", error)
  }
}

const getStorageInfo = async () => {
  try {
    return await AsyncStorage.getAllKeys()
  } catch (error) {
    console.warn("Error getting storage info:", error)
    return []
  }
}

const syncPendingWrites = async () => {
  try {
    await AsyncStorage.flushGetRequests()
  } catch (error) {
    console.warn("Error syncing pending writes:", error)
  }
}

// Make sure all functions are exported
export { clearOfflineData, getStorageInfo, syncPendingWrites }
