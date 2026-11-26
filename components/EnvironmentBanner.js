import { View, Text, StyleSheet } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { APP_ENV } from "../Firebase/config"

// Always-visible marker for non-production builds, drawn above every screen. Production renders nothing.
// It lives INSIDE the status-bar strip (top: 0, never taller than the top safe-area inset), so it can never sit on a screen header.
// Screens that start at insets.top (like the Malloya header) are untouched. On a device with no top inset it is a thin 12px strip.
export default function EnvironmentBanner() {
  const insets = useSafeAreaInsets()
  if (APP_ENV === "production") return null
  const height = Math.max(12, Math.min(16, insets.top || 12))
  return (
    <View pointerEvents="none" style={[styles.wrap, { height }]} accessibilityLabel={`${APP_ENV} environment, test data only`}>
      <View style={[styles.pill, { height }]}><Text style={styles.text} numberOfLines={1}>{APP_ENV.toUpperCase()} · TEST DATA ONLY</Text></View>
    </View>
  )
}
const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 0, left: 0, right: 0, alignItems: "center", zIndex: 9999, elevation: 9999 },
  pill: { backgroundColor: "#B00020", paddingHorizontal: 10, justifyContent: "center", borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
  text: { color: "#fff", fontSize: 9, fontWeight: "800", letterSpacing: 1, includeFontPadding: false },
})
