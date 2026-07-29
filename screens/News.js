"use client"
import { useState, useMemo, useCallback } from "react"
import { Text, View, TouchableOpacity, Image, ActivityIndicator, RefreshControl } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import { useScrollTracking, AnimatedFlatList } from "../components/BottomNav"
import { useOfflineData } from "../hooks/useOfflineData"
import OfflineIndicator from "../components/OfflineIndicator"

dayjs.extend(relativeTime)

const CATEGORIES = ["All", "Community", "Safety", "Events", "Municipal"]

const CATEGORY_STYLE = {
  Safety:     { bg: "bg-danger-light",  text: "text-danger"  },
  Events:     { bg: "bg-brand-light",   text: "text-brand"   },
  Municipal:  { bg: "bg-teal-light",    text: "text-teal"    },
  Community:  { bg: "bg-success-light", text: "text-success" },
}
const DEFAULT_CATEGORY_STYLE = { bg: "bg-teal-light", text: "text-teal" }

// Shown before Firestore's "news" collection has content, so the screen never looks empty.
const FALLBACK_NEWS = [
  { id: "n1", title: "Vilakazi Street upgrade completed ahead of tourist season", summary: "Pavements, lighting and signage along Vilakazi Street have been refreshed to welcome the busy season.", body: "The City of Johannesburg has completed upgrades along Vilakazi Street, including new paving, upgraded street lighting, and clearer signage for visitors. Local business owners say the improvements should help handle the upcoming rise in tourist traffic. The project also included repainting of the iconic street murals and additional seating areas near the Hector Pieterson Memorial.", category: "Municipal", source: "Soweto Times", publishedAt: dayjs().subtract(3, "hour").toISOString(), isFeatured: true, imageUrl: "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=900&h=600&fit=crop" },
  { id: "n2", title: "Free health screening drive this weekend at Baragwanath", summary: "Community members can access free blood pressure, diabetes and HIV screening.", body: "Chris Hani Baragwanath Academic Hospital, in partnership with local clinics, will host a free health screening weekend covering blood pressure, diabetes, and HIV testing. Screenings run from 8am to 3pm on both Saturday and Sunday. Organisers encourage residents to bring ID and arrive early as queues are expected.", category: "Community", source: "Gauteng Health Dept", publishedAt: dayjs().subtract(1, "day").toISOString(), imageUrl: "https://images.unsplash.com/photo-1584982751601-97dcc096659c?w=900&h=600&fit=crop" },
  { id: "n3", title: "Increased patrols announced after recent break-ins in Diepkloof", summary: "SAPS confirms additional night patrols following resident reports.", body: "Following a spate of reported break-ins in Diepkloof Zone 4 and 6, SAPS has confirmed increased night patrols in the area for the next month. Residents are urged to report suspicious activity to the community policing forum hotline and to ensure neighbourhood watch WhatsApp groups remain active.", category: "Safety", source: "SAPS Soweto", publishedAt: dayjs().subtract(2, "day").toISOString() },
  { id: "n4", title: "Soweto Marathon route and road closures announced", summary: "Key roads will close from 5am on race day — plan alternative routes.", body: "Organisers of the annual Soweto Marathon have released this year's route map, with road closures along Chris Hani Road, Old Potch Road and sections of Klipspruit Valley Road starting from 5am on race day until approximately 1pm. Public transport operators have been briefed on detours.", category: "Events", source: "Soweto Marathon Trust", publishedAt: dayjs().subtract(4, "day").toISOString() },
]

const News = () => {
  const [activeCategory, setActiveCategory] = useState("All")
  const [expandedId, setExpandedId] = useState(null)
  const scrollProps = useScrollTracking()

  const offlineOptions = useMemo(() => ({ maxAgeMinutes: 20, enableBackgroundRefresh: true }), [])
  const { data, loading, isOffline, lastUpdated, refresh } = useOfflineData("news", offlineOptions)

  const articles = (data && data.length > 0) ? data : FALLBACK_NEWS
  const usingFallback = !data || data.length === 0

  const sorted = useMemo(
    () => [...articles].filter(a => a.isActive !== false).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)),
    [articles]
  )

  const featured = sorted.find(a => a.isFeatured) || sorted[0]
  const feed = sorted.filter(a => a.id !== featured?.id)
  const filteredFeed = useMemo(
    () => activeCategory === "All" ? feed : feed.filter(a => a.category === activeCategory),
    [feed, activeCategory]
  )

  const toggleExpand = useCallback((id) => setExpandedId(prev => (prev === id ? null : id)), [])

  const ArticleCard = useCallback(({ item }) => {
    const style = CATEGORY_STYLE[item.category] || DEFAULT_CATEGORY_STYLE
    const isExpanded = expandedId === item.id

    return (
      <TouchableOpacity className="bg-surface rounded-2xl mb-3 overflow-hidden border border-line" activeOpacity={0.85} onPress={() => toggleExpand(item.id)}>
        {item.imageUrl && (
          <Image source={{ uri: item.imageUrl }} className="w-full h-36" resizeMode="cover" />
        )}
        <View className="p-4">
          <View className="flex-row items-center justify-between mb-2">
            <View className={`px-2.5 py-1 rounded-full ${style.bg}`}>
              <Text className={`text-[10px] font-extrabold uppercase tracking-wide ${style.text}`}>{item.category}</Text>
            </View>
            <Text className="text-[11px] text-muted font-medium">{dayjs(item.publishedAt).fromNow()}</Text>
          </View>
          <Text className="text-[15px] font-extrabold text-ink -tracking-tight mb-1" numberOfLines={isExpanded ? undefined : 2}>{item.title}</Text>
          <Text className="text-[13px] text-muted leading-5" numberOfLines={isExpanded ? undefined : 2}>
            {isExpanded ? (item.body || item.summary) : item.summary}
          </Text>
          <View className="flex-row items-center justify-between mt-3">
            <Text className="text-[11px] text-muted font-semibold">{item.source}</Text>
            <View className="flex-row items-center gap-1">
              <Text className="text-[11px] font-bold text-brand">{isExpanded ? "Show less" : "Read more"}</Text>
              <Ionicons name={isExpanded ? "chevron-up" : "chevron-forward"} size={12} color="#E8600A" />
            </View>
          </View>
        </View>
      </TouchableOpacity>
    )
  }, [expandedId, toggleExpand])

  const renderItem = useCallback(({ item }) => <ArticleCard item={item} />, [ArticleCard])

  if (loading && (!data || data.length === 0)) {
    return (
      <View className="flex-1 bg-bg justify-center items-center px-10">
        <View className="w-20 h-20 rounded-3xl bg-teal-light justify-center items-center mb-4">
          <Ionicons name="newspaper-outline" size={36} color="#1B4D5C" />
        </View>
        <ActivityIndicator size="large" color="#E8600A" style={{ marginTop: 8 }} />
        <Text className="text-base font-bold text-ink mt-3 text-center">Loading local news…</Text>
      </View>
    )
  }

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
          <Ionicons name="information-circle-outline" size={14} color="#1B4D5C" />
          <Text className="text-[13px] text-teal font-semibold">Sample headlines — connect Firestore "news" data for live info</Text>
        </View>
      )}

      <View className="flex-row justify-between items-center px-[22px] pt-3.5 pb-2.5">
        <View>
          <Text className="text-lg font-extrabold text-ink -tracking-tight">Local News</Text>
          <Text className="text-[13px] text-muted font-medium mt-0.5">What's happening in Soweto</Text>
        </View>
        <View className="w-11 h-11 rounded-2xl bg-surface justify-center items-center border border-line">
          <Ionicons name="newspaper-outline" size={20} color="#1B4D5C" />
        </View>
      </View>

      <AnimatedFlatList
        data={filteredFeed}
        keyExtractor={item => item.id.toString()}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} colors={["#E8600A"]} tintColor="#E8600A" />}
        ListHeaderComponent={() => (
          <>
            {featured && (
              <TouchableOpacity className="mb-4 rounded-2xl overflow-hidden border border-line" activeOpacity={0.9} onPress={() => toggleExpand(featured.id)}>
                <View className="relative">
                  <Image
                    source={{ uri: featured.imageUrl || "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=900&h=600&fit=crop" }}
                    className="w-full h-48"
                    resizeMode="cover"
                  />
                  <View className="absolute bottom-0 left-0 right-0 h-2/3 bg-black/50" />
                  <View className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-brand">
                    <Text className="text-[10px] font-extrabold text-surface uppercase tracking-wide">✦ Featured</Text>
                  </View>
                  <View className="absolute bottom-3 left-3 right-3">
                    <Text className="text-[17px] font-extrabold text-surface -tracking-tight" numberOfLines={2}>{featured.title}</Text>
                    <Text className="text-xs text-surface/80 font-medium mt-1">{featured.source} · {dayjs(featured.publishedAt).fromNow()}</Text>
                  </View>
                </View>
                {expandedId === featured.id && (
                  <View className="p-4 bg-surface">
                    <Text className="text-[13px] text-ink leading-5">{featured.body || featured.summary}</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}

            {/* Category filter chips */}
            <View className="flex-row flex-wrap gap-2 mb-3">
              {CATEGORIES.map(cat => (
                <TouchableOpacity key={cat}
                  className={`px-3.5 py-2 rounded-full border ${activeCategory === cat ? "bg-brand border-brand" : "bg-surface border-line"}`}
                  onPress={() => setActiveCategory(cat)}>
                  <Text className={`text-xs font-bold ${activeCategory === cat ? "text-surface" : "text-ink"}`}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
        {...scrollProps}
      />
    </View>
  )
}

export default News
