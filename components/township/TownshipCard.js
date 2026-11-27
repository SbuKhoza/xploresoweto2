import { memo, useState } from "react"
import { Image, Text, TouchableOpacity, View } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"

const BRAND = "#E8600A"

/**
 * Image card for the Soweto Townships grid. The whole card is the tap target. The picture is the township's own CMS image (info.imageUrl); when it is
 * missing, invalid or fails to load, the card shows the township's own colours with its first letter, so a card is never blank. A dark gradient
 * at the bottom keeps the white name readable over any picture.
 */
const TownshipCard = ({ info, onPress, height = 148 }) => {
  const [failed, setFailed] = useState(false)
  const showImage = !!info.imageUrl && !failed
  const [c1, c2] = info.colors
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${info.name} township info`}
      style={{ width: "48%", height, marginBottom: 14, borderRadius: 22, backgroundColor: "#fff", shadowColor: "#7A4A1E", shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.16, shadowRadius: 10, elevation: 4 }}
    >
      <View style={{ flex: 1, borderRadius: 22, overflow: "hidden" }}>
        {showImage ? (
          <Image source={{ uri: info.imageUrl }} onError={() => setFailed(true)} resizeMode="cover" accessible={false} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" }} />
        ) : (
          <LinearGradient colors={[c1, c2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
            <Text testID="township-placeholder" style={{ fontSize: 72, fontWeight: "900", color: "rgba(255,255,255,0.28)" }}>{info.name.charAt(0)}</Text>
          </LinearGradient>
        )}
        <LinearGradient pointerEvents="none" colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.78)"]} locations={[0.35, 1]} style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: 0 }} />
        <View style={{ position: "absolute", left: 12, right: 12, bottom: 12, flexDirection: "row", alignItems: "center" }}>
          <Text numberOfLines={2} style={{ flex: 1, color: "#fff", fontSize: 18, lineHeight: 22, fontWeight: "900", letterSpacing: -0.2, textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } }}>{info.name}</Text>
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: BRAND, alignItems: "center", justifyContent: "center", marginLeft: 6 }}>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </View>
        </View>
      </View>
    </TouchableOpacity>
  )
}

export default memo(TownshipCard)
