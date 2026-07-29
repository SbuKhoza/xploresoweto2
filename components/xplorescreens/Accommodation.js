import { useState, useEffect } from "react"
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Image,
  Dimensions,
  Modal,
  Linking,
  Alert,
  ActionSheetIOS,
  Platform,
  RefreshControl,
  ActivityIndicator,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { collection, getDocs } from "firebase/firestore"
import { db } from "../../Firebase/config"
import { useScrollTracking, AnimatedFlatList } from "../BottomNav"
import ReservationForm from "./ReservationForm"

const { width } = Dimensions.get("window")

// ── Design tokens (mirrors Xplore) ──────────────────────────────────────────
const ACCENT = "#1A1A2E"
const HIGHLIGHT = "#E94560"
const BG = "#F4F6FB"
const SURFACE = "#FFFFFF"
const SUCCESS = "#22C55E"
const WARNING = "#F59E0B"

const ICON_BG_COLORS = [
  "#EEF2FF", "#FFF0F3", "#F0FFF4", "#FFFBEB",
  "#F5F3FF", "#FFF7ED", "#F0F9FF", "#FDF2F8",
]
// ─────────────────────────────────────────────────────────────────────────────

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

  const renderStars = (rating) => {
    const stars = []
    const full = Math.floor(rating)
    const half = rating % 1 !== 0
    for (let i = 0; i < full; i++) stars.push(<Ionicons key={i} name="star" size={14} color="#F59E0B" />)
    if (half) stars.push(<Ionicons key="half" name="star-half" size={14} color="#F59E0B" />)
    const empty = 5 - Math.ceil(rating)
    for (let i = 0; i < empty; i++) stars.push(<Ionicons key={`e-${i}`} name="star-outline" size={14} color="#F59E0B" />)
    return stars
  }

  // ── Accommodation Card ───────────────────────────────────────────────────
  const renderAccommodationCard = ({ item, index }) => {
    const isAvailable = item.availability === "Available"
    return (
      <TouchableOpacity style={styles.card} onPress={() => openAccommodationDetails(item)} activeOpacity={0.88}>
        {/* Image section */}
        <View style={styles.cardImageWrap}>
          <Image source={{ uri: item.images[0] }} style={styles.cardImage} />
          <View style={styles.imageGradient} />

          <TouchableOpacity style={styles.favoriteBtn} onPress={() => toggleFavorite(item.id)}>
            <Ionicons name={favorites.has(item.id) ? "heart" : "heart-outline"} size={20} color={favorites.has(item.id) ? HIGHLIGHT : "#FFF"} />
          </TouchableOpacity>

          <View style={[styles.availabilityBadge, { backgroundColor: isAvailable ? SUCCESS : WARNING }]}>
            <View style={styles.badgeDot} />
            <Text style={styles.badgeText}>{item.availability}</Text>
          </View>

          {/* Price pill overlaid on image */}
          <View style={styles.pricePill}>
            <Text style={styles.pricePillAmount}>R{item.price}</Text>
            <Text style={styles.pricePillLabel}>/night</Text>
          </View>
        </View>

        {/* Content section */}
        <View style={styles.cardBody}>
          <View style={styles.cardBodyTop}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
              <View style={styles.locationRow}>
                <Ionicons name="location-outline" size={13} color="#888" />
                <Text style={styles.locationText} numberOfLines={1}>{item.location}</Text>
              </View>
            </View>
            <View style={[styles.typeTag, { backgroundColor: ICON_BG_COLORS[index % ICON_BG_COLORS.length] }]}>
              <Text style={styles.typeTagText}>{item.type}</Text>
            </View>
          </View>

          <View style={styles.cardMeta}>
            <View style={styles.starsRow}>
              {renderStars(item.rating)}
              <Text style={styles.ratingNum}>{item.rating}</Text>
              <Text style={styles.reviewNum}>({item.reviews})</Text>
            </View>
            <View style={styles.guestsChip}>
              <Ionicons name="people-outline" size={13} color={ACCENT} />
              <Text style={styles.guestsText}>{item.maxGuests} guests</Text>
            </View>
          </View>

          {/* Actions */}
          <View style={styles.cardActions}>
            <TouchableOpacity style={styles.directionsBtn} onPress={(e) => { e.stopPropagation(); openDirections(item.coordinates, item.name) }}>
              <Ionicons name="navigate-outline" size={15} color={ACCENT} />
              <Text style={styles.directionsBtnText}>Directions</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.reserveBtn} onPress={(e) => { e.stopPropagation(); openReservationForm(item) }}>
              <Text style={styles.reserveBtnText}>Reserve</Text>
              <Ionicons name="arrow-forward" size={14} color="#FFF" />
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    )
  }

  // ── Image carousel (in modal) ────────────────────────────────────────────
  const renderImageCarousel = () => {
    if (!selectedAccommodation) return null
    return (
      <View>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setCurrentImageIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        >
          {selectedAccommodation.images.map((img, i) => (
            <View key={i} style={{ position: "relative" }}>
              <Image source={{ uri: img }} style={styles.carouselImg} />
              <View style={styles.carouselGradient} />
            </View>
          ))}
        </ScrollView>
        <View style={styles.carouselDots}>
          {selectedAccommodation.images.map((_, i) => (
            <View key={i} style={[styles.dot, i === currentImageIndex && styles.dotActive]} />
          ))}
        </View>
      </View>
    )
  }

  // ── Loading / Empty states ───────────────────────────────────────────────
  if (dataLoading) {
    return (
      <View style={styles.stateScreen}>
        <View style={styles.stateIconWrap}><Ionicons name="bed-outline" size={36} color={ACCENT} /></View>
        <ActivityIndicator size="large" color={HIGHLIGHT} style={{ marginTop: 20 }} />
        <Text style={styles.stateText}>Loading accommodations…</Text>
      </View>
    )
  }

  if (Object.keys(accommodationsData).length === 0) {
    return (
      <View style={styles.stateScreen}>
        <View style={styles.stateIconWrap}><Ionicons name="bed-outline" size={36} color={ACCENT} /></View>
        <Text style={styles.stateText}>No accommodations available</Text>
        <Text style={styles.stateSubText}>Please add some accommodations to get started</Text>
      </View>
    )
  }

  if (accommodationTypes.length === 0) {
    return (
      <View style={styles.stateScreen}>
        <View style={styles.stateIconWrap}><Ionicons name="bed-outline" size={36} color={ACCENT} /></View>
        <Text style={styles.stateText}>No accommodation types found</Text>
        <Text style={styles.stateSubText}>Please ensure accommodations have a "type" field</Text>
      </View>
    )
  }

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Stay</Text>
          <Text style={styles.headerSubtitle}>Find your perfect place</Text>
        </View>
        <View style={styles.headerBadge}>
          <Ionicons name="bed-outline" size={18} color={ACCENT} />
        </View>
      </View>

      {/* Type tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabsContent}>
        {accommodationTypes.map((type, i) => (
          <TouchableOpacity key={type} style={[styles.tab, activeTab === type && styles.tabActive]} onPress={() => setActiveTab(type)} activeOpacity={0.8}>
            <View style={[styles.tabIconWrap, { backgroundColor: activeTab === type ? "#FFF0F3" : ICON_BG_COLORS[i % ICON_BG_COLORS.length] }]}>
              <Ionicons
                name={["bed", "home", "business", "cafe", "leaf", "water"][i % 6]}
                size={16}
                color={activeTab === type ? HIGHLIGHT : ACCENT}
              />
            </View>
            <Text style={[styles.tabText, activeTab === type && styles.tabTextActive]}>{type}</Text>
            {activeTab === type && <View style={styles.tabActiveLine} />}
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Count bar */}
      <View style={styles.countBar}>
        <Text style={styles.countText}>
          <Text style={styles.countNum}>{(accommodationsData[activeTab] || []).length}</Text>
          {" "}properties found
        </Text>
      </View>

      {/* List */}
      <AnimatedFlatList
        data={accommodationsData[activeTab] || []}
        renderItem={renderAccommodationCard}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[HIGHLIGHT]} tintColor={HIGHLIGHT} />}
        ListEmptyComponent={() => (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}><Ionicons name="bed-outline" size={40} color={ACCENT} /></View>
            <Text style={styles.emptyText}>No {activeTab.toLowerCase()} found</Text>
            <Text style={styles.emptySubText}>Try a different category or pull to refresh</Text>
          </View>
        )}
        {...scrollProps}
      />

      {/* Detail Modal */}
      <Modal animationType="slide" transparent={false} visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalContainer}>
          {/* Floating header over carousel */}
          <View style={styles.modalFloatHeader}>
            <TouchableOpacity style={styles.modalBackBtn} onPress={() => setModalVisible(false)}>
              <Ionicons name="chevron-down" size={22} color="#FFF" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalFavBtn} onPress={() => toggleFavorite(selectedAccommodation?.id)}>
              <Ionicons
                name={favorites.has(selectedAccommodation?.id) ? "heart" : "heart-outline"}
                size={22}
                color={favorites.has(selectedAccommodation?.id) ? HIGHLIGHT : "#FFF"}
              />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            {renderImageCarousel()}

            {selectedAccommodation && (
              <View style={styles.modalBody}>
                {/* Title row */}
                <View style={styles.modalTitleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalTitle}>{selectedAccommodation.name}</Text>
                    <View style={styles.modalLocationRow}>
                      <Ionicons name="location-outline" size={14} color="#888" />
                      <Text style={styles.modalLocation}>{selectedAccommodation.location}</Text>
                    </View>
                  </View>
                  <View style={[styles.modalAvailBadge, { backgroundColor: selectedAccommodation.availability === "Available" ? SUCCESS : WARNING }]}>
                    <Text style={styles.modalAvailText}>{selectedAccommodation.availability}</Text>
                  </View>
                </View>

                {/* Price + rating row */}
                <View style={styles.modalMetaRow}>
                  <View style={styles.modalPriceBox}>
                    <Text style={styles.modalPrice}>R{selectedAccommodation.price}</Text>
                    <Text style={styles.modalPriceLabel}>per night</Text>
                  </View>
                  <View style={styles.modalRatingBox}>
                    <View style={styles.starsRow}>{renderStars(selectedAccommodation.rating)}</View>
                    <Text style={styles.modalRatingText}>{selectedAccommodation.rating} · {selectedAccommodation.reviews} reviews</Text>
                  </View>
                </View>

                {/* Quick stats chips */}
                <View style={styles.statsRow}>
                  <View style={styles.statChip}>
                    <Ionicons name="people-outline" size={16} color={ACCENT} />
                    <Text style={styles.statText}>Up to {selectedAccommodation.maxGuests} guests</Text>
                  </View>
                  <View style={styles.statChip}>
                    <Ionicons name="calendar-outline" size={16} color={ACCENT} />
                    <Text style={styles.statText}>Min. 1 night</Text>
                  </View>
                </View>

                {/* Directions CTA */}
                <TouchableOpacity style={styles.directionsCTA} onPress={() => openDirections(selectedAccommodation.coordinates, selectedAccommodation.name)}>
                  <Ionicons name="navigate" size={18} color="#FFF" />
                  <Text style={styles.directionsCTAText}>Get Directions</Text>
                </TouchableOpacity>

                {/* Description */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>About this place</Text>
                  <Text style={styles.sectionBody}>{selectedAccommodation.description}</Text>
                </View>

                {/* Amenities */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Amenities</Text>
                  <View style={styles.amenitiesGrid}>
                    {selectedAccommodation.amenities.map((a, i) => (
                      <View key={i} style={styles.amenityChip}>
                        <View style={[styles.amenityIcon, { backgroundColor: ICON_BG_COLORS[i % ICON_BG_COLORS.length] }]}>
                          <Ionicons name="checkmark" size={14} color={ACCENT} />
                        </View>
                        <Text style={styles.amenityText}>{a}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                {/* Reserve button */}
                <TouchableOpacity style={styles.reserveCTA} onPress={() => openReservationForm(selectedAccommodation)} activeOpacity={0.88}>
                  <Text style={styles.reserveCTAText}>Reserve Now</Text>
                  <View style={styles.reserveCTAArrow}>
                    <Ionicons name="arrow-forward" size={18} color={ACCENT} />
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

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  // State screens
  stateScreen: { flex: 1, backgroundColor: BG, justifyContent: "center", alignItems: "center", paddingHorizontal: 40 },
  stateIconWrap: { width: 80, height: 80, borderRadius: 24, backgroundColor: "#EEF2FF", justifyContent: "center", alignItems: "center", marginBottom: 16 },
  stateText: { fontSize: 18, fontWeight: "700", color: ACCENT, marginTop: 10 },
  stateSubText: { fontSize: 14, color: "#999", textAlign: "center", marginTop: 6 },

  // Header
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 22, paddingTop: 14, paddingBottom: 10 },
  headerTitle: { fontSize: 18, fontWeight: "800", color: ACCENT, letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 13, color: "#888", fontWeight: "500", marginTop: 1 },
  headerBadge: { width: 44, height: 44, borderRadius: 14, backgroundColor: SURFACE, justifyContent: "center", alignItems: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6, elevation: 2 },

  // Type tabs
  tabsScroll: { backgroundColor: SURFACE, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  tabsContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  tab: { alignItems: "center", paddingHorizontal: 14, paddingVertical: 6, position: "relative" },
  tabActive: {},
  tabIconWrap: { width: 38, height: 38, borderRadius: 12, justifyContent: "center", alignItems: "center", marginBottom: 4 },
  tabText: { fontSize: 11, fontWeight: "600", color: "#999" },
  tabTextActive: { color: HIGHLIGHT, fontWeight: "700" },
  tabActiveLine: { position: "absolute", bottom: -10, left: "20%", right: "20%", height: 2.5, backgroundColor: HIGHLIGHT, borderRadius: 2 },

  // Count bar
  countBar: { paddingHorizontal: 20, paddingVertical: 10 },
  countText: { fontSize: 13, color: "#888", fontWeight: "500" },
  countNum: { color: ACCENT, fontWeight: "800" },

  // List
  listContainer: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 120 },

  // Card
  card: { backgroundColor: SURFACE, borderRadius: 22, marginBottom: 18, overflow: "hidden", shadowColor: ACCENT, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.09, shadowRadius: 12, elevation: 4 },
  cardImageWrap: { position: "relative" },
  cardImage: { width: "100%", height: 210 },
  imageGradient: { position: "absolute", bottom: 0, left: 0, right: 0, height: 90, backgroundColor: "rgba(0,0,0,0.4)" },
  favoriteBtn: { position: "absolute", top: 14, right: 14, width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(0,0,0,0.3)", justifyContent: "center", alignItems: "center" },
  availabilityBadge: { position: "absolute", top: 14, left: 14, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, gap: 5 },
  badgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.8)" },
  badgeText: { fontSize: 11, fontWeight: "700", color: "#FFF" },
  pricePill: { position: "absolute", bottom: 14, left: 14, flexDirection: "row", alignItems: "baseline", backgroundColor: "rgba(255,255,255,0.95)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, gap: 2 },
  pricePillAmount: { fontSize: 17, fontWeight: "900", color: ACCENT },
  pricePillLabel: { fontSize: 11, color: "#888", fontWeight: "500" },
  cardBody: { padding: 14 },
  cardBodyTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  cardName: { fontSize: 17, fontWeight: "800", color: ACCENT, marginBottom: 3 },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  locationText: { fontSize: 12, color: "#888", flex: 1 },
  typeTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  typeTagText: { fontSize: 10, fontWeight: "700", color: ACCENT, textTransform: "uppercase", letterSpacing: 0.5 },
  cardMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  starsRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  ratingNum: { fontSize: 12, color: ACCENT, fontWeight: "700", marginLeft: 5 },
  reviewNum: { fontSize: 11, color: "#AAA" },
  guestsChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#EEF2FF", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  guestsText: { fontSize: 11, color: ACCENT, fontWeight: "600" },
  cardActions: { flexDirection: "row", gap: 10 },
  directionsBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderColor: "#E8ECF4", paddingVertical: 10, borderRadius: 14 },
  directionsBtnText: { fontSize: 13, fontWeight: "700", color: ACCENT },
  reserveBtn: { flex: 1.4, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: ACCENT, paddingVertical: 10, borderRadius: 14 },
  reserveBtnText: { fontSize: 13, fontWeight: "700", color: "#FFF" },

  // Modal
  modalContainer: { flex: 1, backgroundColor: BG },
  modalFloatHeader: { position: "absolute", top: 50, left: 0, right: 0, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 18, zIndex: 10 },
  modalBackBtn: { width: 42, height: 42, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center" },
  modalFavBtn: { width: 42, height: 42, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center" },
  carouselImg: { width, height: 300 },
  carouselGradient: { position: "absolute", bottom: 0, left: 0, right: 0, height: 100, backgroundColor: "rgba(0,0,0,0.3)" },
  carouselDots: { flexDirection: "row", justifyContent: "center", paddingVertical: 10, gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#DDD" },
  dotActive: { width: 20, borderRadius: 3, backgroundColor: HIGHLIGHT },
  modalBody: { padding: 20, paddingBottom: 60 },
  modalTitleRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 14 },
  modalTitle: { fontSize: 24, fontWeight: "900", color: ACCENT, letterSpacing: -0.5, marginBottom: 4 },
  modalLocationRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  modalLocation: { fontSize: 13, color: "#888" },
  modalAvailBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginTop: 4 },
  modalAvailText: { fontSize: 12, fontWeight: "700", color: "#FFF" },
  modalMetaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: SURFACE, borderRadius: 18, padding: 16, marginBottom: 12, shadowColor: ACCENT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 1 },
  modalPriceBox: {},
  modalPrice: { fontSize: 30, fontWeight: "900", color: ACCENT },
  modalPriceLabel: { fontSize: 12, color: "#AAA", marginTop: 2 },
  modalRatingBox: { alignItems: "flex-end" },
  modalRatingText: { fontSize: 12, color: "#888", marginTop: 4 },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  statChip: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: SURFACE, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 14, shadowColor: ACCENT, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  statText: { fontSize: 12, fontWeight: "600", color: ACCENT },
  directionsCTA: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: ACCENT, paddingVertical: 15, borderRadius: 18, marginBottom: 18, shadowColor: ACCENT, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 },
  directionsCTAText: { fontSize: 15, fontWeight: "800", color: "#FFF" },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: "#AAA", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 },
  sectionBody: { fontSize: 15, color: "#555", lineHeight: 24 },
  amenitiesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  amenityChip: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: SURFACE, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, shadowColor: ACCENT, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  amenityIcon: { width: 26, height: 26, borderRadius: 8, justifyContent: "center", alignItems: "center" },
  amenityText: { fontSize: 13, color: ACCENT, fontWeight: "500" },
  reserveCTA: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: HIGHLIGHT, paddingVertical: 18, paddingHorizontal: 24, borderRadius: 20, shadowColor: HIGHLIGHT, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 14, elevation: 6 },
  reserveCTAText: { fontSize: 18, fontWeight: "900", color: "#FFF", letterSpacing: -0.3 },
  reserveCTAArrow: { width: 38, height: 38, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.25)", justifyContent: "center", alignItems: "center" },

  // Empty
  emptyContainer: { alignItems: "center", paddingVertical: 60 },
  emptyIconWrap: { width: 80, height: 80, borderRadius: 24, backgroundColor: "#EEF2FF", justifyContent: "center", alignItems: "center", marginBottom: 16 },
  emptyText: { fontSize: 17, fontWeight: "700", color: ACCENT },
  emptySubText: { fontSize: 13, color: "#999", marginTop: 6, textAlign: "center" },
})

export default Accommodation