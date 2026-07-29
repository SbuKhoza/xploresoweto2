"use client"

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
import { collection, getDocs, query, where, addDoc, doc, getDoc } from "firebase/firestore"
import { db, auth } from "../../Firebase/config"
import { onAuthStateChanged } from "firebase/auth"
import { useScrollTracking, AnimatedFlatList } from "../BottomNav"
import { TextInput } from "react-native"

const { width } = Dimensions.get("window")

// ── Design tokens (mirrors Xplore) ──────────────────────────────────────────
const ACCENT = "#1A1A2E"
const HIGHLIGHT = "#E94560"
const BG = "#F4F6FB"
const SURFACE = "#FFFFFF"
const SKY = "#87CEEB"        // kept for legacy references / status
const SUCCESS = "#22C55E"
const WARNING = "#F59E0B"

const ICON_BG_COLORS = [
  "#EEF2FF", "#FFF0F3", "#F0FFF4", "#FFFBEB",
  "#F5F3FF", "#FFF7ED", "#F0F9FF", "#FDF2F8",
]

// ─────────────────────────────────────────────────────────────────────────────

const Business = () => {
  const [businesses, setBusinesses] = useState([])
  const [selectedBusiness, setSelectedBusiness] = useState(null)
  const [activeMainTab, setActiveMainTab] = useState("Home")
  const [businessDetailTab, setBusinessDetailTab] = useState("home")
  const [showHamburgerMenu, setShowHamburgerMenu] = useState(false)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [favorites, setFavorites] = useState(new Set())
  const [dataLoading, setDataLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [businessTypes, setBusinessTypes] = useState([])
  const [businessData, setBusinessData] = useState({})
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

  const scrollProps = useScrollTracking()

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

  const openDirections = async (coordinates, name) => {
    if (!coordinates || !coordinates.latitude || !coordinates.longitude) {
      Alert.alert("Error", "Location coordinates not available for this business.")
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
    const optionNames = [...finalOptions.map(o => o.name), "Cancel"]
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions({ options: optionNames, cancelButtonIndex: optionNames.length - 1, title: `Get directions to ${name}` }, (i) => {
        if (i < finalOptions.length) Linking.openURL(finalOptions[i].url).catch(() => Alert.alert("Error", "Could not open maps application"))
      })
    } else {
      Alert.alert("Choose Maps App", `Get directions to ${name}`, [
        ...finalOptions.map(o => ({ text: o.name, onPress: () => Linking.openURL(o.url).catch(() => Alert.alert("Error", "Could not open maps application")) })),
        { text: "Cancel", style: "cancel" },
      ], { cancelable: true })
    }
  }

  const fetchBusinessData = async () => {
    try {
      setDataLoading(true)
      const businessRef = collection(db, "business")
      const snapshot = await getDocs(businessRef)
      const groupedData = {}
      const typesSet = new Set()
      snapshot.forEach((doc) => {
        const data = { id: doc.id, ...doc.data() }
        if (data.type) {
          typesSet.add(data.type)
          if (!groupedData[data.type]) groupedData[data.type] = []
          groupedData[data.type].push(data)
        }
      })
      setBusinessData(groupedData)
      setBusinessTypes(Array.from(typesSet).sort())
      setBusinesses(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })))
    } catch (error) {
      setBusinessData({})
      setBusinessTypes([])
      setBusinesses([])
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
    for (let i = 0; i < full; i++) stars.push(<Ionicons key={i} name="star" size={14} color="#F59E0B" />)
    if (half) stars.push(<Ionicons key="half" name="star-half" size={14} color="#F59E0B" />)
    const empty = 5 - Math.ceil(rating)
    for (let i = 0; i < empty; i++) stars.push(<Ionicons key={`e-${i}`} name="star-outline" size={14} color="#F59E0B" />)
    return stars
  }

  // ── Business Card ────────────────────────────────────────────────────────
  const renderBusinessCard = ({ item, index }) => (
    <TouchableOpacity style={styles.businessCard} onPress={() => openBusinessDetails(item)} activeOpacity={0.88}>
      <View style={styles.imageContainer}>
        <Image source={{ uri: item.images[0] }} style={styles.businessImage} />

        {/* Gradient overlay at bottom */}
        <View style={styles.imageGradient} />

        <TouchableOpacity style={styles.favoriteButton} onPress={() => toggleFavorite(item.id)}>
          <Ionicons name={favorites.has(item.id) ? "heart" : "heart-outline"} size={20} color={favorites.has(item.id) ? HIGHLIGHT : "#FFF"} />
        </TouchableOpacity>

        <View style={[styles.statusBadge, { backgroundColor: item.status === "Open" ? SUCCESS : WARNING }]}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>{item.status}</Text>
        </View>

        {/* Business name on image */}
        <View style={styles.imageNameContainer}>
          <Text style={styles.imageBusinessName} numberOfLines={1}>{item.name}</Text>
        </View>
      </View>

      <View style={styles.cardContent}>
        <View style={styles.cardRow}>
          <View style={[styles.typeChip, { backgroundColor: ICON_BG_COLORS[index % ICON_BG_COLORS.length] }]}>
            <Text style={styles.typeChipText}>{item.type || item.category || "Business"}</Text>
          </View>
          <View style={styles.starsRow}>
            {renderStars(item.rating)}
            <Text style={styles.ratingNum}>{item.rating}</Text>
          </View>
        </View>

        <Text style={styles.description} numberOfLines={2}>{item.description}</Text>

        <View style={styles.cardFooter}>
          <View style={styles.hoursChip}>
            <Ionicons name="time-outline" size={13} color={ACCENT} />
            <Text style={styles.hoursText}>{item.hours}</Text>
          </View>
          <View style={styles.reviewCountChip}>
            <Ionicons name="chatbubble-outline" size={12} color="#888" />
            <Text style={styles.reviewCountText}>{item.reviews}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  )

  // ── Main tabs ────────────────────────────────────────────────────────────
  const NAV_TABS = [
    { key: "Home", icon: "grid-outline" },
    { key: "Services", icon: "construct-outline" },
    { key: "Contact", icon: "call-outline" },
    { key: "Gallery", icon: "images-outline" },
  ]

  const renderHomeContent = () => {
    const all = Object.values(businessData).flat()
    return (
      <AnimatedFlatList
        data={all}
        renderItem={renderBusinessCard}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[HIGHLIGHT]} tintColor={HIGHLIGHT} />}
        ListEmptyComponent={() => (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}><Ionicons name="business-outline" size={40} color={ACCENT} /></View>
            <Text style={styles.emptyText}>No businesses available</Text>
            <Text style={styles.emptySubText}>Try refreshing or add some businesses</Text>
          </View>
        )}
        {...scrollProps}
      />
    )
  }

  const renderServicesContent = () => {
    const all = Object.values(businessData).flat()
    const allServices = all.reduce((acc, b) => {
      if (b.services) b.services.forEach((s) => {
        const name = typeof s === "string" ? s : s.name || s
        if (!acc.find((x) => x.name === name)) acc.push({ name, businessName: b.name, businessId: b.id })
      })
      return acc
    }, [])
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.listContainer} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Available Services</Text>
        {allServices.map((s, i) => (
          <View key={i} style={styles.serviceCard}>
            <View style={[styles.serviceIconWrap, { backgroundColor: ICON_BG_COLORS[i % ICON_BG_COLORS.length] }]}>
              <Ionicons name="checkmark" size={18} color={ACCENT} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.serviceTitle}>{s.name}</Text>
              <Text style={styles.serviceProvider}>{s.businessName}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#CCC" />
          </View>
        ))}
        {allServices.length === 0 && (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}><Ionicons name="construct-outline" size={40} color={ACCENT} /></View>
            <Text style={styles.emptyText}>No services available</Text>
          </View>
        )}
      </ScrollView>
    )
  }

  const renderContactContent = () => {
    const all = Object.values(businessData).flat()
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.listContainer} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Business Contacts</Text>
        {all.map((b, i) => (
          <View key={i} style={styles.contactCard}>
            <View style={styles.contactCardHeader}>
              <View style={[styles.contactAvatar, { backgroundColor: ICON_BG_COLORS[i % ICON_BG_COLORS.length] }]}>
                <Ionicons name="business" size={22} color={ACCENT} />
              </View>
              <Text style={styles.contactBusinessName}>{b.name}</Text>
            </View>
            <View style={styles.contactRows}>
              {b.phone && (
                <TouchableOpacity style={styles.contactRow} onPress={() => Linking.openURL(`tel:${b.phone}`)}>
                  <View style={styles.contactRowIcon}><Ionicons name="call" size={16} color={ACCENT} /></View>
                  <Text style={styles.contactText}>{b.phone}</Text>
                  <Ionicons name="chevron-forward" size={14} color="#CCC" />
                </TouchableOpacity>
              )}
              {b.email && (
                <TouchableOpacity style={styles.contactRow} onPress={() => Linking.openURL(`mailto:${b.email}`)}>
                  <View style={styles.contactRowIcon}><Ionicons name="mail" size={16} color={ACCENT} /></View>
                  <Text style={styles.contactText}>{b.email}</Text>
                  <Ionicons name="chevron-forward" size={14} color="#CCC" />
                </TouchableOpacity>
              )}
              {b.location && (
                <View style={styles.contactRow}>
                  <View style={styles.contactRowIcon}><Ionicons name="location" size={16} color={ACCENT} /></View>
                  <Text style={styles.contactText}>{b.location}</Text>
                </View>
              )}
            </View>
            {b.coordinates && (
              <TouchableOpacity style={styles.directionsButton} onPress={() => openDirections(b.coordinates, b.name)}>
                <Ionicons name="navigate" size={16} color="#FFF" />
                <Text style={styles.directionsButtonText}>Get Directions</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </ScrollView>
    )
  }

  const renderGalleryContent = () => {
    const all = Object.values(businessData).flat()
    const allImages = all.reduce((acc, b) => {
      if (b.images) b.images.forEach((img) => acc.push({ uri: img, businessName: b.name }))
      return acc
    }, [])
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.listContainer} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Business Gallery</Text>
        <View style={styles.galleryGrid}>
          {allImages.map((img, i) => (
            <TouchableOpacity key={i} style={styles.galleryItem} activeOpacity={0.85}>
              <Image source={{ uri: img.uri }} style={styles.galleryImage} />
              <View style={styles.galleryOverlay}>
                <Text style={styles.galleryCaption} numberOfLines={1}>{img.businessName}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    )
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

  const renderHamburgerMenu = () => (
    <Modal animationType="slide" transparent visible={showHamburgerMenu} onRequestClose={() => setShowHamburgerMenu(false)}>
      <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setShowHamburgerMenu(false)}>
        <View style={styles.menuContainer}>
          <View style={styles.menuHandle} />
          <View style={styles.menuHeader}>
            <Text style={styles.menuTitle}>Navigate</Text>
            <TouchableOpacity onPress={() => setShowHamburgerMenu(false)} style={styles.menuCloseBtn}>
              <Ionicons name="close" size={20} color={ACCENT} />
            </TouchableOpacity>
          </View>
          {["Home", "Services", "Contact", "Gallery"].map((tab, i) => {
            const tabKey = tab.toLowerCase() === "services" ? "service" : tab.toLowerCase()
            const isActive = selectedBusiness ? businessDetailTab === tabKey : activeMainTab === tab
            return (
              <TouchableOpacity key={tab} style={[styles.menuItem, isActive && styles.menuItemActive]}
                onPress={() => {
                  selectedBusiness ? setBusinessDetailTab(tabKey) : setActiveMainTab(tab)
                  setShowHamburgerMenu(false)
                }}>
                <View style={[styles.menuItemIcon, { backgroundColor: isActive ? "#FFF0F3" : ICON_BG_COLORS[i] }]}>
                  <Ionicons name={["home", "construct", "call", "images"][i]} size={18} color={isActive ? HIGHLIGHT : ACCENT} />
                </View>
                <Text style={[styles.menuItemText, isActive && styles.menuItemTextActive]}>{tab}</Text>
                {isActive && <View style={styles.menuItemDot} />}
              </TouchableOpacity>
            )
          })}
        </View>
      </TouchableOpacity>
    </Modal>
  )

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

  // ── Loading / empty states ───────────────────────────────────────────────
  if (dataLoading || authLoading) {
    return (
      <View style={styles.stateScreen}>
        <View style={styles.stateIconWrap}><Ionicons name="business-outline" size={36} color={ACCENT} /></View>
        <ActivityIndicator size="large" color={HIGHLIGHT} style={{ marginTop: 20 }} />
        <Text style={styles.stateText}>{dataLoading ? "Loading businesses…" : "Checking authentication…"}</Text>
      </View>
    )
  }

  if (Object.keys(businessData).length === 0) {
    return (
      <View style={styles.stateScreen}>
        <View style={styles.stateIconWrap}><Ionicons name="business-outline" size={36} color={ACCENT} /></View>
        <Text style={styles.stateText}>No businesses available</Text>
        <Text style={styles.stateSubText}>Please add some businesses to get started</Text>
      </View>
    )
  }

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Top header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Business</Text>
          <Text style={styles.headerSubtitle}>Local directory</Text>
        </View>
        <TouchableOpacity style={styles.hamburgerBtn} onPress={() => setShowHamburgerMenu(true)}>
          <Ionicons name="menu" size={22} color={ACCENT} />
        </TouchableOpacity>
      </View>

      {/* Bottom nav tabs */}
      <View style={styles.mainTabBar}>
        {NAV_TABS.map((t) => (
          <TouchableOpacity key={t.key} style={[styles.mainTab, activeMainTab === t.key && styles.mainTabActive]} onPress={() => setActiveMainTab(t.key)}>
            <Ionicons name={t.icon} size={18} color={activeMainTab === t.key ? HIGHLIGHT : "#AAA"} />
            <Text style={[styles.mainTabText, activeMainTab === t.key && styles.mainTabTextActive]}>{t.key}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeMainTab === "Home" && renderHomeContent()}
      {activeMainTab === "Services" && renderServicesContent()}
      {activeMainTab === "Contact" && renderContactContent()}
      {activeMainTab === "Gallery" && renderGalleryContent()}

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

      {renderHamburgerMenu()}

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
  stateScreen: { flex: 1, backgroundColor: BG, justifyContent: "center", alignItems: "center", paddingHorizontal: 40 },
  stateIconWrap: { width: 80, height: 80, borderRadius: 24, backgroundColor: "#EEF2FF", justifyContent: "center", alignItems: "center", marginBottom: 16 },
  stateText: { fontSize: 18, fontWeight: "700", color: ACCENT, marginTop: 10 },
  stateSubText: { fontSize: 14, color: "#999", textAlign: "center", marginTop: 6 },

  // Header
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 22, paddingTop: 14, paddingBottom: 10, backgroundColor: BG },
  headerTitle: { fontSize: 18, fontWeight: "800", color: ACCENT, letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 13, color: "#888", fontWeight: "500", marginTop: 1 },
  hamburgerBtn: { width: 42, height: 42, borderRadius: 14, backgroundColor: SURFACE, justifyContent: "center", alignItems: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6, elevation: 2 },

  // Main tab bar
  mainTabBar: { flexDirection: "row", backgroundColor: SURFACE, marginHorizontal: 20, marginBottom: 12, borderRadius: 16, padding: 4, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2 },
  mainTab: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 12, gap: 2 },
  mainTabActive: { backgroundColor: "#FFF0F3" },
  mainTabText: { fontSize: 10, fontWeight: "600", color: "#AAA" },
  mainTabTextActive: { color: HIGHLIGHT },

  // List
  listContainer: { paddingHorizontal: 16, paddingBottom: 120, paddingTop: 4 },

  // Business card
  businessCard: { backgroundColor: SURFACE, borderRadius: 20, marginBottom: 16, overflow: "hidden", shadowColor: ACCENT, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 3 },
  imageContainer: { position: "relative" },
  businessImage: { width: "100%", height: 200 },
  imageGradient: { position: "absolute", bottom: 0, left: 0, right: 0, height: 80, backgroundColor: "rgba(0,0,0,0.35)" },
  favoriteButton: { position: "absolute", top: 12, right: 12, width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(0,0,0,0.3)", justifyContent: "center", alignItems: "center" },
  statusBadge: { position: "absolute", top: 12, left: 12, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, gap: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.8)" },
  statusText: { color: "#FFF", fontSize: 11, fontWeight: "700" },
  imageNameContainer: { position: "absolute", bottom: 12, left: 14, right: 55 },
  imageBusinessName: { color: "#FFF", fontSize: 17, fontWeight: "800", letterSpacing: -0.3 },
  cardContent: { padding: 14 },
  cardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  typeChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  typeChipText: { fontSize: 11, fontWeight: "700", color: ACCENT },
  starsRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  ratingNum: { fontSize: 12, color: "#888", marginLeft: 4, fontWeight: "600" },
  description: { fontSize: 13, color: "#666", lineHeight: 19, marginBottom: 12 },
  cardFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  hoursChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#EEF2FF", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  hoursText: { fontSize: 11, color: ACCENT, fontWeight: "600" },
  reviewCountChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  reviewCountText: { fontSize: 11, color: "#888" },

  // Services
  serviceCard: { flexDirection: "row", alignItems: "center", backgroundColor: SURFACE, borderRadius: 16, padding: 14, marginBottom: 10, shadowColor: ACCENT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2, gap: 12 },
  serviceIconWrap: { width: 44, height: 44, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  serviceTitle: { fontSize: 15, fontWeight: "700", color: ACCENT },
  serviceProvider: { fontSize: 12, color: "#888", marginTop: 2 },

  // Contacts
  contactCard: { backgroundColor: SURFACE, borderRadius: 18, padding: 16, marginBottom: 14, shadowColor: ACCENT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  contactCardHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  contactAvatar: { width: 48, height: 48, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  contactBusinessName: { fontSize: 17, fontWeight: "800", color: ACCENT },
  contactRows: { gap: 2, marginBottom: 12 },
  contactRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 12, borderBottomWidth: 1, borderBottomColor: "#F4F6FB" },
  contactRowIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: "#EEF2FF", justifyContent: "center", alignItems: "center" },
  contactText: { flex: 1, fontSize: 14, color: "#555", fontWeight: "500" },

  // Gallery
  galleryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  galleryItem: { width: (width - 52) / 2, borderRadius: 16, overflow: "hidden", backgroundColor: "#EEE" },
  galleryImage: { width: "100%", height: 130 },
  galleryOverlay: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.4)", padding: 8 },
  galleryCaption: { fontSize: 11, color: "#FFF", fontWeight: "600" },

  // Directions button
  directionsButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: ACCENT, paddingVertical: 12, borderRadius: 14, gap: 8 },
  directionsButtonText: { color: "#FFF", fontSize: 14, fontWeight: "700" },

  // Hamburger menu
  menuOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  menuContainer: { backgroundColor: SURFACE, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 40 },
  menuHandle: { width: 36, height: 4, backgroundColor: "#E0E0E0", borderRadius: 2, alignSelf: "center", marginTop: 12, marginBottom: 4 },
  menuHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 22, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#F0F0F0" },
  menuTitle: { fontSize: 18, fontWeight: "800", color: ACCENT },
  menuCloseBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F4F6FB", justifyContent: "center", alignItems: "center" },
  menuItem: { flexDirection: "row", alignItems: "center", paddingHorizontal: 22, paddingVertical: 14, gap: 14 },
  menuItemActive: { backgroundColor: "#FFF9FA" },
  menuItemIcon: { width: 44, height: 44, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  menuItemText: { flex: 1, fontSize: 15, fontWeight: "600", color: "#888" },
  menuItemTextActive: { color: ACCENT, fontWeight: "700" },
  menuItemDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: HIGHLIGHT },

  // Modal
  modalContainer: { flex: 1, backgroundColor: BG },
  modalHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, backgroundColor: SURFACE, borderBottomWidth: 1, borderBottomColor: "#F0F0F0" },
  modalCloseBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#F4F6FB", justifyContent: "center", alignItems: "center" },
  modalHeaderTitle: { fontSize: 16, fontWeight: "800", color: ACCENT },
  modalHeaderSub: { fontSize: 11, color: "#888", marginTop: 1 },
  modalFavBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#F4F6FB", justifyContent: "center", alignItems: "center" },

  // Detail tabs (inside modal)
  detailTabBar: { flexDirection: "row", backgroundColor: SURFACE, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F0F0F0" },
  detailTab: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 12, gap: 3 },
  detailTabActive: { backgroundColor: "#FFF0F3" },
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
  infoCardTitle: { fontSize: 13, fontWeight: "800", color: "#AAA", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },
  infoCardBody: { fontSize: 14, color: "#555", lineHeight: 22 },
  serviceRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, gap: 10 },
  serviceDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: SUCCESS },
  serviceRowText: { fontSize: 14, color: ACCENT, fontWeight: "500" },
  moreText: { fontSize: 13, color: "#AAA", marginTop: 6, fontStyle: "italic" },
  ratingsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  ratingBig: { fontSize: 38, fontWeight: "900", color: ACCENT, lineHeight: 42 },
  reviewsCount: { fontSize: 12, color: "#AAA", marginTop: 4 },
  viewReviewsBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#FFF0F3", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14 },
  viewReviewsBtnText: { fontSize: 13, fontWeight: "700", color: HIGHLIGHT },

  // Hire CTA
  hireCTA: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: ACCENT, paddingVertical: 16, borderRadius: 18, gap: 10, shadowColor: ACCENT, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 5 },
  hireCTAText: { color: "#FFF", fontSize: 16, fontWeight: "800" },

  // Reviews drawer
  reviewsDrawer: { flex: 1, backgroundColor: BG },
  reviewsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 22, paddingVertical: 18, backgroundColor: SURFACE, borderBottomWidth: 1, borderBottomColor: "#F0F0F0" },
  reviewsTitle: { fontSize: 20, fontWeight: "800", color: ACCENT },
  reviewsSubtitle: { fontSize: 12, color: "#888", marginTop: 2 },
  reviewsCloseBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#F4F6FB", justifyContent: "center", alignItems: "center" },
  ratingBanner: { flexDirection: "row", alignItems: "center", gap: 16, backgroundColor: SURFACE, borderRadius: 18, padding: 18, marginBottom: 16, shadowColor: ACCENT, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 1 },
  ratingBannerScore: { fontSize: 48, fontWeight: "900", color: ACCENT },
  ratingBannerCount: { fontSize: 12, color: "#AAA", marginTop: 4 },
  writeReviewBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: ACCENT, paddingVertical: 14, borderRadius: 16, gap: 8, marginBottom: 16 },
  writeReviewBtnDisabled: { backgroundColor: "#E0E0E0" },
  writeReviewBtnText: { color: "#FFF", fontSize: 15, fontWeight: "700" },
  writeReviewBtnTextDisabled: { color: "#AAA" },
  reviewForm: { backgroundColor: SURFACE, borderRadius: 18, padding: 18, marginBottom: 16 },
  formTitle: { fontSize: 17, fontWeight: "800", color: ACCENT, marginBottom: 16 },
  formLabel: { fontSize: 12, fontWeight: "700", color: "#AAA", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6, marginTop: 12 },
  formInput: { borderWidth: 1.5, borderColor: "#E8ECF4", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: ACCENT, backgroundColor: BG },
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
  reviewText: { fontSize: 14, color: "#555", lineHeight: 21 },

  // Shared empty state
  emptyContainer: { alignItems: "center", paddingVertical: 40 },
  emptyIconWrap: { width: 72, height: 72, borderRadius: 22, backgroundColor: "#EEF2FF", justifyContent: "center", alignItems: "center", marginBottom: 14 },
  emptyText: { fontSize: 17, fontWeight: "700", color: ACCENT },
  emptySubText: { fontSize: 13, color: "#999", marginTop: 6, textAlign: "center" },

  // Section title
  sectionTitle: { fontSize: 20, fontWeight: "800", color: ACCENT, marginBottom: 14, letterSpacing: -0.3 },
})

export default Business