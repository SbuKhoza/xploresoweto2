import { useState, useEffect } from "react"
import { Text, View, TouchableOpacity, SafeAreaView, StatusBar } from "react-native"
import { useNavigation } from "@react-navigation/native"
import FontAwesome from "react-native-vector-icons/FontAwesome"
import MaterialIcons from "react-native-vector-icons/MaterialIcons"
import Ionicons from "react-native-vector-icons/Ionicons"
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons"
import { collection, getDocs } from "firebase/firestore"
import { db } from "../Firebase/config"
import { useScrollTracking, AnimatedFlatList } from "../components/BottomNav"

// Same rotating tile-color scheme used on the Community hub, so a card in
// Xplore and a card in Community read as the same design system.
const TILE_THEMES = [
  { bgClass: "bg-teal-light",    hex: "#1B4D5C" },
  { bgClass: "bg-brand-light",   hex: "#E8600A" },
  { bgClass: "bg-success-light", hex: "#22C55E" },
  { bgClass: "bg-warning-light", hex: "#F59E0B" },
  { bgClass: "bg-danger-light",  hex: "#EF4444" },
]

export default function Xplore() {
  const navigation = useNavigation()
  const [viewMode, setViewMode] = useState("grid")
  const [exploreItems, setExploreItems] = useState([])
  const [dataLoading, setDataLoading] = useState(true)
  const [error, setError] = useState(null)

  const scrollProps = useScrollTracking()

  const fetchXploreMenuData = async () => {
    try {
      setDataLoading(true)
      setError(null)

      const xploreMenuRef = collection(db, "xplore-menu")
      const snapshot = await getDocs(xploreMenuRef)

      if (snapshot.empty) {
        setExploreItems([])
        return
      }

      const menuItems = []
      snapshot.forEach((doc) => {
        const data = { id: doc.id, ...doc.data() }
        if (data.isActive !== false) menuItems.push(data)
      })

      menuItems.sort((a, b) => (a.order || 0) - (b.order || 0))
      setExploreItems(menuItems)
    } catch (err) {
      console.error("Error fetching xplore menu data:", err)
      setError("Failed to load menu items")
      setExploreItems([])
    } finally {
      setDataLoading(false)
    }
  }

  useEffect(() => { fetchXploreMenuData() }, [])

  const handleItemPress = (item) => navigation.navigate(item.screen)

  const renderIcon = (item, color, size = 20) => {
    switch (item.iconType) {
      case "FontAwesome":             return <FontAwesome name={item.icon} size={size} color={color} />
      case "MaterialIcons":           return <MaterialIcons name={item.icon} size={size} color={color} />
      case "Ionicons":                return <Ionicons name={item.icon} size={size} color={color} />
      case "MaterialCommunityIcons":  return <MaterialCommunityIcons name={item.icon} size={size} color={color} />
      default:                        return <FontAwesome name="question-circle" size={size} color={color} />
    }
  }

  // ── Grid tile — matches Community hub's tile card exactly ──
  const GridItem = ({ item, index }) => {
    const theme = TILE_THEMES[index % TILE_THEMES.length]
    return (
      <TouchableOpacity
        className="w-[48%] bg-surface rounded-2xl p-3.5 border border-line mb-3"
        onPress={() => handleItemPress(item)}
        activeOpacity={0.85}
      >
        <View className={`w-11 h-11 rounded-xl justify-center items-center mb-2.5 ${theme.bgClass}`}>
          {renderIcon(item, theme.hex, 20)}
        </View>
        <Text className="text-[13px] font-bold text-ink -tracking-tight mb-0.5" numberOfLines={1}>{item.title}</Text>
        {item.description ? (
          <Text className="text-[11px] text-muted leading-4" numberOfLines={2}>{item.description}</Text>
        ) : null}
      </TouchableOpacity>
    )
  }

  // ── List row — same card language, horizontal layout ──
  const ListItem = ({ item, index }) => {
    const theme = TILE_THEMES[index % TILE_THEMES.length]
    return (
      <TouchableOpacity
        className="flex-row items-center bg-surface rounded-2xl border border-line p-3.5 mb-3 gap-3"
        onPress={() => handleItemPress(item)}
        activeOpacity={0.85}
      >
        <View className={`w-11 h-11 rounded-xl justify-center items-center ${theme.bgClass}`}>
          {renderIcon(item, theme.hex, 20)}
        </View>
        <Text className="flex-1 text-[14px] font-bold text-ink -tracking-tight" numberOfLines={1}>{item.title}</Text>
        <View className="w-8 h-8 rounded-lg bg-bg justify-center items-center">
          <MaterialIcons name="chevron-right" size={18} color="#1B4D5C" />
        </View>
      </TouchableOpacity>
    )
  }

  // ── Loading state ──
  if (dataLoading) {
    return (
      <SafeAreaView className="flex-1 bg-bg justify-center items-center px-10">
        <StatusBar barStyle="dark-content" />
        <View className="w-20 h-20 rounded-3xl bg-teal-light justify-center items-center mb-4">
          <MaterialIcons name="explore" size={36} color="#1B4D5C" />
        </View>
        <Text className="text-base font-bold text-ink text-center">Loading menu…</Text>
      </SafeAreaView>
    )
  }

  // ── Error state ──
  if (error) {
    return (
      <SafeAreaView className="flex-1 bg-bg justify-center items-center px-10">
        <StatusBar barStyle="dark-content" />
        <View className="w-20 h-20 rounded-3xl bg-danger-light justify-center items-center mb-4">
          <MaterialIcons name="error-outline" size={36} color="#EF4444" />
        </View>
        <Text className="text-lg font-extrabold text-ink mb-1.5">Oops!</Text>
        <Text className="text-sm text-muted text-center mb-5">{error}</Text>
        <TouchableOpacity className="bg-brand px-6 py-3 rounded-2xl" onPress={fetchXploreMenuData} activeOpacity={0.85}>
          <Text className="text-surface text-[14px] font-bold">Try Again</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  // ── Empty state ──
  if (exploreItems.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-bg justify-center items-center px-10">
        <StatusBar barStyle="dark-content" />
        <View className="w-20 h-20 rounded-3xl bg-teal-light justify-center items-center mb-4">
          <MaterialIcons name="explore-off" size={36} color="#1B4D5C" />
        </View>
        <Text className="text-lg font-extrabold text-ink mb-1.5">Nothing here yet</Text>
        <Text className="text-sm text-muted text-center mb-5">Check back later or contact support</Text>
        <TouchableOpacity className="bg-brand px-6 py-3 rounded-2xl" onPress={fetchXploreMenuData} activeOpacity={0.85}>
          <Text className="text-surface text-[14px] font-bold">Refresh</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <StatusBar barStyle="dark-content" />

      {/* Header — mirrors Community's header exactly */}
      <View className="flex-row justify-between items-center px-[22px] pt-3.5 pb-3">
        <View>
          <Text className="text-[26px] font-extrabold text-ink -tracking-tight">Explore</Text>
          <Text className="text-[13px] text-muted font-medium mt-0.5">Discover Soweto</Text>
        </View>
        <View className="flex-row bg-surface rounded-2xl p-1 border border-line">
          <TouchableOpacity
            className={`w-9 h-9 rounded-xl justify-center items-center ${viewMode === "grid" ? "bg-teal-light" : ""}`}
            onPress={() => setViewMode("grid")}
          >
            <MaterialIcons name="grid-view" size={17} color={viewMode === "grid" ? "#1B4D5C" : "#AAAAAA"} />
          </TouchableOpacity>
          <TouchableOpacity
            className={`w-9 h-9 rounded-xl justify-center items-center ${viewMode === "list" ? "bg-teal-light" : ""}`}
            onPress={() => setViewMode("list")}
          >
            <MaterialIcons name="view-list" size={17} color={viewMode === "list" ? "#1B4D5C" : "#AAAAAA"} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      {viewMode === "grid" ? (
        <AnimatedFlatList
          data={exploreItems}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => <GridItem item={item} index={index} />}
          numColumns={2}
          columnWrapperStyle={{ justifyContent: "space-between" }}
          contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          {...scrollProps}
        />
      ) : (
        <AnimatedFlatList
          data={exploreItems}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => <ListItem item={item} index={index} />}
          contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          {...scrollProps}
        />
      )}
    </SafeAreaView>
  )
}