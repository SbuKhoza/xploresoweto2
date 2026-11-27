import { useState, useMemo, useCallback } from "react"
import { Text, View, TouchableOpacity, TextInput, StatusBar, ActivityIndicator, RefreshControl, useWindowDimensions } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useScrollTracking, AnimatedFlatList } from "../components/BottomNav"
import TownshipSheet from "../components/township/TownshipSheet"
import TownshipCard from "../components/township/TownshipCard"
import DynamicHero, { CREAM } from "../components/DynamicHero"
import { useScreenBack } from "../hooks/useScreenBack"
import { useTownships } from "../hooks/useTownships"

const TEAL = "#1B4D5C"
const BRAND = "#E8600A"
const INK = "#14213D"
const MUTED = "#5E7088"

/**
 * Directory of every Soweto township. Opened from Home → Soweto Townships → See All.
 * Fully dynamic: townships come from Firestore (homescreen, type "township") via useTownships, cached for offline use, inactive ones hidden.
 * The hero is the existing dynamic Home banner (CMS-managed). The count shown is the number of townships actually loaded.
 * Manage townships in the Xplore CMS → Soweto → Townships.
 */
export default function SowetoTownships() {
  const scrollProps = useScrollTracking()
  const insets = useSafeAreaInsets()
  const { height: screenH } = useWindowDimensions()
  const goBack = useScreenBack()
  const { townships: all, loading, isOffline, refresh } = useTownships()
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(null)
  const [activeIdx, setActiveIdx] = useState(0)

  // Search matches the township name, its area, its aliases, or the names of its local legends
  const q = query.trim().toLowerCase()
  const data = useMemo(() => {
    if (!q) return all
    return all.filter(({ info }) =>
      info.name.toLowerCase().includes(q) ||
      (info.area || "").toLowerCase().includes(q) ||
      info.aliases.some((a) => String(a).toLowerCase().includes(q)) ||
      info.people.some((p) => p.name.toLowerCase().includes(q))
    )
  }, [all, q])

  const renderItem = useCallback(({ item }) => (
    <TownshipCard info={item.info} onPress={() => { setActiveIdx(item.index); setActive(item.doc) }} />
  ), [])

  const heroH = Math.round(Math.min(210, Math.max(150, screenH * 0.22)))

  const header = (
    <View>
      <DynamicHero height={heroH} topInset={insets.top}>
        <TouchableOpacity onPress={goBack} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={{ position: "absolute", left: 16, top: insets.top + 10, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,248,240,0.94)", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="chevron-back" size={22} color={INK} />
        </TouchableOpacity>
        <View style={{ position: "absolute", left: 72, top: insets.top + 12, backgroundColor: "rgba(255,248,240,0.9)", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 }}>
          <Text style={{ fontSize: 22, fontWeight: "900", color: INK, letterSpacing: -0.4 }}>Xplore<Text style={{ color: BRAND }}>Soweto</Text></Text>
        </View>
      </DynamicHero>

      <View style={{ paddingHorizontal: 22, marginTop: -4, paddingBottom: 14 }}>
        <Text style={{ fontSize: 33, lineHeight: 39, fontWeight: "900", color: INK, letterSpacing: -0.8 }} accessibilityRole="header">Soweto Townships</Text>
        <View style={{ width: 150, height: 4, borderRadius: 2, backgroundColor: BRAND, marginTop: 1, marginLeft: 70, transform: [{ rotate: "-1deg" }] }} />
        <Text style={{ fontSize: 14.5, lineHeight: 21, color: MUTED, fontWeight: "500", marginTop: 8 }}>
          {all.length} {all.length === 1 ? "township" : "townships"} · history, local legends & landmarks
        </Text>

        <View style={{ flexDirection: "row", alignItems: "center", minHeight: 52, borderRadius: 26, backgroundColor: "#fff", paddingHorizontal: 16, borderWidth: 1.5, borderColor: BRAND, marginTop: 14 }}>
          <Ionicons name="search" size={20} color={BRAND} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search a township or a local legend…"
            placeholderTextColor="#8A94A0"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search townships"
            style={{ flex: 1, marginLeft: 10, fontSize: 15, color: INK, paddingVertical: 8 }}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityRole="button" accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={20} color="#B5BDBF" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: CREAM }}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <AnimatedFlatList
        data={data}
        keyExtractor={(item) => item.info.key}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} colors={[BRAND]} tintColor={BRAND} progressViewOffset={insets.top} />}
        renderItem={renderItem}
        numColumns={2}
        columnWrapperStyle={{ justifyContent: "space-between", paddingHorizontal: 22 }}
        contentContainerStyle={{ paddingBottom: 120 }}
        ListHeaderComponent={header}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={7}
        removeClippedSubviews
        ListEmptyComponent={
          loading ? (
            <View className="items-center mt-12"><ActivityIndicator size="large" color={BRAND} /></View>
          ) : (
            <View className="items-center mt-8 px-8">
              <View className="w-20 h-20 rounded-3xl bg-teal-light justify-center items-center mb-4">
                <Ionicons name={all.length === 0 ? (isOffline ? "cloud-offline-outline" : "location-outline") : "search"} size={34} color={TEAL} />
              </View>
              <Text className="text-[16px] font-extrabold text-ink text-center">
                {all.length === 0 ? (isOffline ? "You're offline" : "No townships yet") : "No townships found"}
              </Text>
              <Text className="text-[13px] text-muted text-center mt-1">
                {all.length === 0
                  ? (isOffline ? "Connect once to download the township guides." : "Check back soon — we're adding them.")
                  : "Try a different name or clear your search."}
              </Text>
            </View>
          )
        }
        {...scrollProps}
      />

      <TownshipSheet
        visible={!!active}
        township={active}
        index={activeIdx}
        onClose={() => setActive(null)}
      />
    </View>
  )
}
