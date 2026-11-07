import { useMemo } from "react"
import { useOfflineData } from "./useOfflineData"

const OPTIONS = { maxAgeMinutes: 30, enableBackgroundRefresh: true }

/**
 * Home-screen images managed in the CMS (Soweto → Hero image / Featured card).
 * Both live in the `homescreen` collection (cached offline, shared with useTownships):
 *   homescreen/hero      { type: "hero",          imageUrl, isActive }
 *   homescreen/featured  { type: "featuredImage", imageUrl, title }
 * Returns null for anything missing/disabled so the screen can use its bundled artwork.
 */
export const useHomeContent = () => {
  const { data, loading } = useOfflineData("homescreen", OPTIONS)
  return useMemo(() => {
    const docs = data || []
    const hero = docs.find((d) => d.type === "hero" && d.isActive !== false && d.imageUrl) || null
    const featured = docs.find((d) => d.type === "featuredImage") || null
    return { hero, featured, loading: !!loading && docs.length === 0 }
  }, [data, loading])
}
