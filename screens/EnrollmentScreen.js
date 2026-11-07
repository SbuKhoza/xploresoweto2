import { useEffect, useMemo, useState } from "react"
import {
  Text, View, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform,
  ScrollView, FlatList, ActivityIndicator, StatusBar,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import GlossyBackground from "../components/GlossyBackground"
import { useEnrollment, GREETINGS, validateUsername, isUsernameTaken } from "../utils/enrollment"
import { getKasiOptions } from "../utils/townshipList"
import { useTownships } from "../hooks/useTownships"

const BRAND = "#E8600A"
const BRAND_DARK = "#C74E06"
const TEAL = "#1B4D5C"

const cardShadow = {
  shadowColor: "#2B5FA8", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.14, shadowRadius: 14, elevation: 4,
}

const COPY = {
  username: { icon: "at",        title: "Pick your username",        sub: "This is how other Xplorers will know you." },
  greeting: { icon: "chatbubbles", title: "How should we greet you?", sub: "Choose the hello you like. We'll use it every time you open the app." },
  kasi:     { icon: "location",  title: "Where's your kasi?",         sub: "Choose your township so we can make Soweto feel like home." },
}

/**
 * One-time enrollment shown after sign-up:
 *   1. username (skipped automatically if they already chose one at sign-up)
 *   2. greeting — Aweh · Fede · Eita · Hello
 *   3. kasi — one of the Soweto townships
 * Rendered by MainGate in App.js until the user has finished.
 */
export default function EnrollmentScreen() {
  const insets = useSafeAreaInsets()
  const { user, existing, complete } = useEnrollment()

  const hasUsername = !!existing?.username
  const steps = useMemo(() => (hasUsername ? ["greeting", "kasi"] : ["username", "greeting", "kasi"]), [hasUsername])

  const [stepIdx, setStepIdx] = useState(0)
  const [username, setUsername] = useState("")
  const [greeting, setGreeting] = useState(null)
  const [kasi, setKasi] = useState(null)
  const [other, setOther] = useState(false)
  const [otherText, setOtherText] = useState("")
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const { townships } = useTownships()

  const step = steps[Math.min(stepIdx, steps.length - 1)]
  const isLast = stepIdx >= steps.length - 1

  // Active townships from the CMS (cached offline) are added to the built-in kasi list
  const remoteNames = useMemo(() => townships.map((t) => t.info.name), [townships])

  const options = useMemo(() => getKasiOptions(remoteNames), [remoteNames])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((n) => n.toLowerCase().includes(q)) : options
  }, [options, query])

  const previewName = (username.trim() || existing?.username || (user?.displayName || "").split(" ")[0] || "friend")
  const usernameCheck = validateUsername(username)

  const canContinue =
    step === "username" ? usernameCheck.ok :
    step === "greeting" ? !!greeting :
    (other ? otherText.trim().length >= 2 : !!kasi)

  const goBack = () => { setError(""); setStepIdx((i) => Math.max(0, i - 1)) }

  const onNext = async () => {
    if (!canContinue || busy) return
    setError("")

    if (step === "username") {
      setBusy(true)
      try {
        if (await isUsernameTaken(username.trim(), user?.uid)) { setError("That username is taken. Try another."); return }
      } catch {
        setError("Couldn't check that username. Check your connection and try again."); return
      } finally { setBusy(false) }
    }

    if (!isLast) { setStepIdx((i) => i + 1); return }

    setBusy(true)
    try {
      await complete({
        username: hasUsername ? undefined : username.trim(),
        greeting,
        kasi: other ? otherText.trim() : kasi,
      })
      // MainGate swaps this screen for the app as soon as enrollment is saved
    } catch (e) {
      setError(e?.message || "Something went wrong. Please try again.")
      setBusy(false)
    }
  }

  // ── Step bodies ───────────────────────────────────────────────────────────
  const UsernameStep = (
    <View>
      <View className="flex-row items-center bg-surface rounded-2xl px-4 border border-line" style={{ height: 56, ...cardShadow }}>
        <Ionicons name="at-outline" size={20} color={TEAL} />
        <TextInput
          value={username}
          onChangeText={(t) => { setUsername(t); setError("") }}
          placeholder="e.g. sbu_k"
          placeholderTextColor="#9AA9AE"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
          returnKeyType="next"
          onSubmitEditing={onNext}
          className="flex-1 ml-3 text-[16px] font-semibold text-ink"
          style={{ paddingVertical: 0 }}
        />
        {username.length > 0 && (
          <Ionicons name={usernameCheck.ok ? "checkmark-circle" : "alert-circle"} size={20} color={usernameCheck.ok ? "#22C55E" : "#EF4444"} />
        )}
      </View>
      <Text className="text-[12.5px] mt-2.5 ml-1" style={{ color: username.length > 0 && !usernameCheck.ok ? "#DC2626" : "#5E7088" }}>
        {username.length > 0 && !usernameCheck.ok ? usernameCheck.message : "3–20 characters. Letters, numbers, . and _"}
      </Text>
    </View>
  )

  const GreetingStep = (
    <View>
      <View className="flex-row flex-wrap justify-between">
        {GREETINGS.map((g) => {
          const on = greeting === g.key
          return (
            <TouchableOpacity
              key={g.key}
              activeOpacity={0.9}
              onPress={() => { setGreeting(g.key); setError("") }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Greeting ${g.key}`}
              style={{ width: "48%", marginBottom: 12, borderRadius: 22, opacity: greeting && !on ? 0.72 : 1, ...cardShadow }}
            >
              <LinearGradient colors={g.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ borderRadius: 22, paddingVertical: 22, alignItems: "center", borderWidth: on ? 3 : 0, borderColor: "#FFFFFF", overflow: "hidden" }}>
                <LinearGradient pointerEvents="none" colors={["rgba(255,255,255,0.3)", "rgba(255,255,255,0)"]}
                  style={{ position: "absolute", top: 0, left: 0, right: 0, height: "60%" }} />
                <Text style={{ fontSize: 34 }}>{g.emoji}</Text>
                <Text className="text-[22px] font-extrabold text-white mt-1">{g.key}</Text>
                {on && (
                  <View className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full bg-white items-center justify-center">
                    <Ionicons name="checkmark" size={16} color={g.colors[0]} />
                  </View>
                )}
              </LinearGradient>
            </TouchableOpacity>
          )
        })}
      </View>

      {/* Live preview */}
      <View className="bg-surface rounded-2xl px-4 py-3.5 border border-line mt-1 flex-row items-center" style={cardShadow}>
        <View className="w-10 h-10 rounded-xl bg-brand-light items-center justify-center">
          <Ionicons name="eye" size={20} color={BRAND} />
        </View>
        <View className="ml-3 flex-1">
          <Text className="text-[11px] font-bold text-muted uppercase">Preview</Text>
          <Text className="text-[17px] font-extrabold text-ink" numberOfLines={1}>
            {greeting ? `${greeting}, ${previewName}!` : "Tap a greeting above"}
          </Text>
        </View>
      </View>
    </View>
  )

  const KasiRow = ({ item }) => {
    const on = !other && kasi === item
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => { setOther(false); setKasi(item); setError("") }}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        className="flex-row items-center rounded-2xl px-4 py-3.5 mb-2.5 border"
        style={{ backgroundColor: on ? "#FFF1E8" : "#FFFFFF", borderColor: on ? BRAND : "#DDE2EA", ...cardShadow }}
      >
        <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: on ? BRAND : "#C9E8F3" }}>
          <Ionicons name="location" size={18} color={on ? "#fff" : TEAL} />
        </View>
        <Text className="flex-1 text-[15px] font-bold text-ink ml-3">{item}</Text>
        <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={22} color={on ? BRAND : "#B5BDBF"} />
      </TouchableOpacity>
    )
  }

  const KasiHeader = (
    <View className="mb-3">
      <View className="flex-row items-center h-[46px] rounded-full bg-surface px-3.5 border border-line" style={cardShadow}>
        <Ionicons name="search" size={17} color="#5E7088" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search your township…"
          placeholderTextColor="#9AA9AE"
          autoCapitalize="none"
          autoCorrect={false}
          className="flex-1 ml-2.5 text-[14px] text-ink"
          style={{ paddingVertical: 0 }}
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color="#B5BDBF" />
          </TouchableOpacity>
        )}
      </View>
      {kasi && !other ? (
        <View className="flex-row items-center self-start bg-brand-light rounded-full px-3 py-1.5 mt-3">
          <Ionicons name="checkmark-circle" size={15} color={BRAND} />
          <Text className="text-[12.5px] font-extrabold ml-1.5" style={{ color: BRAND_DARK }}>Your kasi: {kasi}</Text>
        </View>
      ) : null}
    </View>
  )

  const KasiFooter = (
    <View className="mt-1">
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => { setOther(true); setKasi(null); setError("") }}
        className="flex-row items-center rounded-2xl px-4 py-3.5 border"
        style={{ backgroundColor: other ? "#FFF1E8" : "#FFFFFF", borderColor: other ? BRAND : "#DDE2EA", borderStyle: "dashed" }}
      >
        <View className="w-9 h-9 rounded-xl items-center justify-center bg-teal-light">
          <Ionicons name="add" size={20} color={TEAL} />
        </View>
        <Text className="flex-1 text-[14.5px] font-bold text-ink ml-3">My kasi isn't listed</Text>
        <Ionicons name={other ? "radio-button-on" : "radio-button-off"} size={22} color={other ? BRAND : "#B5BDBF"} />
      </TouchableOpacity>
      {other && (
        <TextInput
          value={otherText}
          onChangeText={setOtherText}
          placeholder="Type your kasi's name"
          placeholderTextColor="#9AA9AE"
          autoCapitalize="words"
          maxLength={40}
          className="bg-surface rounded-2xl px-4 mt-2.5 border border-line text-[15px] font-semibold text-ink"
          style={{ height: 50 }}
        />
      )}
    </View>
  )

  const meta = COPY[step]

  return (
    <KeyboardAvoidingView className="flex-1 bg-bg" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <GlossyBackground />
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      {/* ── Header: progress + title ── */}
      <View className="px-6" style={{ paddingTop: insets.top + 18 }}>
        <View className="flex-row items-center">
          {stepIdx > 0 ? (
            <TouchableOpacity onPress={goBack} accessibilityLabel="Back" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              className="w-9 h-9 rounded-full bg-surface items-center justify-center border border-line mr-3">
              <Ionicons name="arrow-back" size={18} color={TEAL} />
            </TouchableOpacity>
          ) : null}
          <View className="flex-1 flex-row">
            {steps.map((s, i) => (
              <View key={s} className="flex-1 h-[6px] rounded-full mx-[3px]" style={{ backgroundColor: i <= stepIdx ? BRAND : "#D5DCE8" }} />
            ))}
          </View>
        </View>

        <Text className="text-[12px] font-extrabold text-brand uppercase mt-4" style={{ letterSpacing: 1 }}>
          Step {stepIdx + 1} of {steps.length}
        </Text>
        <View className="flex-row items-center mt-1.5">
          <View className="w-11 h-11 rounded-2xl items-center justify-center bg-brand mr-3">
            <Ionicons name={meta.icon} size={22} color="#fff" />
          </View>
          <Text className="flex-1 text-[25px] font-extrabold text-ink -tracking-[0.5px]" style={{ lineHeight: 30 }}>{meta.title}</Text>
        </View>
        <Text className="text-[14px] text-muted mt-2" style={{ lineHeight: 20 }}>{meta.sub}</Text>
      </View>

      {/* ── Body ── */}
      <View className="flex-1 mt-5">
        {step === "kasi" ? (
          <FlatList
            data={filtered}
            keyExtractor={(n) => n}
            renderItem={KasiRow}
            ListHeaderComponent={KasiHeader}
            ListFooterComponent={KasiFooter}
            ListEmptyComponent={<Text className="text-[13px] text-muted text-center my-6">No match. You can add your kasi below.</Text>}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24 }}
          />
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24 }}>
            {step === "username" ? UsernameStep : GreetingStep}
          </ScrollView>
        )}
      </View>

      {/* ── Footer: error + continue ── */}
      <View className="px-6 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 14) + 6 }}>
        {error ? (
          <View className="flex-row items-center bg-danger-light rounded-xl px-3 py-2.5 mb-3">
            <Ionicons name="alert-circle" size={17} color="#DC2626" />
            <Text className="flex-1 text-[12.5px] font-semibold ml-2" style={{ color: "#B91C1C" }}>{error}</Text>
          </View>
        ) : null}
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={onNext}
          disabled={!canContinue || busy}
          accessibilityRole="button"
          accessibilityLabel={isLast ? "Finish" : "Continue"}
          style={{ borderRadius: 18, opacity: canContinue ? 1 : 0.5, shadowColor: BRAND, shadowOffset: { width: 0, height: 8 }, shadowOpacity: canContinue ? 0.4 : 0, shadowRadius: 14, elevation: canContinue ? 8 : 0 }}
        >
          <LinearGradient colors={canContinue ? [BRAND, BRAND_DARK] : ["#9AA9AE", "#8795A0"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ borderRadius: 18, paddingVertical: 16, flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
            {busy ? <ActivityIndicator color="#fff" /> : (
              <>
                <Text className="text-[16.5px] font-extrabold text-white mr-2">{isLast ? "Finish & enter Soweto" : "Continue"}</Text>
                <Ionicons name={isLast ? "checkmark-circle" : "arrow-forward"} size={19} color="#fff" />
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}