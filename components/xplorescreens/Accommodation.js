import { useState, useEffect } from "react"
import {
  Text, View, ScrollView, TouchableOpacity, Image, Dimensions, Modal,
  Linking, Alert, ActionSheetIOS, Platform, RefreshControl, ActivityIndicator,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { collection, getDocs } from "firebase/firestore"
import { db } from "../../Firebase/config"
import { useScrollTracking, AnimatedFlatList } from "../BottomNav"
import ReservationForm from "./ReservationForm"

const { width } = Dimensions.get("window")

// Same rotating tile-color scheme used across Xplore/Community, so this
// screen reads as part of the same family instead of its own thing.
const TILE_THEMES = [
  { bgClass: "bg-teal-light",    hex: "#1B4D5C" },
  { bgClass: "bg-brand-light",   hex: "#E8600A" },
  { bgClass: "bg-success-light", hex: "#22C55E" },
  { bgClass: "bg-warning-light", hex: "#F59E0B" },
  { bgClass: "bg-danger-light",  hex: "#EF4444" },
]
const TYPE_ICONS = ["bed", "home", "business", "cafe", "leaf", "water"]

const Accommodation = () => {
  const [activeTab, setActiveTab] = useState("")
  const [selectedAccommodation, setSelectedAccommodation] = useState(null)
  const [modalVisible, setModalVisible] = useState(false)
  const [reservationModalVisible, setReservationModalVisible] = useState(false)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [favorites, setFavorites] = useState(new Set())
  const [accommodationsData, setAccommodationsData] = useState({})
  const [accommodationTypes, setAccommodationTypes] = useState([])
  const [dataLoading, setDataLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const scrollProps = useScrollTracking()

  const openDirections = async (coordinates, name) => {
    if (!coordinates || !coordinates.latitude || !coordinates.longitude) {
      Alert.alert("Error", "Location coordinates not available for this accommodation.")
      return
    }
    const lat = Number.parseFloat(coordinates.latitude)
    const lng = Number.parseFloat(coordinates.longitude)
    const mapsOptions = [
      { name: "Apple Maps", url: `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`, checkUrl: "http://maps.apple.com/", available: Platform.OS === "ios" },
      { name: "Google Maps", url: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, checkUrl: "comgooglemaps://", available: true },
      { name: "Waze", url: `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`, checkUrl: "waze://", available: false },
      { name: "Petal Maps (Huawei)", url: `petalmaps://route?daddr=${lat},${lng}`, checkUrl: "petalmaps://", available: false },
    ]
    const availableOptions = []
    for (const option of mapsOptions) {
      if (option.available) { availableOptions.push(option) }
      else if (option.checkUrl !== option.url) {
        try { const canOpen = await Linking.canOpenURL(option.checkUrl); if (canOpen) availableOptions.push(option) } catch {}
      }
    }
    const nativeOption = Platform.OS === "ios"
      ? { name: "Maps (Default)", url: `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d` }
      : { name: "Maps (Default)", url: `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(name)})` }
    const finalOptions = [nativeOption, ...availableOptions]
    const optionNames = [...finalOptions.map((o) => o.name), "Cancel"]
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions({ options: optionNames, cancelButtonIndex: optionNames.length - 1, title: `Get directions to ${name}` }, (i) => {
        if (i < finalOptions.length) Linking.openURL(finalOptions[i].url).catch(() => Alert.alert("Error", "Could not open maps application"))
      })
    } else {
      Alert.alert("Choose Maps App", `Get directions to ${name}`, [
        ...finalOptions.map((o) => ({ text: o.name, onPress: () => Linking.openURL(o.url).catch(() => Alert.alert("Error", "Could not open maps application")) })),
        { text: "Cancel", style: "cancel" },
      ], { cancelable: true })
    }
  }

  const fetchAccommodationsData = async () => {
    try {
      setDataLoading(true)
      const ref = collection(db, "accommodations")
      const snap = await getDocs(ref)
      const grouped = {}
      const typesSet = new Set()
      snap.forEach((doc) => {
        const data = { id: doc.id, ...doc.data() }
        if (data.type) {
          typesSet.add(data.type)
          if (!grouped[data.type]) grouped[data.type] = []
          grouped[data.type].push(data)
        }
      })
      const uniqueTypes = Array.from(typesSet).sort()
      setAccommodationsData(grouped)
      setAccommodationTypes(uniqueTypes)
      if (!activeTab && uniqueTypes.length > 0) setActiveTab(uniqueTypes[0])
    } catch {
      setAccommodationsData({})
      setAccommodationTypes([])
    } finally {
      setDataLoading(false)
      setRefreshing(false)
    }
  }

  const onRefresh = async () => { setRefreshing(true); await fetchAccommodationsData() }
  useEffect(() => { fetchAccommodationsData() }, [])

  const toggleFavorite = (id) => {
    const n = new Set(favorites)
    n.has(id) ? n.delete(id) : n.add(id)
    setFavorites(n)
  }

  const openAccommodationDetails = (acc) => {
    setSelectedAccommodation(acc)
    setCurrentImageIndex(0)
    setModalVisible(true)
  }

  const openReservationForm = (acc) => {
    setSelectedAccommodation(acc)
    setModalVisible(false)
    setReservationModalVisible(true)
  }

  const renderStars = (rating, size = 12) => {
    const stars = []
    const full = Math.floor(rating)
    const half = rating % 1 !== 0
    for (let i = 0; i < full; i++) stars.push(<Ionicons key={i} name="star" size={size} color="#F59E0B" />)
    if (half) stars.push(<Ionicons key="half" name="star-half" size={size} color="#F59E0B" />)
    const empty = 5 - Math.ceil(rating)
    for (let i = 0; i < empty; i++) stars.push(<Ionicons key={`e-${i}`} name="star-outline" size={size} color="#F59E0B" />)
    return stars
  }

  // ── Accommodation Card — compact ─────────────────────────────────────────
  const renderAccommodationCard = ({ item, index }) => {
    const isAvailable = item.availability === "Available"
    const theme = TILE_THEMES[index % TILE_THEMES.length]
    return (
      <TouchableOpacity
        className="bg-surface rounded-2xl mb-3.5 overflow-hidden border border-line"
        onPress={() => openAccommodationDetails(item)}
        activeOpacity={0.9}
      >
        {/* Image */}
        <View className="relative">
          <Image source={{ uri: item.images[0] }} className="w-full h-[150px]" />
          <View className="absolute bottom-0 left-0 right-0 h-10 bg-black/30" />

          <TouchableOpacity
            className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-black/35 justify-center items-center"
            onPress={() => toggleFavorite(item.id)}
          >
            <Ionicons name={favorites.has(item.id) ? "heart" : "heart-outline"} size={16} color={favorites.has(item.id) ? "#EF4444" : "#FFFFFF"} />
          </TouchableOpacity>

          <View className={`absolute top-2.5 left-2.5 flex-row items-center gap-1 px-2 py-1 rounded-full ${isAvailable ? "bg-success" : "bg-warning"}`}>
            <View className="w-1.5 h-1.5 rounded-full bg-white/80" />
            <Text className="text-[10px] font-bold text-white">{item.availability}</Text>
          </View>

          <View className="absolute bottom-2.5 left-2.5 flex-row items-baseline bg-white/95 px-2.5 py-1 rounded-full">
            <Text className="text-[14px] font-extrabold text-ink">R{item.price}</Text>
            <Text className="text-[10px] text-muted font-medium ml-0.5">/night</Text>
          </View>
        </View>

        {/* Body */}
        <View className="p-3">
          <View className="flex-row items-start justify-between mb-1.5">
            <View className="flex-1 mr-2">
              <Text className="text-[14px] font-extrabold text-ink -tracking-tight" numberOfLines={1}>{item.name}</Text>
              <View className="flex-row items-center gap-1 mt-0.5">
                <Ionicons name="location-outline" size={11} color="#7A8A8F" />
                <Text className="text-[11px] text-muted flex-1" numberOfLines={1}>{item.location}</Text>
              </View>
            </View>
            <View className={`px-2 py-0.5 rounded-lg ${theme.bgClass}`}>
              <Text className="text-[9px] font-extrabold uppercase tracking-wide" style={{ color: theme.hex }}>{item.type}</Text>
            </View>
          </View>

          <View className="flex-row items-center justify-between mb-2.5">
            <View className="flex-row items-center gap-1">
              {renderStars(item.rating)}
              <Text className="text-[11px] font-bold text-ink ml-1">{item.rating}</Text>
              <Text className="text-[10px] text-muted">({item.reviews})</Text>
            </View>
            <View className="flex-row items-center gap-1 bg-teal-light px-2 py-1 rounded-full">
              <Ionicons name="people-outline" size={11} color="#1B4D5C" />
              <Text className="text-[10px] text-teal font-bold">{item.maxGuests} guests</Text>
            </View>
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
              onPress={(e) => { e.stopPropagation(); openReservationForm(item) }}
            >
              <Text className="text-[12px] font-bold text-surface">Reserve</Text>
              <Ionicons name="arrow-forward" size={12} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    )
  }

  // ── Image carousel (in modal) ─────────────────────────────────────────────
  const renderImageCarousel = () => {
    if (!selectedAccommodation) return null
    return (
      <View>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setCurrentImageIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        >
          {selectedAccommodation.images.map((img, i) => (
            <View key={i} className="relative">
              <Image source={{ uri: img }} style={{ width, height: 240 }} />
              <View className="absolute bottom-0 left-0 right-0 h-20 bg-black/30" />
            </View>
          ))}
        </ScrollView>
        <View className="flex-row justify-center py-2.5 gap-1.5">
          {selectedAccommodation.images.map((_, i) => (
            <View key={i} className={`h-1.5 rounded-full ${i === currentImageIndex ? "w-5 bg-brand" : "w-1.5 bg-line"}`} />
          ))}
        </View>
      </View>
    )
  }

  // ── Loading / Empty states ────────────────────────────────────────────────
  if (dataLoading) {
    return (
      <View className="flex-1 bg-bg justify-center items-center px-10">
        <View className="w-20 h-20 rounded-3xl bg-teal-light justify-center items-center mb-4">
          <Ionicons name="bed-outline" size={32} color="#1B4D5C" />
        </View>
        <ActivityIndicator size="large" color="#E8600A" style={{ marginTop: 8 }} />
        <Text className="text-[15px] font-bold text-ink mt-3">Loading accommodations…</Text>
      </View>
    )
  }

  if (Object.keys(accommodationsData).length === 0 || accommodationTypes.length === 0) {
    return (
      <View className="flex-1 bg-bg justify-center items-center px-10">
        <View className="w-20 h-20 rounded-3xl bg-teal-light justify-center items-center mb-4">
          <Ionicons name="bed-outline" size={32} color="#1B4D5C" />
        </View>
        <Text className="text-[16px] font-bold text-ink text-center">No accommodations available</Text>
        <Text className="text-[13px] text-muted mt-1.5 text-center">Please add some accommodations to get started</Text>
      </View>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <View className="flex-1 bg-bg">
      {/* Header */}
      <View className="flex-row justify-between items-center px-[22px] pt-3.5 pb-2.5">
        <View>
          <Text className="text-lg font-extrabold text-ink -tracking-tight">Stay</Text>
          <Text className="text-[13px] text-muted font-medium mt-0.5">Find your perfect place</Text>
        </View>
        <View className="w-11 h-11 rounded-2xl bg-surface justify-center items-center border border-line">
          <Ionicons name="bed-outline" size={18} color="#1B4D5C" />
        </View>
      </View>

      {/* Type tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="bg-surface border-b border-line"
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 6 }}>
        {accommodationTypes.map((type, i) => {
          const isActive = activeTab === type
          return (
            <TouchableOpacity key={type} className="items-center px-3 py-1.5 relative" onPress={() => setActiveTab(type)} activeOpacity={0.8}>
              <View className={`w-8 h-8 rounded-xl justify-center items-center mb-1 ${isActive ? "bg-brand-light" : TILE_THEMES[i % TILE_THEMES.length].bgClass}`}>
                <Ionicons name={TYPE_ICONS[i % TYPE_ICONS.length]} size={14} color={isActive ? "#E8600A" : "#1B4D5C"} />
              </View>
              <Text className={`text-[10px] font-semibold ${isActive ? "text-brand" : "text-muted"}`}>{type}</Text>
              {isActive && <View className="absolute -bottom-1 left-[30%] right-[30%] h-[2.5px] rounded bg-brand" />}
            </TouchableOpacity>
          )
        })}
      </ScrollView>

      {/* Count bar */}
      <View className="px-5 py-2">
        <Text className="text-[12px] text-muted font-medium">
          <Text className="font-extrabold text-ink">{(accommodationsData[activeTab] || []).length}</Text> properties found
        </Text>
      </View>

      {/* List */}
      <AnimatedFlatList
        data={accommodationsData[activeTab] || []}
        renderItem={renderAccommodationCard}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={["#E8600A"]} tintColor="#E8600A" />}
        ListEmptyComponent={() => (
          <View className="items-center py-16">
            <View className="w-20 h-20 rounded-3xl bg-teal-light justify-center items-center mb-4">
              <Ionicons name="bed-outline" size={36} color="#1B4D5C" />
            </View>
            <Text className="text-[15px] font-bold text-ink">No {activeTab?.toLowerCase()} found</Text>
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
            <TouchableOpacity className="w-10 h-10 rounded-2xl bg-black/35 justify-center items-center" onPress={() => toggleFavorite(selectedAccommodation?.id)}>
              <Ionicons
                name={favorites.has(selectedAccommodation?.id) ? "heart" : "heart-outline"}
                size={20}
                color={favorites.has(selectedAccommodation?.id) ? "#EF4444" : "#FFFFFF"}
              />
            </TouchableOpacity>
          </View>

          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            {renderImageCarousel()}

            {selectedAccommodation && (
              <View className="p-5">
                {/* Title row */}
                <View className="flex-row items-start mb-3">
                  <View className="flex-1">
                    <Text className="text-[20px] font-extrabold text-ink -tracking-tight mb-1">{selectedAccommodation.name}</Text>
                    <View className="flex-row items-center gap-1">
                      <Ionicons name="location-outline" size={13} color="#7A8A8F" />
                      <Text className="text-[13px] text-muted">{selectedAccommodation.location}</Text>
                    </View>
                  </View>
                  <View className={`px-2.5 py-1.5 rounded-full mt-1 ${selectedAccommodation.availability === "Available" ? "bg-success" : "bg-warning"}`}>
                    <Text className="text-[11px] font-bold text-white">{selectedAccommodation.availability}</Text>
                  </View>
                </View>

                {/* Price + rating row */}
                <View className="flex-row items-center justify-between bg-surface rounded-2xl p-4 mb-3 border border-line">
                  <View>
                    <Text className="text-[22px] font-extrabold text-ink">R{selectedAccommodation.price}</Text>
                    <Text className="text-[11px] text-muted mt-0.5">per night</Text>
                  </View>
                  <View className="items-end">
                    <View className="flex-row items-center gap-0.5">{renderStars(selectedAccommodation.rating, 13)}</View>
                    <Text className="text-[11px] text-muted mt-1">{selectedAccommodation.rating} · {selectedAccommodation.reviews} reviews</Text>
                  </View>
                </View>

                {/* Quick stats */}
                <View className="flex-row gap-2.5 mb-3">
                  <View className="flex-1 flex-row items-center gap-1.5 bg-surface px-3 py-2.5 rounded-xl border border-line">
                    <Ionicons name="people-outline" size={15} color="#1B4D5C" />
                    <Text className="text-[12px] font-semibold text-ink">Up to {selectedAccommodation.maxGuests} guests</Text>
                  </View>
                  <View className="flex-1 flex-row items-center gap-1.5 bg-surface px-3 py-2.5 rounded-xl border border-line">
                    <Ionicons name="calendar-outline" size={15} color="#1B4D5C" />
                    <Text className="text-[12px] font-semibold text-ink">Min. 1 night</Text>
                  </View>
                </View>

                {/* Directions */}
                <TouchableOpacity
                  className="flex-row items-center justify-center gap-2 bg-teal-light py-2.5 rounded-2xl mb-4 border border-teal/20"
                  onPress={() => openDirections(selectedAccommodation.coordinates, selectedAccommodation.name)}
                >
                  <Ionicons name="navigate" size={15} color="#1B4D5C" />
                  <Text className="text-[13px] font-bold text-teal">Get Directions</Text>
                </TouchableOpacity>

                {/* Description */}
                <View className="mb-4">
                  <Text className="text-[11px] font-extrabold text-muted uppercase tracking-wider mb-2">About this place</Text>
                  <Text className="text-[14px] text-ink leading-5">{selectedAccommodation.description}</Text>
                </View>

                {/* Amenities */}
                <View className="mb-4">
                  <Text className="text-[11px] font-extrabold text-muted uppercase tracking-wider mb-2">Amenities</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {selectedAccommodation.amenities.map((a, i) => (
                      <View key={i} className="flex-row items-center gap-1.5 bg-surface px-2.5 py-1.5 rounded-xl border border-line">
                        <View className={`w-5 h-5 rounded-md justify-center items-center ${TILE_THEMES[i % TILE_THEMES.length].bgClass}`}>
                          <Ionicons name="checkmark" size={12} color={TILE_THEMES[i % TILE_THEMES.length].hex} />
                        </View>
                        <Text className="text-[12px] text-ink font-medium">{a}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                {/* Reserve button — modest size, not a giant CTA */}
                <TouchableOpacity
                  className="flex-row items-center justify-between bg-brand px-5 py-3 rounded-2xl"
                  onPress={() => openReservationForm(selectedAccommodation)}
                  activeOpacity={0.88}
                >
                  <Text className="text-[15px] font-bold text-surface -tracking-tight">Reserve Now</Text>
                  <View className="w-8 h-8 rounded-xl bg-white/25 justify-center items-center">
                    <Ionicons name="arrow-forward" size={15} color="#FFFFFF" />
                  </View>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Reservation Form */}
      <ReservationForm visible={reservationModalVisible} onClose={() => setReservationModalVisible(false)} accommodation={selectedAccommodation} />
    </View>
  )
}

export default Accommodation