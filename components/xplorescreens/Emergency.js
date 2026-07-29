"use client"
import { useCallback } from "react"
import {
  StyleSheet, Text, View, TouchableOpacity, Linking, Alert,
  ScrollView, ActivityIndicator, RefreshControl,
} from "react-native"
import { useState, useEffect, useMemo } from "react"
import { useScrollTracking, AnimatedFlatList } from "../BottomNav"
import { useOfflineData } from "../../hooks/useOfflineData"
import { Ionicons } from "@expo/vector-icons"
import OfflineIndicator from "../OfflineIndicator"

// ── Design tokens ────────────────────────────────────────────────────────────
const ACCENT    = "#1A1A2E"
const HIGHLIGHT = "#E94560"
const BG        = "#F4F6FB"
const SURFACE   = "#FFFFFF"
const SUCCESS   = "#22C55E"
const WARNING   = "#F59E0B"
const DANGER    = "#EF4444"

const ICON_BG_COLORS = [
  "#EEF2FF","#FFF0F3","#F0FFF4","#FFFBEB",
  "#F5F3FF","#FFF7ED","#F0F9FF","#FDF2F8",
]

// Maps category names to Ionicons for visual variety
const CATEGORY_ICONS = {
  Police:     "shield-outline",
  Fire:       "flame-outline",
  Medical:    "medkit-outline",
  Ambulance:  "pulse-outline",
  Hospital:   "medical-outline",
  Default:    "call-outline",
}
// ─────────────────────────────────────────────────────────────────────────────

const Emergency = () => {
  const [expandedContact, setExpandedContact] = useState(null)
  const [activeTab, setActiveTab]             = useState("Public")
  const [privateFilter, setPrivateFilter]     = useState("All")
  const [filterOptions, setFilterOptions]     = useState([{ key: "All", label: "All Services" }])
  const scrollProps = useScrollTracking()

  const offlineOptions = useMemo(() => ({ maxAgeMinutes: 60, enableBackgroundRefresh: true }), [])

  const { data: allContacts, loading, error, isOffline, lastUpdated, refresh } = useOfflineData("emergency", offlineOptions)

  const getFilteredContacts = useMemo(() => {
    if (!allContacts || allContacts.length === 0) return []
    let filtered = allContacts.filter(c => c.isActive !== false && c.type === activeTab)
    if (activeTab === "Private" && privateFilter !== "All") {
      filtered = filtered.filter(c => c.category === privateFilter)
    }
    return filtered.sort((a, b) => (a.order || 0) - (b.order || 0))
  }, [allContacts, activeTab, privateFilter])

  useEffect(() => {
    if (allContacts && allContacts.length > 0) {
      const categorySet = new Set()
      allContacts.forEach(c => { if (c.type === "Private" && c.category) categorySet.add(c.category) })
      const dynamicFilters = [{ key: "All", label: "All Services" }]
      Array.from(categorySet).forEach(cat => dynamicFilters.push({ key: cat, label: cat }))
      setFilterOptions(dynamicFilters)
    }
  }, [allContacts])

  const toggleContact = useCallback((id) => {
    setExpandedContact(prev => prev === id ? null : id)
  }, [])

  const makePhoneCall = useCallback(async (phoneNumber) => {
    const phoneUrl = `tel:${phoneNumber}`
    try {
      const supported = await Linking.canOpenURL(phoneUrl)
      if (supported) {
        await Linking.openURL(phoneUrl)
      } else {
        Alert.alert("Unable to make call", "Your device does not support phone calls", [{ text: "OK" }])
      }
    } catch (err) {
      Alert.alert("Error", "An error occurred while trying to make the call", [{ text: "OK" }])
    }
  }, [])

  // ── Contact Card ─────────────────────────────────────────────────────────
  const ContactCard = useCallback(({ contact, index }) => {
    const isExpanded = expandedContact === contact.id
    const iconName = CATEGORY_ICONS[contact.category] || CATEGORY_ICONS.Default
    const bgColor = ICON_BG_COLORS[index % ICON_BG_COLORS.length]

    return (
      <View style={[styles.card, isExpanded && styles.cardExpanded]}>
        {/* Tap header to expand */}
        <TouchableOpacity style={styles.cardHeader} onPress={() => toggleContact(contact.id)} activeOpacity={0.8}>
          {/* Icon */}
          <View style={[styles.cardIcon, { backgroundColor: bgColor }]}>
            <Ionicons name={iconName} size={22} color={ACCENT} />
          </View>

          {/* Name + number */}
          <View style={styles.cardInfo}>
            <Text style={styles.cardName}>{contact.name}</Text>

            {/* Tappable number inline */}
            <TouchableOpacity onPress={() => makePhoneCall(contact.number)} activeOpacity={0.7} hitSlop={{ top:6, bottom:6, left:6, right:6 }}>
              <View style={styles.numberRow}>
                <Ionicons name="call" size={13} color={HIGHLIGHT} />
                <Text style={styles.cardNumber}>{contact.number}</Text>
              </View>
            </TouchableOpacity>

            {contact.category && (
              <View style={[styles.categoryChip, { backgroundColor: bgColor }]}>
                <Text style={styles.categoryChipText}>{contact.category}</Text>
              </View>
            )}
          </View>

          {/* Expand chevron */}
          <View style={[styles.chevronWrap, isExpanded && styles.chevronWrapActive]}>
            <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color={isExpanded ? HIGHLIGHT : "#AAA"} />
          </View>
        </TouchableOpacity>

        {/* Expanded details */}
        {isExpanded && (
          <View style={styles.cardDetails}>
            {contact.description && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>About</Text>
                <Text style={styles.detailText}>{contact.description}</Text>
              </View>
            )}
            {contact.address && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Address</Text>
                <Text style={styles.detailText}>{contact.address}</Text>
              </View>
            )}
            {contact.additionalInfo && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Additional Info</Text>
                <Text style={styles.detailText}>{contact.additionalInfo}</Text>
              </View>
            )}

            {isOffline && (
              <View style={styles.offlineChip}>
                <Ionicons name="cloud-offline-outline" size={13} color="#888" />
                <Text style={styles.offlineChipText}>Showing offline data</Text>
              </View>
            )}

            {/* Big call CTA */}
            <TouchableOpacity style={styles.callCTA} onPress={() => makePhoneCall(contact.number)} activeOpacity={0.88}>
              <View style={styles.callCTAIcon}>
                <Ionicons name="call" size={20} color={SURFACE} />
              </View>
              <Text style={styles.callCTAText}>Call {contact.number}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    )
  }, [expandedContact, isOffline, toggleContact, makePhoneCall])

  const renderItem = useCallback(({ item, index }) => <ContactCard contact={item} index={index} />, [ContactCard])

  // ── States ───────────────────────────────────────────────────────────────
  if (loading && (!allContacts || allContacts.length === 0)) return (
    <View style={styles.stateScreen}>
      <View style={styles.stateIconWrap}>
        <Ionicons name="call-outline" size={36} color={ACCENT} />
      </View>
      <ActivityIndicator size="large" color={HIGHLIGHT} style={{ marginTop: 20 }} />
      <Text style={styles.stateText}>{isOffline ? "Loading offline data…" : "Loading emergency contacts…"}</Text>
    </View>
  )

  if (error && (!allContacts || allContacts.length === 0)) return (
    <View style={styles.stateScreen}>
      <View style={[styles.stateIconWrap, { backgroundColor:"#FFF0F3" }]}>
        <Ionicons name="call-outline" size={36} color={HIGHLIGHT} />
      </View>
      <Text style={styles.stateText}>{isOffline ? "No offline data available" : "Could not load contacts"}</Text>
      <Text style={styles.stateSubText}>{isOffline ? "Connect to the internet to load emergency contacts" : "Please check your connection and try again"}</Text>
      <TouchableOpacity style={styles.retryBtn} onPress={refresh} activeOpacity={0.88}>
        <Text style={styles.retryBtnText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  )

  const currentContacts = getFilteredContacts

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <OfflineIndicator />

      {/* Offline banner */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={15} color="#92400E" />
          <Text style={styles.offlineBannerText}>Showing cached data</Text>
        </View>
      )}

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Emergency</Text>
          <Text style={styles.headerSubtitle}>Contacts & services</Text>
        </View>
        <View style={[styles.headerBadge, { backgroundColor:"#FFF0F3" }]}>
          <Ionicons name="call" size={20} color={HIGHLIGHT} />
        </View>
      </View>

      {/* Public / Private tab bar */}
      <View style={styles.tabBar}>
        {["Public","Private"].map(tab => (
          <TouchableOpacity key={tab}
            style={[styles.tabBarItem, activeTab === tab && styles.tabBarItemActive]}
            onPress={() => { setActiveTab(tab); setExpandedContact(null) }}>
            <Ionicons
              name={tab === "Public" ? "business-outline" : "lock-closed-outline"}
              size={16}
              color={activeTab === tab ? HIGHLIGHT : "#AAA"}
            />
            <Text style={[styles.tabBarLabel, activeTab === tab && styles.tabBarLabelActive]}>{tab}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Category filter chips — always rendered at a fixed height so the layout never
          jumps when switching between Public and Private tabs.
          ↓ Change the height value in styles.filterRow to resize the filter bar */}
      <View style={styles.filterRow}>
        {activeTab === "Private" && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterContent}>
            {filterOptions.map((opt) => (
              <TouchableOpacity key={opt.key}
                style={[styles.filterChip, privateFilter === opt.key && styles.filterChipActive]}
                onPress={() => setPrivateFilter(opt.key)} activeOpacity={0.8}>
                <Text style={[styles.filterChipText, privateFilter === opt.key && styles.filterChipTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Count bar */}
      <View style={styles.countBar}>
        <Text style={styles.countText}>
          <Text style={styles.countNum}>{currentContacts.length}</Text> contacts available
        </Text>
      </View>

      {/* List */}
      <AnimatedFlatList
        data={currentContacts}
        keyExtractor={item => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} colors={[HIGHLIGHT]} tintColor={HIGHLIGHT} />}
        ListEmptyComponent={() => (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="call-outline" size={40} color={ACCENT} />
            </View>
            <Text style={styles.emptyText}>No {activeTab.toLowerCase()} contacts</Text>
            <Text style={styles.emptySubText}>{isOffline ? "Connect to the internet to load more data" : "Check back later or contact support"}</Text>
          </View>
        )}
        {...scrollProps}
      />

      {/* Last updated */}
      {lastUpdated && (
        <View style={styles.lastUpdated}>
          <Ionicons name="time-outline" size={12} color="#BBB" />
          <Text style={styles.lastUpdatedText}>Updated {lastUpdated.toLocaleTimeString()}</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex:1, backgroundColor:BG },

  // State screens
  stateScreen: { flex:1, backgroundColor:BG, justifyContent:"center", alignItems:"center", paddingHorizontal:40 },
  stateIconWrap: { width:80, height:80, borderRadius:24, backgroundColor:"#EEF2FF", justifyContent:"center", alignItems:"center", marginBottom:16 },
  stateText: { fontSize:18, fontWeight:"700", color:ACCENT, marginTop:10, textAlign:"center" },
  stateSubText: { fontSize:14, color:"#999", textAlign:"center", marginTop:6, marginBottom:20 },
  retryBtn: { backgroundColor:HIGHLIGHT, paddingHorizontal:28, paddingVertical:13, borderRadius:14, shadowColor:HIGHLIGHT, shadowOffset:{width:0,height:4}, shadowOpacity:0.25, shadowRadius:8, elevation:4 },
  retryBtnText: { color:"#FFF", fontSize:15, fontWeight:"700" },

  // Offline banner
  offlineBanner: { flexDirection:"row", alignItems:"center", justifyContent:"center", gap:6, backgroundColor:"#FEF3C7", paddingVertical:8, borderBottomWidth:1, borderBottomColor:"#FDE68A" },
  offlineBannerText: { fontSize:13, color:"#92400E", fontWeight:"600" },

  // Header
  header: { flexDirection:"row", justifyContent:"space-between", alignItems:"center", paddingHorizontal:22, paddingTop:14, paddingBottom:10 },
  headerTitle: { fontSize:18, fontWeight:"800", color:ACCENT, letterSpacing:-0.5 },
  headerSubtitle: { fontSize:13, color:"#888", fontWeight:"500", marginTop:1 },
  headerBadge: { width:44, height:44, borderRadius:14, backgroundColor:SURFACE, justifyContent:"center", alignItems:"center", shadowColor:"#000", shadowOffset:{width:0,height:2}, shadowOpacity:0.07, shadowRadius:6, elevation:2 },

  // Tab bar
  tabBar: { flexDirection:"row", backgroundColor:SURFACE, marginHorizontal:20, marginBottom:10, borderRadius:16, padding:4, shadowColor:ACCENT, shadowOffset:{width:0,height:2}, shadowOpacity:0.07, shadowRadius:8, elevation:2 },
  tabBarItem: { flex:1, flexDirection:"row", alignItems:"center", justifyContent:"center", paddingVertical:10, borderRadius:12, gap:6 },
  tabBarItemActive: { backgroundColor:"#FFF0F3" },
  tabBarLabel: { fontSize:13, fontWeight:"600", color:"#AAA" },
  tabBarLabelActive: { color:HIGHLIGHT, fontWeight:"700" },

  // Filter chips
  filterRow: { height: 52, backgroundColor: SURFACE, justifyContent: "center", marginBottom: 4 }, /* ← change height to resize the filter bar */
  filterContent: { paddingHorizontal: 16, alignItems: "center", gap: 8 },
  filterChip: { paddingHorizontal:16, paddingVertical:8, borderRadius:20, backgroundColor:"#F0F0F0" },
  filterChipActive: { backgroundColor:HIGHLIGHT },
  filterChipText: { fontSize:13, fontWeight:"600", color:"#888" },
  filterChipTextActive: { color:SURFACE, fontWeight:"700" },

  // Count bar
  countBar: { paddingHorizontal:20, paddingVertical:8 },
  countText: { fontSize:13, color:"#888", fontWeight:"500" },
  countNum: { color:ACCENT, fontWeight:"800" },

  // List
  listContent: { paddingHorizontal:16, paddingTop:4, paddingBottom:120 },

  // Card
  card: { backgroundColor:SURFACE, borderRadius:18, marginBottom:12, shadowColor:ACCENT, shadowOffset:{width:0,height:3}, shadowOpacity:0.07, shadowRadius:8, elevation:2, overflow:"hidden" },
  cardExpanded: { shadowOpacity:0.12, shadowRadius:12, elevation:4 },
  cardHeader: { flexDirection:"row", alignItems:"center", padding:14, gap:12 },
  cardIcon: { width:48, height:48, borderRadius:14, justifyContent:"center", alignItems:"center" },
  cardInfo: { flex:1, gap:4 },
  cardName: { fontSize:15, fontWeight:"800", color:ACCENT, letterSpacing:-0.2 },
  numberRow: { flexDirection:"row", alignItems:"center", gap:5 },
  cardNumber: { fontSize:14, color:HIGHLIGHT, fontWeight:"700" },
  categoryChip: { alignSelf:"flex-start", paddingHorizontal:10, paddingVertical:3, borderRadius:20, marginTop:2 },
  categoryChipText: { fontSize:10, fontWeight:"700", color:ACCENT, textTransform:"uppercase", letterSpacing:0.5 },
  chevronWrap: { width:30, height:30, borderRadius:10, backgroundColor:"#F4F6FB", justifyContent:"center", alignItems:"center" },
  chevronWrapActive: { backgroundColor:"#FFF0F3" },

  // Expanded details
  cardDetails: { paddingHorizontal:14, paddingBottom:14, borderTopWidth:1, borderTopColor:"#F4F6FB", gap:10 },
  detailRow: { gap:3 },
  detailLabel: { fontSize:11, fontWeight:"800", color:"#AAA", textTransform:"uppercase", letterSpacing:0.6 },
  detailText: { fontSize:14, color:"#555", lineHeight:21 },
  offlineChip: { flexDirection:"row", alignItems:"center", gap:5, backgroundColor:"#F4F6FB", paddingHorizontal:10, paddingVertical:6, borderRadius:10, alignSelf:"flex-start" },
  offlineChipText: { fontSize:12, color:"#888", fontWeight:"500" },

  // Call CTA
  callCTA: { flexDirection:"row", alignItems:"center", backgroundColor:ACCENT, borderRadius:14, paddingVertical:14, paddingHorizontal:18, gap:12, marginTop:4, shadowColor:ACCENT, shadowOffset:{width:0,height:4}, shadowOpacity:0.25, shadowRadius:8, elevation:4 },
  callCTAIcon: { width:36, height:36, borderRadius:10, backgroundColor:"rgba(255,255,255,0.15)", justifyContent:"center", alignItems:"center" },
  callCTAText: { flex:1, fontSize:16, fontWeight:"800", color:SURFACE },

  // Empty
  emptyContainer: { alignItems:"center", paddingVertical:60 },
  emptyIconWrap: { width:80, height:80, borderRadius:24, backgroundColor:"#EEF2FF", justifyContent:"center", alignItems:"center", marginBottom:16 },
  emptyText: { fontSize:17, fontWeight:"700", color:ACCENT },
  emptySubText: { fontSize:13, color:"#999", marginTop:6, textAlign:"center" },

  // Last updated
  lastUpdated: { flexDirection:"row", alignItems:"center", justifyContent:"center", gap:4, paddingVertical:8, backgroundColor:BG },
  lastUpdatedText: { fontSize:12, color:"#BBB" },
})

export default Emergency