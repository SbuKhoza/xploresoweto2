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
const INFO      = "#3B82F6"   // accessibility / website accent

const ICON_BG_COLORS = [
  "#EEF2FF","#FFF0F3","#F0FFF4","#FFFBEB",
  "#F5F3FF","#FFF7ED","#F0F9FF","#FDF2F8",
]
// ─────────────────────────────────────────────────────────────────────────────

const PublicService = () => {
  const [activeTab, setActiveTab]             = useState("")
  const [selectedService, setSelectedService] = useState(null)
  const [modalVisible, setModalVisible]       = useState(false)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [favorites, setFavorites]             = useState(new Set())
  const [servicesData, setServicesData]       = useState({})
  const [serviceTypes, setServiceTypes]       = useState([])
  const [dataLoading, setDataLoading]         = useState(true)
  const [refreshing, setRefreshing]           = useState(false)

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

  const fetchServicesData = async () => {
    try {
      setDataLoading(true)
      const snap = await getDocs(collection(db, "publicservice"))
      const grouped = {}
      const typesSet = new Set()
      snap.forEach(doc => {
        const data = { id: doc.id, ...doc.data() }
        if (data.type) {
          typesSet.add(data.type)
          if (!grouped[data.type]) grouped[data.type] = []
          grouped[data.type].push(data)
        }
      })
      const uniqueTypes = Array.from(typesSet).sort()
      setServicesData(grouped)
      setServiceTypes(uniqueTypes)
      if (!activeTab && uniqueTypes.length > 0) setActiveTab(uniqueTypes[0])
    } catch {
      setServicesData({})
      setServiceTypes([])
    } finally {
      setDataLoading(false)
      setRefreshing(false)
    }
  }

  const onRefresh = async () => { setRefreshing(true); await fetchServicesData() }
  useEffect(() => { fetchServicesData() }, [])

  const toggleFavorite = id => {
    const n = new Set(favorites); n.has(id) ? n.delete(id) : n.add(id); setFavorites(n)
  }
  const openServiceDetails = s => { setSelectedService(s); setCurrentImageIndex(0); setModalVisible(true) }

  const renderStars = rating => {
    const full = Math.floor(rating), half = rating % 1 !== 0, empty = 5 - Math.ceil(rating)
    return [
      ...Array(full).fill(0).map((_,i) => <Ionicons key={`f${i}`} name="star" size={13} color="#F59E0B"/>),
      ...(half ? [<Ionicons key="h" name="star-half" size={13} color="#F59E0B"/>] : []),
      ...Array(empty).fill(0).map((_,i) => <Ionicons key={`e${i}`} name="star-outline" size={13} color="#F59E0B"/>),
    ]
  }

  // ── Service Card ─────────────────────────────────────────────────────────
  const renderServiceCard = ({ item, index }) => (
    <TouchableOpacity style={styles.card} onPress={() => openServiceDetails(item)} activeOpacity={0.88}>
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

        {item.accessibility && (
          <View style={styles.accessBadge}>
            <Ionicons name="accessibility" size={12} color="#FFF" />
            <Text style={styles.accessBadgeText}>Accessible</Text>
          </View>
        )}

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
            <Text style={styles.typeTagText}>{item.category || item.type}</Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.starsRow}>
            {renderStars(item.rating)}
            <Text style={styles.ratingNum}>{item.rating}</Text>
            <Text style={styles.reviewNum}>({item.reviews})</Text>
          </View>
          <View style={styles.hoursChip}>
            <Ionicons name="time-outline" size={12} color={ACCENT} />
            <Text style={styles.hoursChipText}>{item.hours}</Text>
          </View>
        </View>

        {item.website && (
          <TouchableOpacity style={styles.websiteRow} onPress={() => Linking.openURL(item.website)}>
            <Ionicons name="globe-outline" size={13} color={INFO} />
            <Text style={styles.websiteText} numberOfLines={1}>{item.website}</Text>
          </TouchableOpacity>
        )}

        <View style={styles.cardActions}>
          <TouchableOpacity style={styles.dirBtn} onPress={e => { e.stopPropagation(); openDirections(item.coordinates, item.name) }}>
            <Ionicons name="navigate-outline" size={15} color={ACCENT} />
            <Text style={styles.dirBtnText}>Directions</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.viewBtn} onPress={() => openServiceDetails(item)}>
            <Text style={styles.viewBtnText}>View Details</Text>
            <Ionicons name="arrow-forward" size={14} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  )

  // ── Image Carousel ───────────────────────────────────────────────────────
  const renderCarousel = () => {
    if (!selectedService) return null
    return (
      <View>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={e => setCurrentImageIndex(Math.round(e.nativeEvent.contentOffset.x / width))}>
          {selectedService.images.map((img, i) => (
            <View key={i}>
              <Image source={{ uri: img }} style={styles.carouselImg} />
              <View style={styles.carouselGradient} />
            </View>
          ))}
        </ScrollView>
        <View style={styles.carouselDots}>
          {selectedService.images.map((_, i) => (
            <View key={i} style={[styles.dot, i === currentImageIndex && styles.dotActive]} />
          ))}
        </View>
      </View>
    )
  }

  // ── States ───────────────────────────────────────────────────────────────
  if (dataLoading) return (
    <View style={styles.stateScreen}>
      <View style={styles.stateIconWrap}><Ionicons name="business-outline" size={36} color={ACCENT} /></View>
      <ActivityIndicator size="large" color={HIGHLIGHT} style={{ marginTop: 20 }} />
      <Text style={styles.stateText}>Loading public services…</Text>
    </View>
  )

  if (!Object.keys(servicesData).length) return (
    <View style={styles.stateScreen}>
      <View style={styles.stateIconWrap}><Ionicons name="business-outline" size={36} color={ACCENT} /></View>
      <Text style={styles.stateText}>No public services available</Text>
      <Text style={styles.stateSubText}>Please add some public services to get started</Text>
    </View>
  )

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Public Services</Text>
          <Text style={styles.headerSubtitle}>Government & community</Text>
        </View>
        <View style={styles.headerBadge}>
          <Ionicons name="business-outline" size={20} color={ACCENT} />
        </View>
      </View>

      {/* Type tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll} contentContainerStyle={styles.tabsContent}>
        {serviceTypes.map((type, i) => (
          <TouchableOpacity key={type} style={[styles.tab, activeTab === type && styles.tabActive]}
            onPress={() => setActiveTab(type)} activeOpacity={0.8}>
            <View style={[styles.tabIcon, { backgroundColor: activeTab === type ? "#FFF0F3" : ICON_BG_COLORS[i % ICON_BG_COLORS.length] }]}>
              <Ionicons name={["business","library","school","shield","people","car"][i % 6]}
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
          <Text style={styles.countNum}>{(servicesData[activeTab] || []).length}</Text> services found
        </Text>
      </View>

      {/* List */}
      <AnimatedFlatList
        data={servicesData[activeTab] || []}
        renderItem={renderServiceCard}
        keyExtractor={item => item.id.toString()}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[HIGHLIGHT]} tintColor={HIGHLIGHT} />}
        ListEmptyComponent={() => (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}><Ionicons name="business-outline" size={40} color={ACCENT} /></View>
            <Text style={styles.emptyText}>No {activeTab.toLowerCase()} services</Text>
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
            <TouchableOpacity style={styles.modalFavBtn} onPress={() => toggleFavorite(selectedService?.id)}>
              <Ionicons name={favorites.has(selectedService?.id) ? "heart" : "heart-outline"} size={22}
                color={favorites.has(selectedService?.id) ? HIGHLIGHT : "#FFF"} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            {renderCarousel()}

            {selectedService && (
              <View style={styles.modalBody}>
                {/* Title */}
                <View style={styles.modalTitleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalTitle}>{selectedService.name}</Text>
                    <View style={styles.modalLocRow}>
                      <Ionicons name="location-outline" size={13} color="#888" />
                      <Text style={styles.modalLoc}>{selectedService.location}</Text>
                    </View>
                  </View>
                  <View style={[styles.modalStatusBadge, { backgroundColor: selectedService.status === "Open" ? SUCCESS : WARNING }]}>
                    <Text style={styles.modalStatusText}>{selectedService.status}</Text>
                  </View>
                </View>

                {/* Accessibility banner */}
                {selectedService.accessibility && (
                  <View style={styles.accessBanner}>
                    <View style={styles.accessBannerIcon}>
                      <Ionicons name="accessibility" size={20} color={INFO} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.accessBannerTitle}>Wheelchair Accessible</Text>
                      <Text style={styles.accessBannerSub}>This facility is fully accessible</Text>
                    </View>
                  </View>
                )}

                {/* Meta card */}
                <View style={styles.metaCard}>
                  <View style={styles.metaSection}>
                    <View style={[styles.metaIcon, { backgroundColor: "#EEF2FF" }]}>
                      <Ionicons name="time-outline" size={18} color={ACCENT} />
                    </View>
                    <Text style={styles.metaLabel}>Hours</Text>
                    <Text style={styles.metaValue}>{selectedService.hours}</Text>
                  </View>
                  <View style={styles.metaDivider} />
                  <View style={styles.metaSection}>
                    <View style={styles.starsRow}>{renderStars(selectedService.rating)}</View>
                    <Text style={styles.metaLabel}>Rating</Text>
                    <Text style={styles.metaValue}>{selectedService.rating} ({selectedService.reviews})</Text>
                  </View>
                  <View style={styles.metaDivider} />
                  <View style={styles.metaSection}>
                    <View style={[styles.metaIcon, { backgroundColor: ICON_BG_COLORS[2] }]}>
                      <Ionicons name="business-outline" size={18} color={ACCENT} />
                    </View>
                    <Text style={styles.metaLabel}>Category</Text>
                    <Text style={styles.metaValue} numberOfLines={1}>{selectedService.category || selectedService.type}</Text>
                  </View>
                </View>

                {/* Website */}
                {selectedService.website && (
                  <TouchableOpacity style={styles.websiteCTA} onPress={() => Linking.openURL(selectedService.website)}>
                    <View style={styles.websiteCTAIcon}><Ionicons name="globe-outline" size={18} color={INFO} /></View>
                    <Text style={styles.websiteCTAText} numberOfLines={1}>{selectedService.website}</Text>
                    <Ionicons name="open-outline" size={16} color={INFO} />
                  </TouchableOpacity>
                )}

                {/* Contact quick actions */}
                <View style={styles.contactActions}>
                  {selectedService.phone && (
                    <TouchableOpacity style={styles.contactBtn} onPress={() => Linking.openURL(`tel:${selectedService.phone}`)}>
                      <View style={styles.contactBtnIcon}><Ionicons name="call" size={18} color={ACCENT} /></View>
                      <Text style={styles.contactBtnText}>{selectedService.phone}</Text>
                    </TouchableOpacity>
                  )}
                  {selectedService.email && (
                    <TouchableOpacity style={styles.contactBtn} onPress={() => Linking.openURL(`mailto:${selectedService.email}`)}>
                      <View style={styles.contactBtnIcon}><Ionicons name="mail" size={18} color={ACCENT} /></View>
                      <Text style={styles.contactBtnText}>{selectedService.email}</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Directions */}
                <TouchableOpacity style={styles.dirCTA}
                  onPress={() => openDirections(selectedService.coordinates, selectedService.name)}>
                  <Ionicons name="navigate" size={18} color="#FFF" />
                  <Text style={styles.dirCTAText}>Get Directions</Text>
                </TouchableOpacity>

                {/* Description */}
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>About</Text>
                  <Text style={styles.sectionBody}>{selectedService.description}</Text>
                </View>

                {/* Services offered */}
                {selectedService.services?.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>Services Offered</Text>
                    <View style={styles.servicesGrid}>
                      {selectedService.services.map((s, i) => (
                        <View key={i} style={[styles.serviceChip, { backgroundColor: ICON_BG_COLORS[i % ICON_BG_COLORS.length] }]}>
                          <Ionicons name="checkmark" size={14} color={ACCENT} />
                          <Text style={styles.serviceChipText}>{s}</Text>
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
  headerTitle: { fontSize: 26, fontWeight: "800", color: ACCENT, letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 13, color: "#888", fontWeight: "500", marginTop: 1 },
  headerBadge: { width: 44, height: 44, borderRadius: 14, backgroundColor: SURFACE, justifyContent: "center", alignItems: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6, elevation: 2 },

  tabsScroll: { backgroundColor: SURFACE, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  tabsContent: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, gap: 8 },
  tab: { alignItems: "center", paddingHorizontal: 14, paddingTop: 6, paddingBottom: 0 },
  tabActive: {},
  tabIcon: { width: 38, height: 38, borderRadius: 12, justifyContent: "center", alignItems: "center", marginBottom: 4 },
  tabText: { fontSize: 11, fontWeight: "600", color: "#999", marginBottom: 6 },
  tabTextActive: { color: HIGHLIGHT, fontWeight: "700" },
  tabLine: { width: "60%", height: 2.5, backgroundColor: HIGHLIGHT, borderRadius: 2, marginTop: 2 },

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
  accessBadge: { position: "absolute", top: 52, left: 14, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: INFO },
  accessBadgeText: { fontSize: 11, fontWeight: "700", color: "#FFF" },
  nameOverlay: { position: "absolute", bottom: 12, left: 14, right: 14 },
  overlayName: { fontSize: 17, fontWeight: "800", color: "#FFF", letterSpacing: -0.3 },

  cardBody: { padding: 14 },
  cardRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 3, flex: 1, marginRight: 8 },
  locationText: { fontSize: 12, color: "#888", flex: 1 },
  typeTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  typeTagText: { fontSize: 10, fontWeight: "700", color: ACCENT, textTransform: "uppercase", letterSpacing: 0.5 },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  starsRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  ratingNum: { fontSize: 12, color: ACCENT, fontWeight: "700", marginLeft: 4 },
  reviewNum: { fontSize: 11, color: "#AAA" },
  hoursChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#EEF2FF", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  hoursChipText: { fontSize: 11, color: ACCENT, fontWeight: "600" },
  websiteRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 12 },
  websiteText: { fontSize: 12, color: INFO, fontWeight: "500", flex: 1 },
  cardActions: { flexDirection: "row", gap: 10 },
  dirBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderColor: "#E8ECF4", paddingVertical: 10, borderRadius: 14 },
  dirBtnText: { fontSize: 13, fontWeight: "700", color: ACCENT },
  viewBtn: { flex: 1.4, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: ACCENT, paddingVertical: 10, borderRadius: 14 },
  viewBtnText: { fontSize: 13, fontWeight: "700", color: "#FFF" },

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

  accessBanner: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#EFF6FF", borderRadius: 16, padding: 14, marginBottom: 14, borderLeftWidth: 4, borderLeftColor: INFO },
  accessBannerIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#DBEAFE", justifyContent: "center", alignItems: "center" },
  accessBannerTitle: { fontSize: 14, fontWeight: "800", color: INFO },
  accessBannerSub: { fontSize: 12, color: "#888", marginTop: 2 },

  metaCard: { flexDirection: "row", alignItems: "flex-start", backgroundColor: SURFACE, borderRadius: 18, padding: 16, marginBottom: 14, shadowColor: ACCENT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 1 },
  metaSection: { flex: 1, alignItems: "center", gap: 4 },
  metaIcon: { width: 36, height: 36, borderRadius: 12, justifyContent: "center", alignItems: "center", marginBottom: 2 },
  metaLabel: { fontSize: 10, color: "#AAA", fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  metaValue: { fontSize: 11, color: ACCENT, fontWeight: "600", textAlign: "center" },
  metaDivider: { width: 1, alignSelf: "stretch", backgroundColor: "#F0F0F0", marginHorizontal: 4 },

  websiteCTA: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#EFF6FF", borderRadius: 14, padding: 14, marginBottom: 12 },
  websiteCTAIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#DBEAFE", justifyContent: "center", alignItems: "center" },
  websiteCTAText: { flex: 1, fontSize: 13, color: INFO, fontWeight: "600" },

  contactActions: { gap: 8, marginBottom: 14 },
  contactBtn: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: SURFACE, borderRadius: 14, padding: 14, shadowColor: ACCENT, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  contactBtnIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#EEF2FF", justifyContent: "center", alignItems: "center" },
  contactBtnText: { fontSize: 14, color: ACCENT, fontWeight: "600" },

  dirCTA: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: ACCENT, paddingVertical: 15, borderRadius: 18, marginBottom: 18, shadowColor: ACCENT, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 },
  dirCTAText: { fontSize: 15, fontWeight: "800", color: "#FFF" },

  section: { marginBottom: 18 },
  sectionLabel: { fontSize: 13, fontWeight: "800", color: "#AAA", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },
  sectionBody: { fontSize: 15, color: "#555", lineHeight: 24 },

  servicesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  serviceChip: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12 },
  serviceChipText: { fontSize: 13, color: ACCENT, fontWeight: "600" },
})

export default PublicService