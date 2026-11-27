import { Text, View, TouchableOpacity, ScrollView, ActivityIndicator, StatusBar, useWindowDimensions } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import DynamicHero, { CREAM } from "./DynamicHero"

const BRAND = "#E8600A"
const BRAND_DARK = "#C74E06"
const INK = "#14213D"
const MUTED = "#5E7088"

// Soft tint of a "#RRGGBB" colour (hex alpha), used for the option cards' pastel backgrounds
const tint = (hex, alpha) => `${/^#[0-9a-f]{6}$/i.test(hex) ? hex : BRAND}${alpha}`

/**
 * Visual layer of the greeting step (step 1 of enrolment). It owns NO enrolment logic: the options, the selection, validation, saving and
 * navigation all stay in EnrollmentScreen / utils/enrollment, which pass them in. The banner is the existing dynamic one (DynamicHero).
 */
export default function GreetingEnrollment({ greetings, greeting, onSelect, previewName, stepIndex, stepCount, title, subtitle, canContinue, busy, error, onNext }) {
  const insets = useSafeAreaInsets()
  const { height: screenH } = useWindowDimensions()
  const heroH = Math.round(Math.min(230, Math.max(168, screenH * 0.25)))
  const pct = Math.max(0, Math.min(1, (stepIndex + 1) / Math.max(1, stepCount)))

  return (
    <View style={{ flex: 1, backgroundColor: CREAM }}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ paddingBottom: 20 }}>
        <DynamicHero height={heroH} topInset={insets.top}>
          <View style={{ position: "absolute", left: 20, top: insets.top + 12, backgroundColor: "rgba(255,248,240,0.9)", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 }}>
            <Text style={{ fontSize: 26, fontWeight: "900", color: INK, letterSpacing: -0.5 }} accessibilityRole="header">
              Xplore<Text style={{ color: BRAND }}>Soweto</Text>
            </Text>
            <Text style={{ fontSize: 9, fontWeight: "800", color: INK, letterSpacing: 1.2, marginTop: 1 }}>EXPLORE · EXPERIENCE · SUPPORT LOCAL</Text>
          </View>
        </DynamicHero>

        <View style={{ paddingHorizontal: 22, marginTop: -6 }}>
          {/* progress */}
          <Text style={{ fontSize: 15, fontWeight: "800", color: INK }} accessibilityLabel={`Step ${stepIndex + 1} of ${stepCount}`}>Step {stepIndex + 1} of {stepCount}</Text>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: "#E9E3DC", marginTop: 8, overflow: "hidden" }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: stepCount, now: stepIndex + 1 }}>
            <View testID="enrol-progress-fill" style={{ width: `${Math.round(pct * 100)}%`, height: 8, borderRadius: 4, backgroundColor: BRAND }} />
          </View>

          <Text style={{ fontSize: 29, lineHeight: 35, fontWeight: "900", color: INK, letterSpacing: -0.6, marginTop: 22 }} accessibilityRole="header">{title}</Text>
          <View style={{ width: 118, height: 4, borderRadius: 2, backgroundColor: BRAND, alignSelf: "flex-end", marginTop: 2, marginRight: 8, transform: [{ rotate: "-1.5deg" }] }} />
          <Text style={{ fontSize: 15, lineHeight: 22, color: MUTED, marginTop: 10 }}>{subtitle}</Text>

          {/* greeting cards */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: 18 }}>
            {greetings.map((g) => {
              const on = greeting === g.key
              return (
                <TouchableOpacity
                  key={g.key}
                  activeOpacity={0.88}
                  onPress={() => onSelect(g.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Greeting ${g.key}`}
                  style={{
                    width: "48%", minHeight: 112, marginBottom: 14, borderRadius: 22, overflow: "hidden", alignItems: "center", justifyContent: "center", paddingVertical: 16,
                    backgroundColor: on ? "#FFEFE3" : tint(g.colors[0], "14"),
                    borderWidth: on ? 2.5 : 1.5, borderColor: on ? BRAND : tint(g.colors[0], "33"),
                  }}
                >
                  <View pointerEvents="none" style={{ position: "absolute", left: -20, bottom: -20, width: 70, height: 70, borderRadius: 35, borderWidth: 7, borderColor: tint(g.colors[0], "26") }} />
                  <Text style={{ fontSize: 42 }}>{g.emoji}</Text>
                  <Text style={{ fontSize: 23, fontWeight: "900", color: INK, marginTop: 4 }}>{g.key}</Text>
                  {on && (
                    <View testID={`selected-${g.key}`} style={{ position: "absolute", top: 10, right: 10, width: 28, height: 28, borderRadius: 14, backgroundColor: BRAND, alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="checkmark" size={18} color="#fff" />
                    </View>
                  )}
                </TouchableOpacity>
              )
            })}
          </View>

          {/* live preview */}
          <Text style={{ fontSize: 15, fontWeight: "700", color: MUTED, marginTop: 6 }}>Preview</Text>
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10 }}>
            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: BRAND, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="location" size={26} color="#fff" />
            </View>
            <View style={{ flex: 1, marginLeft: 12, backgroundColor: "#FBE7D6", borderRadius: 22, borderBottomLeftRadius: 6, paddingHorizontal: 18, paddingVertical: 14 }}>
              <Text testID="greeting-preview" style={{ fontSize: 17, lineHeight: 23, fontWeight: "800", color: INK }}>
                {greeting ? `${greeting}, ${previewName}! Welcome to XploreSoweto.` : "Tap a greeting above"}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* continue */}
      <View style={{ paddingHorizontal: 22, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 14) + 6, backgroundColor: CREAM }}>
        {error ? (
          <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#FFD2D2", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 }}>
            <Ionicons name="alert-circle" size={17} color="#DC2626" />
            <Text style={{ flex: 1, fontSize: 12.5, fontWeight: "600", marginLeft: 8, color: "#B91C1C" }}>{error}</Text>
          </View>
        ) : null}
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={onNext}
          disabled={!canContinue || busy}
          accessibilityRole="button"
          accessibilityLabel="Continue"
          accessibilityState={{ disabled: !canContinue || busy }}
          style={{ borderRadius: 20, minHeight: 56, opacity: canContinue ? 1 : 0.5, shadowColor: BRAND, shadowOffset: { width: 0, height: 8 }, shadowOpacity: canContinue ? 0.35 : 0, shadowRadius: 14, elevation: canContinue ? 8 : 0 }}
        >
          <LinearGradient colors={canContinue ? [BRAND, BRAND_DARK] : ["#9AA9AE", "#8795A0"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ borderRadius: 20, minHeight: 56, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 15 }}>
            {busy ? <ActivityIndicator color="#fff" /> : (
              <>
                <Text style={{ fontSize: 19, fontWeight: "900", color: "#fff", marginRight: 8 }}>Continue</Text>
                <Ionicons name="arrow-forward" size={22} color="#fff" />
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  )
}
