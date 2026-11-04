"use client"

import { useState, useEffect, useRef } from "react"
import {
  StyleSheet, Text, View, ScrollView, TouchableOpacity, Image, Dimensions, Modal,
  Linking, Alert, RefreshControl, ActivityIndicator, TextInput,
} from "react-native"
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons"
import { collection, getDocs, query, where, addDoc, doc, getDoc } from "firebase/firestore"
import { db, auth } from "../../Firebase/config"
import { onAuthStateChanged } from "firebase/auth"
import { useScrollTracking, AnimatedFlatList } from "../BottomNav"
import OfflineIndicator from "../OfflineIndicator"
import {
  TEAL, BRAND, INK, MUTED, ALL, TILE_THEMES, cardShadow,
  typeIconFor, getEditorialBadge, getStatusBadge, searchText,
} from "./shared/theme"
import {
  Hero, SearchBar, SectionHeader, CategoryChips, EmptyState, ListingCard,
  FilterSheet, DEFAULT_FILTERS, hasActiveFilters,
} from "./shared/ui"
import { ContactRow } from "./shared/detail"
import { openDirections } from "./shared/openDirections"

const { width } = Dimensions.get("window")

// ── Design tokens (same palette as the rest of Xplore) ──────────────────────
const ACCENT    = INK
const HIGHLIGHT = BRAND
const BG        = "#FAF7F2"
const SURFACE   = "#FFFFFF"
const SUCCESS   = "#22C55E"

const ICON_BG_COLORS = ["#E8F4F7", "#FFF1E8", "#EAFBF1", "#FEF3C7", "#FFF0F0"]

const NAV_TABS = [
  { key: "Home",     icon: "grid-outline",      label: "Businesses" },
  { key: "Services", icon: "construct-outline", label: "Services" },
  { key: "Contact",  icon: "call-outline",      label: "Contact" },
  { key: "Gallery",  icon: "images-outline",    label: "Gallery" },
]
const TAB_TITLES = {
  Services: "Available Services",
  Contact:  "Business Contacts",
  Gallery:  "Business Gallery",
}

const Business = () => {
  const [businesses, setBusinesses] = useState([])
  const [businessTypes, setBusinessTypes] = useState([])
  const [activeType, setActiveType] = useState(ALL)
  const [selectedBusiness, setSelectedBusiness] = useState(null)
  const [activeMainTab, setActiveMainTab] = useState("Home")
  const [businessDetailTab, setBusinessDetailTab] = useState("home")
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [favorites, setFavorites] = useState(new Set())
  const [dataLoading, setDataLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [showReviewsDrawer, setShowReviewsDrawer] = useState(false)
  const [reviews, setReviews] = useState([])
  const [loadingReviews, setLoadingReviews] = useState(false)
  const [showReviewForm, setShowReviewForm] = useState(false)
  const [newReview, setNewReview] = useState({ rating: 5, comment: "", reviewerName: "" })
  const [currentUser, setCurrentUser] = useState(null)
  const [userCanReview, setUserCanReview] = useState(false)
  const [hasUserReviewed, setHasUserReviewed] = useState(false)
  const [calculatedRating, setCalculatedRating] = useState(0)
  const [authLoading, setAuthLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [filterVisible, setFilterVisible] = useState(false)

  const scrollProps = useScrollTracking()
  const searchRef = useRef(null)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setAuthLoading(true)
      if (firebaseUser) {
        try {
          const userDoc = await getDoc(doc(db, "users", firebaseUser.uid))
          if (userDoc.exists()) {
            const userData = {
              id: firebaseUser.uid,
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              name: firebaseUser.displayName || userDoc.data().name,
              ...userDoc.data(),
            }
            setCurrentUser(userData)
            setUserCanReview(userData.canReview || false)
          } else {
            setCurrentUser({ id: firebaseUser.uid, uid: firebaseUser.uid, email: firebaseUser.email, name: firebaseUser.displayName })
            setUserCanReview(false)
          }
        } catch (error) {
          setCurrentUser({ id: firebaseUser.uid, uid: firebaseUser.uid, email: firebaseUser.email, name: firebaseUser.displayName })
          setUserCanReview(false)
        }
      } else {
        setCurrentUser(null)
        setUserCanReview(false)
        setHasUserReviewed(false)
      }
      setAuthLoading(false)
    })
    return () => unsubscribe()
  }, [])

  const fetchBusinessData = async () => {
    try {
      setDataLoading(true)
      const snapshot = await getDocs(collection(db, "business"))
      const list = snapshot.docs.map((d) => {
        const data = { id: d.id, ...d.data() }
        data.__type = typeof data.type === "string" ? data.type.trim() : ""
        return data
      })
      setBusinesses(list)
      setBusinessTypes(Array.from(new Set(list.map((b) => b.__type).filter(Boolean))).sort())
    } catch (error) {
      setBusinesses([])
      setBusinessTypes([])
    } finally {
      setDataLoading(false)
      setRefreshing(false)
    }
  }

  const onRefresh = async () => { setRefreshing(true); await fetchBusinessData() }

  useEffect(() => { fetchBusinessData() }, [])

  const toggleFavorite = (id) => {
    const n = new Set(favorites)
    n.has(id) ? n.delete(id) : n.add(id)
    setFavorites(n)
  }

  const openBusinessDetails = (business) => {
    setSelectedBusiness(business)
    setCurrentImageIndex(0)
    setModalVisible(true)
    setBusinessDetailTab("home")
    fetchReviews(business.id)
  }

  const renderStars = (rating) => {
    const stars = []
    const full = Math.floor(rating)
    const half = rating % 1 !== 0
    for (let i = 0; i < full; i++) stars.push(<Ionicons key={i} name="star" size={14} color="#F5A524" />)
    if (half) stars.push(<Ionicons key="half" name="star-half" size={14} color="#F5A524" />)
    const empty = 5 - Math.ceil(rating)
    for (let i = 0; i < empty; i++) stars.push(<Ionicons key={`e-${i}`} name="star-outline" size={14} color="#F5A524" />)
    return stars
  }

  // ── Search / filter (list tabs) ──────────────────────────────────────────
  const q = searchQuery.trim().toLowerCase()
  const filtersActive = hasActiveFilters(filters)
  const now = new Date()

  const matchesQuery = (b) => !q || searchText(b).includes(q)

  const homeList = (() => {
    const list = businesses.filter((b) => {
      if (q) { if (!searchText(b).includes(q)) return false }
      else if (activeType !== ALL && b.__type !== activeType) return false
      if (filters.minRating && (Number(b.rating) || 0) < filters.minRating) return false
      if (filters.openNow) {
        const s = getStatusBadge(b, now, "hours")
        if (!s || !s.ok) return false
      }
      return true
    })
    if (filters.sort === "rating")  list.sort((a, b) => (Number(b.rating)  || 0) - (Number(a.rating)  || 0))
    if (filters.sort === "reviews") list.sort((a, b) => (Number(b.reviews) || 0) - (Number(a.reviews) || 0))
    return list
  })()

  const serviceList = businesses.reduce((acc, b) => {
    ;(b.services || []).forEach((s) => {
      const name = typeof s === "string" ? s : s?.name
      if (!name) return
      if (q && !name.toLowerCase().includes(q) && !String(b.name || "").toLowerCase().includes(q)) return
      if (!acc.find((x) => x.name === name)) acc.push({ id: `${b.id}-${name}`, name, business: b })
    })
    return acc
  }, [])

  const contactList = businesses.filter(matchesQuery)

  // Gallery: two photos per row
  const galleryRows = (() => {
    const imgs = []
    businesses.forEach((b) => {
      if (q && !String(b.name || "").toLowerCase().includes(q)) return
      ;(b.images || []).forEach((uri, i) => imgs.push({ id: `${b.id}-${i}`, uri, business: b }))
    })
    const rows = []
    for (let i = 0; i < imgs.length; i += 2) rows.push({ id: `row-${i}`, items: imgs.slice(i, i + 2) })
    return rows
  })()

  const listData =
    activeMainTab === "Home" ? homeList :
    activeMainTab === "Services" ? serviceList :
    activeMainTab === "Contact" ? contactList : galleryRows

  // ── Row renderers ──────────────────────────────────────────────────────────
  const renderBusinessCard = (item) => {
    const status    = getStatusBadge(item, now, "hours")
    const editorial = getEditorialBadge(item)
    const badge = status && !status.ok ? status : (editorial || status)
    return (
      <ListingCard
        image={Array.isArray(item.images) ? item.images[0] : null}
        fallbackIcon={typeIconFor(item.__type, "storefront")}
        badge={badge}
        title={item.name}
        location={item.location}
        rating={item.rating}
        reviews={item.reviews}
        pill={item.hours ? { icon: "time-outline", text: item.hours, muted: status ? status.ok === false : false } : null}
        footer={item.description ? { text: item.description, color: "#3A4A63", lines: 2 } : null}
        favorite={favorites.has(item.id)}
        onToggleFavorite={() => toggleFavorite(item.id)}
        onPress={() => openBusinessDetails(item)}
      />
    )
  }

  const renderServiceRow = (item, index) => {
    const t = TILE_THEMES[index % TILE_THEMES.length]
    return (
      <View className="px-4">
        <TouchableOpacity
          className="flex-row items-center bg-surface rounded-2xl px-3 py-3 mb-2.5 border border-line"
          onPress={() => openBusinessDetails(item.business)}
          activeOpacity={0.9}
        >
          <View className={`w-10 h-10 rounded-[14px] justify-center items-center mr-3 ${t.bgClass}`}>
            <Ionicons name="checkmark" size={18} color={t.hex} />
          </View>
          <View className="flex-1">
            <Text className="text-[14px] font-bold text-ink" numberOfLines={1}>{item.name}</Text>
            <Text className="text-[11.5px] text-muted mt-0.5" numberOfLines={1}>{item.business.name}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={MUTED} />
        </TouchableOpacity>
      </View>
    )
  }

  const renderContactCard = (b, index) => {
    const t = TILE_THEMES[index % TILE_THEMES.length]
    return (
      <View className="px-4">
        <View className="bg-surface rounded-[22px] p-3.5 mb-3" style={cardShadow}>
          <View className="flex-row items-center mb-3">
            <View className={`w-11 h-11 rounded-[14px] justify-center items-center mr-3 ${t.bgClass}`}>
              <MaterialCommunityIcons name={typeIconFor(b.__type, "storefront")} size={22} color={t.hex} />
            </View>
            <Text className="text-[15px] font-extrabold text-ink flex-1" numberOfLines={1}>{b.name}</Text>
          </View>
          {!!b.phone && <ContactRow icon="call" text={b.phone} onPress={() => Linking.openURL(`tel:${b.phone}`)} chevron="chevron-forward" />}
          {!!b.email && <ContactRow icon="mail" tone="brand" text={b.email} onPress={() => Linking.openURL(`mailto:${b.email}`)} chevron="chevron-forward" />}
          {!!b.location && <ContactRow icon="location" text={b.location} />}
          {!!b.coordinates && (
            <TouchableOpacity
              className="flex-row items-center justify-center gap-2 bg-teal-light py-2.5 rounded-2xl border border-teal/20"
              onPress={() => openDirections(b.coordinates, b.name)}
              activeOpacity={0.85}
            >
              <Ionicons name="navigate" size={15} color={TEAL} />
              <Text className="text-[13px] font-bold text-teal">Get Directions</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    )
  }

  const GALLERY_W = (width - 32 - 10) / 2
  const renderGalleryRow = (row) => (
    <View className="flex-row px-4 mb-2.5" style={{ gap: 10 }}>
      {row.items.map((img) => (
        <TouchableOpacity
          key={img.id}
          activeOpacity={0.88}
          onPress={() => openBusinessDetails(img.business)}
          style={{ width: GALLERY_W, height: 120, borderRadius: 18, overflow: "hidden", backgroundColor: "#E8F4F7" }}
        >
          <Image source={{ uri: img.uri }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
          <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "rgba(20,33,61,0.5)", paddingHorizontal: 9, paddingVertical: 6 }}>
            <Text style={{ fontSize: 11, color: "#FFF", fontWeight: "700" }} numberOfLines={1}>{img.business.name}</Text>
          </View>
        </TouchableOpacity>
      ))}
      {row.items.length === 1 && <View style={{ width: GALLERY_W }} />}
    </View>
  )

  const renderRow = ({ item, index }) => {
    if (activeMainTab === "Home") return renderBusinessCard(item)
    if (activeMainTab === "Services") return renderServiceRow(item, index)
    if (activeMainTab === "Contact") return renderContactCard(item, index)
    return renderGalleryRow(item)
  }

  // ── Reviews helpers ──────────────────────────────────────────────────────
  const fetchReviews = async (businessId) => {
    setLoadingReviews(true)
    try {
      const q = query(collection(db, "reviews"), where("businessId", "==", businessId))
      const snap = await getDocs(q)
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const sorted = data.sort((a, b) => {
        const dA = a.createdAt?.toDate?.() || new Date(a.createdAt)
        const dB = b.createdAt?.toDate?.() || new Date(b.createdAt)
        return dB - dA
      })
      setReviews(sorted)
      setCalculatedRating(calculateAverageRating(sorted))
      if (currentUser?.id || currentUser?.uid) await checkUserReviewStatus(businessId, currentUser.id || currentUser.uid)
    } catch (e) {
      setReviews([])
      setCalculatedRating(0)
    } finally {
      setLoadingReviews(false)
    }
  }

  const calculateAverageRating = (r) => r.length === 0 ? 0 : (r.reduce((s, x) => s + x.rating, 0) / r.length).toFixed(1)

  const checkUserReviewStatus = async (businessId, userId) => {
    try {
      const q = query(collection(db, "reviews"), where("businessId", "==", businessId), where("userId", "==", userId))
      const snap = await getDocs(q)
      setHasUserReviewed(!snap.empty)
    } catch {}
  }

  const submitReview = async () => {
    if (!newReview.reviewerName.trim() || !newReview.comment.trim()) { Alert.alert("Missing Information", "Please fill in all fields"); return }
    if (authLoading) { Alert.alert("Please wait", "Checking authentication status..."); return }
    if (!currentUser?.id && !currentUser?.uid) { Alert.alert("Authentication Required", "Please log in to submit a review"); return }
    try {
      await addDoc(collection(db, "reviews"), {
        businessId: selectedBusiness.id,
        businessName: selectedBusiness.name,
        userId: currentUser.id || currentUser.uid,
        rating: newReview.rating,
        comment: newReview.comment,
        reviewerName: newReview.reviewerName,
        createdAt: new Date().toISOString(),
      })
      setNewReview({ rating: 5, comment: "", reviewerName: "" })
      setShowReviewForm(false)
      fetchReviews(selectedBusiness.id)
      Alert.alert("Success", "Review submitted successfully!")
    } catch { Alert.alert("Error", "Error submitting review. Please try again.") }
  }

  const handleHireRequest = async () => {
    if (authLoading) { Alert.alert("Please wait", "Checking authentication status..."); return }
    if (!currentUser?.id && !currentUser?.uid) { Alert.alert("Authentication Required", "Please log in to request a service"); return }
    try {
      await addDoc(collection(db, "userservices"), {
        businessId: selectedBusiness.id,
        businessName: selectedBusiness.name,
        userId: currentUser.id || currentUser.uid,
        userName: currentUser.name || currentUser.displayName || "Unknown User",
        userEmail: currentUser.email || "No email provided",
        requestedAt: new Date().toISOString(),
        status: "pending",
      })
      Alert.alert("Request Sent!", `Service request sent to ${selectedBusiness.name}.`)
    } catch { Alert.alert("Error", "Error submitting service request. Please try again.") }
  }

  // ── Business Profile (inside modal) ─────────────────────────────────────
  const renderBusinessProfile = () => {
    if (!selectedBusiness) return null
    const detailTabs = [
      { key: "home", icon: "home-outline", label: "Home" },
      { key: "service", icon: "construct-outline", label: "Services" },
      { key: "contact", icon: "call-outline", label: "Contact" },
      { key: "gallery", icon: "images-outline", label: "Gallery" },
    ]
    return (
      <View style={{ flex: 1 }}>
        {/* Detail tab bar */}
        <View style={styles.detailTabBar}>
          {detailTabs.map((t) => (
            <TouchableOpacity key={t.key} style={[styles.detailTab, businessDetailTab === t.key && styles.detailTabActive]} onPress={() => setBusinessDetailTab(t.key)}>
              <Ionicons name={t.icon} size={18} color={businessDetailTab === t.key ? HIGHLIGHT : "#AAA"} />
              <Text style={[styles.detailTabText, businessDetailTab === t.key && styles.detailTabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          {/* ── Home tab ── */}
          {businessDetailTab === "home" && (
            <View>
              {selectedBusiness.images?.length > 0 && (
                <View style={styles.detailCarousel}>
                  <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
                    onScroll={(e) => setCurrentImageIndex(Math.round(e.nativeEvent.contentOffset.x / e.nativeEvent.layoutMeasurement.width))}
                    scrollEventThrottle={16}
                  >
                    {selectedBusiness.images.map((img, i) => (
                      <Image key={i} source={{ uri: img }} style={styles.detailCarouselImage} />
                    ))}
                  </ScrollView>
                  {selectedBusiness.images.length > 1 && (
                    <View style={styles.carouselDots}>
                      {selectedBusiness.images.map((_, i) => (
                        <View key={i} style={[styles.dot, currentImageIndex === i && styles.dotActive]} />
                      ))}
                    </View>
                  )}
                </View>
              )}

              {/* About card */}
              <View style={styles.infoCard}>
                <Text style={styles.infoCardTitle}>About</Text>
                <Text style={styles.infoCardBody}>{selectedBusiness.description}</Text>
              </View>

              {/* Services preview */}
              {selectedBusiness.services?.length > 0 && (
                <View style={styles.infoCard}>
                  <Text style={styles.infoCardTitle}>Services</Text>
                  {selectedBusiness.services.slice(0, 3).map((s, i) => (
                    <View key={i} style={styles.serviceRow}>
                      <View style={styles.serviceDot} />
                      <Text style={styles.serviceRowText}>{typeof s === "string" ? s : s.name || s}</Text>
                    </View>
                  ))}
                  {selectedBusiness.services.length > 3 && (
                    <Text style={styles.moreText}>+{selectedBusiness.services.length - 3} more</Text>
                  )}
                </View>
              )}

              {/* Ratings */}
              <View style={styles.infoCard}>
                <View style={styles.ratingsRow}>
                  <View>
                    <Text style={styles.ratingBig}>{calculatedRating}</Text>
                    <View style={styles.starsRow}>{renderStars(Number.parseFloat(calculatedRating))}</View>
                    <Text style={styles.reviewsCount}>{reviews.length} reviews</Text>
                  </View>
                  <TouchableOpacity style={styles.viewReviewsBtn} onPress={() => { setShowReviewsDrawer(true); fetchReviews(selectedBusiness.id) }}>
                    <Text style={styles.viewReviewsBtnText}>View Reviews</Text>
                    <Ionicons name="chevron-forward" size={14} color={HIGHLIGHT} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Hire CTA */}
              <TouchableOpacity style={styles.hireCTA} onPress={handleHireRequest} activeOpacity={0.88}>
                <Ionicons name="briefcase" size={20} color="#FFF" />
                <Text style={styles.hireCTAText}>Request This Business</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Services tab ── */}
          {businessDetailTab === "service" && selectedBusiness.services?.map((s, i) => (
            <View key={i} style={styles.serviceCard}>
              <View style={[styles.serviceIconWrap, { backgroundColor: ICON_BG_COLORS[i % ICON_BG_COLORS.length] }]}>
                <Ionicons name="checkmark" size={18} color={ACCENT} />
              </View>
              <Text style={styles.serviceTitle}>{typeof s === "string" ? s : s.name || s}</Text>
            </View>
          ))}

          {/* ── Contact tab ── */}
          {businessDetailTab === "contact" && (
            <View style={styles.infoCard}>
              <Text style={styles.infoCardTitle}>Contact Information</Text>
              {selectedBusiness.phone && (
                <TouchableOpacity style={styles.contactRow} onPress={() => Linking.openURL(`tel:${selectedBusiness.phone}`)}>
                  <View style={styles.contactRowIcon}><Ionicons name="call" size={16} color={ACCENT} /></View>
                  <Text style={styles.contactText}>{selectedBusiness.phone}</Text>
                </TouchableOpacity>
              )}
              {selectedBusiness.email && (
                <TouchableOpacity style={styles.contactRow} onPress={() => Linking.openURL(`mailto:${selectedBusiness.email}`)}>
                  <View style={styles.contactRowIcon}><Ionicons name="mail" size={16} color={ACCENT} /></View>
                  <Text style={styles.contactText}>{selectedBusiness.email}</Text>
                </TouchableOpacity>
              )}
              {selectedBusiness.location && (
                <View style={styles.contactRow}>
                  <View style={styles.contactRowIcon}><Ionicons name="location" size={16} color={ACCENT} /></View>
                  <Text style={styles.contactText}>{selectedBusiness.location}</Text>
                </View>
              )}
            </View>
          )}

          {/* ── Gallery tab ── */}
          {businessDetailTab === "gallery" && (
            <View style={styles.galleryGrid}>
              {selectedBusiness.images?.map((img, i) => (
                <TouchableOpacity key={i} style={styles.galleryItem} activeOpacity={0.85}>
                  <Image source={{ uri: img }} style={styles.galleryImage} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    )
  }

  // ── Loading / empty states (hero stays so back is always available) ───────
  if (dataLoading || authLoading) {
    if (!(refreshing && businesses.length)) {
      return (
        <View className="flex-1 bg-bg">
          <Hero title="Business" subtitle={"Local\ndirectory"} />
          <View className="items-center mt-16">
            <ActivityIndicator size="large" color={BRAND} />
            <Text className="text-[14px] font-bold text-ink mt-3">{dataLoading ? "Loading businesses…" : "Checking authentication…"}</Text>
          </View>
        </View>
      )
    }
  }

  if (businesses.length === 0) {
    return (
      <View className="flex-1 bg-bg">
        <Hero title="Business" subtitle={"Local\ndirectory"} />
        <EmptyState icon="storefront" title="No businesses available" message="Please check back soon" />
      </View>
    )
  }

  // ── Header (hero, search, tabs, categories) ───────────────────────────────
  const header = (
    <View>
      <Hero title="Business" subtitle={"Local\ndirectory"} />
      <SearchBar
        inputRef={searchRef}
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder={
          activeMainTab === "Services" ? "Search services…" :
          activeMainTab === "Gallery" ? "Search by business…" : "Search businesses, services, etc…"
        }
        onFilterPress={activeMainTab === "Home" ? () => setFilterVisible(true) : undefined}
        filtersActive={filtersActive}
      />

      {/* Segmented tabs */}
      <View className="flex-row mx-4 mt-4 border-b border-line">
        {NAV_TABS.map((t) => {
          const active = activeMainTab === t.key
          return (
            <TouchableOpacity
              key={t.key}
              className="flex-1 items-center pt-1.5"
              onPress={() => setActiveMainTab(t.key)}
              activeOpacity={0.85}
            >
              <View className="flex-row items-center">
                <Ionicons name={t.icon} size={14} color={active ? TEAL : MUTED} />
                <Text className={`text-[11px] ml-1 ${active ? "font-extrabold text-ink" : "font-bold text-muted"}`} numberOfLines={1}>{t.label}</Text>
              </View>
              <View className={`mt-1.5 h-[2.5px] w-10 rounded-full ${active ? "bg-brand" : "bg-transparent"}`} />
            </TouchableOpacity>
          )
        })}
      </View>

      {activeMainTab === "Home" ? (
        <>
          <SectionHeader
            title="Local Businesses"
            showingAll={activeType === ALL && !searchQuery}
            onSeeAll={() => { setSearchQuery(""); setActiveType(ALL) }}
          />
          {businessTypes.length > 0 && (
            <CategoryChips
              types={businessTypes}
              active={searchQuery ? null : activeType}
              onSelect={(t) => { setSearchQuery(""); setActiveType(t) }}
              iconFor={(t) => typeIconFor(t, "storefront")}
            />
          )}
        </>
      ) : (
        <View className="flex-row items-center gap-2 px-4 mt-5 mb-3">
          <View className="w-[3px] h-[18px] rounded bg-brand" />
          <Text className="text-[16px] font-extrabold text-ink -tracking-[0.3px]">{TAB_TITLES[activeMainTab]}</Text>
        </View>
      )}

      {(!!q || (filtersActive && activeMainTab === "Home")) && activeMainTab === "Home" && (
        <Text className="text-[11.5px] text-muted font-medium px-4 mb-2">
          <Text className="font-extrabold text-ink">{homeList.length}</Text> {homeList.length === 1 ? "business" : "businesses"} found
        </Text>
      )}
    </View>
  )

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <View className="flex-1 bg-bg">
      <OfflineIndicator />

      <AnimatedFlatList
        key={activeMainTab}
        data={listData}
        renderItem={renderRow}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={header}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[BRAND]} tintColor={BRAND} />}
        ListEmptyComponent={() => (
          <EmptyState
            icon={activeMainTab === "Services" ? "hammer-wrench" : activeMainTab === "Gallery" ? "image-multiple" : "storefront"}
            title={q ? `No results for “${searchQuery.trim()}”` : activeMainTab === "Home" ? "No businesses match" : `No ${activeMainTab.toLowerCase()} available`}
            message={filtersActive && activeMainTab === "Home" ? "Try removing some filters" : "Try a different search or pull to refresh"}
          />
        )}
        {...scrollProps}
      />

      <FilterSheet
        visible={filterVisible}
        onClose={() => setFilterVisible(false)}
        filters={filters}
        setFilters={setFilters}
        count={homeList.length}
        noun={{ one: "business", many: "businesses" }}
        openNowLabel="Open now"
      />

      {/* Business Details Modal */}
      <Modal animationType="slide" transparent={false} visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setModalVisible(false)}>
              <Ionicons name="chevron-down" size={24} color={ACCENT} />
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={styles.modalHeaderTitle} numberOfLines={1}>{selectedBusiness?.name}</Text>
              <Text style={styles.modalHeaderSub}>{selectedBusiness?.category}</Text>
            </View>
            <TouchableOpacity style={styles.modalFavBtn} onPress={() => toggleFavorite(selectedBusiness?.id)}>
              <Ionicons name={favorites.has(selectedBusiness?.id) ? "heart" : "heart-outline"} size={22} color={favorites.has(selectedBusiness?.id) ? HIGHLIGHT : ACCENT} />
            </TouchableOpacity>
          </View>
          {renderBusinessProfile()}
        </View>
      </Modal>

      {/* Reviews Drawer */}
      <Modal visible={showReviewsDrawer} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowReviewsDrawer(false)}>
        <View style={styles.reviewsDrawer}>
          <View style={styles.reviewsHeader}>
            <View>
              <Text style={styles.reviewsTitle}>Reviews</Text>
              <Text style={styles.reviewsSubtitle}>{selectedBusiness?.name}</Text>
            </View>
            <TouchableOpacity style={styles.reviewsCloseBtn} onPress={() => setShowReviewsDrawer(false)}>
              <Ionicons name="close" size={20} color={ACCENT} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            {/* Rating summary */}
            <View style={styles.ratingBanner}>
              <Text style={styles.ratingBannerScore}>{calculatedRating}</Text>
              <View>
                <View style={styles.starsRow}>{renderStars(Number.parseFloat(calculatedRating))}</View>
                <Text style={styles.ratingBannerCount}>{reviews.length} reviews</Text>
              </View>
            </View>

            {/* Write review button */}
            <TouchableOpacity
              style={[styles.writeReviewBtn, (!userCanReview || hasUserReviewed) && styles.writeReviewBtnDisabled]}
              onPress={() => {
                if (!userCanReview) { alert("You need to use our services before you can write a review."); return }
                if (hasUserReviewed) { alert("You have already reviewed this business."); return }
                setShowReviewForm(!showReviewForm)
              }}
              disabled={!userCanReview || hasUserReviewed}
            >
              <Ionicons name={showReviewForm ? "close-circle-outline" : "create-outline"} size={18} color={(!userCanReview || hasUserReviewed) ? "#AAA" : "#FFF"} />
              <Text style={[styles.writeReviewBtnText, (!userCanReview || hasUserReviewed) && styles.writeReviewBtnTextDisabled]}>
                {hasUserReviewed ? "Already Reviewed" : showReviewForm ? "Cancel" : "Write a Review"}
              </Text>
            </TouchableOpacity>

            {/* Review form */}
            {showReviewForm && (
              <View style={styles.reviewForm}>
                <Text style={styles.formTitle}>Share Your Experience</Text>
                <Text style={styles.formLabel}>Your Name</Text>
                <TextInput style={styles.formInput} value={newReview.reviewerName} onChangeText={(t) => setNewReview({ ...newReview, reviewerName: t })} placeholder="Enter your name" placeholderTextColor="#BBB" />
                <Text style={styles.formLabel}>Rating</Text>
                <View style={styles.ratingSelector}>
                  {[1,2,3,4,5].map((star) => (
                    <TouchableOpacity key={star} onPress={() => setNewReview({ ...newReview, rating: star })}>
                      <Ionicons name={star <= newReview.rating ? "star" : "star-outline"} size={32} color="#F59E0B" style={{ marginRight: 4 }} />
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.formLabel}>Your Review</Text>
                <TextInput style={[styles.formInput, styles.formTextArea]} value={newReview.comment} onChangeText={(t) => setNewReview({ ...newReview, comment: t })} placeholder="Share your experience…" placeholderTextColor="#BBB" multiline numberOfLines={4} />
                <TouchableOpacity style={styles.submitBtn} onPress={submitReview}>
                  <Text style={styles.submitBtnText}>Submit Review</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Reviews list */}
            {loadingReviews ? (
              <ActivityIndicator color={HIGHLIGHT} style={{ marginTop: 30 }} />
            ) : reviews.length > 0 ? (
              reviews.map((r) => (
                <View key={r.id} style={styles.reviewCard}>
                  <View style={styles.reviewCardTop}>
                    <View style={styles.reviewAvatar}>
                      <Text style={styles.reviewAvatarLetter}>{r.reviewerName?.[0]?.toUpperCase() || "?"}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.reviewerName}>{r.reviewerName}</Text>
                      <View style={styles.starsRow}>{renderStars(r.rating)}</View>
                    </View>
                    <Text style={styles.reviewDate}>{new Date(r.createdAt).toLocaleDateString()}</Text>
                  </View>
                  <Text style={styles.reviewText}>{r.comment}</Text>
                </View>
              ))
            ) : (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconWrap}><Ionicons name="chatbubbles-outline" size={36} color={ACCENT} /></View>
                <Text style={styles.emptyText}>No reviews yet</Text>
                <Text style={styles.emptySubText}>Be the first to review!</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  // State screens

  // Header

  // Main tab bar

  // List

  // Business card
  starsRow: { flexDirection: "row", alignItems: "center", gap: 2 },

  // Services
  serviceCard: { flexDirection: "row", alignItems: "center", backgroundColor: SURFACE, borderRadius: 16, padding: 14, marginBottom: 10, shadowColor: ACCENT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2, gap: 12 },
  serviceIconWrap: { width: 44, height: 44, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  serviceTitle: { fontSize: 14, fontWeight: "700", color: ACCENT },

  // Contacts
  contactRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 12, borderBottomWidth: 1, borderBottomColor: "#FAF7F2" },
  contactRowIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: "#E8F4F7", justifyContent: "center", alignItems: "center" },
  contactText: { flex: 1, fontSize: 13, color: "#3A4A63", fontWeight: "500" },

  // Gallery
  galleryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  galleryItem: { width: (width - 52) / 2, borderRadius: 16, overflow: "hidden", backgroundColor: "#EEE" },
  galleryImage: { width: "100%", height: 130 },

  // Directions button

  // Hamburger menu

  // Modal
  modalContainer: { flex: 1, backgroundColor: BG },
  modalHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, backgroundColor: SURFACE, borderBottomWidth: 1, borderBottomColor: "#ECE6DD" },
  modalCloseBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#FAF7F2", justifyContent: "center", alignItems: "center" },
  modalHeaderTitle: { fontSize: 15, fontWeight: "800", color: ACCENT },
  modalHeaderSub: { fontSize: 11, color: "#7A8A8F", marginTop: 1 },
  modalFavBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#FAF7F2", justifyContent: "center", alignItems: "center" },

  // Detail tabs (inside modal)
  detailTabBar: { flexDirection: "row", backgroundColor: SURFACE, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#ECE6DD" },
  detailTab: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 12, gap: 3 },
  detailTabActive: { backgroundColor: "#FFF1E8" },
  detailTabText: { fontSize: 10, fontWeight: "600", color: "#AAA" },
  detailTabTextActive: { color: HIGHLIGHT },

  // Detail carousel
  detailCarousel: { marginBottom: 16, borderRadius: 18, overflow: "hidden" },
  detailCarouselImage: { width: width - 40, height: 220, borderRadius: 18 },
  carouselDots: { flexDirection: "row", justifyContent: "center", marginTop: 10, gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#DDD" },
  dotActive: { width: 18, borderRadius: 3, backgroundColor: HIGHLIGHT },

  // Info cards
  infoCard: { backgroundColor: SURFACE, borderRadius: 18, padding: 16, marginBottom: 12, shadowColor: ACCENT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 1 },
  infoCardTitle: { fontSize: 11, fontWeight: "800", color: "#AAA", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },
  infoCardBody: { fontSize: 13, color: "#3A4A63", lineHeight: 20 },
  serviceRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, gap: 10 },
  serviceDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: SUCCESS },
  serviceRowText: { fontSize: 14, color: ACCENT, fontWeight: "500" },
  moreText: { fontSize: 13, color: "#AAA", marginTop: 6, fontStyle: "italic" },
  ratingsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  ratingBig: { fontSize: 30, fontWeight: "800", color: ACCENT, lineHeight: 34 },
  reviewsCount: { fontSize: 12, color: "#AAA", marginTop: 4 },
  viewReviewsBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#FFF1E8", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14 },
  viewReviewsBtnText: { fontSize: 13, fontWeight: "700", color: HIGHLIGHT },

  // Hire CTA
  hireCTA: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: HIGHLIGHT, paddingVertical: 13, borderRadius: 16, gap: 10, shadowColor: ACCENT, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 5 },
  hireCTAText: { color: "#FFF", fontSize: 14, fontWeight: "800" },

  // Reviews drawer
  reviewsDrawer: { flex: 1, backgroundColor: BG },
  reviewsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 22, paddingVertical: 18, backgroundColor: SURFACE, borderBottomWidth: 1, borderBottomColor: "#ECE6DD" },
  reviewsTitle: { fontSize: 18, fontWeight: "800", color: ACCENT },
  reviewsSubtitle: { fontSize: 12, color: "#7A8A8F", marginTop: 2 },
  reviewsCloseBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#FAF7F2", justifyContent: "center", alignItems: "center" },
  ratingBanner: { flexDirection: "row", alignItems: "center", gap: 16, backgroundColor: SURFACE, borderRadius: 18, padding: 18, marginBottom: 16, shadowColor: ACCENT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 1 },
  ratingBannerScore: { fontSize: 36, fontWeight: "800", color: ACCENT },
  ratingBannerCount: { fontSize: 12, color: "#AAA", marginTop: 4 },
  writeReviewBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: HIGHLIGHT, paddingVertical: 12, borderRadius: 16, gap: 8, marginBottom: 16 },
  writeReviewBtnDisabled: { backgroundColor: "#E0E0E0" },
  writeReviewBtnText: { color: "#FFF", fontSize: 14, fontWeight: "700" },
  writeReviewBtnTextDisabled: { color: "#AAA" },
  reviewForm: { backgroundColor: SURFACE, borderRadius: 18, padding: 18, marginBottom: 16 },
  formTitle: { fontSize: 17, fontWeight: "800", color: ACCENT, marginBottom: 16 },
  formLabel: { fontSize: 12, fontWeight: "700", color: "#AAA", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6, marginTop: 12 },
  formInput: { borderWidth: 1.5, borderColor: "#ECE6DD", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: ACCENT, backgroundColor: BG },
  formTextArea: { height: 100, textAlignVertical: "top" },
  ratingSelector: { flexDirection: "row", marginTop: 4 },
  submitBtn: { backgroundColor: HIGHLIGHT, paddingVertical: 14, borderRadius: 14, alignItems: "center", marginTop: 16 },
  submitBtnText: { color: "#FFF", fontSize: 15, fontWeight: "700" },
  reviewCard: { backgroundColor: SURFACE, borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: ACCENT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1 },
  reviewCardTop: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  reviewAvatar: { width: 40, height: 40, borderRadius: 14, backgroundColor: ACCENT, justifyContent: "center", alignItems: "center" },
  reviewAvatarLetter: { fontSize: 16, fontWeight: "800", color: "#FFF" },
  reviewerName: { fontSize: 14, fontWeight: "700", color: ACCENT, marginBottom: 2 },
  reviewDate: { fontSize: 11, color: "#BBB" },
  reviewText: { fontSize: 14, color: "#3A4A63", lineHeight: 21 },

  // Shared empty state
  emptyContainer: { alignItems: "center", paddingVertical: 40 },
  emptyIconWrap: { width: 72, height: 72, borderRadius: 22, backgroundColor: "#E8F4F7", justifyContent: "center", alignItems: "center", marginBottom: 14 },
  emptyText: { fontSize: 17, fontWeight: "700", color: ACCENT },
  emptySubText: { fontSize: 13, color: "#7A8A8F", marginTop: 6, textAlign: "center" },

  // Section title
})

export default Business