"use client"
import { useMemo } from "react"
import { Text, View, TouchableOpacity, ScrollView } from "react-native"
import { useNavigation } from "@react-navigation/native"
import { Ionicons, MaterialIcons, MaterialCommunityIcons } from "@expo/vector-icons"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import { useOfflineData } from "../hooks/useOfflineData"

dayjs.extend(relativeTime)

// ── Hub sections ─────────────────────────────────────────────────────────────
// Each tile navigates either into the Xplore stack (existing category screens)
// or into this Community stack (Eskom, PoIst, News).
const SECTIONS = [
  {
    title: "Safety & Community",
    tiles: [
      { key: "emergency",  label: "Emergency Contacts",      desc: "Police, fire, medical & private services", icon: "call",          iconType: "Ionicons",  bg: "bg-danger-light",  color: "#EF4444", nav: { stack: "Xplore", screen: "Emergency" } },
      { key: "poist",      label: "Lost & Found / Missing",  desc: "Report or search missing persons",         icon: "person-search", iconType: "Material",  bg: "bg-teal-light",    color: "#1B4D5C", nav: { stack: "Community", screen: "PoIst" } },
      { key: "publicservice", label: "Public Services",      desc: "Municipal offices, home affairs & more",   icon: "people",        iconType: "Ionicons",  bg: "bg-teal-light",    color: "#1B4D5C", nav: { stack: "Xplore", screen: "PublicService" } },
      { key: "healthcare", label: "Healthcare",              desc: "Clinics, hospitals & pharmacies",          icon: "medkit",        iconType: "Ionicons",  bg: "bg-success-light", color: "#22C55E", nav: { stack: "Xplore", screen: "Healthcare" } },
    ],
  },
  {
    title: "Explore & Book",
    tiles: [
      { key: "attractions",   label: "Points of Interest",   desc: "Landmarks, museums & heritage sites",      icon: "map",           iconType: "Ionicons",  bg: "bg-brand-light",   color: "#E8600A", nav: { stack: "Xplore", screen: "Attraction" } },
      { key: "accommodation", label: "Accommodation",        desc: "Stays, B&Bs & guesthouses — book direct",  icon: "bed",           iconType: "Ionicons",  bg: "bg-brand-light",   color: "#E8600A", nav: { stack: "Xplore", screen: "Accommodation" } },
      { key: "restaurants",   label: "Restaurants",          desc: "Reserve a table & explore local cuisine",  icon: "restaurant",    iconType: "Ionicons",  bg: "bg-brand-light",   color: "#E8600A", nav: { stack: "Xplore", screen: "Restaurants" } },
      { key: "recreation",    label: "Recreation",           desc: "Sport, leisure & things to do",            icon: "football",      iconType: "Ionicons",  bg: "bg-brand-light",   color: "#E8600A", nav: { stack: "Xplore", screen: "Recreation" } },
    ],
  },
  {
    title: "City Life",
    tiles: [
      { key: "transport", label: "Transport",             desc: "Bus & train schedules",                    icon: "bus",           iconType: "MCI",       bg: "bg-teal-light",    color: "#1B4D5C", nav: { stack: "Xplore", screen: "Transport" } },
      { key: "news",      label: "News",                  desc: "Local headlines & updates",                icon: "newspaper",     iconType: "Ionicons",  bg: "bg-teal-light",    color: "#1B4D5C", nav: { stack: "Community", screen: "News" } },
      { key: "eskom",     label: "Load Shedding",         desc: "Check current schedule & stage",           icon: "flash-off",     iconType: "Material",  bg: "bg-warning-light", color: "#F59E0B", nav: { stack: "Community", screen: "Eskom" } },
      { key: "business",  label: "Business Directory",    desc: "Local shops & services",                   icon: "business",      iconType: "Ionicons",  bg: "bg-teal-light",    color: "#1B4D5C", nav: { stack: "Xplore", screen: "Business" } },
    ],
  },
]

const Icon = ({ type, name, size, color }) => {
  if (type === "Material") return <MaterialIcons name={name} size={size} color={color} />
  if (type === "MCI") return <MaterialCommunityIcons name={name} size={size} color={color} />
  return <Ionicons name={name} size={size} color={color} />
}

const Community = () => {
  const navigation = useNavigation()

  const newsOptions = useMemo(() => ({ maxAgeMinutes: 20 }), [])
  const { data: news } = useOfflineData("news", newsOptions)
  const latestNews = news && news.length > 0
    ? [...news].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))[0]
    : null

  const handlePress = (tile) => {
    try {
      if (tile.nav.stack === "Xplore") {
        navigation.navigate("Xplore", { screen: tile.nav.screen })
      } else {
        navigation.navigate(tile.nav.screen)
      }
    } catch (e) { console.error("Community nav error:", e) }
  }

  return (
    <ScrollView className="flex-1 bg-bg" showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View className="flex-row justify-between items-center px-[22px] pt-3.5 pb-3">
        <View>
          <Text className="text-[26px] font-extrabold text-ink -tracking-tight">Community</Text>
          <Text className="text-[13px] text-muted font-medium mt-0.5">Everything Soweto, in one place</Text>
        </View>
        <View className="w-11 h-11 rounded-2xl bg-surface justify-center items-center border border-line">
          <Ionicons name="grid-outline" size={20} color="#1B4D5C" />
        </View>
      </View>

      {/* Live news pulse strip */}
      <TouchableOpacity
        className="mx-[22px] mb-5 bg-ink rounded-2xl p-4 flex-row items-center gap-3"
        activeOpacity={0.88}
        onPress={() => navigation.navigate("News")}
      >
        <View className="w-10 h-10 rounded-xl bg-white/15 justify-center items-center">
          <Ionicons name="pulse" size={18} color="#FFFFFF" />
        </View>
        <View className="flex-1">
          <Text className="text-[10px] font-extrabold text-brand uppercase tracking-widest mb-0.5">Community Pulse</Text>
          <Text className="text-[13px] font-bold text-white" numberOfLines={1}>
            {latestNews ? latestNews.title : "Tap to see the latest local news"}
          </Text>
          {latestNews && (
            <Text className="text-[11px] text-white/60 mt-0.5">{dayjs(latestNews.publishedAt).fromNow()}</Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.6)" />
      </TouchableOpacity>

      {/* Sections */}
      {SECTIONS.map(section => (
        <View key={section.title} className="mb-6 px-[22px]">
          <Text className="text-[13px] font-extrabold text-muted uppercase tracking-wider mb-3">{section.title}</Text>
          <View className="flex-row flex-wrap justify-between gap-y-3">
            {section.tiles.map(tile => (
              <TouchableOpacity
                key={tile.key}
                className="w-[48%] bg-surface rounded-2xl p-3.5 border border-line"
                activeOpacity={0.85}
                onPress={() => handlePress(tile)}
              >
                <View className={`w-11 h-11 rounded-xl justify-center items-center mb-2.5 ${tile.bg}`}>
                  <Icon type={tile.iconType} name={tile.icon} size={20} color={tile.color} />
                </View>
                <Text className="text-[13px] font-bold text-ink -tracking-tight mb-0.5">{tile.label}</Text>
                <Text className="text-[11px] text-muted leading-4" numberOfLines={2}>{tile.desc}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      <View className="h-[100px]" />
    </ScrollView>
  )
}

export default Community
