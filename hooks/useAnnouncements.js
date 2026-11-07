import { useMemo } from "react"
import { useOfflineData } from "./useOfflineData"
import { toDate } from "../utils/content"

const OPTIONS = { maxAgeMinutes: 10, enableBackgroundRefresh: true }
const WEIGHT = { urgent: 3, warning: 2, success: 1, info: 0 }

/**
 * Community announcements from Firestore (`announcements`, managed in CMS → Community).
 * Only active ones inside their optional startsAt/expiresAt window are returned.
 * Order: pinned first → urgency → newest.
 */
export const useAnnouncements = () => {
  const { data, loading, isOffline, refresh } = useOfflineData("announcements", OPTIONS)

  const announcements = useMemo(() => {
    const now = Date.now()
    return (data || [])
      .filter((a) => a.isActive !== false && a.title)
      .filter((a) => {
        const start = toDate(a.startsAt), end = toDate(a.expiresAt)
        return (!start || start.getTime() <= now) && (!end || end.getTime() >= now)
      })
      .sort((a, b) =>
        (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
        (WEIGHT[b.type] || 0) - (WEIGHT[a.type] || 0) ||
        (toDate(b.publishedAt)?.getTime() || 0) - (toDate(a.publishedAt)?.getTime() || 0)
      )
  }, [data])

  return { announcements, loading: !!loading && !(data && data.length), isOffline, refresh }
}
