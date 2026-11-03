"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import {
  Text, View, ScrollView, TouchableOpacity, Image, TextInput,
  Dimensions, Modal, Linking, Alert, ActionSheetIOS, Platform, Pressable,
  RefreshControl, ActivityIndicator, BackHandler, Keyboard, useWindowDimensions,
} from "react-native"
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { collection, getDocs } from "firebase/firestore"
import { db } from "../../Firebase/config"
import { useScrollTracking, AnimatedFlatList } from "../BottomNav"
import OfflineIndicator from "../OfflineIndicator"
import RestaurantReservationForm from "./RestaurantReservationForm"

const { width } = Dimensions.get("window")

// ── Design tokens (match tailwind.config.js) ────────────────────────────────
const TEAL  = "#1B4D5C"
const BRAND = "#E8600A"
const MUTED = "#7A8A8F"
const STAR  = "#F5A524"
const ALL   = "__all__" // "See All" — no category filter

// Badge rules. Everything is derived from the restaurant's own Firestore data.
const TOP_RATED_MIN_RATING  = 4.7
const TOP_RATED_MIN_REVIEWS = 10
const POPULAR_MIN_REVIEWS   = 200

// Hero artwork (already used on Home) — 1042 × 316
const HERO_IMAGE  = require("../../assets/home/hero-towers.png")
const HERO_RATIO  = 1042 / 316
const HERO_BODY_H = 150 // hero height below the status bar

const cardShadow = {
  shadowColor: "#14213D",
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.09,
  shadowRadius: 16,
  elevation: 4,
}
const softShadow = {
  shadowColor: TEAL,
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 10,
  elevation: 3,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Picks an icon for whatever category names exist in Firestore.
const typeIcon = (type = "") => {
  const t = String(type).toLowerCase()
  if (/caf[eé]|coffee|bakery|tea/.test(t))               return "coffee"
  if (/fast|takeaway|take-away|burger/.test(t))           return "hamburger"
  if (/grill|braai|bbq|barbe|steak|shisa|meat/.test(t))   return "grill"
  if (/\bbars?\b|\bpubs?\b|lounge|cocktail|tavern|shebeen|club/.test(t)) return "glass-cocktail"
  if (/pizza|italian/.test(t))                            return "pizza"
  return "silverware-fork-knife"
}

// "09:00 – 23:00" / "9:00 AM - 5:00 PM" → minutes since midnight
const to24 = (h, m, mer) => {
  let hh = Number(h)
  if (mer) {
    const x = mer.toLowerCase()
    if (x === "pm" && hh < 12) hh += 12
    if (x === "am" && hh === 12) hh = 0
  }
  return hh * 60 + Number(m)
}
const parseHours = (str) => {
  if (typeof str !== "string") return null
  const m = str.match(/(\d{1,2})[:.h](\d{2})\s*(am|pm)?\s*(?:–|—|-|to)\s*(\d{1,2})[:.h](\d{2})\s*(am|pm)?/i)
  if (!m) return null
  return { open: to24(m[1], m[2], m[3]), close: to24(m[4], m[5], m[6]) }
}
// true / false, or null when the hours string can't be understood
const isOpenNow = (str, now) => {
  const p = parseHours(str)
  if (!p) return null
  const cur = now.getHours() * 60 + now.getMinutes()
  if (p.open === p.close) return true
  return p.close > p.open ? cur >= p.open && cur < p.close : cur >= p.open || cur < p.close
}

const getBadge = (r, open) => {
  const rating  = Number(r.rating)  || 0
  const reviews = Number(r.reviews) || 0
  if (rating >= TOP_RATED_MIN_RATING && reviews >= TOP_RATED_MIN_REVIEWS)
    return { label: "Top Rated", icon: "star", color: "#6D4AD8" }
  if (reviews >= POPULAR_MIN_REVIEWS)
    return { label: "Popular", icon: "star", color: "#2563EB" }
  if (open === true)  return { label: "Open Now", dot: true, color: "#22C55E" }
  if (open === false) return { label: "Closed",   dot: true, color: "#6B7280" }
  return null
}

const FilterChip = ({ label, active, onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={0.8}
    className={`px-3.5 py-2 rounded-full mr-2 mb-2 border ${active ? "bg-teal border-teal" : "bg-surface border-line"}`}
  >
    <Text className={`text-[12px] font-bold ${active ? "text-white" : "text-ink"}`}>{label}</Text>
  </TouchableOpacity>
)

const Restaurants = () => {
  const [activeTab, setActiveTab]                             = useState(undefined) // undefined = not chosen yet
  const [selectedRestaurant, setSelectedRestaurant]           = useState(null)
  const [modalVisible, setModalVisible]                       = useState(false)
  const [reservationModalVisible, setReservationModalVisible] = useState(false)
  const [currentImageIndex, setCurrentImageIndex]             = useState(0)
  const [favorites, setFavorites]                             = useState(new Set())
  const [allRestaurants, setAllRestaurants]                   = useState([])
  const [restaurantTypes, setRestaurantTypes]                 = useState([])
  const [dataLoading, setDataLoading]                         = useState(true)
  const [refreshing, setRefreshing]                           = useState(false)
  const [query, setQuery]                                     = useState("")
  const [filterVisible, setFilterVisible]                     = useState(false)
  const [filters, setFilters]                                 = useState({ openNow: false, minRating: 0, sort: "default" })
  const [now, setNow]                                         = useState(new Date())

  const scrollProps = useScrollTracking()
  const insets      = useSafeAreaInsets()
  const { width: winW } = useWindowDimensions()
  const navigation  = useNavigation()
  const route       = useRoute()
  const searchRef   = useRef(null)

  // Keep "Open Now" honest while the screen stays open.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])

  // ── Back navigation (this screen draws its own header) ────────────────────
  // Screens opened from Home are tagged `from: "Home"` and always return there.
  const openedFromHome = route.params?.from === "Home"
  const handleBack = () => {
    if (openedFromHome) navigation.navigate("Home")
    else if (navigation.canGoBack()) navigation.goBack()
    else navigation.navigate("Home")
  }
  useFocusEffect(
    useCallback(() => {
      if (!openedFromHome) return undefined
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        navigation.navigate("Home")
        return true
      })
      return () => sub.remove()
    }, [navigation, openedFromHome])
  )

  // ── Data ──────────────────────────────────────────────────────────────────
  const fetchRestaurantsData = async () => {
    try {
      setDataLoading(true)
      const snap = await getDocs(collection(db, "restaurants"))
      const restaurants = []
      const typesSet = new Set()
      snap.forEach(doc => {
        const data = { id: doc.id, ...doc.data() }
        restaurants.push(data)
        if (data.type) typesSet.add(data.type)
      })
      const uniqueTypes = Array.from(typesSet).sort()
      setAllRestaurants(restaurants)
      setRestaurantTypes(uniqueTypes)
      setActiveTab(prev => {
        if (prev === ALL) return ALL
        if (prev && uniqueTypes.includes(prev)) return prev
        return uniqueTypes[0] ?? ALL
      })
    } catch {
      setAllRestaurants([])
      setRestaurantTypes([])
    } finally {
      setDataLoading(false)
      setRefreshing(false)
    }
  }

  const onRefresh = async () => { setRefreshing(true); await fetchRestaurantsData() }
  useEffect(() => { fetchRestaurantsData() }, [])

  const visibleRestaurants = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = allRestaurants.filter(r => {
      if (q) {
        // Searching looks across every category
        const hay = [r.name, r.cuisine, r.type, r.location, r.description, ...(r.tags || []), ...(r.specialDishes || [])]
          .filter(Boolean).join(" ").toLowerCase()
        if (!hay.includes(q)) return false
      } else if (activeTab !== ALL && r.type !== activeTab) {
        return false
      }
      if (filters.minRating && (Number(r.rating) || 0) < filters.minRating) return false
      if (filters.openNow && isOpenNow(r.openingHours, now) !== true) return false
      return true
    })
    if (filters.sort === "rating")  list.sort((a, b) => (Number(b.rating)  || 0) - (Number(a.rating)  || 0))
    if (filters.sort === "reviews") list.sort((a, b) => (Number(b.reviews) || 0) - (Number(a.reviews) || 0))
    return list
  }, [allRestaurants, activeTab, query, filters, now])

  const filtersActive = filters.openNow || filters.minRating > 0 || filters.sort !== "default"
  const resetFilters  = () => setFilters({ openNow: false, minRating: 0, sort: "default" })

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

  const toggleFavorite = (id) => {
    const n = new Set(favorites); n.has(id) ? n.delete(id) : n.add(id); setFavorites(n)
  }
  const openRestaurantDetails = (r) => { setSelectedRestaurant(r); setCurrentImageIndex(0); setModalVisible(true) }
  const openReservationForm   = (r) => { setSelectedRestaurant(r); setModalVisible(false); setReservationModalVisible(true) }

  const renderStars = (rating, size = 12) => {
    const r = Math.max(0, Math.min(5, Math.round((Number(rating) || 0) * 2) / 2))
    const full = Math.floor(r), half = r % 1 !== 0, empty = 5 - full - (half ? 1 : 0)
    return [
      ...Array(full).fill(0).map((_, i) => <Ionicons key={`f${i}`} name="star" size={size} color={STAR} />),
      ...(half ? [<Ionicons key="h" name="star-half" size={size} color={STAR} />] : []),
      ...Array(empty).fill(0).map((_, i) => <Ionicons key={`e${i}`} name="star-outline" size={size} color={STAR} />),
    ]
  }

  const availClasses = (avail) =>
    avail === "Available" ? "bg-success" : avail === "Limited" ? "bg-warning" : "bg-danger"

  // ── Restaurant card ───────────────────────────────────────────────────────
  const renderRestaurantCard = ({ item }) => {
    const open    = isOpenNow(item.openingHours, now)
    const badge   = getBadge(item, open)
    const img     = Array.isArray(item.images) ? item.images[0] : null
    const fav     = favorites.has(item.id)
    const reviews = Number(item.reviews)
    const hasRating = item.rating !== undefined && item.rating !== null && item.rating !== ""

    return (
      <View className="px-4">
      <TouchableOpacity
        className="bg-surface rounded-[22px] mb-3.5 overflow-hidden"
        style={cardShadow}
        onPress={() => openRestaurantDetails(item)}
        activeOpacity={0.92}
      >
        {/* Image */}
        <View className="h-[150px] bg-teal-light justify-center items-center">
          {img ? (
            <Image source={{ uri: img }} className="w-full h-full" resizeMode="cover" />
          ) : (
            <MaterialCommunityIcons name={typeIcon(item.type)} size={34} color={TEAL} />
          )}

          {badge && (
            <View
              className="absolute top-2.5 left-2.5 flex-row items-center px-2.5 py-1 rounded-full"
              style={{ backgroundColor: badge.color }}
            >
              {badge.icon ? (
                <Ionicons name={badge.icon} size={11} color="#FFFFFF" style={{ marginRight: 4 }} />
              ) : (
                <View className="w-[6px] h-[6px] rounded-full bg-white mr-1.5" />
              )}
              <Text className="text-[11px] font-bold text-white">{badge.label}</Text>
            </View>
          )}

          <TouchableOpacity
            className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full justify-center items-center"
            style={{ backgroundColor: "rgba(20,33,61,0.55)" }}
            onPress={() => toggleFavorite(item.id)}
            accessibilityLabel={fav ? "Remove from favourites" : "Add to favourites"}
          >
            <Ionicons name={fav ? "heart" : "heart-outline"} size={16} color={fav ? "#EF4444" : "#FFFFFF"} />
          </TouchableOpacity>
        </View>

        {/* Body */}
        <View className="flex-row items-center px-3 pt-2.5 pb-3">
          <View className="flex-1 mr-2.5">
            <Text
              className="text-[15px] font-extrabold text-ink -tracking-[0.2px]"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {item.name}
            </Text>

            {!!item.location && (
              <View className="flex-row items-center mt-1">
                <Ionicons name="location-sharp" size={12} color={TEAL} />
                <Text className="text-[11.5px] text-ink-soft ml-1 flex-1" numberOfLines={1}>{item.location}</Text>
              </View>
            )}

            {hasRating && (
              <View className="flex-row items-center mt-1">
                {renderStars(item.rating, 12)}
                {!Number.isNaN(reviews) && item.reviews !== undefined && (
                  <Text className="text-[10.5px] text-muted ml-1" numberOfLines={1}>
                    ({reviews} {reviews === 1 ? "review" : "reviews"})
                  </Text>
                )}
              </View>
            )}
          </View>

          <View className="flex-row items-center">
            {!!item.openingHours && (
              <View
                className={`flex-row items-center px-2 py-1.5 rounded-full mr-1.5 ${open === false ? "bg-line" : "bg-teal-light"}`}
              >
                <Ionicons name="time-outline" size={12} color={open === false ? MUTED : TEAL} />
                <Text
                  className={`text-[10.5px] font-bold ml-1 ${open === false ? "text-muted" : "text-teal"}`}
                  numberOfLines={1}
                >
                  {item.openingHours}
                </Text>
              </View>
            )}
            <TouchableOpacity
              className="flex-row items-center bg-brand pl-3 pr-2.5 py-2 rounded-full"
              onPress={() => openRestaurantDetails(item)}
              activeOpacity={0.88}
            >
              <Text className="text-[11.5px] font-bold text-white mr-1">View Details</Text>
              <Ionicons name="arrow-forward" size={12} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
      </View>
    )
  }

  // ── Image Carousel (in modal) ──────────────────────────────────────────────
  const renderCarousel = () => {
    if (!selectedRestaurant) return null
    return (
      <View>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setCurrentImageIndex(Math.round(e.nativeEvent.contentOffset.x / width))}>
          {selectedRestaurant.images.map((img, i) => (
            <View key={i} className="relative">
              <Image source={{ uri: img }} style={{ width, height: 240 }} />
              <View className="absolute bottom-0 left-0 right-0 h-20 bg-black/30" />
            </View>
          ))}
        </ScrollView>
        <View className="flex-row justify-center py-2.5 gap-1.5">
          {selectedRestaurant.images.map((_, i) => (
            <View key={i} className={`h-1.5 rounded-full ${i === currentImageIndex ? "w-5 bg-brand" : "w-1.5 bg-line"}`} />
          ))}
        </View>
      </View>
    )
  }

  // ── States ─────────────────────────────────────────────────────────────────
  if (dataLoading && !refreshing && !allRestaurants.length) {
    return (
      <View className="flex-1 bg-bg justify-center items-center px-10">
        <View className="w-16 h-16 rounded-[22px] bg-teal-light justify-center items-center mb-3">
          <MaterialCommunityIcons name="silverware-fork-knife" size={26} color={TEAL} />
        </View>
        <ActivityIndicator size="large" color={BRAND} style={{ marginTop: 8 }} />
        <Text className="text-[15px] font-bold text-ink mt-3">Loading restaurants…</Text>
      </View>
    )
  }

  if (!allRestaurants.length) {
    return (
      <View className="flex-1 bg-bg justify-center items-center px-10">
        <View className="w-16 h-16 rounded-[22px] bg-teal-light justify-center items-center mb-3">
          <MaterialCommunityIcons name="silverware-fork-knife" size={26} color={TEAL} />
        </View>
        <Text className="text-[16px] font-bold text-ink text-center">No restaurants available</Text>
        <Text className="text-[13px] text-muted mt-1.5 text-center">Please check back soon</Text>
        <TouchableOpacity onPress={handleBack} className="mt-5 px-5 py-2.5 rounded-full bg-brand">
          <Text className="text-[13px] font-bold text-white">Go back</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // ── Hero ───────────────────────────────────────────────────────────────────
  const heroH = insets.top + HERO_BODY_H
  const imgW  = heroH * HERO_RATIO
  // Keep the cooling towers on the right-hand side of the hero.
  const imgLeft = Math.min(0, Math.max(winW - imgW, winW * 0.64 - imgW * 0.52))

  const roundBtn = "w-[34px] h-[34px] rounded-[12px] bg-surface justify-center items-center"

  const listHeader = (
    <View>
      {/* Hero */}
      <View style={{ height: heroH, overflow: "hidden", backgroundColor: "#CFE6F2" }}>
        <Image
          source={HERO_IMAGE}
          style={{ position: "absolute", top: 0, left: imgLeft, width: imgW, height: heroH }}
          resizeMode="cover"
        />
        <LinearGradient
          colors={["rgba(250,247,242,0.96)", "rgba(250,247,242,0.82)", "rgba(250,247,242,0)"]}
          locations={[0, 0.42, 0.78]}
          start={{ x: 0, y: 0.4 }}
          end={{ x: 1, y: 0.6 }}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          pointerEvents="none"
        />

        {/* Top buttons */}
        <View
          className="flex-row justify-between items-center px-4"
          style={{ position: "absolute", top: insets.top + 10, left: 0, right: 0 }}
        >
          <TouchableOpacity className={roundBtn} style={softShadow} onPress={handleBack} accessibilityLabel="Go back" activeOpacity={0.8}>
            <Ionicons name="arrow-back" size={17} color={TEAL} />
          </TouchableOpacity>
          <View className="flex-row items-center">
            <TouchableOpacity className={roundBtn} style={softShadow} accessibilityLabel="Notifications" activeOpacity={0.8}>
              <Ionicons name="notifications-outline" size={16} color={TEAL} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Title */}
        <View style={{ position: "absolute", left: 20, bottom: 36 }}>
          <Text className="text-[24px] font-extrabold text-ink -tracking-[0.5px]" style={{ lineHeight: 28 }}>
            Restaurants
          </Text>
          <View
            className="bg-brand rounded-full"
            style={{ width: 84, height: 3, marginTop: 1, transform: [{ rotate: "-1deg" }] }}
          />
          <Text className="text-[12px] font-medium text-ink mt-2" style={{ lineHeight: 16 }}>
            Discover great food{"\n"}in Soweto
          </Text>
        </View>
      </View>

      {/* Search bar — overlaps the hero */}
      <View className="px-4" style={{ marginTop: -24, zIndex: 5 }}>
        <View
          className="flex-row items-center bg-surface rounded-full pl-4 pr-3 h-[48px]"
          style={softShadow}
        >
          <Ionicons name="search" size={20} color={TEAL} style={{ marginRight: 10 }} />
          <TextInput
            ref={searchRef}
            value={query}
            onChangeText={setQuery}
            placeholder="Search restaurants, cuisine, etc…"
            placeholderTextColor="#8C999D"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            className="flex-1 text-[14px] text-ink"
            style={{ paddingVertical: 0 }}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} className="mr-2" accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={17} color="#B5BDBF" />
            </TouchableOpacity>
          )}
          <View className="w-px h-6 bg-line mx-3" />
          <TouchableOpacity
            onPress={() => { Keyboard.dismiss(); setFilterVisible(true) }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Filters"
            activeOpacity={0.8}
          >
            <Ionicons name="options-outline" size={22} color={TEAL} />
            {filtersActive && <View className="absolute -top-0.5 -right-0.5 w-[8px] h-[8px] rounded-full bg-brand border-[1.5px] border-surface" />}
          </TouchableOpacity>
        </View>
      </View>

      {/* Section header */}
      <View className="flex-row items-center justify-between px-4 mt-5 mb-2.5">
        <View className="flex-row items-center gap-2">
          <View className="w-[3px] h-[18px] rounded bg-brand" />
          <Text className="text-[16px] font-extrabold text-ink -tracking-[0.3px]">Eat & Drink</Text>
        </View>
        {activeTab === ALL && !query ? (
          <Text className="text-[12px] font-semibold text-muted">Showing all</Text>
        ) : (
          <TouchableOpacity
            className="flex-row items-center gap-0.5"
            onPress={() => { setQuery(""); setActiveTab(ALL) }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text className="text-[12px] font-bold text-brand underline">See All</Text>
            <Ionicons name="chevron-forward" size={13} color={BRAND} />
          </TouchableOpacity>
        )}
      </View>

      {/* Category chips — built from the types found in Firestore */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, flexShrink: 0 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12, paddingTop: 2 }}
      >
        {restaurantTypes.map((type) => {
          const isActive = activeTab === type && !query
          const content = (
            <>
              <MaterialCommunityIcons name={typeIcon(type)} size={19} color={isActive ? "#FFFFFF" : TEAL} />
              <Text className={`text-[10px] font-bold mt-0.5 ${isActive ? "text-white" : "text-ink"}`} numberOfLines={1}>
                {type}
              </Text>
              {isActive && <View className="bg-brand rounded-full mt-0.5" style={{ width: 20, height: 2 }} />}
            </>
          )
          return (
            <TouchableOpacity
              key={type}
              className="mr-2"
              activeOpacity={0.85}
              onPress={() => { setQuery(""); setActiveTab(type) }}
            >
              {isActive ? (
                <LinearGradient
                  colors={["#236477", "#123F4D"]}
                  start={{ x: 0.1, y: 0 }}
                  end={{ x: 0.9, y: 1 }}
                  style={[{ minWidth: 40, height: 50, borderRadius: 50, paddingHorizontal: 9, alignItems: "center", justifyContent: "center" }, softShadow]}
                >
                  {content}
                </LinearGradient>
              ) : (
                <View
                  style={{ minWidth: 40, height: 50, borderRadius: 50, paddingHorizontal: 9, alignItems: "center", justifyContent: "center", backgroundColor: "#f1ede62b" }}
                >
                  {content}
                </View>
              )}
            </TouchableOpacity>
          )
        })}
      </ScrollView>

      {(!!query.trim() || filtersActive) && (
        <Text className="text-[11.5px] text-muted font-medium px-4 mb-2">
          <Text className="font-extrabold text-ink">{visibleRestaurants.length}</Text>{" "}
          {visibleRestaurants.length === 1 ? "restaurant" : "restaurants"} found
        </Text>
      )}
    </View>
  )

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View className="flex-1 bg-bg">
      <OfflineIndicator />

      <AnimatedFlatList
        data={visibleRestaurants}
        renderItem={renderRestaurantCard}
        keyExtractor={(item) => item.id.toString()}
        ListHeaderComponent={listHeader}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[BRAND]} tintColor={BRAND} progressViewOffset={insets.top} />}
        ListEmptyComponent={() => (
          <View className="items-center py-12 px-10">
            <View className="w-16 h-16 rounded-[22px] bg-teal-light justify-center items-center mb-3">
              <MaterialCommunityIcons name="silverware-fork-knife" size={26} color={TEAL} />
            </View>
            <Text className="text-[15px] font-bold text-ink text-center">
              {query.trim() ? `No results for “${query.trim()}”` : "No restaurants match"}
            </Text>
            <Text className="text-[12px] text-muted mt-1.5 text-center">
              {filtersActive ? "Try removing some filters" : "Try a different category or pull to refresh"}
            </Text>
          </View>
        )}
        {...scrollProps}
      />

      {/* Filter sheet */}
      <Modal animationType="fade" transparent visible={filterVisible} onRequestClose={() => setFilterVisible(false)}>
        <Pressable className="flex-1 justify-end" style={{ backgroundColor: "rgba(20,33,61,0.45)" }} onPress={() => setFilterVisible(false)}>
          <Pressable
            className="bg-bg px-5 pt-3"
            style={{ borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: Math.max(insets.bottom, 16) + 8 }}
            onPress={() => {}}
          >
            <View className="self-center w-10 h-1 rounded-full bg-line mb-4" />
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-[16px] font-extrabold text-ink -tracking-[0.3px]">Filters</Text>
              <TouchableOpacity onPress={resetFilters} disabled={!filtersActive}>
                <Text className={`text-[12px] font-bold ${filtersActive ? "text-brand" : "text-muted"}`}>Reset</Text>
              </TouchableOpacity>
            </View>

            <Text className="text-[11px] font-extrabold text-muted uppercase tracking-wider mb-2">Sort by</Text>
            <View className="flex-row flex-wrap mb-3">
              <FilterChip label="Recommended"   active={filters.sort === "default"} onPress={() => setFilters(f => ({ ...f, sort: "default" }))} />
              <FilterChip label="Top rated"     active={filters.sort === "rating"}  onPress={() => setFilters(f => ({ ...f, sort: "rating" }))} />
              <FilterChip label="Most reviewed" active={filters.sort === "reviews"} onPress={() => setFilters(f => ({ ...f, sort: "reviews" }))} />
            </View>

            <Text className="text-[11px] font-extrabold text-muted uppercase tracking-wider mb-2">Minimum rating</Text>
            <View className="flex-row flex-wrap mb-3">
              <FilterChip label="Any"  active={filters.minRating === 0}   onPress={() => setFilters(f => ({ ...f, minRating: 0 }))} />
              <FilterChip label="4.0+" active={filters.minRating === 4}   onPress={() => setFilters(f => ({ ...f, minRating: 4 }))} />
              <FilterChip label="4.5+" active={filters.minRating === 4.5} onPress={() => setFilters(f => ({ ...f, minRating: 4.5 }))} />
            </View>

            <Text className="text-[11px] font-extrabold text-muted uppercase tracking-wider mb-2">Availability</Text>
            <View className="flex-row flex-wrap mb-4">
              <FilterChip label="Open now" active={filters.openNow} onPress={() => setFilters(f => ({ ...f, openNow: !f.openNow }))} />
            </View>

            <TouchableOpacity className="bg-brand rounded-full py-3 items-center" onPress={() => setFilterVisible(false)} activeOpacity={0.88}>
              <Text className="text-[14px] font-bold text-white">
                Show {visibleRestaurants.length} {visibleRestaurants.length === 1 ? "restaurant" : "restaurants"}
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Detail Modal */}
      <Modal animationType="slide" transparent={false} visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <View className="flex-1 bg-bg">
          <View className="absolute top-12 left-0 right-0 flex-row justify-between px-4 z-10">
            <TouchableOpacity className="w-10 h-10 rounded-2xl bg-black/35 justify-center items-center" onPress={() => setModalVisible(false)}>
              <Ionicons name="chevron-down" size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity className="w-10 h-10 rounded-2xl bg-black/35 justify-center items-center" onPress={() => toggleFavorite(selectedRestaurant?.id)}>
              <Ionicons
                name={favorites.has(selectedRestaurant?.id) ? "heart" : "heart-outline"}
                size={20}
                color={favorites.has(selectedRestaurant?.id) ? "#EF4444" : "#FFFFFF"}
              />
            </TouchableOpacity>
          </View>

          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            {renderCarousel()}

            {selectedRestaurant && (
              <View className="p-5">
                {/* Title row */}
                <View className="flex-row items-start mb-3">
                  <View className="flex-1">
                    <Text className="text-[20px] font-extrabold text-ink -tracking-tight mb-1">{selectedRestaurant.name}</Text>
                    <View className="flex-row items-center gap-1">
                      <Ionicons name="location-outline" size={13} color="#7A8A8F" />
                      <Text className="text-[13px] text-muted">{selectedRestaurant.location}</Text>
                    </View>
                  </View>
                  <View className={`px-2.5 py-1.5 rounded-full mt-1 ${availClasses(selectedRestaurant.availability)}`}>
                    <Text className="text-[11px] font-bold text-white">{selectedRestaurant.availability}</Text>
                  </View>
                </View>

                {/* Meta card */}
                <View className="flex-row items-center bg-surface rounded-2xl p-3.5 mb-3 border border-line">
                  <View className="flex-1 items-center gap-1.5">
                    <View className="w-9 h-9 rounded-xl bg-teal-light justify-center items-center">
                      <Ionicons name="restaurant-outline" size={16} color="#1B4D5C" />
                    </View>
                    <Text className="text-[11px] text-ink font-semibold text-center" numberOfLines={1}>{selectedRestaurant.cuisine}</Text>
                  </View>
                  <View className="w-px h-10 bg-line" />
                  <View className="flex-1 items-center gap-1.5">
                    <View className="w-9 h-9 rounded-xl bg-brand-light justify-center items-center">
                      <Ionicons name="time-outline" size={16} color="#E8600A" />
                    </View>
                    <Text className="text-[11px] text-ink font-semibold text-center" numberOfLines={1}>{selectedRestaurant.openingHours}</Text>
                  </View>
                  <View className="w-px h-10 bg-line" />
                  <View className="flex-1 items-center gap-1.5">
                    <View className="flex-row items-center gap-0.5">{renderStars(selectedRestaurant.rating, 12)}</View>
                    <Text className="text-[11px] text-ink font-semibold text-center">{selectedRestaurant.rating} ({selectedRestaurant.reviews})</Text>
                  </View>
                </View>

                {/* Tags */}
                {selectedRestaurant.tags?.length > 0 && (
                  <View className="mb-4">
                    <Text className="text-[11px] font-extrabold text-muted uppercase tracking-wider mb-2">Tags</Text>
                    <View className="flex-row flex-wrap gap-1.5">
                      {selectedRestaurant.tags.map((tag, i) => {
                        const t = TILE_THEMES[i % TILE_THEMES.length]
                        return (
                          <View key={i} className={`px-2.5 py-1 rounded-full ${t.bgClass}`}>
                            <Text className="text-[11px] font-bold" style={{ color: t.hex }}>{tag}</Text>
                          </View>
                        )
                      })}
                    </View>
                  </View>
                )}

                {/* Directions */}
                <TouchableOpacity
                  className="flex-row items-center justify-center gap-2 bg-teal-light py-2.5 rounded-2xl mb-4 border border-teal/20"
                  onPress={() => openDirections(selectedRestaurant.coordinates, selectedRestaurant.name)}
                >
                  <Ionicons name="navigate" size={15} color="#1B4D5C" />
                  <Text className="text-[13px] font-bold text-teal">Get Directions</Text>
                </TouchableOpacity>

                {/* Description */}
                <View className="mb-4">
                  <Text className="text-[11px] font-extrabold text-muted uppercase tracking-wider mb-2">About</Text>
                  <Text className="text-[14px] text-ink leading-5">{selectedRestaurant.description}</Text>
                </View>

                {/* Signature dishes */}
                {selectedRestaurant.specialDishes?.length > 0 && (
                  <View className="mb-4">
                    <Text className="text-[11px] font-extrabold text-muted uppercase tracking-wider mb-2">Signature Dishes</Text>
                    <View className="flex-row flex-wrap gap-2">
                      {selectedRestaurant.specialDishes.map((dish, i) => (
                        <View key={i} className={`flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-xl ${TILE_THEMES[i % TILE_THEMES.length].bgClass}`}>
                          <Ionicons name="restaurant" size={13} color="#E8600A" />
                          <Text className="text-[12px] text-ink font-medium">{dish}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Reserve button */}
                <TouchableOpacity
                  className="flex-row items-center justify-between bg-brand px-5 py-3 rounded-2xl"
                  onPress={() => openReservationForm(selectedRestaurant)}
                  activeOpacity={0.88}
                >
                  <Text className="text-[15px] font-bold text-surface -tracking-tight">Make a Reservation</Text>
                  <View className="w-8 h-8 rounded-xl bg-white/25 justify-center items-center">
                    <Ionicons name="arrow-forward" size={15} color="#FFFFFF" />
                  </View>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>

      <RestaurantReservationForm
        visible={reservationModalVisible}
        onClose={() => setReservationModalVisible(false)}
        restaurant={selectedRestaurant}
      />
    </View>
  )
}

export default Restaurants