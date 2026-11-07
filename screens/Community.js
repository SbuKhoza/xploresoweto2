"use client"
import { useMemo, useState } from "react"
import { Text, View, TouchableOpacity, ScrollView, Linking, RefreshControl } from "react-native"
import { useNavigation } from "@react-navigation/native"
import { Ionicons, MaterialIcons, MaterialCommunityIcons } from "@expo/vector-icons"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import { useOfflineData } from "../hooks/useOfflineData"
import { toDate, cardShadow } from "../utils/content"
import { useAnnouncements } from "../hooks/useAnnouncements"
import { announcementStyle } from "../utils/announcements"

dayjs.extend(relativeTime)

// One announcement: tap to expand the full message; optional link button
const AnnouncementCard = ({ a }) => {
  const [open, setOpen] = useState(false)
  const st = announcementStyle(a.type)
  const when = toDate(a.publishedAt)
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={() => setOpen((o) => !o)}
      style={[{ backgroundColor: "#fff", borderRadius: 18, padding: 14, borderWidth: 1, borderColor: st.border }, cardShadow]}>
      <View className="flex-row items-center mb-2">
        <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: st.bg, justifyContent: "center", alignItems: "center" }}>
          <Ionicons name={st.icon} size={20} color={st.color} />
        </View>
        <View className="flex-row items-center gap-1.5 ml-2.5 flex-1">
          <View style={{ backgroundColor: st.chip, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
            <Text className="text-[9.5px] font-extrabold text-white uppercase tracking-[0.5px]">{st.label}</Text>
          </View>
          {a.pinned ? <Ionicons name="pin" size={12} color="#7A8A8F" /> : null}
        </View>
        {when ? <Text className="text-[11px] text-muted font-medium">{dayjs(when).fromNow()}</Text> : null}
      </View>
      <Text className="text-[15px] font-extrabold text-ink -tracking-[0.2px]">{a.title}</Text>
      {a.message ? <Text className="text-[13px] text-ink/80 leading-[19px] mt-1" numberOfLines={open ? undefined : 3}>{a.message}</Text> : null}
      {a.link ? (
        <TouchableOpacity onPress={() => Linking.openURL(a.link).catch(() => {})} activeOpacity={0.85}
          className="flex-row items-center self-start mt-2.5 px-3 py-1.5 rounded-full" style={{ backgroundColor: st.bg }}>
          <Text className="text-[12px] font-extrabold" style={{ color: st.color }}>{a.linkLabel || "Learn more"}</Text>
          <Ionicons name="open-outline" size={13} color={st.color} style={{ marginLeft: 5 }} />
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  )
}

const Community = () => {
  const navigation = useNavigation()
  const { announcements, loading: announcementsLoading, refresh: refreshAnnouncements } = useAnnouncements()

  const newsOptions = useMemo(() => ({ maxAgeMinutes: 20 }), [])
  const { data: news } = useOfflineData("news", newsOptions)
  const latestNews = useMemo(
    () => [...(news || [])].filter((n) => n.isActive !== false && n.title)
      .sort((a, b) => (toDate(b.publishedAt) || 0) - (toDate(a.publishedAt) || 0))[0] || null,
    [news]
  )

  const eventsOptions = useMemo(() => ({ maxAgeMinutes: 20 }), [])
  const { data: events } = useOfflineData("events", eventsOptions)
  const nextEvent = useMemo(() => {
    const today = dayjs().startOf("day")
    return (events || [])
      .filter(e => e.isActive !== false && (e.title || e.name))
      .map(e => ({ ...e, _date: toDate(e.date || e.startDate) }))
      .filter(e => e._date && !dayjs(e._date).isBefore(today))
      .sort((a, b) => a._date - b._date)[0] || null
  }, [events])

  const poiOptions = useMemo(() => ({ maxAgeMinutes: 20 }), [])
  const { data: personsOfInterest } = useOfflineData("Person-Of-Interest", poiOptions)
  const activeCasesCount = personsOfInterest ? personsOfInterest.length : null

  const cards = [
    {
      key: "events",
      label: "Events",
      desc: "What's on in Soweto, this week and beyond",
      icon: "calendar",
      iconType: "Ionicons",
      bg: "bg-brand-light",
      color: "#E8600A",
      preview: nextEvent ? `Next: ${nextEvent.title || nextEvent.name} · ${dayjs(nextEvent._date).format("D MMM")}` : "Tap to see upcoming events",
      onPress: () => navigation.navigate("Events"),
    },
    {
      key: "news",
      label: "News",
      desc: "Local headlines & community updates",
      icon: "newspaper",
      iconType: "Ionicons",
      bg: "bg-teal-light",
      color: "#1B4D5C",
      preview: latestNews ? `${latestNews.title} · ${toDate(latestNews.publishedAt) ? dayjs(toDate(latestNews.publishedAt)).fromNow() : ""}` : "Tap to see the latest local news",
      onPress: () => navigation.navigate("News"),
    },
    {
      key: "eskom",
      label: "Load Shedding",
      desc: "Check your suburb's current schedule & stage",
      icon: "flash-off",
      iconType: "Material",
      bg: "bg-warning-light",
      color: "#F59E0B",
      preview: "Search your suburb for today's schedule",
      onPress: () => navigation.navigate("Eskom"),
    },
    {
      key: "poist",
      label: "Lost & Found",
      desc: "Report or search missing persons in Soweto",
      icon: "account-search",
      iconType: "MCI",
      bg: "bg-danger-light",
      color: "#EF4444",
      preview: activeCasesCount !== null
        ? `${activeCasesCount} active listing${activeCasesCount !== 1 ? "s" : ""}`
        : "Tap to view or report a case",
      onPress: () => navigation.navigate("PoIst"),
    },
  ]

  const Icon = ({ type, name, size, color }) => {
    if (type === "Material") return <MaterialIcons name={name} size={size} color={color} />
    if (type === "MCI") return <MaterialCommunityIcons name={name} size={size} color={color} />
    return <Ionicons name={name} size={size} color={color} />
  }

  return (
    <ScrollView className="flex-1 bg-bg" showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={announcementsLoading} onRefresh={refreshAnnouncements} colors={["#E8600A"]} tintColor="#E8600A" />}>
      {/* Header */}
      <View className="flex-row justify-between items-center px-[22px] pt-3.5 pb-3">
        <View>
          <Text className="text-[26px] font-extrabold text-ink -tracking-tight">Community</Text>
          <Text className="text-[13px] text-muted font-medium mt-0.5">News, power & safety, in one place</Text>
        </View>
        <View className="w-11 h-11 rounded-2xl bg-surface justify-center items-center border border-line">
          <Ionicons name="grid-outline" size={20} color="#1B4D5C" />
        </View>
      </View>

      {/* Announcements — live from the CMS */}
      {announcements.length > 0 && (
        <View className="px-[22px] mb-4">
          <View className="flex-row items-center gap-2 mb-2.5">
            <View className="w-[3px] h-[16px] rounded bg-brand" />
            <Text className="text-[13px] font-extrabold text-ink uppercase tracking-[0.8px]">Announcements</Text>
          </View>
          <View className="gap-3">
            {announcements.map((a) => <AnnouncementCard key={a.id} a={a} />)}
          </View>
        </View>
      )}

      {/* Feature cards */}
      <View className="px-[22px] gap-3">
        {cards.map(card => (
          <TouchableOpacity
            key={card.key}
            className="bg-surface rounded-2xl p-4 border border-line flex-row items-center gap-3.5"
            activeOpacity={0.85}
            onPress={card.onPress}
          >
            <View className={`w-14 h-14 rounded-2xl justify-center items-center ${card.bg}`}>
              <Icon type={card.iconType} name={card.icon} size={26} color={card.color} />
            </View>
            <View className="flex-1">
              <Text className="text-[16px] font-extrabold text-ink -tracking-tight mb-0.5">{card.label}</Text>
              <Text className="text-xs text-muted leading-4 mb-1.5" numberOfLines={2}>{card.desc}</Text>
              <Text className="text-[11px] font-semibold" style={{ color: card.color }} numberOfLines={1}>{card.preview}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#C0C4D6" />
          </TouchableOpacity>
        ))}
      </View>

      <View className="h-[100px]" />
    </ScrollView>
  )
}

export default Community