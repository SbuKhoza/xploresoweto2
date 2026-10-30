import {
  Text, View, ScrollView, TextInput, TouchableOpacity,
  Image, Dimensions, Modal, FlatList, ActivityIndicator, Keyboard,
} from "react-native"
import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import { onAuthStateChanged } from "firebase/auth"
import { doc, getDoc, collection, getDocs } from "firebase/firestore"
import { auth, db } from "../Firebase/config"
import { useNavigation } from "@react-navigation/native"
import { useOfflineData } from "../hooks/useOfflineData"

dayjs.extend(relativeTime)

// ── Design tokens (mirror tailwind.config.js) ───────────────────────────────
const TEAL   = "#1B4D5C"
const BRAND  = "#E8600A"
const BG     = "#FAF7F2"
const MUTED  = "#7A8A8F"

// Soweto, Gauteng — used for the weather lookup
const SOWETO = { latitude: -26.2485, longitude: 27.854 }

// Soft card shadow shared by every card on the screen
const cardShadow = {
  shadowColor: TEAL,
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 12,
  elevation: 3,
}

// Maps each collection to a display label, icon, and nav destination
const SEARCH_COLLECTIONS = [
  { key: "accommodations", label: "Accommodation", icon: "bed-outline",      screen: "Accommodation" },
  { key: "attractions",    label: "Attraction",    icon: "map-outline",       screen: "Attraction"    },
  { key: "business",       label: "Business",      icon: "business-outline",  screen: "Business"      },
  { key: "healthcare",     label: "Healthcare",    icon: "medkit-outline",    screen: "Healthcare"    },
  { key: "emergency",      label: "Emergency",     icon: "call-outline",      screen: "Emergency"     },
  { key: "restaurants",    label: "Restaurant",    icon: "restaurant-outline",screen: "Restaurants"   },
  { key: "publicservice",  label: "Public Service",icon: "people-outline",    screen: "PublicService" },
  { key: "recreation",     label: "Recreation",    icon: "football-outline",  screen: "Recreation"    },
  { key: "transport",      label: "Transport",     icon: "bus-outline",       screen: "Transport"     },
  { key: "news",           label: "News",          icon: "newspaper-outline", screen: null            },
  { key: "homescreen",     label: "Township",      icon: "location-outline",  screen: null            },
]

// Fields to search across for each document
const SEARCH_FIELDS = ["name", "title", "description", "location", "category", "type", "cuisine"]

const QUICK_LINKS = [
  { id: "1", name: "Transport",   icon: "bus",        screen: "Transport"   },
  { id: "2", name: "Restaurants", icon: "restaurant", screen: "Restaurants" },
  { id: "3", name: "Attractions", icon: "map",        screen: "Attraction"  },
  { id: "4", name: "Emergency",   icon: "medical",    screen: "Emergency"   },
]

const FALLBACK_TOWNSHIPS = ["Dobsonville", "Emndeni", "Orlando", "Meadowlands", "Diepkloof", "Protea Glen"]
  .map((name, i) => ({ id: `t${i}`, name }))

// ── Placeholder content ─────────────────────────────────────────────────────
// Shown until the "news" / "events" Firestore collections have content, so the
// screen never looks empty (same approach as screens/News.js). Replace by adding
// documents to Firestore — no code change needed.
const buildFallbackStories = () => [
  { id: "s1", title: "What's happening in Soweto today?",             category: "Local News", source: "Latest community headlines", publishedAt: dayjs().subtract(10, "minute").toISOString(), localImage: require("../assets/home/story-towers.jpg") },
  { id: "s2", title: "Youth development initiatives making a difference", category: "Community",  source: "Community update",        publishedAt: dayjs().subtract(25, "minute").toISOString() },
  { id: "s3", title: "Discover what's new in local business",         category: "Business",   source: "Business news",             publishedAt: dayjs().subtract(1, "hour").toISOString() },
]

const nextOccurrence = (month, day) => {
  let d = dayjs().month(month).date(day).startOf("day")
  if (d.isBefore(dayjs().startOf("day"))) d = d.add(1, "year")
  return d.toISOString()
}
const buildFallbackEvents = () => [
  { id: "e1", title: "Soweto Cultural Festival", category: "Music & Culture", date: nextOccurrence(10, 15), time: "10:00", location: "Orlando, Soweto" },
  { id: "e2", title: "Community Football Day",   category: "Sports",          date: nextOccurrence(10, 22), time: "09:00", location: "Dobsonville, Soweto" },
]

// ── Small helpers ───────────────────────────────────────────────────────────
// Firestore Timestamps may arrive as Timestamp objects, {seconds}, ISO strings…
const toDate = (v) => {
  if (!v) return null
  if (typeof v.toDate === "function") return v.toDate()
  if (typeof v === "object" && (v.seconds ?? v._seconds) != null) return new Date((v.seconds ?? v._seconds) * 1000)
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

// Solid chips that sit on top of story images
const STORY_TAG = {
  "local news": "#1B4D5C",
  municipal:    "#1B4D5C",
  community:    "#22A559",
  business:     "#E8600A",
  events:       "#E8600A",
  safety:       "#DC3B3B",
}
const storyTagColor = (c = "") => STORY_TAG[c.toLowerCase()] || TEAL

const STORY_ICON = { community: "people", business: "storefront", safety: "shield-checkmark", events: "calendar" }
const storyIcon = (c = "") => STORY_ICON[c.toLowerCase()] || "newspaper"

// Soft chips used on event rows
const EVENT_TAG = {
  "music & culture": { bg: "#E6F6EC", fg: "#1E8E4E", icon: "musical-notes" },
  sports:            { bg: "#E3EEFF", fg: "#2563EB", icon: "football" },
  community:         { bg: "#FFF1E8", fg: "#C74E06", icon: "people" },
  business:          { bg: "#FFF1E8", fg: "#C74E06", icon: "storefront" },
}
const eventTag = (c = "") => EVENT_TAG[c.toLowerCase()] || { bg: "#E8F4F7", fg: TEAL, icon: "calendar" }

// Open-Meteo weather codes → label + icon kind
const describeWeather = (code, isDay) => {
  if (code === 0)  return { label: isDay ? "Sunny" : "Clear", kind: isDay ? "sun" : "moon" }
  if (code === 1)  return { label: "Mostly clear",  kind: "partly" }
  if (code === 2)  return { label: "Partly cloudy", kind: "partly" }
  if (code === 3)  return { label: "Overcast",      kind: "cloud" }
  if (code === 45 || code === 48) return { label: "Foggy", kind: "cloud" }
  if (code >= 51 && code <= 57)   return { label: "Drizzle", kind: "rain" }
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { label: "Rain", kind: "rain" }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: "Snow", kind: "snow" }
  if (code >= 95) return { label: "Thunderstorms", kind: "storm" }
  return { label: "Cloudy", kind: "cloud" }
}

const iconShadow = { textShadowColor: "rgba(27,77,92,0.22)", textShadowOffset: { width: 0, height: 3 }, textShadowRadius: 5 }

const WeatherIcon = ({ kind }) => (
  <View style={{ width: 76, height: 66 }}>
    {kind === "sun"   && <Ionicons name="sunny"  size={60} color="#FFB020" style={[{ position: "absolute", right: 4, top: 2 }, iconShadow]} />}
    {kind === "moon"  && <Ionicons name="moon"   size={56}  color="#F5C542" style={[{ position: "absolute", right: 8, top: 4 }, iconShadow]} />}
    {kind === "partly" && (
      <>
        <Ionicons name="sunny" size={46} color="#FFB020" style={[{ position: "absolute", left: 2, top: 0 }, iconShadow]} />
        <Ionicons name="cloud" size={54} color="#FFFFFF" style={[{ position: "absolute", right: 0, bottom: 0 }, iconShadow]} />
      </>
    )}
    {kind === "cloud" && <Ionicons name="cloud"        size={60} color="#FFFFFF" style={[{ position: "absolute", right: 4, top: 3 }, iconShadow]} />}
    {kind === "rain"  && <Ionicons name="rainy"        size={58} color="#5B8DB8" style={[{ position: "absolute", right: 4, top: 3 }, iconShadow]} />}
    {kind === "snow"  && <Ionicons name="snow"         size={58} color="#7FB2D9" style={[{ position: "absolute", right: 4, top: 3 }, iconShadow]} />}
    {kind === "storm" && <Ionicons name="thunderstorm" size={58} color="#5B6B8C" style={[{ position: "absolute", right: 4, top: 3 }, iconShadow]} />}
  </View>
)

// Image that quietly falls back to a gradient + icon if it fails to load
const CoverImage = ({ source, fallbackIcon = "image-outline", colors = ["#DCEBEF", "#EAF3F5"], style, iconSize = 24 }) => {
  const [failed, setFailed] = useState(false)
  if (!source || failed) {
    return (
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ justifyContent: "center", alignItems: "center" }, style]}>
        <Ionicons name={fallbackIcon} size={iconSize} color={TEAL} style={{ opacity: 0.55 }} />
      </LinearGradient>
    )
  }
  return <Image source={source} style={style} resizeMode="cover" onError={() => setFailed(true)} />
}

const SectionHeader = ({ title, icon, bar, onSeeAll, subtitle }) => (
  <View className="flex-row items-center justify-between mb-2.5">
    <View className="flex-row items-center flex-1 gap-2">
      {bar && <View className="w-[3px] h-[18px] rounded bg-brand" />}
      {icon && <Ionicons name={icon} size={17} color={BRAND} />}
      <View className="flex-1">
        <Text className="text-[16px] font-extrabold text-ink -tracking-[0.3px]" numberOfLines={1}>{title}</Text>
        {subtitle ? <Text className="text-[11.5px] text-muted mt-0.5">{subtitle}</Text> : null}
      </View>
    </View>
    {onSeeAll && (
      <TouchableOpacity className="flex-row items-center gap-0.5" onPress={onSeeAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text className="text-[12px] font-bold text-brand">See All</Text>
        <Ionicons name="chevron-forward" size={13} color={BRAND} />
      </TouchableOpacity>
    )}
  </View>
)

const Home = () => {
  const navigation    = useNavigation()
  const insets        = useSafeAreaInsets()
  const [userDisplayName, setUserDisplayName] = useState("User")
  const [loading, setLoading]                 = useState(true)
  const [featuredImage, setFeaturedImage]     = useState(null)
  const [townships, setTownships]             = useState([])
  const [dataLoading, setDataLoading]         = useState(true)
  const [screenData, setScreenData]           = useState(Dimensions.get("window"))
  const [storyIndex, setStoryIndex]           = useState(0)

  // ── Weather state ──
  const [weather, setWeather] = useState({ status: "loading" })

  // ── Search state ──
  const [searchQuery, setSearchQuery]         = useState("")
  const [searchVisible, setSearchVisible]     = useState(false)
  const [searchResults, setSearchResults]     = useState([])
  const [searchLoading, setSearchLoading]     = useState(false)
  const [searchCache, setSearchCache]         = useState(null) // all docs cached after first search
  const searchInputRef                        = useRef(null)
  const debounceTimer                         = useRef(null)

  // ── Top stories + events (Firestore with graceful fallback) ──
  const feedOptions = useMemo(() => ({ maxAgeMinutes: 20, enableBackgroundRefresh: true }), [])
  const { data: newsData }   = useOfflineData("news",   feedOptions)
  const { data: eventsData } = useOfflineData("events", feedOptions)

  const stories = useMemo(() => {
    const live = (newsData || []).filter(a => a.isActive !== false && a.title)
    const list = live.length > 0
      ? [...live].sort((a, b) => (toDate(b.publishedAt) || 0) - (toDate(a.publishedAt) || 0))
      : buildFallbackStories()
    return list.slice(0, 5)
  }, [newsData])

  const events = useMemo(() => {
    const today = dayjs().startOf("day")
    const normalise = (e) => ({ ...e, _date: toDate(e.date || e.startDate) })
    const live = (eventsData || []).filter(e => e.isActive !== false).map(normalise).filter(e => e._date && (e.title || e.name))
    const source = live.length > 0 ? live : buildFallbackEvents().map(normalise)
    return source
      .filter(e => !dayjs(e._date).isBefore(today))
      .sort((a, b) => a._date - b._date)
      .slice(0, 3)
  }, [eventsData])

  const goXploreItem = (screenName) => {
    try { navigation.navigate("Xplore", { screen: screenName }) }
    catch (e) { console.error(`Navigation error to ${screenName}:`, e) }
  }
  const goCommunity = (screenName) => {
    try { navigation.navigate("Community", screenName ? { screen: screenName } : undefined) }
    catch (e) { console.error("Navigation error to Community:", e) }
  }

  const getGreeting = () => {
    const h = new Date().getHours()
    if (h < 12) return "Good Morning"
    if (h < 17) return "Good Afternoon"
    return "Good Evening"
  }

  const fetchWeather = useCallback(async () => {
    setWeather(w => (w.status === "ready" ? w : { status: "loading" }))
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const url =
        "https://api.open-meteo.com/v1/forecast" +
        `?latitude=${SOWETO.latitude}&longitude=${SOWETO.longitude}` +
        "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day" +
        "&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=Africa%2FJohannesburg"
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) throw new Error(`Weather HTTP ${res.status}`)
      const json = await res.json()
      const c = json.current
      setWeather({
        status: "ready",
        temp:      Math.round(c.temperature_2m),
        feelsLike: Math.round(c.apparent_temperature),
        humidity:  Math.round(c.relative_humidity_2m),
        wind:      Math.round(c.wind_speed_10m),
        high:      Math.round(json.daily.temperature_2m_max[0]),
        low:       Math.round(json.daily.temperature_2m_min[0]),
        ...describeWeather(c.weather_code, c.is_day === 1),
      })
    } catch {
      setWeather(w => (w.status === "ready" ? w : { status: "error" }))
    } finally { clearTimeout(timeout) }
  }, [])

  const fetchHomescreenData = async () => {
    try {
      setDataLoading(true)
      const featuredSnap = await getDoc(doc(db, "homescreen", "featured"))
      let featuredImageData = null
      if (featuredSnap.exists()) {
        const d = featuredSnap.data()
        if (d.type === "featuredImage") featuredImageData = { id: featuredSnap.id, ...d }
      }
      const snapshot = await getDocs(collection(db, "homescreen"))
      const townshipsData = []
      snapshot.forEach(s => { const d = s.data(); if (d.type === "township") townshipsData.push({ id: s.id, ...d }) })
      setFeaturedImage(featuredImageData)
      setTownships(townshipsData)
    } catch {
      setFeaturedImage({ imageUrl: "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800&h=600&fit=crop", title: "The Ultimate Guide to Soweto" })
      setTownships(FALLBACK_TOWNSHIPS)
    } finally { setDataLoading(false) }
  }

  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) => setScreenData(window))
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const userDoc = await getDoc(doc(db, "users", user.uid))
          if (userDoc.exists()) {
            const d = userDoc.data()
            setUserDisplayName(d.username || d.name || user.email.split("@")[0])
          } else {
            setUserDisplayName(user.displayName || user.email.split("@")[0])
          }
        } catch { setUserDisplayName(user.displayName || user.email.split("@")[0]) }
      } else { setUserDisplayName("User") }
      setLoading(false)
    })
    fetchHomescreenData()
    fetchWeather()
    return () => { sub?.remove(); unsub() }
  }, [fetchWeather])

  // ── Search logic ─────────────────────────────────────────────────────────

  // Fetch and cache all searchable docs from Firestore
  const loadSearchCache = async () => {
    if (searchCache) return searchCache
    setSearchLoading(true)
    try {
      const all = []
      await Promise.all(
        SEARCH_COLLECTIONS.map(async (col) => {
          try {
            const snap = await getDocs(collection(db, col.key))
            snap.forEach(d => {
              const data = d.data()
              // Only include townships (type === "township") from homescreen
              if (col.key === "homescreen" && data.type !== "township") return
              all.push({
                id:         d.id,
                collection: col.key,
                label:      col.label,
                icon:       col.icon,
                screen:     col.screen,
                ...data,
              })
            })
          } catch { /* collection may not exist yet — skip quietly */ }
        })
      )
      setSearchCache(all)
      return all
    } finally { setSearchLoading(false) }
  }

  const runSearch = useCallback(async (query) => {
    const q = query.trim().toLowerCase()
    if (!q) { setSearchResults([]); return }

    setSearchLoading(true)
    try {
      const docs = await loadSearchCache()
      const results = docs.filter(item => {
        return SEARCH_FIELDS.some(field => {
          const val = item[field]
          return typeof val === "string" && val.toLowerCase().includes(q)
        })
      })
      setSearchResults(results)
    } finally { setSearchLoading(false) }
  }, [searchCache])

  const handleSearchChange = (text) => {
    setSearchQuery(text)
    clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => runSearch(text), 350)
  }

  const openSearch = () => {
    setSearchVisible(true)
    setTimeout(() => searchInputRef.current?.focus(), 100)
  }

  const closeSearch = () => {
    Keyboard.dismiss()
    setSearchVisible(false)
    setSearchQuery("")
    setSearchResults([])
  }

  const handleResultPress = (item) => {
    closeSearch()
    if (item.screen) {
      try { navigation.navigate("Xplore", { screen: item.screen }) }
      catch { navigation.navigate(item.screen) }
    }
  }

  // ── Search result item ───────────────────────────────────────────────────
  const SearchResult = ({ item, index }) => {
    const displayName = item.name || item.title || "Unnamed"
    const sub = item.location || item.category || item.type || item.cuisine || item.label

    return (
      <TouchableOpacity
        className={`flex-row items-center py-3 gap-3 ${index === 0 ? "" : "border-t border-line"}`}
        onPress={() => handleResultPress(item)} activeOpacity={0.75}>
        <View className="w-11 h-11 rounded-2xl justify-center items-center bg-teal-light">
          <Ionicons name={item.icon} size={20} color="#1B4D5C" />
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="text-[15px] font-bold text-ink" numberOfLines={1}>{displayName}</Text>
          {sub ? <Text className="text-xs text-muted" numberOfLines={1}>{sub}</Text> : null}
        </View>
        <View className="px-2.5 py-1 rounded-full bg-brand-light">
          <Text className="text-[10px] font-extrabold text-brand uppercase tracking-wide">{item.label}</Text>
        </View>
      </TouchableOpacity>
    )
  }

  // ── Derived layout values ────────────────────────────────────────────────
  const screenW    = screenData.width
  const STORY_W    = Math.min(Math.round(screenW * 0.66), 270)
  const STORY_GAP  = 12
  const townshipsToShow = (townships.length > 0 ? townships : FALLBACK_TOWNSHIPS).slice(0, 6)
  const townshipW  = (screenW - 44 - 16) / 3

  const handleStoryScroll = (e) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / (STORY_W + STORY_GAP))
    const clamped = Math.max(0, Math.min(idx, stories.length - 1))
    if (clamped !== storyIndex) setStoryIndex(clamped)
  }

  const openTownship = (name) => {
    setSearchVisible(true)
    handleSearchChange(name)
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <ScrollView className="flex-1 bg-bg" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 110 }}>

        {/* ── Hero: faded Orlando Towers backdrop, greeting, search ── */}
        <View className="relative px-[22px]" style={{ paddingTop: insets.top + 10 }}>
          <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: 235 }}>
            <Image source={require("../assets/home/hero-towers.png")} style={{ width: "100%", height: "100%", opacity: 0.5 }} resizeMode="cover" />
            <LinearGradient colors={["rgba(250,247,242,0.15)", "rgba(250,247,242,0.82)", BG]} locations={[0, 0.65, 1]} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
            <LinearGradient colors={["rgba(250,247,242,0.95)", "rgba(250, 247, 242, 0.71)"]} start={{ x: 0, y: 0 }} end={{ x: 0.75, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
          </View>

          <View className="flex-row justify-between items-start mb-4">
            <View className="flex-1">
              <Text className="text-[13px] text-ink font-medium mb-0.5">{getGreeting()} 👋</Text>
              <Text className="text-[19px] font-extrabold text-ink -tracking-[0.3px]" numberOfLines={1}>Aweh, {loading ? "User" : userDisplayName}!</Text>
              <Text className="text-[11.5px] text-muted font-medium mt-0.5">Soweto  •  Gauteng</Text>
            </View>
            <TouchableOpacity className="w-[42px] h-[42px] justify-center items-center rounded-full bg-surface" style={cardShadow} activeOpacity={0.8}>
              <Ionicons name="notifications-outline" size={20} color={TEAL} />
              <View className="absolute top-2.5 right-3 w-2 h-2 rounded-full bg-brand border-[1.5px] border-surface" />
            </TouchableOpacity>
          </View>

          {/* Search bar — tap to open modal */}
          <TouchableOpacity className="flex-row items-center pl-3.5 pr-1.5 h-[46px] bg-surface rounded-full" style={cardShadow} onPress={openSearch} activeOpacity={0.9}>
            <Ionicons name="search" size={17} color={MUTED} style={{ marginRight: 10 }} />
            <Text className="flex-1 text-[13.5px] text-[#9AA9AE]" numberOfLines={1}>Search places, events, etc.</Text>
            <View className="w-px h-5 bg-line mx-2" />
            <View className="w-[32px] h-[32px] rounded-xl bg-teal-light justify-center items-center">
              <Ionicons name="options-outline" size={16} color={TEAL} />
            </View>
          </TouchableOpacity>
        </View>

        {/* ── Weather card ── */}
        <View className="px-[22px] mt-3 mb-4">
          <LinearGradient colors={["#DDF1F8", "#CDE8F2"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ borderRadius: 16, padding: 11, borderWidth: 1, borderColor: "rgba(255,255,255,0.7)" }, cardShadow]}>
            {weather.status === "ready" ? (
              <>
                <View className="flex-row justify-between">
                  <View className="flex-1">
                    <Text className="text-[8.5px] font-bold text-ink tracking-[0.9px] uppercase mb-0.5">Today's Weather</Text>
                    <Text className="text-[14px] font-extrabold text-ink -tracking-[0.2px]">Soweto, Gauteng</Text>
                    <Text className="text-[10px] text-muted">{dayjs().format("dddd, D MMM YYYY")}</Text>
                    <View className="flex-row items-center">
                      <Text className="text-[38px] font-extrabold text-[#12495C] -tracking-[1px]" style={{ lineHeight: 44 }}>{weather.temp}°</Text>
                      <View className="ml-2.5 flex-1">
                        <Text className="text-[12px] font-bold text-ink" numberOfLines={1}>{weather.label}</Text>
                        <Text className="text-[10.5px] text-muted mt-0.5">Feels like {weather.feelsLike}°</Text>
                      </View>
                    </View>
                  </View>
                  <View className="justify-center -mr-1 -mt-1">
                    <WeatherIcon kind={weather.kind} />
                  </View>
                </View>

                <View className="h-px bg-[#B9D9E4] mt-1.5 mb-2.5" />

                <View className="flex-row items-center">
                  <View className="flex-1 flex-row items-center gap-2">
                    <Ionicons name="thermometer-outline" size={16} color={TEAL} />
                    <View>
                      <Text className="text-[9.5px] text-muted">High / Low</Text>
                      <Text className="text-[11.5px] font-extrabold text-ink">{weather.high}° / {weather.low}°</Text>
                    </View>
                  </View>
                  <View className="w-px h-6 bg-[#B9D9E4]" />
                  <View className="flex-1 flex-row items-center justify-center gap-2">
                    <MaterialCommunityIcons name="weather-windy" size={16} color={TEAL} />
                    <View>
                      <Text className="text-[9.5px] text-muted">Wind</Text>
                      <Text className="text-[11.5px] font-extrabold text-ink">{weather.wind} km/h</Text>
                    </View>
                  </View>
                  <View className="w-px h-6 bg-[#B9D9E4]" />
                  <View className="flex-1 flex-row items-center justify-end gap-2">
                    <Ionicons name="water-outline" size={16} color={TEAL} />
                    <View>
                      <Text className="text-[9.5px] text-muted">Humidity</Text>
                      <Text className="text-[11.5px] font-extrabold text-ink">{weather.humidity}%</Text>
                    </View>
                  </View>
                </View>
              </>
            ) : weather.status === "loading" ? (
              <View className="h-[84px] justify-center items-center">
                <ActivityIndicator color={TEAL} />
                <Text className="text-[12px] text-muted mt-2">Loading Soweto weather…</Text>
              </View>
            ) : (
              <TouchableOpacity className="h-[84px] justify-center items-center" onPress={fetchWeather} activeOpacity={0.8}>
                <Ionicons name="cloud-offline-outline" size={30} color={TEAL} />
                <Text className="text-[13.5px] font-bold text-ink mt-2">Weather unavailable</Text>
                <Text className="text-[12px] text-muted mt-0.5">Tap to try again</Text>
              </TouchableOpacity>
            )}
          </LinearGradient>
        </View>

        {/* ── Quick Access ── */}
        <View className="px-[22px] mb-6">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-[11px] font-extrabold text-[#12495C] tracking-[1.4px] uppercase">Quick Access</Text>
            <TouchableOpacity className="flex-row items-center gap-0.5" onPress={() => navigation.navigate("Xplore", { screen: "XploreMain" })} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text className="text-[12px] font-bold text-brand">See All</Text>
              <Ionicons name="chevron-forward" size={13} color={BRAND} />
            </TouchableOpacity>
          </View>
          <View className="flex-row">
            {QUICK_LINKS.map((link, i) => (
              <TouchableOpacity
                key={link.id}
                className="flex-1 items-center"
                style={{ borderRightWidth: i < QUICK_LINKS.length - 1 ? 1 : 0, borderColor: "#E8E1D6" }}
                onPress={() => goXploreItem(link.screen)}
                activeOpacity={0.75}
              >
                <View className="w-12 h-12 rounded-[18px] justify-center items-center mb-2 bg-teal" style={cardShadow}>
                  <Ionicons name={link.icon} size={22} color="#FFFFFF" />
                </View>
                <Text className="text-[11px] text-ink text-center font-bold -tracking-[0.1px]" numberOfLines={1}>{link.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Top Stories ── */}
        <View className="mb-5">
          <View className="px-[22px]">
            <SectionHeader title="Top Stories" bar onSeeAll={() => goCommunity("News")} />
          </View>
          <FlatList
            data={stories}
            horizontal
            keyExtractor={(item) => String(item.id)}
            showsHorizontalScrollIndicator={false}
            snapToInterval={STORY_W + STORY_GAP}
            snapToAlignment="start"
            decelerationRate="fast"
            contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 6 }}
            onScroll={handleStoryScroll}
            scrollEventThrottle={32}
            renderItem={({ item }) => {
              const tagColor = storyTagColor(item.category)
              const src = item.imageUrl ? { uri: item.imageUrl } : item.localImage
              const when = toDate(item.publishedAt)
              return (
                <TouchableOpacity activeOpacity={0.9} onPress={() => goCommunity("News")} style={[{ width: STORY_W, marginRight: STORY_GAP, borderRadius: 16, backgroundColor: "#fff" }, cardShadow]}>
                  <View style={{ borderRadius: 16, overflow: "hidden" }}>
                    <View style={{ height: 92 }}>
                      <CoverImage source={src} fallbackIcon={storyIcon(item.category)} iconSize={28} style={{ width: "100%", height: "100%" }} />
                    </View>
                    <View className="px-3 pt-5 pb-3">
                      <Text className="text-[13px] font-extrabold text-ink leading-[17px]" numberOfLines={2}>{item.title}</Text>
                      <Text className="text-[10.5px] text-muted mt-1" numberOfLines={1}>
                        {[item.source, when ? dayjs(when).fromNow() : null].filter(Boolean).join("  ·  ")}
                      </Text>
                    </View>
                  </View>
                  <View style={{ position: "absolute", top: 92 - 10, left: 10, backgroundColor: tagColor, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 }}>
                    <Text className="text-[9px] font-extrabold text-white uppercase tracking-[0.5px]">{item.category || "News"}</Text>
                  </View>
                </TouchableOpacity>
              )
            }}
          />
          {stories.length > 1 && (
            <View className="flex-row justify-center items-center gap-1.5 mt-2.5">
              {stories.map((s, i) => (
                <View key={s.id} style={{ width: i === storyIndex ? 14 : 6, height: 6, borderRadius: 3, backgroundColor: i === storyIndex ? TEAL : "#D5D9D9" }} />
              ))}
            </View>
          )}
        </View>

        {/* ── Upcoming Events ── */}
        {events.length > 0 && (
          <View className="px-[22px] mb-4">
            <SectionHeader title="Upcoming Events" icon="calendar-outline" onSeeAll={() => goCommunity()} />
            {events.map((e) => {
              const tag  = eventTag(e.category)
              const d    = dayjs(e._date)
              const time = e.time || ((d.hour() || d.minute()) ? d.format("HH:mm") : null)
              return (
                <TouchableOpacity key={e.id} activeOpacity={0.85} onPress={() => goCommunity()}
                  className="flex-row items-center bg-surface rounded-2xl p-1.5 mb-2.5 gap-2.5" style={cardShadow}>
                  <CoverImage
                    source={e.imageUrl ? { uri: e.imageUrl } : null}
                    fallbackIcon={tag.icon}
                    colors={[tag.bg, "#FFFFFF"]}
                    style={{ width: 70, height: 60, borderRadius: 12 }}
                  />
                  <View className="w-[38px] h-[46px] rounded-[10px] bg-teal-light justify-center items-center">
                    <Text className="text-[16px] font-extrabold text-[#12495C]" style={{ lineHeight: 18 }}>{d.format("D")}</Text>
                    <Text className="text-[9.5px] font-bold text-[#12495C] uppercase">{d.format("MMM")}</Text>
                  </View>
                  <View className="flex-1">
                    {e.category ? (
                      <View className="self-start px-1.5 py-px rounded-full mb-0.5" style={{ backgroundColor: tag.bg }}>
                        <Text className="text-[8.5px] font-extrabold uppercase tracking-[0.4px]" style={{ color: tag.fg }}>{e.category}</Text>
                      </View>
                    ) : null}
                    <Text className="text-[13px] font-extrabold text-ink -tracking-[0.2px]" numberOfLines={1}>{e.title || e.name}</Text>
                    <View className="flex-row items-center mt-1">
                      <Ionicons name="location-outline" size={11} color={TEAL} />
                      <Text className="text-[11px] text-muted ml-1 flex-1" numberOfLines={1}>
                        {[time, e.location].filter(Boolean).join("  ·  ")}
                      </Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={15} color="#9AA9AE" style={{ marginRight: 4 }} />
                </TouchableOpacity>
              )
            })}
          </View>
        )}

        {/* ── Community Announcements ── */}
        <View className="px-[22px] mb-5">
          <TouchableOpacity
            activeOpacity={0.88}
            onPress={() => goCommunity()}
            className="flex-row items-center rounded-2xl px-3 py-3 gap-3"
            style={{ backgroundColor: "#FFF1E4", borderWidth: 1, borderColor: "#F8D9BC" }}
          >
            <Ionicons name="megaphone" size={30} color={BRAND} />
            <View className="flex-1">
              <View className="flex-row items-center justify-between mb-1">
                <Text className="text-[13.5px] font-extrabold text-[#8A3D05] flex-1" numberOfLines={1}>Community Announcements</Text>
                <View className="px-2 py-0.5 rounded-full bg-[#1E9E55] ml-2">
                  <Text className="text-[9px] font-bold text-white">Local updates</Text>
                </View>
              </View>
              <Text className="text-[11px] text-[#6B5B4B] leading-[15px]">Stay informed with the latest notices, opportunities and important information.</Text>
            </View>
            <Ionicons name="chevron-forward" size={15} color="#8A6B50" />
          </TouchableOpacity>
        </View>

        {/* ── The Ultimate Guide to Soweto ── */}
        <View className="px-[22px] mb-5">
          <SectionHeader icon="book-outline" title={featuredImage?.title || "The Ultimate Guide to Soweto"} subtitle="Discover places, people and experiences." />
          <TouchableOpacity activeOpacity={0.9} onPress={() => navigation.navigate("Xplore", { screen: "XploreMain" })}
            className="rounded-2xl bg-surface" style={cardShadow}>
            <View style={{ height: 92, borderRadius: 16, overflow: "hidden" }}>
              {dataLoading ? (
                <View className="w-full h-full bg-[#EDE8E2] justify-center items-center">
                  <Ionicons name="image-outline" size={28} color="#C8CBD8" />
                </View>
              ) : (
                <CoverImage
                  source={featuredImage?.imageUrl ? { uri: featuredImage.imageUrl } : require("../assets/Soweto1.png")}
                  fallbackIcon="map-outline"
                  style={{ width: "100%", height: "100%" }}
                />
              )}
            </View>
          </TouchableOpacity>
        </View>

        {/* ── Soweto Townships ── */}
        <View className="px-[22px]">
          <SectionHeader title="Soweto Townships" onSeeAll={() => navigation.navigate("Xplore", { screen: "XploreMain" })} />
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {dataLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <View key={i} className="h-[38px] rounded-xl bg-[#EDE8E2]" style={{ width: townshipW }} />
                ))
              : townshipsToShow.map((t) => (
                  <TouchableOpacity key={t.id} activeOpacity={0.85} onPress={() => openTownship(t.name)}
                    className="h-[38px] rounded-xl bg-surface flex-row items-center px-2 border border-line"
                    style={{ width: townshipW }}>
                    <Ionicons name="location" size={13} color={TEAL} />
                    <Text className="flex-1 text-[11px] font-bold text-[#12495C] ml-1" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{t.name}</Text>
                    <Ionicons name="chevron-forward" size={12} color="#9AA9AE" />
                  </TouchableOpacity>
                ))}
          </View>
        </View>
      </ScrollView>

      {/* ── Search Modal ── */}
      <Modal visible={searchVisible} animationType="slide" transparent={false} onRequestClose={closeSearch}>
        <View className="flex-1 bg-bg pt-[50px]">

          {/* Modal header */}
          <View className="flex-row items-center px-4 pb-3.5 gap-2.5">
            <View className="flex-1 flex-row items-center h-12 bg-surface rounded-2xl px-3.5 border-[1.5px] border-[#C8DFE6] gap-2">
              <Ionicons name="search" size={17} color="#7A8A8F" />
              <TextInput
                ref={searchInputRef}
                className="flex-1 text-[15px] text-ink"
                value={searchQuery}
                onChangeText={handleSearchChange}
                placeholder="Search places, events, etc."
                placeholderTextColor="#B0BFC4"
                returnKeyType="search"
                autoCorrect={false}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => { setSearchQuery(""); setSearchResults([]) }} hitSlop={{ top:8,bottom:8,left:8,right:8 }}>
                  <Ionicons name="close-circle" size={18} color="#7A8A8F" />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity className="py-2 px-1" onPress={closeSearch}>
              <Text className="text-[15px] font-bold text-brand">Cancel</Text>
            </TouchableOpacity>
          </View>

          {/* Category chips — tap to pre-fill */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12, gap: 8 }}>
            {SEARCH_COLLECTIONS.map(col => (
              <TouchableOpacity key={col.key} className="flex-row items-center gap-1.5 h-10 px-3 py-1.5 rounded-full bg-surface border border-[#C8DFE6]"
                onPress={() => handleSearchChange(col.label)} activeOpacity={0.8}>
                <Ionicons name={col.icon} size={13} color="#1B4D5C" />
                <Text className="text-xs font-bold text-ink">{col.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Divider */}
          <View className="h-px bg-[#E8DDD5] mx-4 mb-1" />

          {/* Results */}
          {searchLoading ? (
            <View className="flex-1 justify-center items-center px-10 pb-20">
              <ActivityIndicator size="large" color="#E8600A" />
              <Text className="text-sm text-muted text-center leading-[21px] mt-2">Searching…</Text>
            </View>
          ) : searchQuery.length === 0 ? (
            <View className="flex-1 justify-center items-center px-10 pb-20">
              <View className="w-20 h-20 rounded-3xl bg-teal-light justify-center items-center mb-4">
                <Ionicons name="search-outline" size={36} color="#1B4D5C" />
              </View>
              <Text className="text-lg font-extrabold text-ink mb-1.5 text-center">Find anything in Soweto</Text>
              <Text className="text-sm text-muted text-center leading-[21px]">Restaurants, attractions, healthcare, services and more</Text>
            </View>
          ) : searchResults.length === 0 ? (
            <View className="flex-1 justify-center items-center px-10 pb-20">
              <View className="w-20 h-20 rounded-3xl bg-teal-light justify-center items-center mb-4">
                <Ionicons name="sad-outline" size={36} color="#1B4D5C" />
              </View>
              <Text className="text-lg font-extrabold text-ink mb-1.5 text-center">No results for "{searchQuery}"</Text>
              <Text className="text-sm text-muted text-center leading-[21px]">Try a different keyword or browse categories above</Text>
            </View>
          ) : (
            <>
              <Text className="text-sm text-muted px-5 py-2.5">
                <Text className="font-extrabold text-ink">{searchResults.length}</Text>
                {" "}result{searchResults.length !== 1 ? "s" : ""} for "{searchQuery}"
              </Text>
              <FlatList
                data={searchResults}
                keyExtractor={(item, i) => `${item.collection}-${item.id}-${i}`}
                renderItem={({ item, index }) => <SearchResult item={item} index={index} />}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              />
            </>
          )}
        </View>
      </Modal>
    </>
  )
}

export default Home