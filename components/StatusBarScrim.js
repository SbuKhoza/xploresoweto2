import { createContext, useCallback, useContext, useMemo, useRef } from "react"
import { Animated, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

// Scroll-aware top safe area. Screens that draw their hero edge-to-edge under the (translucent) status bar let scrolling content pass behind the
// status-bar icons. This adds a solid strip, exactly as tall as the top inset, whose opacity follows the scroll position:
//   at the top  -> fully transparent (the screen looks exactly as it did before)
//   scrolling   -> fades in over SCRIM_RANGE px to the screen's own background colour (the same colour the app already uses)
//   back to top -> fades out again.
// The progress is a plain Animated.Value updated from the scroll handler, so nothing re-renders while scrolling, and the handler does no work
// once the strip is fully shown or fully hidden. The status bar icons stay dark (the app's existing style) on this light strip.
export const SCRIM_RANGE = 72
export const SCRIM_COLOR = "#F5F7FA" // = the app's screen background (App.js screenContainer / safeAreaProvider)

const ScrimContext = createContext(null)

export const ScrimProvider = ({ children }) => {
  const progress = useRef(new Animated.Value(0)).current
  const last = useRef(0)
  const onOffset = useCallback((y) => {
    const next = Math.max(0, Math.min(1, (Number(y) || 0) / SCRIM_RANGE))
    if (next === last.current) return // fully hidden or fully shown: nothing to update
    last.current = next
    progress.setValue(next)
  }, [progress])
  const value = useMemo(() => ({ progress, onOffset }), [progress, onOffset])
  return <ScrimContext.Provider value={value}>{children}</ScrimContext.Provider>
}

/** Used by scroll containers: (offsetY) => void, or null when the screen has no scrim (so nothing is tracked). */
export const useScrimOffset = () => useContext(ScrimContext)?.onOffset || null

/** Props for a plain ScrollView / FlatList on a scrim screen. Empty when the screen has no scrim. */
export const useScrimScrollProps = () => {
  const onOffset = useScrimOffset()
  return useMemo(() => (onOffset ? { onScroll: (e) => onOffset(e?.nativeEvent?.contentOffset?.y), scrollEventThrottle: 16 } : {}), [onOffset])
}

export const StatusBarScrim = ({ color = SCRIM_COLOR }) => {
  const ctx = useContext(ScrimContext)
  const insets = useSafeAreaInsets()
  if (!ctx || !(insets.top > 0)) return null
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top, zIndex: 20 }} testID="status-bar-scrim">
      <Animated.View style={{ flex: 1, backgroundColor: color, opacity: ctx.progress }} />
    </View>
  )
}
