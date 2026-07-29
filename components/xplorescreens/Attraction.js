"use client"

import { useState, useEffect } from "react"
import {
  StyleSheet, Text, View, ScrollView, TouchableOpacity, Image,
  Dimensions, Modal, Linking, Alert, ActionSheetIOS, Platform,
  RefreshControl, ActivityIndicator,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { collection, getDocs } from "firebase/firestore"
import { db } from "../../Firebase/config"
import { useScrollTracking, AnimatedFlatList } from "../BottomNav"

const { width } = Dimensions.get("window")

// ── Design tokens ────────────────────────────────────────────────────────────
const ACCENT    = "#1A1A2E"
const HIGHLIGHT = "#E94560"
const BG        = "#F4F6FB"
const SURFACE   = "#FFFFFF"
const SUCCESS   = "#22C55E"
const WARNING   = "#F59E0B"

const ICON_BG_COLORS = [
  "#EEF2FF","#FFF0F3","#F0FFF4","#FFFBEB",
  "#F5F3FF","#FFF7ED","#F0F9FF","#FDF2F8",
]
// ─────────────────────────────────────────────────────────────────────────────

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
      { name:"Apple Maps",         url:`http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`, available: Platform.OS==="ios" },
      { name:"Google Maps",        url:`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, available: true },
      { name:"Waze",               url:`https://waze.com/ul?ll=${lat},${lng}&navigate=yes`, checkUrl:"waze://", available: false },
      { name:"Petal Maps (Huawei)",url:`petalmaps://route?daddr=${lat},${lng}`, checkUrl:"petalmaps://", available: false },
    ]
    const avail = []
    for (const o of opts) {
      if (o.available) { avail.push(o) }
      else if (o.checkUrl) { try { if (await Linking.canOpenURL(o.checkUrl)) avail.push(o) } catch {} }
    }
    const native = Platform.OS === "ios"
      ? { name:"Maps (Default)", url:`http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d` }
      : { name:"Maps (Default)", url:`geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(name)})` }
    const final = [native, ...avail]
    const names = [...final.map(o=>o.name), "Cancel"]
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions({ options:names, cancelButtonIndex:names.length-1, title:`Get directions to ${name}` },
        i => { if (i < final.length) Linking.openURL(final[i].url).catch(()=>Alert.alert("Error","Could not open maps")) })
    } else {
      Alert.alert("Choose Maps App", `Get directions to ${name}`, [
        ...final.map(o=>({ text:o.name, onPress:()=>Linking.openURL(o.url).catch(()=>Alert.alert("Error","Could not open maps")) })),
        { text:"Cancel", style:"cancel" },
      ], { cancelable:true })
    }
  }

  const fetchAttractionsData = async () => {
    try {
      setDataLoading(true)
      const snap = await getDocs(collection(db, "attractions"))
      const grouped = {}
      const typesSet = new Set()
      snap.forEach(doc => {
        const data = { id: doc.id, ...doc.data() }
        const type = data.type?.trim() || "All Attractions"
        typesSet.add(type)
        if (!grouped[type]) grouped[type] = []
        grouped[type].push(data)
      })
      const uniqueTypes = Array.from(typesSet).sort()
      setAttractionsData(grouped)
      setAttractionTypes(uniqueTypes)
      if (!activeTab && uniqueTypes.length > 0) setActiveTab(uniqueTypes[0])
    } catch {
      setAttractionsData({})
      setAttractionTypes([])
    } finally {
      setDataLoading(false)
      setRefreshing(false)
    }
  }

  const onRefresh = async () => { setRefreshing(true); await fetchAttractionsData() }
  useEffect(() => { fetchAttractionsData() }, [])

  const toggleFavorite = id => {
    const n = new Set(favorites); n.has(id) ? n.delete(id) : n.add(id); setFavorites(n)
  }
  const openAttractionDetails = a => { setSelectedAttraction(a); setCurrentImageIndex(0); setModalVisible(true) }

  const renderStars = rating => {
    const full = Math.floor(rating), half = rating % 1 !== 0, empty = 5 - Math.ceil(rating)
    return [
      ...Array(full).fill(0).map((_,i) => <Ionicons key={`f${i}`} name="star" size={13} color="#F59E0B"/>),
      ...(half ? [<Ionicons key="h" name="star-half" size={13} color="#F59E0B"/>] : []),
      ...Array(empty).fill(0).map((_,i) => <Ionicons key={`e${i}`} name="star-outline" size={13} color="#F59E0B"/>),
    ]
  }

  // ── Attraction Card ──────────────────────────────────────────────────────
  const renderAttractionCard = ({ item, index }) => (
    <TouchableOpacity style={styles.card} onPress={() => openAttractionDetails(item)} activeOpacity={0.88}>
      <View style={styles.cardImageWrap}>
        <Image source={{ uri: item.images[0] }} style={styles.cardImage} />
        <View style={styles.imageGradient} />

        <TouchableOpacity style={styles.favBtn} onPress={() => toggleFavorite(item.id)}>
          <Ionicons name={favorites.has(item.id) ? "heart" : "heart-outline"} size={20}
            color={favorites.has(item.id) ? HIGHLIGHT : "#FFF"} />
        </TouchableOpacity>

        <View style={[styles.statusBadge, { backgroundColor: item.status === "Open" ? SUCCESS : WARNING }]}>
          <View style={styles.badgeDot} />
          <Text style={styles.badgeText}>{item.status}</Text>
        </View>

        {/* Price pill */}
        <View style={styles.pricePill}>
          <Text style={styles.pricePillAmount}>R{item.price}</Text>
          <Text style={styles.pricePillLabel}> entry</Text>
        </View>

        {/* Name overlay */}
        <View style={styles.nameOverlay}>
          <Text style={styles.overlayName} numberOfLines={1}>{item.name}</Text>
        </View>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.cardRow}>
          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={12} color="#888" />
            <Text style={styles.locationText} numberOfLines={1}>{item.location}</Text>
          </View>
          <View style={[styles.typeTag, { backgroundColor: ICON_BG_COLORS[index % ICON_BG_COLORS.length] }]}>
            <Text style={styles.typeTagText}>{item.type || "Attraction"}</Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.starsRow}>
            {renderStars(item.rating)}
            <Text style={styles.ratingNum}>{item.rating}</Text>
            <Text style={styles.reviewNum}>({item.reviews})</Text>
          </View>
          <View style={styles.durationChip}>
            <Ionicons name="time-outline" size={12} color={ACCENT} />
            <Text style={styles.durationChipText}>{item.duration}</Text>
          </View>
        </View>

        <View style={styles.cardActions}>
          <TouchableOpacity style={styles.dirBtn} onPress={e => { e.stopPropagation(); openDirections(item.coordinates, item.name) }}>
            <Ionicons name="navigate-outline" size={15} color={ACCENT} />
            <Text style={styles.dirBtnText}>Directions</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.detailBtn} onPress={() => openAttractionDetails(item)}>
            <Text style={styles.detailBtnText}>Explore</Text>
            <Ionicons name="arrow-forward" size={14} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  )

  // ── Image Carousel ───────────────────────────────────────────────────────
  const renderCarousel = () => {
    if (!selectedAttraction) return null
    return (
      <View>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={e => setCurrentImageIndex(Math.round(e.nativeEvent.contentOffset.x / width))}>
          {selectedAttraction.images.map((img, i) => (
            <View key={i}>
              <Image source={{ uri: img }} style={styles.carouselImg} />
              <View style={styles.carouselGradient} />
            </View>
          ))}
        </ScrollView>
        <View style={styles.carouselDots}>
          {selectedAttraction.images.map((_, i) => (
            <View key={i} style={[styles.dot, i === currentImageIndex && styles.dotActive]} />
          ))}
        </View>
      </View>
    )
  }

  // ── States ───────────────────────────────────────────────────────────────
  if (dataLoading) return (
    <View style={styles.stateScreen}>
      <View style={styles.stateIconWrap}><Ionicons name="compass-outline" size={36} color={ACCENT} /></View>
      <ActivityIndicator size="large" color={HIGHLIGHT} style={{ marginTop: 20 }} />
      <Text style={styles.stateText}>Loading attractions…</Text>
    </View>
  )

  if (!Object.keys(attractionsData).length) return (
    <View style={styles.stateScreen}>
      <View style={styles.stateIconWrap}><Ionicons name="location-outline" size={36} color={ACCENT} /></View>
      <Text style={styles.stateText}>No attractions available</Text>
      <Text style={styles.stateSubText}>Please add some attractions to get started</Text>
    </View>
  )

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Attractions</Text>
          <Text style={styles.headerSubtitle}>Things to see & do</Text>
        </View>
        <View style={styles.headerBadge}>
          <Ionicons name="compass-outline" size={20} color={ACCENT} />
        </View>
      </View>

      {/* Type tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll} contentContainerStyle={styles.tabsContent}>
        {attractionTypes.map((type, i) => (
          <TouchableOpacity key={type} style={[styles.tab, activeTab === type && styles.tabActive]}
            onPress={() => setActiveTab(type)} activeOpacity={0.8}>
            <View style={[styles.tabIcon, { backgroundColor: activeTab === type ? "#FFF0F3" : ICON_BG_COLORS[i % ICON_BG_COLORS.length] }]}>
              <Ionicons name={["map","telescope","football","musical-notes","color-palette","leaf"][i % 6]}
                size={15} color={activeTab === type ? HIGHLIGHT : ACCENT} />
            </View>
            <Text style={[styles.tabText, activeTab === type && styles.tabTextActive]}>{type}</Text>
            {activeTab === type && <View style={styles.tabLine} />}
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Count bar */}
      <View style={styles.countBar}>
        <Text style={styles.countText}>
          <Text style={styles.countNum}>{(attractionsData[activeTab] || []).length}</Text> attractions found
        </Text>
      </View>

      {/* List */}
      <AnimatedFlatList data={attractionsData[activeTab] || []} renderItem={renderAttractionCard}
        keyExtractor={item => item.id.toString()}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[HIGHLIGHT]} tintColor={HIGHLIGHT} />}
        ListEmptyComponent={() => (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}><Ionicons name="location-outline" size={40} color={ACCENT} /></View>
            <Text style={styles.emptyText}>No {activeTab.toLowerCase()} attractions</Text>
            <Text style={styles.emptySubText}>Try a different category or pull to refresh</Text>
          </View>
        )}
        {...scrollProps}
      />

      {/* Detail Modal */}
      <Modal animationType="slide" transparent={false} visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalFloatHeader}>
            <TouchableOpacity style={styles.modalBackBtn} onPress={() => setModalVisible(false)}>
              <Ionicons name="chevron-down" size={22} color="#FFF" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalFavBtn} onPress={() => toggleFavorite(selectedAttraction?.id)}>
              <Ionicons name={favorites.has(selectedAttraction?.id) ? "heart" : "heart-outline"} size={22}
                color={favorites.has(selectedAttraction?.id) ? HIGHLIGHT : "#FFF"} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            {renderCarousel()}

            {selectedAttraction && (
              <View style={styles.modalBody}>
                {/* Title */}
                <View style={styles.modalTitleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalTitle}>{selectedAttraction.name}</Text>
                    <View style={styles.modalLocRow}>
                      <Ionicons name="location-outline" size={13} color="#888" />
                      <Text style={styles.modalLoc}>{selectedAttraction.location}</Text>
                    </View>
                  </View>
                  <View style={[styles.modalStatusBadge, { backgroundColor: selectedAttraction.status === "Open" ? SUCCESS : WARNING }]}>
                    <Text style={styles.modalStatusText}>{selectedAttraction.status}</Text>
                  </View>
                </View>

                {/* Price + rating card */}
                <View style={styles.metaCard}>
                  <View style={styles.metaSection}>
                    <Text style={styles.metaPrice}>R{selectedAttraction.price}</Text>
                    <Text style={styles.metaPriceLabel}>entry fee</Text>
                  </View>
                  <View style={styles.metaDivider} />
                  <View style={styles.metaSection}>
                    <View style={styles.starsRow}>{renderStars(selectedAttraction.rating)}</View>
                    <Text style={styles.metaSmall}>{selectedAttraction.rating} · {selectedAttraction.reviews} reviews</Text>
                  </View>
                  <View style={styles.metaDivider} />
                  <View style={styles.metaSection}>
                    <Ionicons name="time-outline" size={20} color={ACCENT} />
                    <Text style={styles.metaSmall}>{selectedAttraction.duration}</Text>
                  </View>
                </View>

                {/* Info chips */}
                <View style={styles.infoChipsRow}>
                  {selectedAttraction.bestTime && (
                    <View style={styles.infoChip}>
                      <Ionicons name="calendar-outline" size={15} color={ACCENT} />
                      <Text style={styles.infoChipText}>Best: {selectedAttraction.bestTime}</Text>
                    </View>
                  )}
                </View>

                {/* Directions */}
                <TouchableOpacity style={styles.dirCTA}
                  onPress={() => openDirections(selectedAttraction.coordinates, selectedAttraction.name)}>
                  <Ionicons name="navigate" size={18} color="#FFF" />
                  <Text style={styles.dirCTAText}>Get Directions</Text>
                </TouchableOpacity>

                {/* Description */}
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>About</Text>
                  <Text style={styles.sectionBody}>{selectedAttraction.description}</Text>
                </View>

                {/* Features */}
                {selectedAttraction.features?.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>Features</Text>
                    <View style={styles.featuresGrid}>
                      {selectedAttraction.features.map((f, i) => (
                        <View key={i} style={[styles.featureChip, { backgroundColor: ICON_BG_COLORS[i % ICON_BG_COLORS.length] }]}>
                          <Ionicons name="checkmark" size={14} color={ACCENT} />
                          <Text style={styles.featureText}>{f}</Text>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  stateScreen: { flex: 1, backgroundColor: BG, justifyContent: "center", alignItems: "center", paddingHorizontal: 40 },
  stateIconWrap: { width: 80, height: 80, borderRadius: 24, backgroundColor: "#EEF2FF", justifyContent: "center", alignItems: "center" },
  stateText: { fontSize: 18, fontWeight: "700", color: ACCENT, marginTop: 14 },
  stateSubText: { fontSize: 14, color: "#999", textAlign: "center", marginTop: 6 },

  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 22, paddingTop: 14, paddingBottom: 10 },
  headerTitle: { fontSize: 18, fontWeight: "800", color: ACCENT, letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 13, color: "#888", fontWeight: "500", marginTop: 1 },
  headerBadge: { width: 44, height: 44, borderRadius: 14, backgroundColor: SURFACE, justifyContent: "center", alignItems: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6, elevation: 2 },

  tabsScroll: { backgroundColor: SURFACE, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  tabsContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  tab: { alignItems: "center", paddingHorizontal: 14, paddingVertical: 6, position: "relative" },
  tabActive: {},
  tabIcon: { width: 38, height: 38, borderRadius: 12, justifyContent: "center", alignItems: "center", marginBottom: 4 },
  tabText: { fontSize: 11, fontWeight: "600", color: "#999" },
  tabTextActive: { color: HIGHLIGHT, fontWeight: "700" },
  tabLine: { position: "absolute", bottom: -10, left: "20%", right: "20%", height: 2.5, backgroundColor: HIGHLIGHT, borderRadius: 2 },

  countBar: { paddingHorizontal: 20, paddingVertical: 10 },
  countText: { fontSize: 13, color: "#888", fontWeight: "500" },
  countNum: { color: ACCENT, fontWeight: "800" },

  listContainer: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 120 },

  card: { backgroundColor: SURFACE, borderRadius: 22, marginBottom: 18, overflow: "hidden", shadowColor: ACCENT, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.09, shadowRadius: 12, elevation: 4 },
  cardImageWrap: { position: "relative" },
  cardImage: { width: "100%", height: 210 },
  imageGradient: { position: "absolute", bottom: 0, left: 0, right: 0, height: 90, backgroundColor: "rgba(0,0,0,0.42)" },
  favBtn: { position: "absolute", top: 14, right: 14, width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(0,0,0,0.3)", justifyContent: "center", alignItems: "center" },
  statusBadge: { position: "absolute", top: 14, left: 14, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, gap: 5 },
  badgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.8)" },
  badgeText: { fontSize: 11, fontWeight: "700", color: "#FFF" },
  pricePill: { position: "absolute", bottom: 40, left: 14, flexDirection: "row", alignItems: "baseline", backgroundColor: "rgba(255,255,255,0.92)", paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  pricePillAmount: { fontSize: 15, fontWeight: "900", color: ACCENT },
  pricePillLabel: { fontSize: 10, color: "#888", fontWeight: "500" },
  nameOverlay: { position: "absolute", bottom: 12, left: 14, right: 60 },
  overlayName: { fontSize: 17, fontWeight: "800", color: "#FFF", letterSpacing: -0.3 },

  cardBody: { padding: 14 },
  cardRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 3, flex: 1, marginRight: 8 },
  locationText: { fontSize: 12, color: "#888", flex: 1 },
  typeTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  typeTagText: { fontSize: 10, fontWeight: "700", color: ACCENT, textTransform: "uppercase", letterSpacing: 0.5 },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  starsRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  ratingNum: { fontSize: 12, color: ACCENT, fontWeight: "700", marginLeft: 4 },
  reviewNum: { fontSize: 11, color: "#AAA" },
  durationChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#EEF2FF", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  durationChipText: { fontSize: 11, color: ACCENT, fontWeight: "600" },
  cardActions: { flexDirection: "row", gap: 10 },
  dirBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderColor: "#E8ECF4", paddingVertical: 10, borderRadius: 14 },
  dirBtnText: { fontSize: 13, fontWeight: "700", color: ACCENT },
  detailBtn: { flex: 1.4, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: ACCENT, paddingVertical: 10, borderRadius: 14 },
  detailBtnText: { fontSize: 13, fontWeight: "700", color: "#FFF" },

  emptyContainer: { alignItems: "center", paddingVertical: 60 },
  emptyIconWrap: { width: 80, height: 80, borderRadius: 24, backgroundColor: "#EEF2FF", justifyContent: "center", alignItems: "center", marginBottom: 16 },
  emptyText: { fontSize: 17, fontWeight: "700", color: ACCENT },
  emptySubText: { fontSize: 13, color: "#999", marginTop: 6, textAlign: "center" },

  modalContainer: { flex: 1, backgroundColor: BG },
  modalFloatHeader: { position: "absolute", top: 50, left: 0, right: 0, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 18, zIndex: 10 },
  modalBackBtn: { width: 42, height: 42, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center" },
  modalFavBtn: { width: 42, height: 42, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center" },
  carouselImg: { width, height: 300 },
  carouselGradient: { position: "absolute", bottom: 0, left: 0, right: 0, height: 100, backgroundColor: "rgba(0,0,0,0.35)" },
  carouselDots: { flexDirection: "row", justifyContent: "center", paddingVertical: 10, gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#DDD" },
  dotActive: { width: 20, borderRadius: 3, backgroundColor: HIGHLIGHT },

  modalBody: { padding: 20, paddingBottom: 60 },
  modalTitleRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 14 },
  modalTitle: { fontSize: 24, fontWeight: "900", color: ACCENT, letterSpacing: -0.5, marginBottom: 4 },
  modalLocRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  modalLoc: { fontSize: 13, color: "#888" },
  modalStatusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginTop: 4 },
  modalStatusText: { fontSize: 12, fontWeight: "700", color: "#FFF" },

  metaCard: { flexDirection: "row", alignItems: "center", backgroundColor: SURFACE, borderRadius: 18, padding: 16, marginBottom: 14, shadowColor: ACCENT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 1 },
  metaSection: { flex: 1, alignItems: "center", gap: 4 },
  metaPrice: { fontSize: 26, fontWeight: "900", color: ACCENT },
  metaPriceLabel: { fontSize: 11, color: "#AAA" },
  metaSmall: { fontSize: 11, color: "#666", fontWeight: "600", textAlign: "center", marginTop: 2 },
  metaDivider: { width: 1, height: 40, backgroundColor: "#F0F0F0" },

  infoChipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  infoChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: SURFACE, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, shadowColor: ACCENT, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  infoChipText: { fontSize: 13, fontWeight: "600", color: ACCENT },

  dirCTA: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: ACCENT, paddingVertical: 15, borderRadius: 18, marginBottom: 18, shadowColor: ACCENT, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 },
  dirCTAText: { fontSize: 15, fontWeight: "800", color: "#FFF" },

  section: { marginBottom: 18 },
  sectionLabel: { fontSize: 13, fontWeight: "800", color: "#AAA", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },
  sectionBody: { fontSize: 15, color: "#555", lineHeight: 24 },

  featuresGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  featureChip: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12 },
  featureText: { fontSize: 13, color: ACCENT, fontWeight: "600" },
})

export default Attraction