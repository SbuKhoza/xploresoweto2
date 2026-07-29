"use client"
import { useMemo } from "react"
import { Text, View, TouchableOpacity, ScrollView } from "react-native"
import { useNavigation } from "@react-navigation/native"
import { Ionicons, MaterialIcons, MaterialCommunityIcons } from "@expo/vector-icons"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import { useOfflineData } from "../hooks/useOfflineData"

dayjs.extend(relativeTime)

const Community = () => {
  const navigation = useNavigation()

  const newsOptions = useMemo(() => ({ maxAgeMinutes: 20 }), [])
  const { data: news } = useOfflineData("news", newsOptions)
  const latestNews = news && news.length > 0
    ? [...news].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))[0]
    : null

  const poiOptions = useMemo(() => ({ maxAgeMinutes: 20 }), [])
  const { data: personsOfInterest } = useOfflineData("Person-Of-Interest", poiOptions)
  const activeCasesCount = personsOfInterest ? personsOfInterest.length : null

  const cards = [
    {
      key: "news",
      label: "News",
      desc: "Local headlines & community updates",
      icon: "newspaper",
      iconType: "Ionicons",
      bg: "bg-teal-light",
      color: "#1B4D5C",
      preview: latestNews ? `${latestNews.title} · ${dayjs(latestNews.publishedAt).fromNow()}` : "Tap to see the latest local news",
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
    <ScrollView className="flex-1 bg-bg" showsVerticalScrollIndicator={false}>
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