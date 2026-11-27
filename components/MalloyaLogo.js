import { useEffect, useState } from "react"
import { Image, View } from "react-native"
import { Ionicons } from "@expo/vector-icons"

// Only plain web addresses are fetched; anything else in the CMS field is treated as "not configured".
const toLogoUri = (v) => (typeof v === "string" && /^https?:\/\/[^\s]+$/i.test(v.trim()) ? v.trim() : "")

/**
 * The image beside "The ultimate guide to Soweto" on Home. `url` is the CMS-managed Malloya promotional logo (homescreen/featured.malloyLogoUrl).
 * While it is missing, invalid, still loading or fails to load, the existing compass icon is shown, exactly as before this feature. When it loads,
 * it is drawn with resizeMode "contain" inside a fixed box: aspect ratio preserved, no crop, no stretch, transparent backgrounds stay transparent.
 */
export default function MalloyaLogo({ url }) {
  const uri = toLogoUri(url)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => { setLoaded(false); setFailed(false) }, [uri])
  const showFallback = !uri || failed || !loaded

  return (
    <View style={{ width: 88, height: 64, alignItems: "center", justifyContent: "center" }}>
      {showFallback ? (
        <View testID="malloya-fallback" style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="compass" size={32} color="#fff" />
        </View>
      ) : null}
      {uri && !failed ? (
        <Image
          testID="malloya-logo"
          source={{ uri }}
          resizeMode="contain"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          accessible={false}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", opacity: loaded ? 1 : 0 }}
        />
      ) : null}
    </View>
  )
}
