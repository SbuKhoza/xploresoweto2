"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { getOfflineData, storeOfflineData, isOnline } from "../utils/offlineData"
import { collection, getDocs, query, orderBy, limit } from "firebase/firestore"
import { db } from "../Firebase/config"

export const useOfflineData = (collectionName, options = {}) => {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isOfflineMode, setIsOfflineMode] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)

  // Use refs to prevent infinite loops
  const optionsRef = useRef(options)
  const isMountedRef = useRef(true)
  const lastFetchRef = useRef(0)

  // Update options ref when options change
  useEffect(() => {
    optionsRef.current = options
  }, [options])

  // Create storage key
  const getStorageKey = useCallback(() => {
    return `collection_${collectionName}`
  }, [collectionName])

  // Memoized refresh function to prevent recreation on every render
  const refresh = useCallback(async () => {
    // Prevent multiple simultaneous fetches
    const now = Date.now()
    if (now - lastFetchRef.current < 1000) {
      return
    }
    lastFetchRef.current = now

    if (!isMountedRef.current) return

    try {
      setLoading(true)
      setError(null)

      const online = await isOnline()
      setIsOfflineMode(!online)

      const storageKey = getStorageKey()

      if (online) {
        console.log(`🔄 Fetching fresh data for ${collectionName}`)

        // Build Firestore query
        let firestoreQuery = collection(db, collectionName)

        if (optionsRef.current.orderByField) {
          firestoreQuery = query(firestoreQuery, orderBy(optionsRef.current.orderByField))
        }

        if (optionsRef.current.limitCount) {
          firestoreQuery = query(firestoreQuery, limit(optionsRef.current.limitCount))
        }

        const snapshot = await getDocs(firestoreQuery)
        const freshData = []

        snapshot.forEach((doc) => {
          freshData.push({
            id: doc.id,
            ...doc.data(),
          })
        })

        if (isMountedRef.current) {
          setData(freshData)
          setLastUpdated(new Date())

          // Store offline using the updated function
          await storeOfflineData(storageKey, freshData, {
            collectionName,
            fetchedAt: Date.now(),
          })
          console.log(`✅ Stored offline data for ${collectionName}`)
        }
      } else {
        // Load from offline storage
        console.log(`📱 Loading offline data for ${collectionName}`)
        const offlineResult = await getOfflineData(storageKey)

        if (isMountedRef.current) {
          if (offlineResult && offlineResult.data) {
            setData(offlineResult.data)
            setLastUpdated(offlineResult.metadata?.lastUpdated ? new Date(offlineResult.metadata.lastUpdated) : null)
          } else {
            setData([])
            setLastUpdated(null)
          }
        }
      }
    } catch (err) {
      console.error(`❌ Error fetching data for ${collectionName}:`, err)

      if (isMountedRef.current) {
        setError(err)

        // Try to load offline data as fallback
        try {
          const storageKey = getStorageKey()
          const offlineResult = await getOfflineData(storageKey)

          if (offlineResult && offlineResult.data) {
            setData(offlineResult.data)
            setLastUpdated(offlineResult.metadata?.lastUpdated ? new Date(offlineResult.metadata.lastUpdated) : null)
          } else {
            setData([])
            setLastUpdated(null)
          }
          setIsOfflineMode(true)
        } catch (offlineErr) {
          console.error(`❌ Error loading offline data for ${collectionName}:`, offlineErr)
          setData([])
          setLastUpdated(null)
        }
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false)
      }
    }
  }, [collectionName, getStorageKey])

  // Initial data load
  useEffect(() => {
    isMountedRef.current = true
    refresh()

    return () => {
      isMountedRef.current = false
    }
  }, [refresh])

  // Background refresh based on maxAgeMinutes
  useEffect(() => {
    if (!optionsRef.current.maxAgeMinutes || !optionsRef.current.enableBackgroundRefresh) {
      return
    }

    const interval = setInterval(async () => {
      if (!isMountedRef.current) return

      const online = await isOnline()
      if (online && lastUpdated) {
        const ageInMinutes = (Date.now() - lastUpdated.getTime()) / (1000 * 60)
        if (ageInMinutes >= optionsRef.current.maxAgeMinutes) {
          refresh()
        }
      }
    }, 60000) // Check every minute

    return () => clearInterval(interval)
  }, [lastUpdated, refresh])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  return {
    data,
    loading,
    error,
    isOffline: isOfflineMode,
    lastUpdated,
    refresh,
  }
}
