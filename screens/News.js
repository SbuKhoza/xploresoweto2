"use client"
import { useState, useMemo, useCallback } from "react"
import { Text, View, TouchableOpacity, ActivityIndicator, RefreshControl, ScrollView, Share } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import { useScrollTracking, AnimatedFlatList } from "../components/BottomNav"
import { useOfflineData } from "../hooks/useOfflineData"
import OfflineIndicator from "../components/OfflineIndicator"
import CoverImage from "../components/content/CoverImage"
import DetailSheet from "../components/content/DetailSheet"
import { TEAL, BRAND, cardShadow, toDate, newsImage, NEWS_FALLBACK_IMAGE, tagColor, readingTime, matchesQuery } from "../utils/content"

dayjs.extend(relativeTime)

const SEARCH_FIELDS = ["title", "summary", "body", "category", "source"]
const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }

const CATEGORY_ICON = { community: "people", business: "storefront", safety: "shield-checkmark", events: "calendar", municipal: "business" }
const categoryIcon = (c = "") => CATEGORY_ICON[String(c).toLowerCase()] || "newspaper"
const ago = (a) => { const d = toDate(a.publishedAt); return d ? dayjs(d).fromNow() : "" }

const FALLBACK_NEWS = [
  { id: "n1", title: "Vilakazi Street upgrade completed ahead of tourist season", summary: "Pavements, lighting and signage along Vilakazi Street have been refreshed to welcome the busy season.", body: "The City of Johannesburg has completed upgrades along Vilakazi Street, including new paving, upgraded street lighting, and clearer signage for visitors. Local business owners say the improvements should help handle the upcoming rise in tourist traffic. The project also included repainting of the iconic street murals and additional seating areas near the Hector Pieterson Memorial.", category: "Municipal", source: "Soweto Times", publishedAt: dayjs().subtract(3, "hour").toISOString(), isFeatured: true, imageUrl: "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=900&h=600&fit=crop" },
  { id: "n2", title: "Free health screening drive this weekend at Baragwanath", summary: "Community members can access free blood pressure, diabetes and HIV screening.", body: "Chris Hani Baragwanath Academic Hospital, in partnership with local clinics, will host a free health screening weekend covering blood pressure, diabetes, and HIV testing. Screenings run from 8am to 3pm on both Saturday and Sunday. Organisers encourage residents to bring ID and arrive early as queues are expected.", category: "Community", source: "Gauteng Health Dept", publishedAt: dayjs().subtract(1, "day").toISOString(), imageUrl: "https://images.unsplash.com/photo-1584982751601-97dcc096659c?w=900&h=600&fit=crop" },
  { id: "n3", title: "Increased patrols announced after recent break-ins in Diepkloof", summary: "SAPS confirms additional night patrols following resident reports.", body: "Following a spate of reported break-ins in Diepkloof Zone 4 and 6, SAPS has confirmed increased night patrols in the area for the next month. Residents are urged to report suspicious activity to the community policing forum hotline and to ensure neighbourhood watch WhatsApp groups remain active.", category: "Safety", source: "SAPS Soweto", publishedAt: dayjs().subtract(2, "day").toISOString() },
  { id: "n4", title: "Soweto Marathon route and road closures announced", summary: "Key roads will close from 5am on race day — plan alternative routes.", body: "Organisers of the annual Soweto Marathon have released this year's route map, with road closures along Chris Hani Road, Old Potch Road and sections of Klipspruit Valley Road starting from 5am on race day until approximately 1pm. Public transport operators have been briefed on detours.", category: "Events", source: "Soweto Marathon Trust", publishedAt: dayjs().subtract(4, "day").toISOString() },
]

// ── Big card for the featured story ─────────────────────────────────────────
const FeaturedCard = ({ a, onPress }) => (
  <TouchableOpacity activeOpacity={0.9} onPress={onPress}
    style={[{ height: 220, borderRadius: 22, backgroundColor: "#fff", marginBottom: 16 }, cardShadow]}>
    <View style={{ flex: 1, borderRadius: 22, overflow: "hidden" }}>
      <CoverImage source={newsImage(a)} fallbackSource={NEWS_FALLBACK_IMAGE} fallbackIcon={categoryIcon(a.category)} iconSize={34} style={{ ...FILL, width: "100%", height: "100%" }} />
      <LinearGradient pointerEvents="none" colors={["rgba(10,30,38,0)", "rgba(10,30,38,0.4)", "rgba(10,30,38,0.9)"]} locations={[0.2, 0.55, 1]} style={FILL} />
      <View style={{ position: "absolute", top: 12, left: 12, flexDirection: "row", gap: 6 }}>
        <View style={{ backgroundColor: BRAND, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
          <Text className="text-[10px] font-extrabold text-white uppercase tracking-[0.6px]">Featured</Text>
        </View>
        {a.category ? (
          <View style={{ backgroundColor: "rgba(255,255,255,0.92)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
            <Text className="text-[10px] font-extrabold text-teal uppercase tracking-[0.6px]">{a.category}</Text>
          </View>
        ) : null}
      </View>
      <View style={{ position: "absolute", left: 14, right: 14, bottom: 14 }}>
        <Text className="text-[19px] font-extrabold text-white -tracking-[0.3px]" style={{ lineHeight: 24 }} numberOfLines={3}>{a.title}</Text>
        <Text className="text-[12px] font-semibold text-white/80 mt-1.5" numberOfLines={1}>
          {[a.source, ago(a)].filter(Boolean).join("  ·  ")}
        </Text>
      </View>
    </View>
  </TouchableOpacity>
)

// ── Compact row: thumbnail + text ───────────────────────────────────────────
const ArticleRow = ({ a, onPress }) => {
  const color = tagColor(a.category)
  return (
    <TouchableOpacity activeOpacity={0.88} onPress={onPress}
      style={[{ flexDirection: "row", backgroundColor: "#fff", borderRadius: 18, padding: 10, marginBottom: 12 }, cardShadow]}>
      <View style={{ width: 96, height: 96, borderRadius: 14, overflow: "hidden" }}>
        <CoverImage source={newsImage(a)} fallbackSource={NEWS_FALLBACK_IMAGE} fallbackIcon={categoryIcon(a.category)} iconSize={26} style={{ width: "100%", height: "100%" }} />
      </View>
      <View style={{ flex: 1, marginLeft: 12, justifyContent: "space-between" }}>
        <View>
          <Text className="text-[10px] font-extrabold uppercase tracking-[0.6px]" style={{ color }} numberOfLines={1}>{a.category || "News"}</Text>
          <Text className="text-[14px] font-extrabold text-ink -tracking-[0.2px] mt-0.5" style={{ lineHeight: 18 }} numberOfLines={3}>{a.title}</Text>
        </View>
        <View className="flex-row items-center">
          <Ionicons name="time-outline" size={12} color="#7A8A8F" />
          <Text className="text-[11px] text-muted font-medium ml-1 flex-1" numberOfLines={1}>
            {[a.source, ago(a)].filter(Boolean).join("  ·  ")}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  )
}

const News = ({ search = "" }) => {
  const [activeCategory, setActiveCategory] = useState("All")
  const [selected, setSelected] = useState(null)
  const scrollProps = useScrollTracking()

  const options = useMemo(() => ({ maxAgeMinutes: 20, enableBackgroundRefresh: true }), [])
  const { data, loading, isOffline, refresh } = useOfflineData("news", options)

  const live = useMemo(() => (data || []).filter((a) => a.isActive !== false && a.title), [data])
  const usingFallback = live.length === 0

  const sorted = useMemo(() => {
    const list = usingFallback ? FALLBACK_NEWS : live
    return [...list].sort((a, b) => (toDate(b.publishedAt) || 0) - (toDate(a.publishedAt) || 0))
  }, [usingFallback, live])

  const categories = useMemo(() => ["All", ...Array.from(new Set(sorted.map((a) => a.category).filter(Boolean)))], [sorted])
  const category = categories.includes(activeCategory) ? activeCategory : "All"

  const filtered = useMemo(
    () => sorted.filter((a) => (category === "All" || a.category === category) && matchesQuery(a, search, SEARCH_FIELDS)),
    [sorted, category, search]
  )

  // Featured story only on the unfiltered view
  const showFeatured = category === "All" && !search.trim() && filtered.length > 0
  const featured = showFeatured ? (filtered.find((a) => a.isFeatured) || filtered[0]) : null
  const feed = featured ? filtered.filter((a) => a.id !== featured.id) : filtered

  const shareArticle = useCallback((a) => {
    Share.share({ message: [a.title, a.summary, a.source ? `— ${a.source}` : null].filter(Boolean).join("\n") }).catch(() => {})
  }, [])

  const renderItem = useCallback(({ item }) => <ArticleRow a={item} onPress={() => setSelected(item)} />, [])

  if (loading && (!data || data.length === 0) && !isOffline) {
    return (
      <View className="flex-1 bg-bg justify-center items-center px-10">
        <View className="w-20 h-20 rounded-3xl bg-teal-light justify-center items-center mb-4">
          <Ionicons name="newspaper-outline" size={36} color={TEAL} />
        </View>
        <ActivityIndicator size="large" color={BRAND} />
        <Text className="text-base font-bold text-ink mt-3 text-center">Loading local news…</Text>
      </View>
    )
  }

  const header = (
    <View>
      {categories.length > 2 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 14 }}>
          {categories.map((c) => {
            const on = category === c
            return (
              <TouchableOpacity key={c} activeOpacity={0.85} onPress={() => setActiveCategory(c)}
                className={`px-3.5 py-2 rounded-full border ${on ? "bg-brand border-brand" : "bg-surface border-line"}`}>
                <Text className={`text-xs font-bold ${on ? "text-white" : "text-ink"}`}>{c}</Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      )}

      {featured && <FeaturedCard a={featured} onPress={() => setSelected(featured)} />}

      {feed.length > 0 && (
        <View className="flex-row items-center gap-2 mb-2.5">
          <View className="w-[3px] h-[16px] rounded bg-brand" />
          <Text className="text-[13px] font-extrabold text-ink uppercase tracking-[0.8px]">{featured ? "Latest" : `${feed.length} ${feed.length === 1 ? "story" : "stories"}`}</Text>
        </View>
      )}
    </View>
  )

  const sel = selected
  const body = sel ? (sel.body || sel.summary || "") : ""

  return (
    <View className="flex-1 bg-bg">
      <OfflineIndicator />

      {isOffline && (
        <View className="flex-row items-center justify-center gap-1.5 bg-warning-light py-2 border-b border-warning/30">
          <Ionicons name="cloud-offline-outline" size={14} color="#92400E" />
          <Text className="text-[13px] text-[#92400E] font-semibold">Showing cached headlines</Text>
        </View>
      )}
      {usingFallback && !isOffline && (
        <View className="flex-row items-center justify-center gap-1.5 bg-teal-light py-2 border-b border-teal/20">
          <Ionicons name="information-circle-outline" size={14} color={TEAL} />
          <Text className="text-[13px] text-teal font-semibold">Sample headlines — add Firestore "news" data for live info</Text>
        </View>
      )}

      <AnimatedFlatList
        data={feed}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={!!loading} onRefresh={refresh} colors={[BRAND]} tintColor={BRAND} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          !featured ? (
            <View className="items-center py-14 px-8">
              <View className="w-16 h-16 rounded-3xl bg-teal-light justify-center items-center mb-3">
                <Ionicons name="newspaper-outline" size={30} color={TEAL} />
              </View>
              <Text className="text-[15px] font-extrabold text-ink text-center">{search.trim() ? "No stories match your search" : "No stories yet"}</Text>
              <Text className="text-[13px] text-muted text-center mt-1">{search.trim() ? "Try a different word or clear the search." : "Pull down to refresh, or check back soon."}</Text>
            </View>
          ) : null
        }
        {...scrollProps}
      />

      <DetailSheet
        visible={!!sel}
        onClose={() => setSelected(null)}
        image={sel ? newsImage(sel) : null}
        fallbackImage={NEWS_FALLBACK_IMAGE}
        fallbackIcon={sel ? categoryIcon(sel.category) : "newspaper"}
        pill={sel?.category || "News"}
        pillColor={sel ? tagColor(sel.category) : TEAL}
        title={sel?.title || ""}
        meta={sel ? [
          { icon: "newspaper-outline", text: [sel.source, ago(sel)].filter(Boolean).join("  ·  ") || "Local news" },
          { icon: "time-outline", text: `${readingTime(body)} min read` },
        ] : []}
        body={body}
        actions={sel ? [{ icon: "share-social-outline", label: "Share story", primary: true, onPress: () => shareArticle(sel) }] : []}
      />
    </View>
  )
}

export default News
