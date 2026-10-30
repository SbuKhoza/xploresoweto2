"use client"

import { StyleSheet, Text, View, TouchableOpacity, Animated } from "react-native"
import { useRef, createContext, useContext, useEffect } from "react"
import { Ionicons } from "@expo/vector-icons"
import { useSafeAreaInsets } from "react-native-safe-area-context"

// ── Design tokens — must match Home.js ──────────────────────────────────────
const ACCENT    = "#1B4D5C"   // Deep teal
const HIGHLIGHT = "#E8600A"   // Vibrant orange
const SURFACE   = "#FFFFFF"
const MUTED     = "#7A8A8F"
// ─────────────────────────────────────────────────────────────────────────────

// Create scroll context within this file
const ScrollContext = createContext()

// Create animated FlatList component
export const AnimatedFlatList = Animated.createAnimatedComponent(require("react-native").FlatList)

// Scroll provider component
export const ScrollProvider = ({ children }) => {
  const scrollY = useRef(new Animated.Value(0)).current
  return <ScrollContext.Provider value={{ scrollY }}>{children}</ScrollContext.Provider>
}

// Custom hook to use the scroll context
export const useScrollContext = () => {
  const context = useContext(ScrollContext)
  if (context === undefined) throw new Error("useScrollContext must be used within a ScrollProvider")
  return context
}

// ScrollTrackingView component
export const ScrollTrackingView = ({ children, style }) => (
  <View style={[scrollStyles.container, style]}>{children}</View>
)

// Hook to connect FlatLists / ScrollViews to scroll tracking
export const useScrollTracking = () => {
  const { scrollY } = useScrollContext()
  return {
    onScroll: Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }),
    scrollEventThrottle: 16,
  }
}

// ── Tab config ────────────────────────────────────────────────────────────────
const TABS = {
  Home:      { outline: "home-outline",    filled: "home",    label: "Home"      },
  Xplore:    { outline: "compass-outline", filled: "compass", label: "Explore"   },
  Profile:   { outline: "person-outline",  filled: "person",  label: "Profile"   },
  Community: { outline: "grid-outline",    filled: "grid",    label: "Community" },
}

// ── BottomNav ─────────────────────────────────────────────────────────────────
const BottomNav = ({ state, descriptors, navigation }) => {
  const { scrollY } = useScrollContext()
  const insets = useSafeAreaInsets()
  const opacity        = useRef(new Animated.Value(1)).current
  const scrollYPrev    = useRef(0)

  useEffect(() => {
    const id = scrollY.addListener(({ value }) => {
      const scrollingDown = value > scrollYPrev.current && value > 10
      scrollYPrev.current = value
      Animated.timing(opacity, {
        toValue: scrollingDown ? 0 : 1,
        duration: 300,
        useNativeDriver: true,
      }).start()
    })
    return () => scrollY.removeListener(id)
  }, [scrollY])

  // Always show when returning to Home
  useEffect(() => {
    if (state.routes[state.index].name === "Home") {
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start()
    }
  }, [state.index])

  return (
    <Animated.View style={[styles.navContainer, { opacity, bottom: Math.max(insets.bottom, 8) + 6 }]}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key]
        const isFocused   = state.index === index
        const iconName    = isFocused ? TABS[route.name]?.filled : TABS[route.name]?.outline
        const label       = TABS[route.name]?.label ?? options.tabBarLabel ?? options.title ?? route.name

        const onPress = () => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true })
          if (!event.defaultPrevented) {
            if (route.name === "Xplore") {
              navigation.navigate("Xplore", { screen: "XploreMain" })
            } else if (!isFocused) {
              navigation.navigate(route.name)
            }
          }
        }

        const onLongPress = () => navigation.emit({ type: "tabLongPress", target: route.key })

        return (
          <TouchableOpacity
            key={route.key}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            testID={options.tabBarTestID}
            onPress={onPress}
            onLongPress={onLongPress}
            style={styles.tabButton}
            activeOpacity={0.7}
          >
            {/* Active pill background */}
            {isFocused && <View style={styles.activePill} />}

            <View style={styles.iconWrap}>
              <Ionicons
                name={iconName}
                size={21}
                color={isFocused ? ACCENT : MUTED}
              />
            </View>
            <Text style={[styles.tabLabel, isFocused && styles.tabLabelActive]}>
              {label}
            </Text>
            {isFocused && <View style={styles.activeBar} />}
          </TouchableOpacity>
        )
      })}
    </Animated.View>
  )
}

export default BottomNav

// ── Styles ─────────────────────────────────────────────────────────────────────
const scrollStyles = StyleSheet.create({
  container: { flex: 1 },
})

const styles = StyleSheet.create({
  // Floating, fully-rounded bar inset from the screen edges
  navContainer: {
    flexDirection: "row",
    backgroundColor: SURFACE,
    height: 62,
    borderRadius: 26,
    alignItems: "center",
    position: "absolute",
    left: 12,
    right: 12,
    padding: 5,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 12,
    borderWidth: 1,
    borderColor: "#EFE9E0",
  },

  tabButton: {
    flex: 1,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },

  // Soft teal tint behind the active tab
  activePill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 2,
    right: 2,
    borderRadius: 21,
    backgroundColor: "#E8F4F7",
  },

  iconWrap: {
    width: 26,
    height: 24,
    justifyContent: "center",
    alignItems: "center",
  },

  tabLabel: {
    fontSize: 10.5,
    fontWeight: "600",
    color: MUTED,
    marginTop: 2,
    letterSpacing: 0.1,
  },
  tabLabelActive: {
    color: ACCENT,
    fontWeight: "800",
  },

  // Small underline beneath the active label
  activeBar: {
    position: "absolute",
    bottom: 4,
    width: 30,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: ACCENT,
  },
})