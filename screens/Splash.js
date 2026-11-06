import { useEffect, useRef, useState } from "react"
import {
  Text, View, Image, TouchableOpacity, StatusBar, ScrollView,
  Animated, Easing, ActivityIndicator, useWindowDimensions,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import GlossyBackground from "../components/GlossyBackground"
import { auth } from "../Firebase/config"

// Brand colours (mirror tailwind.config.js) — only used where a style prop is needed
const BRAND = "#E8600A"
const BRAND_DARK = "#C74E06"

const cardShadow = {
  shadowColor: "#2B5FA8", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.18, shadowRadius: 22, elevation: 10,
}
const buttonShadow = {
  shadowColor: BRAND, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 14, elevation: 8,
}

// What the app offers — shown as three colourful highlight tiles
const HIGHLIGHTS = [
  { icon: "location",      label: "Townships",     tint: "bg-teal-light",    color: "#1B4D5C" },
  { icon: "musical-notes", label: "Culture",       tint: "bg-brand-light",   color: BRAND },
  { icon: "sparkles",      label: "Hidden gems",   tint: "bg-success-light", color: "#15803D" },
]

const Splash = ({ navigation }) => {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const isTablet = width >= 768
  const [signedIn, setSignedIn] = useState(false)

  // ── Entrance animation ────────────────────────────────────────────────────
  const heroScale = useRef(new Animated.Value(1.1)).current
  const fade = useRef(new Animated.Value(0)).current
  const rise = useRef(new Animated.Value(32)).current

  useEffect(() => {
    Animated.parallel([
      Animated.timing(heroScale, { toValue: 1, duration: 1400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 700, delay: 250, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(rise, { toValue: 0, duration: 700, delay: 250, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start()
  }, [heroScale, fade, rise])

  // ── Auth: signed-in users go straight into the app ───────────────────────
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        setSignedIn(true)
        setTimeout(() => {
          navigation.reset({ index: 0, routes: [{ name: "MainApp" }] })
        }, 1500)
      }
    })
    return () => unsubscribe()
  }, [navigation])

  const handleGetStarted = () => navigation.navigate("Authentication")

  const heroHeight = Math.round(height * (isTablet ? 0.46 : 0.5))

  return (
    <View className="flex-1 bg-bg">
      <GlossyBackground />
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: Math.max(insets.bottom, 16) + 8 }}
      >
        {/* ═════════════ HERO ═════════════ */}
        <View className="overflow-hidden rounded-b-[36px]" style={{ height: heroHeight }}>
          <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, transform: [{ scale: heroScale }] }}>
            <Image
              source={require("../assets/Soweto.png")}
              style={{ width: "100%", height: "100%" }}
              resizeMode="cover"
            />
          </Animated.View>

          {/* Darkening + brand tint so text always reads */}
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(10,20,40,0.55)", "rgba(10,20,40,0.05)", "rgba(10,20,40,0.78)"]}
            locations={[0, 0.4, 1]}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          />
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(232,96,10,0.0)", "rgba(232,96,10,0.28)"]}
            start={{ x: 0, y: 0.3 }} end={{ x: 1, y: 1 }}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          />

          {/* Brand row */}
          <View className="flex-row items-center px-5" style={{ paddingTop: insets.top + 14 }}>
            <View className="w-11 h-11 rounded-2xl items-center justify-center bg-brand" style={buttonShadow}>
              <Ionicons name="compass" size={24} color="#fff" />
            </View>
            <View className="ml-3">
              <Text className="text-[17px] font-extrabold text-white tracking-[2px]">XPLORE SOWETO</Text>
              <Text className="text-[11.5px] font-semibold text-white" style={{ opacity: 0.85 }}>
                Discover the Heart of South Africa
              </Text>
            </View>
          </View>

          {/* Glass caption pinned to the bottom of the hero */}
          <View className="absolute left-5 right-5" style={{ bottom: 52 }}>
            <View
              className="self-start flex-row items-center rounded-full px-3 py-1.5 mb-3"
              style={{ backgroundColor: "rgba(255,255,255,0.22)", borderWidth: 1, borderColor: "rgba(255,255,255,0.35)" }}
            >
              <Ionicons name="star" size={12} color="#FFD27A" />
              <Text className="text-[11px] font-extrabold text-white ml-1.5 uppercase tracking-[1px]">Your Soweto guide</Text>
            </View>
            <Text className="text-[27px] font-extrabold text-white -tracking-[0.5px]" style={{ lineHeight: 33 }}>
              The Ultimate Guide{"\n"}to Soweto
            </Text>
            <Text className="text-[13.5px] text-white mt-1.5" style={{ opacity: 0.9, lineHeight: 19 }}>
              Explore townships, culture, and hidden gems.
            </Text>
          </View>
        </View>

        {/* ═════════════ CARD ═════════════ */}
        <Animated.View style={{ opacity: fade, transform: [{ translateY: rise }], marginTop: -34 }}>
          <View
            className="mx-4 bg-surface rounded-[28px] px-5 pt-6 pb-5 border border-line"
            style={[cardShadow, isTablet ? { maxWidth: 560, width: "100%", alignSelf: "center" } : null]}
          >
            <Text className="text-[24px] font-extrabold text-ink -tracking-[0.5px] text-center">Welcome to Soweto</Text>
            <Text className="text-[13.5px] text-muted text-center mt-1.5 px-2" style={{ lineHeight: 20 }}>
              Local history, famous faces, food, events and places worth the trip, all in one app.
            </Text>

            {/* Highlights */}
            <View className="flex-row justify-between mt-5">
              {HIGHLIGHTS.map((h) => (
                <View key={h.label} className="flex-1 items-center mx-1 py-3 rounded-2xl bg-bg border border-line">
                  <View className={`w-11 h-11 rounded-2xl items-center justify-center ${h.tint}`}>
                    <Ionicons name={h.icon} size={22} color={h.color} />
                  </View>
                  <Text className="text-[12px] font-extrabold text-ink mt-2">{h.label}</Text>
                </View>
              ))}
            </View>

            {/* CTA */}
            <TouchableOpacity activeOpacity={0.9} onPress={handleGetStarted} className="mt-6" style={[{ borderRadius: 18 }, buttonShadow]}
              accessibilityRole="button" accessibilityLabel="Get started">
              <LinearGradient
                colors={[BRAND, BRAND_DARK]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ borderRadius: 18, paddingVertical: 16, flexDirection: "row", alignItems: "center", justifyContent: "center" }}
              >
                <Text className="text-[16.5px] font-extrabold text-white mr-2">Get Started</Text>
                <View className="w-7 h-7 rounded-full items-center justify-center" style={{ backgroundColor: "rgba(255,255,255,0.25)" }}>
                  <Ionicons name="arrow-forward" size={16} color="#fff" />
                </View>
              </LinearGradient>
            </TouchableOpacity>

            {/* Footer / signed-in hint */}
            {signedIn ? (
              <View className="flex-row items-center justify-center mt-4">
                <ActivityIndicator size="small" color={BRAND} />
                <Text className="text-[12.5px] font-bold text-teal ml-2">Welcome back, taking you in…</Text>
              </View>
            ) : (
              <View className="flex-row items-center justify-center mt-4">
                <Ionicons name="sparkles" size={13} color={BRAND} />
                <Text className="text-[12.5px] font-semibold text-muted ml-1.5">Your adventure begins here</Text>
              </View>
            )}
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  )
}

export default Splash