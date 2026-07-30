"use client"

import { useState, useEffect } from "react"
import {
  Text, View, ScrollView, TouchableOpacity, Image,
  Dimensions, Modal, Linking, Alert, ActionSheetIOS, Platform,
  RefreshControl, ActivityIndicator,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { collection, getDocs } from "firebase/firestore"
import { db } from "../../Firebase/config"
import { useScrollTracking, AnimatedFlatList } from "../BottomNav"

const { width } = Dimensions.get("window")

const TILE_THEMES = [
  { bgClass: "bg-teal-light",    hex: "#1B4D5C" },
  { bgClass: "bg-brand-light",   hex: "#E8600A" },
  { bgClass: "bg-success-light", hex: "#22C55E" },
  { bgClass: "bg-warning-light", hex: "#F59E0B" },
  { bgClass: "bg-danger-light",  hex: "#EF4444" },
]
const TYPE_ICONS = ["camera", "image", "earth", "leaf", "business", "star"]

const Attraction = () => {
  const [activeTab, setActiveTab]                   = useState("")
  const [selectedAttraction, setSelectedAttraction] = useState(null)
  const [modalVisible, setModalVisible]             = useState(false)
  const [currentImageIndex, setCurrentImageIndex]   = useState(0)
  const [favorites, setFavorites]                   = useState(new Set())
  const [attractionsData, setAttractionsData]       = useState({})
  const [attractionTypes, setAttractionTypes]       = useState([])
  const [dataLoading, setDataLoading]               = useState(true)
  const [refreshing, setRefreshing]                 = useState(false)

  const scrollProps = useScrollTracking()

  const openDirections = async (coordinates, name) => {
    if (!coordinates?.latitude || !coordinates?.longitude) {
      Alert.alert("Error", "Location coordinates not available."); return
    }
    const lat = parseFloat(coordinates.latitude)
    const lng = parseFloat(coordinates.longitude)
    const opts = [
      { name: "Apple Maps",          url: `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`, available: Platform.OS === "ios" },
      { name: "Google Maps",         url: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, available: true },
      { name: "Waze",                url: `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`, checkUrl: "waze://", available: false },
      { name: "Petal Maps (Huawei)", url: `petalmaps://route?daddr=${lat},${lng}`, checkUrl: "petalmaps://", available: false },
    ]
    const avail = []
    for (const o of opts) {
      if (o.available) { avail.push(o) }
      else if (o.checkUrl) { try { if (await Linking.canOpenURL(o.checkUrl)) avail.push(o) } catch {} }
    }
    const native = Platform.OS === "ios"
      ? { name: "Maps (Default)", url: `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d` }
      : { name: "Maps (Default)", url: `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(name)})` }
    const final = [native, ...avail]
    const names = [...final.map(o => o.name), "Cancel"]
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions({ options: names, cancelButtonIndex: names.length - 1, title: `Get directions to ${name}` },
        i => { if (i < final.length) Linking.openURL(final[i].url).catch(() => Alert.alert("Error", "Could not open maps")) })
    } else {
      Alert.alert("Choose Maps App", `Get directions to ${name}`, [
        ...final.map(o => ({ text: o.name, onPress: () => Linking.openURL(o.url).catch(() => Alert.alert("Error", "Could not open maps")) })),
        { text: "Cancel", style: "cancel" },
      ], { cancelable: true })
    }
  }

  const fetchAttractionsData = async () => {
  try {
    setDataLoading(true)

    const snap = await getDocs(collection(db, "attractions"))

    const grouped = {}
    const typesSet = new Set()

    snap.forEach((doc) => {
      const data = {
        id: doc.id,
        ...doc.data(),
      }

      // Match the old component exactly
      const type = data.type?.trim() || "All Attractions"

      typesSet.add(type)

      if (!grouped[type]) {
        grouped[type] = []
      }

      grouped[type].push({
        ...data,
        type,
      })
    })

    const uniqueTypes = Array.from(typesSet).sort()

    setAttractionsData(grouped)
    setAttractionTypes(uniqueTypes)

    // Ensure the selected tab always exists
    setActiveTab((prev) =>
      prev && grouped[prev]
        ? prev
        : uniqueTypes[0] || ""
    )

  } catch (error) {
    console.log("Error loading attractions:", error)
    setAttractionsData({})
    setAttractionTypes([])
  } finally {
    setDataLoading(false)
    setRefreshing(false)
  }
}

  const onRefresh = async () => { setRefreshing(true); await fetchAttractionsData() }
  useEffect(() => { fetchAttractionsData() }, [])

  const toggleFavorite = (id) => {
    const n = new Set(favorites); n.has(id) ? n.delete(id) : n.add(id); setFavorites(n)
  }
  const openAttractionDetails = (a) => { setSelectedAttraction(a); setCurrentImageIndex(0); setModalVisible(true) }

  const renderStars = (rating, size = 12) => {
    const full = Math.floor(rating), half = rating % 1 !== 0, empty = 5 - Math.ceil(rating)
    return [
      ...Array(full).fill(0).map((_, i) => <Ionicons key={`f${i}`} name="star" size={size} color="#F59E0B" />),
      ...(half ? [<Ionicons key="h" name="star-half" size={size} color="#F59E0B" />] : []),
      ...Array(empty).fill(0).map((_, i) => <Ionicons key={`e${i}`} name="star-outline" size={size} color="#F59E0B" />),
    ]
  }

  // ── Attraction Card ─────────────────────────────────────────────────────
  const renderAttractionCard = ({ item, index }) => {
    const isOpen = item.status === "Open"
    const theme = TILE_THEMES[index % TILE_THEMES.length]
    return (
      <TouchableOpacity
        className="bg-surface rounded-2xl mb-3.5 overflow-hidden border border-line"
        onPress={() => openAttractionDetails(item)}
        activeOpacity={0.9}
      >
        {/* Image */}
        <View className="relative">
          <Image source={{ uri: item.images[0] }} className="w-full h-[150px]" />
          <View className="absolute bottom-0 left-0 right-0 h-12 bg-black/35" />

          <TouchableOpacity
            className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-black/35 justify-center items-center"
            onPress={() => toggleFavorite(item.id)}
          >
            <Ionicons name={favorites.has(item.id) ? "heart" : "heart-outline"} size={16} color={favorites.has(item.id) ? "#EF4444" : "#FFFFFF"} />
          </TouchableOpacity>

          <View className={`absolute top-2.5 left-2.5 flex-row items-center gap-1 px-2 py-1 rounded-full ${isOpen ? "bg-success" : "bg-warning"}`}>
            <View className="w-1.5 h-1.5 rounded-full bg-white/80" />
            <Text className="text-[10px] font-bold text-white">{item.status}</Text>
          </View>

          {(item.price !== undefined && item.price !== null) ? (
            <View className="absolute bottom-2.5 right-2.5 bg-white/95 px-2.5 py-1 rounded-full">
              <Text className="text-[12px] font-extrabold text-ink">R{item.price}</Text>
            </View>
          ) : null}

          <View className="absolute bottom-2.5 left-2.5 right-2.5">
            <Text className="text-[15px] font-extrabold text-white -tracking-tight" numberOfLines={1}>{item.name}</Text>
          </View>
        </View>

        {/* Body */}
        <View className="p-3">
          <View className="flex-row items-center justify-between mb-1.5">
            <View className="flex-row items-center gap-1 flex-1 mr-2">
              <Ionicons name="location-outline" size={11} color="#7A8A8F" />
              <Text className="text-[11px] text-muted flex-1" numberOfLines={1}>{item.location}</Text>
            </View>
            <View className={`px-2 py-0.5 rounded-lg ${theme.bgClass}`}>
              <Text className="text-[9px] font-extrabold uppercase tracking-wide" style={{ color: theme.hex }}>{item.type || "Attraction"}</Text>
            </View>
          </View>

          <View className="flex-row items-center justify-between mb-2.5">
            <View className="flex-row items-center gap-1">
              {renderStars(item.rating)}
              <Text className="text-[11px] font-bold text-ink ml-1">{item.rating}</Text>
              <Text className="text-[10px] text-muted">({item.reviews})</Text>
            </View>
            {item.duration ? (
              <View className="flex-row items-center gap-1 bg-teal-light px-2 py-1 rounded-full">
                <Ionicons name="time-outline" size={11} color="#1B4D5C" />
                <Text className="text-[10px] text-teal font-bold" numberOfLines={1}>{item.duration}</Text>
              </View>
            ) : null}
          </View>

          <View className="flex-row gap-2">
            <TouchableOpacity
              className="flex-1 flex-row items-center justify-center gap-1.5 border border-line py-2 rounded-xl"
              onPress={(e) => { e.stopPropagation(); openDirections(item.coordinates, item.name) }}
            >
              <Ionicons name="navigate-outline" size={13} color="#1B4D5C" />
              <Text className="text-[12px] font-bold text-ink">Directions</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="flex-1 flex-row items-center justify-center gap-1.5 bg-brand py-2 rounded-xl"
              onPress={(e) => { e.stopPropagation(); openAttractionDetails(item) }}
            >
              <Text className="text-[12px] font-bold text-surface">Explore</Text>
              <Ionicons name="arrow-forward" size={12} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    )
  }

  // ── Carousel ──────────────────────────────────────────────────────────────
  const renderCarousel = () => {
    if (!selectedAttraction) return null
    return (
      <View>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setCurrentImageIndex(Math.round(e.nativeEvent.contentOffset.x / width))}>
          {selectedAttraction.images.map((img, i) => (
            <View key={i} className="relative">
              <Image source={{ uri: img }} style={{ width, height: 240 }} />
              <View className="absolute bottom-0 left-0 right-0 h-20 bg-black/30" />
            </View>
          ))}
        </ScrollView>
        <View className="flex-row justify-center py-2.5 gap-1.5">
          {selectedAttraction.images.map((_, i) => (
            <View key={i} className={`h-1.5 rounded-full ${i === currentImageIndex ? "w-5 bg-brand" : "w-1.5 bg-line"}`} />
          ))}
        </View>
      </View>
    )
  }

  // ── States ──────────────────────────────────────────────────────────────
  if (dataLoading) {
    return (
      <View className="flex-1 bg-bg justify-center items-center px-10">
        <View className="w-20 h-20 rounded-3xl bg-teal-light justify-center items-center mb-4">
          <Ionicons name="camera-outline" size={32} color="#1B4D5C" />
        </View>
        <ActivityIndicator size="large" color="#E8600A" style={{ marginTop: 8 }} />
        <Text className="text-[15px] font-bold text-ink mt-3">Loading attractions…</Text>
      </View>
    )
  }

  if (!Object.keys(attractionsData).length) {
    return (
      <View className="flex-1 bg-bg justify-center items-center px-10">
        <View className="w-20 h-20 rounded-3xl bg-teal-light justify-center items-center mb-4">
          <Ionicons name="camera-outline" size={32} color="#1B4D5C" />
        </View>
        <Text className="text-[16px] font-bold text-ink text-center">No attractions available</Text>
        <Text className="text-[13px] text-muted mt-1.5 text-center">Please add some attractions to get started</Text>
      </View>
    )
  }

  const currentItems = attractionsData[activeTab] || []

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View className="flex-1 bg-bg">
      {/* Header */}
      <View className="flex-row justify-between items-center px-[22px] pt-3.5 pb-2.5">
        <View>
          <Text className="text-lg font-extrabold text-ink -tracking-tight">Attractions</Text>
          <Text className="text-[13px] text-muted font-medium mt-0.5">Things to see & do</Text>
        </View>
        <View className="w-11 h-11 rounded-2xl bg-surface justify-center items-center border border-line">
          <Ionicons name="camera-outline" size={18} color="#1B4D5C" />
        </View>
      </View>

      {/* Type tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="bg-surface border-b border-line"
        style={{ flexGrow: 0, flexShrink: 0 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8 }}
      >
        {attractionTypes.map((type, i) => {
          const isActive = activeTab === type
          return (
            <TouchableOpacity key={type} className="items-center px-3 pt-2 mr-4" onPress={() => setActiveTab(type)} activeOpacity={0.8}>
              <View className={`w-8 h-8 rounded-xl justify-center items-center mb-1 ${isActive ? "bg-brand-light" : TILE_THEMES[i % TILE_THEMES.length].bgClass}`}>
                <Ionicons name={TYPE_ICONS[i % TYPE_ICONS.length]} size={14} color={isActive ? "#E8600A" : "#1B4D5C"} />
              </View>
              <Text className={`text-[10px] font-semibold ${isActive ? "text-brand" : "text-muted"}`}>{type}</Text>
              <View className={`mt-1 h-[2.5px] rounded-full ${isActive ? "bg-brand w-10" : "bg-transparent w-10"}`} />
            </TouchableOpacity>
          )
        })}
      </ScrollView>

      {/* Count bar */}
      <View className="px-5 py-2">
        <Text className="text-[12px] text-muted font-medium">
          <Text className="font-extrabold text-ink">{currentItems.length}</Text> attractions found
        </Text>
      </View>

      {/* List */}
      <AnimatedFlatList
        data={currentItems}
        renderItem={renderAttractionCard}
        keyExtractor={(item) => item.id.toString()}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={["#E8600A"]} tintColor="#E8600A" />}
        ListEmptyComponent={() => (
          <View className="items-center py-16">
            <View className="w-20 h-20 rounded-3xl bg-teal-light justify-center items-center mb-4">
              <Ionicons name="camera-outline" size={36} color="#1B4D5C" />
            </View>
            <Text className="text-[15px] font-bold text-ink">No {activeTab?.toLowerCase()} attractions</Text>
            <Text className="text-[12px] text-muted mt-1.5 text-center">Try a different category or pull to refresh</Text>
          </View>
        )}
        {...scrollProps}
      />

      {/* Detail Modal */}
      <Modal animationType="slide" transparent={false} visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <View className="flex-1 bg-bg">
          <View className="absolute top-12 left-0 right-0 flex-row justify-between px-4 z-10">
            <TouchableOpacity className="w-10 h-10 rounded-2xl bg-black/35 justify-center items-center" onPress={() => setModalVisible(false)}>
              <Ionicons name="chevron-down" size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity className="w-10 h-10 rounded-2xl bg-black/35 justify-center items-center" onPress={() => toggleFavorite(selectedAttraction?.id)}>
              <Ionicons name={favorites.has(selectedAttraction?.id) ? "heart" : "heart-outline"} size={20} color={favorites.has(selectedAttraction?.id) ? "#EF4444" : "#FFFFFF"} />
            </TouchableOpacity>
          </View>

          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            {renderCarousel()}

            {selectedAttraction && (
              <View className="p-5">
                {/* Title row */}
                <View className="flex-row items-start mb-3">
                  <View className="flex-1">
                    <Text className="text-[20px] font-extrabold text-ink -tracking-tight mb-1">{selectedAttraction.name}</Text>
                    <View className="flex-row items-center gap-1">
                      <Ionicons name="location-outline" size={13} color="#7A8A8F" />
                      <Text className="text-[13px] text-muted">{selectedAttraction.location}</Text>
                    </View>
                  </View>
                  <View className={`px-2.5 py-1.5 rounded-full mt-1 ${selectedAttraction.status === "Open" ? "bg-success" : "bg-warning"}`}>
                    <Text className="text-[11px] font-bold text-white">{selectedAttraction.status}</Text>
                  </View>
                </View>

                {/* Meta card */}
                <View className="flex-row items-center bg-surface rounded-2xl p-3.5 mb-3 border border-line">
                  <View className="flex-1 items-center gap-1.5">
                    <Text className="text-[15px] font-extrabold text-ink">R{selectedAttraction.price}</Text>
                    <Text className="text-[11px] text-muted">Entry</Text>
                  </View>
                  <View className="w-px h-10 bg-line" />
                  <View className="flex-1 items-center gap-1.5">
                    <View className="flex-row items-center gap-0.5">{renderStars(selectedAttraction.rating, 12)}</View>
                    <Text className="text-[11px] text-ink font-semibold text-center">{selectedAttraction.rating} ({selectedAttraction.reviews})</Text>
                  </View>
                  <View className="w-px h-10 bg-line" />
                  <View className="flex-1 items-center gap-1.5">
                    <Ionicons name="time-outline" size={16} color="#1B4D5C" />
                    <Text className="text-[11px] text-ink font-semibold text-center" numberOfLines={1}>{selectedAttraction.duration}</Text>
                  </View>
                </View>

                {/* Best time chip */}
                {selectedAttraction.bestTime ? (
                  <View className="flex-row items-center gap-1.5 bg-teal-light px-3 py-2 rounded-xl mb-3">
                    <Ionicons name="sunny-outline" size={14} color="#1B4D5C" />
                    <Text className="text-[12px] font-semibold text-ink">Best time: {selectedAttraction.bestTime}</Text>
                  </View>
                ) : null}

                {/* Directions */}
                <TouchableOpacity
                  className="flex-row items-center justify-center gap-2 bg-teal-light py-2.5 rounded-2xl mb-4 border border-teal/20"
                  onPress={() => openDirections(selectedAttraction.coordinates, selectedAttraction.name)}
                >
                  <Ionicons name="navigate" size={15} color="#1B4D5C" />
                  <Text className="text-[13px] font-bold text-teal">Get Directions</Text>
                </TouchableOpacity>

                {/* Description */}
                {selectedAttraction.description ? (
                  <View className="mb-4">
                    <Text className="text-[11px] font-extrabold text-muted uppercase tracking-wider mb-2">About</Text>
                    <Text className="text-[14px] text-ink leading-5">{selectedAttraction.description}</Text>
                  </View>
                ) : null}

                {/* Features */}
                {selectedAttraction.features?.length > 0 && (
                  <View className="mb-4">
                    <Text className="text-[11px] font-extrabold text-muted uppercase tracking-wider mb-2">Features</Text>
                    <View className="flex-row flex-wrap gap-2">
                      {selectedAttraction.features.map((f, i) => (
                        <View key={i} className={`flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-xl ${TILE_THEMES[i % TILE_THEMES.length].bgClass}`}>
                          <Ionicons name="checkmark-circle" size={13} color={TILE_THEMES[i % TILE_THEMES.length].hex} />
                          <Text className="text-[12px] text-ink font-medium">{f}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  )
}

export default Attraction