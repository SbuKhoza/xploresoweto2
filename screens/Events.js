"use client"
import { useState, useMemo, useCallback } from "react"
import { Text, View, TouchableOpacity, ActivityIndicator, RefreshControl, ScrollView, Linking, Share } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"
import dayjs from "dayjs"
import { useScrollTracking, AnimatedFlatList } from "../components/BottomNav"
import { useOfflineData } from "../hooks/useOfflineData"
import OfflineIndicator from "../components/OfflineIndicator"
import CoverImage from "../components/content/CoverImage"
import DetailSheet from "../components/content/DetailSheet"
import {
  TEAL, BRAND, cardShadow, eventImage, eventTime, normaliseEvent,
  buildFallbackEvents, EVENT_FALLBACK_IMAGE, matchesQuery,
} from "../utils/content"

const SEARCH_FIELDS = ["title", "name", "location", "category", "description"]
const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }

const daysUntil = (d) => dayjs(d).startOf("day").diff(dayjs().startOf("day"), "day")
const countdown = (n) => (n <= 0 ? "Today" : n === 1 ? "Tomorrow" : `In ${n} days`)
const whenLine = (e) => [dayjs(e._date).format("D MMM"), eventTime(e)].filter(Boolean).join("  •  ")

// ── Large card for the next upcoming event ──────────────────────────────────
const EventHero = ({ e, onPress }) => (
  <TouchableOpacity activeOpacity={0.9} onPress={onPress}
    style={[{ height: 210, borderRadius: 22, backgroundColor: "#fff", marginBottom: 18 }, cardShadow]}>
    <View style={{ flex: 1, borderRadius: 22, overflow: "hidden" }}>
      <CoverImage source={eventImage(e)} fallbackSource={EVENT_FALLBACK_IMAGE} fallbackIcon="calendar" iconSize={34} style={{ ...FILL, width: "100%", height: "100%" }} />
      <LinearGradient pointerEvents="none" colors={["rgba(10,30,38,0)", "rgba(10,30,38,0.35)", "rgba(10,30,38,0.88)"]} locations={[0.25, 0.55, 1]} style={FILL} />

      <View style={{ position: "absolute", top: 12, left: 12, right: 12, flexDirection: "row", justifyContent: "space-between" }}>
        <View style={{ backgroundColor: BRAND, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
          <Text className="text-[10px] font-extrabold text-white uppercase tracking-[0.6px]">Next up</Text>
        </View>
        <View style={{ backgroundColor: "rgba(255,255,255,0.92)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
          <Text className="text-[11px] font-extrabold text-teal">{countdown(daysUntil(e._date))}</Text>
        </View>
      </View>

      <View style={{ position: "absolute", left: 14, right: 14, bottom: 14 }}>
        <Text className="text-[11px] font-bold text-white/80 uppercase tracking-[0.6px]" numberOfLines={1}>{e.category || "Event"}</Text>
        <Text className="text-[20px] font-extrabold text-white -tracking-[0.3px] mt-0.5" numberOfLines={2}>{e.title || e.name}</Text>
        <View className="flex-row items-center mt-1.5">
          <Ionicons name="calendar-outline" size={13} color="#fff" />
          <Text className="text-[12px] font-semibold text-white ml-1.5">{whenLine(e)}</Text>
          {e.location ? (
            <>
              <Ionicons name="location-outline" size={13} color="#fff" style={{ marginLeft: 12 }} />
              <Text className="text-[12px] font-semibold text-white ml-1 flex-1" numberOfLines={1}>{e.location}</Text>
            </>
          ) : null}
        </View>
      </View>
    </View>
  </TouchableOpacity>
)

// ── List card: same look as the Home carousel card ──────────────────────────
const EventCard = ({ e, onPress }) => (
  <TouchableOpacity activeOpacity={0.9} onPress={onPress}
    style={[{ height: 104, borderRadius: 18, backgroundColor: "#fff", marginBottom: 12 }, cardShadow]}>
    <View style={{ flex: 1, borderRadius: 18, overflow: "hidden" }}>
      <CoverImage source={eventImage(e)} fallbackSource={EVENT_FALLBACK_IMAGE} fallbackIcon="calendar" iconSize={26} style={{ ...FILL, width: "100%", height: "100%" }} />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(255,255,255,0.97)", "rgba(255,255,255,0.88)", "rgba(255,255,255,0.35)", "rgba(255,255,255,0)"]}
        locations={[0, 0.4, 0.68, 0.92]}
        start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
        style={FILL}
      />
      <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 10, justifyContent: "space-between" }}>
        <View style={{ width: "68%" }}>
          <View style={{ alignSelf: "flex-start", backgroundColor: BRAND, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
            <Text className="text-[9px] font-extrabold text-white uppercase tracking-[0.5px]" numberOfLines={1}>{e.category || "Event"}</Text>
          </View>
          <Text className="text-[14.5px] font-extrabold text-ink -tracking-[0.2px] mt-1" numberOfLines={1}>{e.title || e.name}</Text>
        </View>
        <View style={{ width: "72%" }}>
          <View className="flex-row items-center">
            <Ionicons name="calendar-outline" size={12} color={TEAL} />
            <Text className="text-[11px] font-semibold text-ink ml-1.5" numberOfLines={1}>{whenLine(e)}</Text>
          </View>
          {e.location ? (
            <View className="flex-row items-center mt-0.5">
              <Ionicons name="location-outline" size={12} color={TEAL} />
              <Text className="text-[11px] font-semibold text-ink ml-1.5" numberOfLines={1}>{e.location}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={{ position: "absolute", right: 10, bottom: 10, width: 28, height: 28, borderRadius: 14, backgroundColor: "#fff", justifyContent: "center", alignItems: "center", shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 3 }}>
        <Ionicons name="arrow-forward" size={15} color={BRAND} />
      </View>
    </View>
  </TouchableOpacity>
)

const Events = ({ search = "" }) => {
  const [tab, setTab]           = useState("upcoming") // "upcoming" | "past"
  const [category, setCategory] = useState("All")
  const [selected, setSelected] = useState(null)
  const scrollProps = useScrollTracking()

  const options = useMemo(() => ({ maxAgeMinutes: 20, enableBackgroundRefresh: true }), [])
  const { data, loading, isOffline, refresh } = useOfflineData("events", options)

  const live = useMemo(
    () => (data || []).filter((e) => e.isActive !== false).map(normaliseEvent).filter((e) => e._date && (e.title || e.name)),
    [data]
  )
  const usingFallback = live.length === 0
  const all = useMemo(() => (usingFallback ? buildFallbackEvents().map(normaliseEvent) : live), [usingFallback, live])

  const { upcoming, past } = useMemo(() => {
    const today = dayjs().startOf("day")
    return {
      upcoming: all.filter((e) => !dayjs(e._date).isBefore(today)).sort((a, b) => a._date - b._date),
      past:     all.filter((e) =>  dayjs(e._date).isBefore(today)).sort((a, b) => b._date - a._date),
    }
  }, [all])

  const pool = tab === "upcoming" ? upcoming : past
  const categories = useMemo(() => ["All", ...Array.from(new Set(pool.map((e) => e.category).filter(Boolean)))], [pool])
  const activeCategory = categories.includes(category) ? category : "All"

  const filtered = useMemo(
    () => pool.filter((e) => (activeCategory === "All" || e.category === activeCategory) && matchesQuery(e, search, SEARCH_FIELDS)),
    [pool, activeCategory, search]
  )

  // Hero for the very next event, only on the unfiltered upcoming view
  const showHero = tab === "upcoming" && activeCategory === "All" && !search.trim() && filtered.length > 0
  const hero = showHero ? filtered[0] : null
  const rest = showHero ? filtered.slice(1) : filtered

  // Flat list with month headings
  const rows = useMemo(() => {
    const out = []
    let last = ""
    rest.forEach((e) => {
      const m = dayjs(e._date).format("MMMM YYYY")
      if (m !== last) { out.push({ type: "month", id: `m-${m}`, label: m }); last = m }
      out.push({ type: "event", id: String(e.id), e })
    })
    return out
  }, [rest])

  const openMaps = useCallback((loc) => {
    if (!loc) return
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}`).catch(() => {})
  }, [])

  const shareEvent = useCallback((e) => {
    const msg = [e.title || e.name, whenLine(e), e.location].filter(Boolean).join("\n")
    Share.share({ message: msg }).catch(() => {})
  }, [])

  const sheetMeta = selected ? [
    { icon: "calendar-outline", text: [dayjs(selected._date).format("dddd, D MMMM YYYY"), eventTime(selected)].filter(Boolean).join("  •  ") },
    selected.location ? { icon: "location-outline", text: selected.location } : null,
    selected.price != null && selected.price !== "" ? { icon: "ticket-outline", text: String(selected.price) } : null,
    selected.organizer ? { icon: "people-outline", text: String(selected.organizer) } : null,
  ].filter(Boolean) : []

  const renderItem = useCallback(({ item }) => {
    if (item.type === "month") {
      return (
        <View className="flex-row items-center gap-2 mt-2 mb-2.5">
          <View className="w-[3px] h-[16px] rounded bg-brand" />
          <Text className="text-[13px] font-extrabold text-ink uppercase tracking-[0.8px]">{item.label}</Text>
        </View>
      )
    }
    return <EventCard e={item.e} onPress={() => setSelected(item.e)} />
  }, [])

  if (loading && (!data || data.length === 0) && !isOffline) {
    return (
      <View className="flex-1 bg-bg justify-center items-center px-10">
        <View className="w-20 h-20 rounded-3xl bg-brand-light justify-center items-center mb-4">
          <Ionicons name="calendar-outline" size={36} color={BRAND} />
        </View>
        <ActivityIndicator size="large" color={BRAND} />
        <Text className="text-base font-bold text-ink mt-3 text-center">Loading events…</Text>
      </View>
    )
  }

  const header = (
    <View>
      {/* Upcoming / Past switch */}
      <View className="flex-row bg-surface border border-line rounded-full p-1 mb-3">
        {[{ k: "upcoming", label: "Upcoming", n: upcoming.length }, { k: "past", label: "Past", n: past.length }].map((t) => {
          const on = tab === t.k
          return (
            <TouchableOpacity key={t.k} activeOpacity={0.85} onPress={() => { setTab(t.k); setCategory("All") }}
              className={`flex-1 py-2 rounded-full items-center ${on ? "bg-teal" : ""}`}>
              <Text className={`text-[13px] font-extrabold ${on ? "text-white" : "text-muted"}`}>{t.label} · {t.n}</Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {/* Category chips */}
      {categories.length > 2 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 14 }}>
          {categories.map((c) => {
            const on = activeCategory === c
            return (
              <TouchableOpacity key={c} activeOpacity={0.85} onPress={() => setCategory(c)}
                className={`px-3.5 py-2 rounded-full border ${on ? "bg-brand border-brand" : "bg-surface border-line"}`}>
                <Text className={`text-xs font-bold ${on ? "text-white" : "text-ink"}`}>{c}</Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      )}

      {hero && <EventHero e={hero} onPress={() => setSelected(hero)} />}
    </View>
  )

  return (
    <View className="flex-1 bg-bg">
      <OfflineIndicator />

      {isOffline && (
        <View className="flex-row items-center justify-center gap-1.5 bg-warning-light py-2 border-b border-warning/30">
          <Ionicons name="cloud-offline-outline" size={14} color="#92400E" />
          <Text className="text-[13px] text-[#92400E] font-semibold">Showing saved events</Text>
        </View>
      )}
      {usingFallback && !isOffline && (
        <View className="flex-row items-center justify-center gap-1.5 bg-teal-light py-2 border-b border-teal/20">
          <Ionicons name="information-circle-outline" size={14} color={TEAL} />
          <Text className="text-[13px] text-teal font-semibold">Sample events — add Firestore "events" data for live listings</Text>
        </View>
      )}

      <AnimatedFlatList
        data={rows}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={!!loading} onRefresh={refresh} colors={[BRAND]} tintColor={BRAND} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          !hero ? (
            <View className="items-center py-14 px-8">
              <View className="w-16 h-16 rounded-3xl bg-brand-light justify-center items-center mb-3">
                <Ionicons name="calendar-clear-outline" size={30} color={BRAND} />
              </View>
              <Text className="text-[15px] font-extrabold text-ink text-center">
                {search.trim() ? "No events match your search" : tab === "upcoming" ? "No upcoming events" : "No past events"}
              </Text>
              <Text className="text-[13px] text-muted text-center mt-1">
                {search.trim() ? "Try a different word or clear the search." : "Check back soon — new events are added regularly."}
              </Text>
            </View>
          ) : null
        }
        {...scrollProps}
      />

      <DetailSheet
        visible={!!selected}
        onClose={() => setSelected(null)}
        image={selected ? eventImage(selected) : null}
        fallbackImage={EVENT_FALLBACK_IMAGE}
        fallbackIcon="calendar"
        pill={selected?.category || "Event"}
        title={selected ? (selected.title || selected.name) : ""}
        meta={sheetMeta}
        body={selected?.description || selected?.details || selected?.summary}
        actions={selected ? [
          selected.location ? { icon: "navigate", label: "Directions", primary: true, onPress: () => openMaps(selected.location) } : null,
          { icon: "share-social-outline", label: "Share", onPress: () => shareEvent(selected) },
        ].filter(Boolean) : []}
      />
    </View>
  )
}

export default Events
