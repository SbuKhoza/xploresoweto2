import { useState } from "react"
import { Image } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"

const TEAL = "#1B4D5C"

// Remote/local image with graceful fallbacks:
// source → fallbackSource (bundled image) → soft gradient with an icon.
const CoverImage = ({ source, fallbackSource, fallbackIcon = "image-outline", colors = ["#DCEBEF", "#EAF3F5"], style, iconSize = 24 }) => {
  const [failed, setFailed] = useState(false)
  const [fallbackFailed, setFallbackFailed] = useState(false)

  if ((!source || failed) && fallbackSource && !fallbackFailed) {
    return <Image source={fallbackSource} style={style} resizeMode="cover" onError={() => setFallbackFailed(true)} />
  }
  if (!source || failed) {
    return (
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ justifyContent: "center", alignItems: "center" }, style]}>
        <Ionicons name={fallbackIcon} size={iconSize} color={TEAL} style={{ opacity: 0.55 }} />
      </LinearGradient>
    )
  }
  return <Image source={source} style={style} resizeMode="cover" onError={() => setFailed(true)} />
}

export default CoverImage
