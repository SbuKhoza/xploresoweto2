import { useState, useEffect, useMemo } from "react"
import { Text, View, TouchableOpacity, TextInput, StatusBar } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"
import { collection, getDocs } from "firebase/firestore"
import { db } from "../Firebase/config"
import { useScrollTracking, AnimatedFlatList } from "../components/BottomNav"
import TownshipSheet from "../components/township/TownshipSheet"
import { TOWNSHIPS, findTownshipInfo, getTownshipInfo } from "../utils/townships"

const TEAL = "#1B4D5C"
const MUTED = "#5E7088"

const cardShadow = {
  shadowColor: "#2B5FA8", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 6,
}

// Full, de-duplicated township directory: Firestore townships first, then every
// built-in township that Firestore doesn't already have. Sorted A–Z.
// (Kept in this file so the screen only depends on the core township exports.)
const normName = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()
const buildTownshipList = (docs = []) => {
  const out = []
  const seen = new Set()
  docs.forEach((d) => {
    if (!d?.name) return
    const info = findTownshipInfo(d.name)
    const k = info ? info.key : normName(d.name)
    if (seen.has(k)) return
    seen.add(k)
    out.push(d)
  })
  TOWNSHIPS.forEach((t) => {
    if (seen.has(t.key)) return
    seen.add(t.key)
    out.push({ id: t.key, name: t.name })
  })
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

/**
 * Directory of every Soweto township. Opened from Home → Soweto Townships → See All.
 * Townships come from Firestore (homescreen collection, type "township") merged
 * with the built-in list in utils/townships.js, so it is never empty, even offline.
 */
export default function SowetoTownships() {
  const scrollProps = useScrollTracking()
  const [remote, setRemote] = useState([])
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(null)
  const [activeIdx, setActiveIdx] = useState(0)

  // Best-effort Firestore fetch — the built-in list shows immediately
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const snap = await getDocs(collection(db, "homescreen"))
        const docs = []
        snap.forEach((s) => { const d = s.data(); if (d.type === "township") docs.push({ id: s.id, ...d }) })
        if (alive) setRemote(docs)
      } catch { /* offline: bundled list is enough */ }
    })()
    return () => { alive = false }
  }, [])

  // Attach full info (colours, people, etc.) to each township once
  const all = useMemo(
    () => buildTownshipList(remote).map((t, i) => ({ doc: t, info: getTownshipInfo(t, i), index: i })),
    [remote]
  )

  // Search matches the township name, its area, or the names of its local legends
  const q = query.trim().toLowerCase()
  const data = useMemo(() => {
    if (!q) return all
    return all.filter(({ info }) =>
      info.name.toLowerCase().includes(q) ||
      (info.area || "").toLowerCase().includes(q) ||
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
          {all.length} townships · history, local legends & landmarks
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
        keyExtractor={(item) => item.info.key + item.index}
        renderItem={renderItem}
        numColumns={2}
        columnWrapperStyle={{ justifyContent: "space-between" }}
        contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 4, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View className="items-center mt-12 px-8">
            <View className="w-20 h-20 rounded-3xl bg-teal-light justify-center items-center mb-4">
              <Ionicons name="search" size={34} color={TEAL} />
            </View>
            <Text className="text-[16px] font-extrabold text-ink text-center">No townships found</Text>
            <Text className="text-[13px] text-muted text-center mt-1">Try a different name or clear your search.</Text>
          </View>
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