import { useMemo } from "react"
import { useOfflineData } from "./useOfflineData"
import { compareTownships, getTownshipInfo } from "../utils/townships"

// Module-level so the options object is stable between renders
const OPTIONS = { maxAgeMinutes: 30, enableBackgroundRefresh: true }

/**
 * Townships from Firestore (`homescreen` docs with type "township"), cached for offline use.
 * Inactive townships (isActive === false) are hidden. Sorted by CMS order, then A–Z.
 *
 * Returns { townships, loading, error, isOffline, lastUpdated, refresh } where each
 * township is { doc, info, index } — `doc` is the raw Firestore doc, `info` the normalised view.
 */
export const useTownships = () => {
  const { data, loading, error, isOffline, lastUpdated, refresh } = useOfflineData("homescreen", OPTIONS)

  const townships = useMemo(
    () =>
      (data || [])
        .filter((d) => d.type === "township" && d.name && d.isActive !== false)
        .sort(compareTownships)
        .map((doc, index) => ({ doc, index, info: getTownshipInfo(doc, index) })),
    [data]
  )

  return { townships, loading, error, isOffline, lastUpdated, refresh }
}
