import { View, Text, StyleSheet } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { APP_ENV } from "../Firebase/config"

// Always-visible marker for non-production builds, drawn above every screen. Production renders nothing.
export default function EnvironmentBanner() {
  const insets = useSafeAreaInsets()
  if (APP_ENV === "production") return null
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top }]} accessibilityLabel={`${APP_ENV} environment`}>
      <View style={styles.pill}><Text style={styles.text}>{APP_ENV.toUpperCase()} · TEST DATA ONLY</Text></View>
    </View>
  )
}
const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 9999, elevation: 9999 },
  pill: { backgroundColor: "#B00020", paddingHorizontal: 10, paddingVertical: 2, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
  text: { color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 1 },
})
