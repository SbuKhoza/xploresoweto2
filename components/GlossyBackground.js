import { View, StyleSheet } from "react-native"
import { LinearGradient } from "expo-linear-gradient"

// Glossy white glass page background: a white-to-silver base, a bright glass
// highlight across the top and a soft diagonal sheen. Non-interactive; sits
// behind content.
const GlossyBackground = () => (
  <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {/* Base — white with soft silver shading so the gloss reads */}
    <LinearGradient
      colors={["#FFFFFF", "#EEF1F6", "#FBFCFE", "#E6EAF1"]}
      locations={[0, 0.38, 0.7, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
    {/* Glass highlight across the top */}
    <LinearGradient
      colors={["rgba(255,255,255,1)", "rgba(255,255,255,0)"]}
      style={{ position: "absolute", top: 0, left: 0, right: 0, height: "36%" }}
    />
    {/* Diagonal sheen streak */}
    <LinearGradient
      colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.95)", "rgba(255,255,255,0)"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={{ position: "absolute", top: "32%", left: "-30%", width: "160%", height: 120, transform: [{ rotate: "-24deg" }] }}
    />
    {/* Soft silver shade at the bottom */}
    <LinearGradient
      colors={["rgba(200,208,222,0)", "rgba(200,208,222,0.35)"]}
      style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "28%" }}
    />
  </View>
)

export default GlossyBackground