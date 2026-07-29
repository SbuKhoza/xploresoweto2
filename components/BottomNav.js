"use client"

import { StyleSheet, Text, View, TouchableOpacity, Animated } from "react-native"
import { useRef, createContext, useContext, useEffect } from "react"
import { Ionicons } from "@expo/vector-icons"

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
  Home:      { outline: "home-outline",    filled: "home"    },
  Xplore:    { outline: "compass-outline", filled: "compass" },
  Profile:   { outline: "person-outline",  filled: "person"  },
  Community: { outline: "grid-outline",    filled: "grid"    },
}

// ── BottomNav ─────────────────────────────────────────────────────────────────
const BottomNav = ({ state, descriptors, navigation }) => {
  const { scrollY } = useScrollContext()
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
    <Animated.View style={[styles.navContainer, { opacity }]}>
      {/* Decorative top accent line */}
      <View style={styles.topAccent} />

      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key]
        const isFocused   = state.index === index
        const iconName    = isFocused ? TABS[route.name]?.filled : TABS[route.name]?.outline
        const label       = options.tabBarLabel ?? options.title ?? route.name

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

            <View style={[styles.iconWrap, isFocused && styles.iconWrapActive]}>
              <Ionicons
                name={iconName}
                size={21}
                color={ACCENT}
              />
            </View>
            <Text style={[styles.tabLabel, isFocused && styles.tabLabelActive]}>
              {label}
            </Text>
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
  navContainer: {
    flexDirection: "row",
    backgroundColor: SURFACE,
    width: "100%",
    height: 66,
    borderRadius: 10,
    justifyContent: "space-around",
    alignItems: "center",
    position: "absolute",
    bottom: 0,
    alignSelf: "center",
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 4,
    // Shadow — matches Home card shadow style
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 10,
    borderWidth: 1,
    borderColor: "#E8DDD5",   // Warm-toned border matching Home township cards
  },

  // Subtle orange top-left accent sliver inside the pill
  topAccent: {
    position: "absolute",
    top: 0,
    left: "20%",
    right: "20%",
    height: 2.5,
    borderRadius: 2,
    backgroundColor: ACCENT,
    opacity: 1,
  },

  tabButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    position: "relative",
  },

  // Soft pill that appears behind the active icon
  activePill: {
    position: "absolute",
    top: 2,
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#ffffff",   // Warm orange tint — matches Home guideBadge
  },

  iconWrap: {
    width: 28,
    height: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  iconWrapActive: {
    // Slight upward nudge on active item for a lively feel
    transform: [{ translateY: -1 }],
  },

  tabLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: MUTED,
    marginTop: 1,
    letterSpacing: 0.2,
  },
  tabLabelActive: {
    color: ACCENT,
    fontWeight: "800",
  },
})