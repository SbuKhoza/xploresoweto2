import { useState, useMemo } from "react"
import { Text, View, TouchableOpacity, TextInput, StatusBar, ActivityIndicator, RefreshControl } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"
import { useScrollTracking, AnimatedFlatList } from "../components/BottomNav"
import TownshipSheet from "../components/township/TownshipSheet"
import { useTownships } from "../hooks/useTownships"

const TEAL = "#1B4D5C"
const MUTED = "#5E7088"

const cardShadow = {
  shadowColor: "#2B5FA8", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 6,
}

/**
 * Directory of every Soweto township. Opened from Home → Soweto Townships → See All.
 * Fully dynamic: townships come from Firestore (homescreen, type "township") via
 * useTownships, cached for offline use. Manage them in the Xplore CMS → Soweto → Townships.
 */
export default function SowetoTownships() {
  const scrollProps = useScrollTracking()
  const { townships: all, loading, isOffline, refresh } = useTownships()
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(null)
  const [activeIdx, setActiveIdx] = useState(0)

  // Search matches the township name, its area, or the names of its local legends
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

  const renderItem = ({ item }) => {
    const { info, doc, index } = item
    const [c1, c2] = info.colors
    return (
      <TouchableOpacity
        activeOpacity={0.88}
        onPress={() => { setActiveIdx(index); setActive(doc) }}
        accessibilityRole="button"
        accessibilityLabel={`${info.name} township info`}
        style={{ width: "48%", marginBottom: 12, borderRadius: 20, ...cardShadow }}
      >
        <LinearGradient colors={[c1, c2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ borderRadius: 20, padding: 14, minHeight: 150, overflow: "hidden" }}>
          {/* glass highlight + big watermark letter */}
          <LinearGradient pointerEvents="none" colors={["rgba(255,255,255,0.30)", "rgba(255,255,255,0)"]}
            style={{ position: "absolute", top: 0, left: 0, right: 0, height: "60%" }} />
          <Text style={{ position: "absolute", right: -6, bottom: -26, fontSize: 96, fontWeight: "900", color: "rgba(255,255,255,0.14)" }}>
            {info.name.charAt(0)}
          </Text>

          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="location" size={18} color="#fff" />
          </View>
          <Text numberOfLines={1} style={{ color: "#fff", fontSize: 18, fontWeight: "800", marginTop: 12, letterSpacing: -0.3 }}>{info.name}</Text>
          <Text numberOfLines={2} style={{ color: "rgba(255,255,255,0.9)", fontSize: 11.5, marginTop: 3, lineHeight: 16 }}>
            {info.tagline}
          </Text>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {info.established ? (
              <View style={{ backgroundColor: "rgba(255,255,255,0.22)", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>Est. {info.established}</Text>
              </View>
            ) : null}
            {info.people.length > 0 ? (
              <View style={{ backgroundColor: "rgba(255,255,255,0.22)", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>{info.people.length} legends</Text>
              </View>
            ) : null}
          </View>
        </LinearGradient>
      </TouchableOpacity>
    )
  }

  return (
    <View className="flex-1">
      <StatusBar barStyle="dark-content" />

      {/* Title + search */}
      <View className="px-[22px] pt-2 pb-3">
        <Text className="text-[26px] font-extrabold text-ink -tracking-tight">Soweto Townships</Text>
        <Text className="text-[13px] text-muted font-medium mt-0.5">
          {all.length} {all.length === 1 ? "township" : "townships"} · history, local legends & landmarks
        </Text>

        <View className="flex-row items-center h-[44px] rounded-full bg-surface px-3.5 border border-line mt-3" style={{ shadowColor: "#2B5FA8", shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 }}>
          <Ionicons name="search" size={17} color={MUTED} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search a township or a local legend…"
            placeholderTextColor="#9AA9AE"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            className="flex-1 ml-2.5 text-[14px] text-ink"
            style={{ paddingVertical: 0 }}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color="#B5BDBF" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <AnimatedFlatList
        data={data}
        keyExtractor={(item) => item.info.key}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} colors={["#E8600A"]} tintColor="#E8600A" />}
        renderItem={renderItem}
        numColumns={2}
        columnWrapperStyle={{ justifyContent: "space-between" }}
        contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 4, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          loading ? (
            <View className="items-center mt-16"><ActivityIndicator size="large" color="#E8600A" /></View>
          ) : (
            <View className="items-center mt-12 px-8">
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