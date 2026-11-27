import { useEffect, useState } from "react"
import { Image, View, useWindowDimensions } from "react-native"
import { LinearGradient } from "expo-linear-gradient"
import { useHomeContent } from "../hooks/useHomeContent"

export const CREAM = "#FFF8F0"

/**
 * Hero banner for redesigned screens. It reuses the EXISTING dynamic banner: the CMS-managed Home hero image (homescreen/hero via useHomeContent),
 * with the same bundled artwork as the Home screen when none is configured or it fails to load. Nothing is hardcoded here, so changing the banner
 * in XploreCMS changes it everywhere with no app build. The image is cropped to fill (cover); the curved cream transition at the bottom and a soft
 * fade work with any colours and aspect ratios. `children` are drawn over the banner (e.g. the brand chip and back button).
 */
export default function DynamicHero({ height, topInset = 0, children, curve = 44, background = CREAM }) {
  const { hero } = useHomeContent()
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [hero?.imageUrl])
  const uri = hero?.imageUrl && !failed ? hero.imageUrl : null
  const h = Math.max(160, height)
  const { width: W } = useWindowDimensions()
  const D = Math.round(W * 2.4) // diameter of the circle whose top arc forms the curved edge
  return (
    <View style={{ height: h + topInset, overflow: "hidden", backgroundColor: "#F0DCC8" }}>
      <Image
        source={uri ? { uri } : require("../assets/home/hero-towers.png")}
        onError={() => setFailed(true)}
        resizeMode="cover"
        accessible={false}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" }}
      />
      {/* light scrim: keeps the (dark) status-bar icons readable over any banner */}
      <LinearGradient pointerEvents="none" colors={["rgba(255,248,240,0.6)", "rgba(255,248,240,0)"]} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 90 + topInset }} />
      {/* smooth fade into the content colour */}
      <LinearGradient pointerEvents="none" colors={["rgba(255,248,240,0)", background]} style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: curve + 20 }} />
      {/* curved edge: the top of a very wide circle, so the content area appears to rise in a gentle arc (clipped by the hero) */}
      <View pointerEvents="none" style={{ position: "absolute", left: Math.round((W - D) / 2), top: h + topInset - curve, width: D, height: D, borderRadius: D / 2, backgroundColor: background }} />
      {children}
    </View>
  )
}
