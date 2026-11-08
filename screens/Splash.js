import { useEffect, useRef, useState } from "react"
import {
  Text, View, Image, TouchableOpacity, StatusBar, ScrollView,
  Animated, Easing, ActivityIndicator, useWindowDimensions,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { auth } from "../Firebase/config"

// ── Design tokens ────────────────────────────────────────────────────────────
const BRAND      = "#E8600A"   // vibrant orange
const BRAND_GOLD = "#FFB300"
const NAVY       = "#101B3D"   // headings on the white card
const MUTED      = "#5E6B80"
const LINE       = "#E6EAF1"

// Sunset sky behind the hero (night blue → purple → rose → orange → gold)
const SKY        = ["#0B1B3A", "#33286A", "#A83F6E", "#F2792B", "#FFB347"]
const SKY_STOPS  = [0, 0.28, 0.55, 0.8, 1]

// Highlight tiles — matches the design: navy / peach / grey-blue icon discs
const HIGHLIGHTS = [
  { icon: "location",      label: "Townships",   disc: "#E9EDF3" },
  { icon: "musical-notes", label: "Culture",     disc: "#FFDCC2" },
  { icon: "sparkles",      label: "Hidden gems", disc: "#E9EDF3" },
]

const PHOTO_RATIO = 991 / 1315   // width / height of assets/splash-hero-photo.jpg

const Splash = ({ navigation }) => {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const isTablet = width >= 768
  const s = Math.min(Math.max(width / 390, 0.85), 1.25)   // gentle responsive scale
  const [signedIn, setSignedIn] = useState(false)

  // ── Animations (all native-driver) ─────────────────────────────────────────
  const heroScale = useRef(new Animated.Value(1.08)).current
  const heroFade  = useRef(new Animated.Value(0)).current
  const cardFade  = useRef(new Animated.Value(0)).current
  const cardRise  = useRef(new Animated.Value(40)).current

  useEffect(() => {
    Animated.parallel([
      Animated.timing(heroScale, { toValue: 1, duration: 1200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(heroFade,  { toValue: 1, duration: 800,  easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(cardFade,  { toValue: 1, duration: 700, delay: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(cardRise,  { toValue: 0, duration: 700, delay: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start()
  }, [heroScale, heroFade, cardFade, cardRise])

  // ── Auth: signed-in users go straight into the app ─────────────────────────
  useEffect(() => {
    let timer
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        setSignedIn(true)
        timer = setTimeout(() => {
          navigation.reset({ index: 0, routes: [{ name: "MainApp" }] })
        }, 1500)
      }
    })
    return () => { unsubscribe(); if (timer) clearTimeout(timer) }
  }, [navigation])

  const handleGetStarted = () => navigation.navigate("Authentication")

  // ── Sizes ──────────────────────────────────────────────────────────────────
  const heroHeight = Math.max(Math.round(height * (isTablet ? 0.54 : 0.58)), 400)
  const imgW       = Math.max(heroHeight * PHOTO_RATIO, width * 1.04)   // cover the hero
  const imgH       = imgW / PHOTO_RATIO
  const titleSize  = Math.round(Math.min(32 * s, 44))

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <ScrollView
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        {/* ═══════════════ HERO ═══════════════ */}
        <View style={{ height: heroHeight, overflow: "hidden" }}>
          {/* Fallback sky colour while the photo decodes */}
          <LinearGradient
            colors={["#183A6E", "#2B3F7A", "#7A7098"]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          />

          {/* Full-bleed hero photo — covers the whole hero, anchored right so she stays in frame */}
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute", right: 0, bottom: -6,
              width: imgW, height: imgH,
              opacity: heroFade, transform: [{ scale: heroScale }],
            }}
          >
            <Image source={require("../assets/splash-hero-photo.png")} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
          </Animated.View>

          {/* Scrims so the headline stays readable on the left (and the lower sky stays rich) */}
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(8,10,24,0)", "rgba(8,10,24,0.5)"]}
            style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: heroHeight * 0.3 }}
          />
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(8,10,24,0.55)", "rgba(8,10,24,0.2)", "rgba(8,10,24,0)"]}
            locations={[0, 0.5, 0.8]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: heroHeight * 0.3 }}
          />

          {/* Darken the very top so the brand row always reads */}
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(6,12,28,0.55)", "rgba(6,12,28,0)"]}
            style={{ position: "absolute", top: 0, left: 0, right: 0, height: 150 }}
          />

          {/* Brand row */}
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: insets.top + 14 }}>
            <View
              style={{
                width: 54, height: 54, borderRadius: 16, backgroundColor: "#15151A",
                alignItems: "center", justifyContent: "center",
                borderWidth: 1.5, borderColor: "rgba(255,255,255,0.18)",
              }}
            >
              <Text style={{ fontSize: 21, fontWeight: "900", fontStyle: "italic", color: "#fff", letterSpacing: -0.5 }}>
                Xp<Text style={{ color: BRAND_GOLD }}>S</Text>
              </Text>
              <View style={{ position: "absolute", bottom: 8, left: 10, right: 10, height: 3, borderRadius: 2, backgroundColor: BRAND }} />
            </View>
            <View style={{ width: 1.5, height: 44, backgroundColor: "rgba(255,255,255,0.55)", marginHorizontal: 14 }} />
            <View style={{ flexShrink: 1 }}>
              <Text style={{ fontSize: 21 * Math.min(s, 1.1), fontWeight: "900", color: "#fff", letterSpacing: 1.5 }} numberOfLines={1}>
                XPLORE SOWETO
              </Text>
              <Text style={{ fontSize: 10 * Math.min(s, 1.1), fontWeight: "700", color: "rgba(255,255,255,0.92)", letterSpacing: 1.6, marginTop: 2 }} numberOfLines={1}>
                DISCOVER • EXPLORE • EXPERIENCE
              </Text>
            </View>
          </View>

          {/* Headline block */}
          <View style={{ position: "absolute", left: 22, bottom: 58, width: isTablet ? "44%" : "53%" }}>
            <View
              style={{
                alignSelf: "flex-start", backgroundColor: BRAND, borderRadius: 20,
                paddingHorizontal: 16, paddingVertical: 7, marginBottom: 14,
                shadowColor: BRAND, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8, elevation: 6,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: "900", color: "#fff", letterSpacing: 1.2 }}>YOUR SOWETO GUIDE</Text>
            </View>

            <Text
              style={{
                fontSize: titleSize, lineHeight: titleSize * 1.04, fontWeight: "900", color: "#fff", letterSpacing: -0.8,
                textShadowColor: "rgba(0,0,0,0.35)", textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8,
              }}
            >
              The Ultimate{"\n"}Guide to{"\n"}
              <Text style={{ color: "#FF9A1F" }}>Soweto</Text>
            </Text>

            <View style={{ width: 84, height: 3, borderRadius: 2, backgroundColor: BRAND, marginTop: 10, marginBottom: 10 }} />

            <Text
              style={{
                fontSize: 15 * Math.min(s, 1.15), lineHeight: 20 * Math.min(s, 1.15), color: "#fff", fontWeight: "500",
                textShadowColor: "rgba(0,0,0,0.35)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5,
                maxWidth: 260,
              }}
            >
              Explore townships, culture, and hidden gems.
            </Text>
          </View>
        </View>

        {/* ═══════════════ WHITE CARD ═══════════════ */}
        <Animated.View
          style={{
            flex: 1, marginTop: -34, opacity: cardFade, transform: [{ translateY: cardRise }],
            backgroundColor: "#FFFFFF", borderTopLeftRadius: 38, borderTopRightRadius: 38,
            overflow: "hidden",
            shadowColor: "#0B1B3A", shadowOffset: { width: 0, height: -8 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 12,
          }}
        >
          {/* Soft geometric pattern on the edges */}
          {[0, 1, 2, 3].map((i) => (
            <View key={`l${i}`} pointerEvents="none" style={{
              position: "absolute", left: -34, top: 36 + i * 40, width: 40, height: 40,
              borderWidth: 1.5, borderColor: "rgba(16,27,61,0.06)", transform: [{ rotate: "45deg" }],
            }} />
          ))}
          {[0, 1, 2, 3].map((i) => (
            <View key={`r${i}`} pointerEvents="none" style={{
              position: "absolute", right: -34, top: 36 + i * 40, width: 40, height: 40,
              borderWidth: 1.5, borderColor: "rgba(16,27,61,0.06)", transform: [{ rotate: "45deg" }],
            }} />
          ))}

          <View
            style={[
              { paddingHorizontal: 22, paddingTop: 20, paddingBottom: 4 },
              isTablet ? { maxWidth: 560, width: "100%", alignSelf: "center" } : null,
            ]}
          >
            <Text style={{ fontSize: 25 * Math.min(s, 1.15), fontWeight: "900", color: NAVY, textAlign: "center", letterSpacing: -0.6 }}>
              Welcome to Soweto
            </Text>
            <Text style={{ fontSize: 13, lineHeight: 19, color: MUTED, textAlign: "center", marginTop: 5, paddingHorizontal: 6 }}>
              Local history, famous faces, food, events and places worth the trip, all in one app.
            </Text>

            {/* Highlight tiles */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 14 }}>
              {HIGHLIGHTS.map((h) => (
                <View
                  key={h.label}
                  style={{
                    flex: 1, marginHorizontal: 6, alignItems: "center", paddingTop: 10, paddingBottom: 9,
                    backgroundColor: "#FFFFFF", borderRadius: 16, borderWidth: 1, borderColor: LINE,
                    shadowColor: "#1B2B55", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 4,
                  }}
                >
                  <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: h.disc, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name={h.icon} size={20} color={NAVY} />
                  </View>
                  <Text style={{ fontSize: 12, fontWeight: "800", color: NAVY, marginTop: 7 }} numberOfLines={1}>{h.label}</Text>
                  <View style={{ width: 22, height: 2.5, borderRadius: 2, backgroundColor: BRAND, marginTop: 4 }} />
                </View>
              ))}
            </View>

            {/* CTA */}
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={handleGetStarted}
              accessibilityRole="button"
              accessibilityLabel="Get started"
              style={{
                marginTop: 16, borderRadius: 26,
                shadowColor: BRAND, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
              }}
            >
              <LinearGradient
                colors={[BRAND_GOLD, "#F2700C", "#E8500A"]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ height: 50, borderRadius: 25, flexDirection: "row", alignItems: "center", justifyContent: "center" }}
              >
                <Text style={{ fontSize: 17, fontWeight: "900", color: "#fff", marginRight: 12 }}>Get Started</Text>
                <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="arrow-forward" size={17} color="#fff" />
                </View>
              </LinearGradient>
            </TouchableOpacity>

            {/* Footer / signed-in hint */}
            {signedIn ? (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 12 }}>
                <ActivityIndicator size="small" color={BRAND} />
                <Text style={{ fontSize: 13.5, fontWeight: "700", color: NAVY, marginLeft: 8 }}>Welcome back, taking you in…</Text>
              </View>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: 14 }}>
                <View style={{ flex: 1, height: 1, backgroundColor: LINE }} />
                <Ionicons name="location" size={16} color={BRAND} style={{ marginLeft: 12 }} />
                <Text style={{ fontSize: 12.5, fontWeight: "600", color: NAVY, marginHorizontal: 6 }}>Your adventure begins here</Text>
                <View style={{ flex: 1, height: 1, backgroundColor: LINE }} />
              </View>
            )}
          </View>

          {/* Bottom wave band: black swoosh with an orange crest */}
          <View style={{ flex: 1, minHeight: 40 + insets.bottom, marginTop: 8, overflow: "hidden" }}>
            <View style={{
              position: "absolute", top: 14, left: "-25%", width: "150%", height: 260, borderRadius: 220,
              backgroundColor: BRAND, transform: [{ rotate: "-2deg" }],
            }} />
            <View style={{
              position: "absolute", top: 24, left: "-30%", width: "150%", height: 260, borderRadius: 220,
              backgroundColor: "#0D0D12", transform: [{ rotate: "-2deg" }],
            }} />
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  )
}

export default Splash