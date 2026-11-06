import {
  Text, View, ScrollView, TextInput, TouchableOpacity,
  Image, Dimensions, Modal, FlatList, ActivityIndicator, Keyboard,
  Animated, Easing,
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
import { useNavigation, CommonActions } from "@react-navigation/native"
import { useOfflineData } from "../hooks/useOfflineData"

dayjs.extend(relativeTime)

// ── Design tokens (mirror tailwind.config.js) ───────────────────────────────
const TEAL   = "#1B4D5C"
const BRAND  = "#E8600A"
const BG     = "#F5F7FA"
const MUTED  = "#7A8A8F"

// Horizontal page margin shared by every section on Home
const PAD = 16

// Soweto, Gauteng — used for the weather lookup
const SOWETO = { latitude: -26.2485, longitude: 27.854 }

// Soft card shadow shared by every card on the screen
const cardShadow = {
  shadowColor: "#2B5FA8",
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.16,
  shadowRadius: 16,
  elevation: 5,
}

// ═════════════════════════════════════════════════════════════════════════════
// ★ WEATHER WIDGET — PLAY WITH THESE ★
// The weather card on Home (search for "WEATHER CARD" further down) reads all
// of its colours from this block.
//   WEATHER_GRADIENT   – card colours, top-left → bottom-right. The last number
//                        in each rgba() is opacity: 1 = solid, lower = see-through.
//   WEATHER_GRADIENT_LOCATIONS – where each colour sits (0 = start, 1 = end)
//   WEATHER_BORDER     – outline of the card
//   WEATHER_GLOSS      – glassy highlight laid over the top of the card
//   weatherShadow      – coloured glow under the card (raise shadowOpacity for more)
// ═════════════════════════════════════════════════════════════════════════════
const WEATHER_GRADIENT = ["rgba(3, 58, 67, 0.79)", "rgba(3, 54, 80, 0.83)", "rgba(9, 23, 51, 0.74)"]
const WEATHER_GRADIENT_LOCATIONS = [0, 0.5, 1]
const WEATHER_BORDER = "rgba(255,255,255,0.45)"
const WEATHER_GLOSS = ["rgba(255,255,255,0.30)", "rgba(255,255,255,0)"]
const weatherShadow = {
  shadowColor: "#0A6EA0",
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.35,
  shadowRadius: 14,
  elevation: 6,
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
  { id: "s1", title: "What's happening in Soweto today?",             category: "Local News", source: "Latest community headlines", publishedAt: dayjs().subtract(10, "minute").toISOString(), localImage: require("../assets/home/news.png") },
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

// Events may store their picture under a few different field names
const eventImage = (e) => {
  const url = e.imageUrl || e.image || e.photo || e.thumbnail || e.coverImage
  return typeof url === "string" && url.trim() ? { uri: url.trim() } : null
}
const EVENT_FALLBACK_IMAGE = require("../assets/home/events.png")

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

// ── Weather illustration ────────────────────────────────────────────────────
// Built from plain Views (no extra native deps): a sun with rays, a layered
// white cloud, rain / snow / lightning variants. All motion is native-driven
// and deliberately subtle — slow-turning rays, a breathing glow, a floating cloud.
const useAnimLoop = (mode, duration) => {
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const step = (toValue) =>
      Animated.timing(v, { toValue, duration, easing: mode === "spin" ? Easing.linear : Easing.inOut(Easing.sin), useNativeDriver: true })
    const loop = Animated.loop(mode === "spin" ? step(1) : Animated.sequence([step(1), step(0)]))
    loop.start()
    return () => loop.stop()
  }, [v, mode, duration])
  return v
}

const SUN_RAYS = Array.from({ length: 12 }, (_, i) => i * 30)

const Sun = () => {
  const spin   = useAnimLoop("spin", 28000)
  const pulse  = useAnimLoop("float", 2400)
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] })
  const glow   = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] })
  return (
    <View style={{ width: 66, height: 66, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{ position: "absolute", width: 54, height: 54, borderRadius: 27, backgroundColor: "rgba(255,196,60,0.30)", transform: [{ scale: glow }] }} />
      <Animated.View style={{ position: "absolute", width: 66, height: 66, transform: [{ rotate }] }}>
        {SUN_RAYS.map((deg) => (
          <View key={deg} style={{ position: "absolute", width: 66, height: 66, alignItems: "center", transform: [{ rotate: `${deg}deg` }] }}>
            <View style={{ width: 4.5, height: 10, borderRadius: 3, backgroundColor: "#FFC933" }} />
          </View>
        ))}
      </Animated.View>
      <LinearGradient colors={["#FFE46B", "#FFA726"]} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={{ width: 36, height: 36, borderRadius: 18 }} />
    </View>
  )
}

// Cloud drawn twice (a soft shade copy underneath, white on top) for a bit of depth
const Cloud = ({ fill = "#FFFFFF", shade = "#B9D6E2" }) => {
  const puffs = (c, dy) => (
    <>
      <View style={{ position: "absolute", left: 0,  top: 16 + dy, width: 68, height: 24, borderRadius: 12,   backgroundColor: c }} />
      <View style={{ position: "absolute", left: 5,  top: 8 + dy,  width: 24, height: 24, borderRadius: 12,   backgroundColor: c }} />
      <View style={{ position: "absolute", left: 21, top: dy,      width: 33, height: 33, borderRadius: 16.5, backgroundColor: c }} />
      <View style={{ position: "absolute", left: 42, top: 10 + dy, width: 24, height: 24, borderRadius: 12,   backgroundColor: c }} />
    </>
  )
  return <View style={{ width: 68, height: 44 }}>{puffs(shade, 3)}{puffs(fill, 0)}</View>
}

// Falling rain drop / snow flake
const Drop = ({ left, delay = 0, flake }) => {
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration: flake ? 1600 : 900, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [v, delay, flake])
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [0, flake ? 12 : 14] })
  const opacity    = v.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 1, 1, 0] })
  return (
    <Animated.View style={{
      position: "absolute", left, top: 0, opacity, transform: [{ translateY }, { rotate: flake ? "0deg" : "18deg" }],
      width: flake ? 6 : 3.5, height: flake ? 6 : 10, borderRadius: 5,
      backgroundColor: flake ? "#FFFFFF" : "#7CC8F2",
    }} />
  )
}

const WeatherIcon = ({ kind }) => {
  const float = useAnimLoop("float", 3000)
  const bob   = float.interpolate({ inputRange: [0, 1], outputRange: [0, -3] })
  const drift = float.interpolate({ inputRange: [0, 1], outputRange: [0, 2.5] })
  const cloudMove = { transform: [{ translateY: bob }, { translateX: drift }] }

  let art = null
  if (kind === "partly") {
    art = (
      <>
        <View style={{ position: "absolute", left: 0, top: 0 }}><Sun /></View>
        <Animated.View style={[{ position: "absolute", left: 28, top: 34 }, cloudMove]}><Cloud /></Animated.View>
      </>
    )
  } else if (kind === "sun") {
    art = <View style={{ position: "absolute", left: 15, top: 6, transform: [{ scale: 1.15 }] }}><Sun /></View>
  } else if (kind === "moon") {
    art = (
      <Animated.View style={{ position: "absolute", left: 22, top: 10, width: 52, height: 52, alignItems: "center", justifyContent: "center", transform: [{ translateY: bob }] }}>
        <View style={{ position: "absolute", width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(255,226,120,0.22)" }} />
        <Ionicons name="moon" size={40} color="#FFE27A" />
      </Animated.View>
    )
  } else if (kind === "cloud") {
    art = <Animated.View style={[{ position: "absolute", left: 14, top: 16, transform: [{ scale: 1.2 }] }, cloudMove]}><Cloud /></Animated.View>
  } else {
    // rain / snow / storm — slightly greyer cloud with something falling from it
    const dark = kind === "storm"
    art = (
      <>
        <Animated.View style={[{ position: "absolute", left: 14, top: 4 }, cloudMove]}>
          <Cloud fill={dark ? "#C9D3E3" : "#EEF4F8"} shade={dark ? "#7E8FB0" : "#A9C4D3"} />
        </Animated.View>
        <View style={{ position: "absolute", left: 14, top: 50, width: 68, height: 26 }}>
          {kind === "rain" && [14, 30, 46].map((l, i) => <Drop key={l} left={l} delay={i * 280} />)}
          {kind === "snow" && [12, 31, 50].map((l, i) => <Drop key={l} left={l} delay={i * 450} flake />)}
          {kind === "storm" && <Ionicons name="flash" size={28} color="#FFD23F" style={{ position: "absolute", left: 22, top: -4 }} />}
        </View>
      </>
    )
  }

  // 96×78 artboard scaled down into an 80×68 slot so the card stays compact
  return (
    <View style={{ width: 80, height: 68 }}>
      <View style={{ position: "absolute", left: -8, top: -5, width: 96, height: 78, transform: [{ scale: 0.84 }] }}>{art}</View>
    </View>
  )
}

const WeatherStat = ({ icon, label, value }) => (
  <View style={{ flex: 1, alignItems: "center" }}>
    <MaterialCommunityIcons name={icon} size={20} color="#FFFFFF" />
    <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.82)", marginTop: 1 }}>{label}</Text>
    <Text style={{ fontSize: 14.5, fontWeight: "800", color: "#FFFFFF" }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{value}</Text>
  </View>
)

const WEATHER_DIVIDER = { width: 1, height: 54, backgroundColor: "rgba(255,255,255,0.28)" }

// Image that quietly falls back to a gradient + icon if it fails to load
const CoverImage = ({ source, fallbackSource, fallbackIcon = "image-outline", colors = ["#DCEBEF", "#EAF3F5"], style, iconSize = 24 }) => {
  const [failed, setFailed] = useState(false)
  const [fallbackFailed, setFallbackFailed] = useState(false)
  // Primary image missing or broken → show the bundled fallback image, if one was given
  if ((!source || failed) && fallbackSource && !fallbackFailed) {
    return <Image source={fallbackSource} style={style} resizeMode="cover" onError={() => setFallbackFailed(true)} />
  }
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
  const [eventIndex, setEventIndex]           = useState(0)

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

  // Opens `screenName` inside another tab's stack so that "back" returns to Home.
  // The tab's nested stack stays mounted after the first visit, so a plain
  // navigate() would push on top of whatever was opened last (e.g. Restaurants).
  // Resetting that stack to just the target screen avoids this.
  const openInTab = (tabName, screenName) => {
    try {
      const tabRoute = navigation.getState()?.routes?.find(r => r.name === tabName)
      const stackKey = tabRoute?.state?.key // undefined until the tab has been visited
      if (stackKey) {
        navigation.dispatch({
          ...CommonActions.reset({ index: 0, routes: [{ name: screenName }] }),
          target: stackKey,
        })
      }
      // `from: "Home"` lets the shared Header send the back button straight to Home.
      navigation.navigate(tabName, { screen: screenName, params: { from: "Home" } })
    } catch (e) {
      console.error(`Navigation error to ${tabName}/${screenName}:`, e)
    }
  }

  const goXploreItem = (screenName) => openInTab("Xplore", screenName)
  const goCommunity  = (screenName) => openInTab("Community", screenName || "CommunityMain")

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
      goXploreItem(item.screen)
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
  const HERO_H     = insets.top + 215                 // backdrop runs behind the whole (glass) weather card
  const HERO_SHIFT = Math.round(screenW * 0)         // nudge the artwork to the right
  const STORY_W    = Math.min(Math.round(screenW * 0.66), 270)
  const STORY_GAP  = 12
  const EVENT_W    = screenW - PAD * 2               // one event card per screen
  const EVENT_GAP  = 12
  const townshipsToShow = (townships.length > 0 ? townships : FALLBACK_TOWNSHIPS).slice(0, 6)
  const townshipW  = (screenW - PAD * 2 - 16) / 3

  const handleStoryScroll = (e) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / (STORY_W + STORY_GAP))
    const clamped = Math.max(0, Math.min(idx, stories.length - 1))
    if (clamped !== storyIndex) setStoryIndex(clamped)
  }

  const handleEventScroll = (e) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / (EVENT_W + EVENT_GAP))
    const clamped = Math.max(0, Math.min(idx, events.length - 1))
    if (clamped !== eventIndex) setEventIndex(clamped)
  }

  const openTownship = (name) => {
    setSearchVisible(true)
    handleSearchChange(name)
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 110 }}>

        {/* ── Hero: Orlando Towers backdrop, greeting, weather, search ── */}
        <View style={{ paddingTop: insets.top + 10 }}>
          {/* Backdrop — shifted right so the towers sit on the right-hand side */}
          <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: HERO_H, overflow: "hidden" }}>
            <Image
              source={require("../assets/home/hero-towers.png")}
              style={{ position: "absolute", top: 0, left: HERO_SHIFT, width: screenW, height: HERO_H, opacity: 0.92 }}
              resizeMode="cover"
            />
            {/* fade the left so the greeting stays readable */}
            <LinearGradient colors={["rgba(245,247,250,0.65)", "rgba(245,247,250,0.55)", "rgba(255,255,255,0)"]} locations={[0, 0.4, 0.75]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
            {/* fade the bottom into the page background */}
            <LinearGradient colors={["rgba(245,247,250,0)", "rgba(245,247,250,0.95)"]} locations={[0.7, 1]} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
          </View>

          {/* Greeting + bell */}
          <View className="flex-row justify-between items-start" style={{ paddingHorizontal: PAD + 4 }}>
            <View className="flex-1">
              {/* <Text className="text-[15px] text-ink font-medium mb-0.5">{getGreeting()} 👋</Text> */}
              <Text className="text-[18px] font-extrabold text-ink -tracking-[0.4px]" numberOfLines={1}>👋Aweh, {loading ? "User" : userDisplayName}!</Text>
              <View style={{ width: 62, height: 3, borderRadius: 2, backgroundColor: BRAND, marginTop: 1, marginBottom: 5 }} />
              <View className="flex-row items-center">
                <Ionicons name="location" size={13} color="#14213D" />
                <Text className="text-[12px] text-ink font-medium ml-1">Soweto, Gauteng</Text>
              </View>
            </View>
            <TouchableOpacity className="w-[34px] h-[34px] justify-center items-center rounded-[12px] bg-surface" style={cardShadow} activeOpacity={0.8}>
              <Ionicons name="notifications-outline" size={16} color={TEAL} />
              <View className="absolute top-[7px] right-[8px] w-[7px] h-[7px] rounded-full bg-brand border-[1.5px] border-surface" />
            </TouchableOpacity>
          </View>

          {/* ═══ WEATHER CARD — colours come from the "WEATHER WIDGET" block at the top of this file ═══ */}
          <View style={{ paddingHorizontal: PAD, marginTop: 14 }}>
            <LinearGradient
              colors={WEATHER_GRADIENT}
              locations={WEATHER_GRADIENT_LOCATIONS}
              start={{ x: 0, y: 0.2 }} end={{ x: 1, y: 0.8 }}
              style={[{ borderRadius: 24, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: WEATHER_BORDER, minHeight: 92, justifyContent: "center" }, weatherShadow]}
            >
              <LinearGradient
                pointerEvents="none"
                colors={WEATHER_GLOSS}
                locations={[0, 0.6]}
                style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 24 }}
              />
              {weather.status === "ready" ? (
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <WeatherIcon kind={weather.kind} />

                  <View style={{ flex: 1.15, marginLeft: 4, marginRight: 6 }}>
                    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                      <Text style={{ fontSize: 38, lineHeight: 42, fontWeight: "800", color: "#FFFFFF", letterSpacing: -1 }}>{weather.temp}</Text>
                      <Text style={{ fontSize: 18, lineHeight: 22, fontWeight: "700", color: "#FFFFFF", marginTop: 5 }}>°C</Text>
                    </View>
                    <Text style={{ fontSize: 14, fontWeight: "800", color: "#FFFFFF" }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{weather.label}</Text>
                    <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.82)", marginTop: 1 }} numberOfLines={1}>Feels like {weather.feelsLike}°</Text>
                  </View>

                  <View style={WEATHER_DIVIDER} />
                  <View style={{ flex: 1.6, flexDirection: "row", alignItems: "center" }}>
                    <WeatherStat icon="thermometer-high" label="High" value={`${weather.high}°`} />
                    <View style={[WEATHER_DIVIDER, { height: 40 }]} />
                    <WeatherStat icon="thermometer-low" label="Low" value={`${weather.low}°`} />
                    <View style={[WEATHER_DIVIDER, { height: 40 }]} />
                    <WeatherStat icon="weather-windy" label="Wind" value={`${weather.wind} km/h`} />
                  </View>
                </View>
              ) : weather.status === "loading" ? (
                <View className="h-[68px] justify-center items-center">
                  <ActivityIndicator color="#FFFFFF" />
                  <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 8 }}>Loading Soweto weather…</Text>
                </View>
              ) : (
                <TouchableOpacity className="h-[68px] justify-center items-center" onPress={fetchWeather} activeOpacity={0.8}>
                  <Ionicons name="cloud-offline-outline" size={26} color="#FFFFFF" />
                  <Text style={{ fontSize: 13.5, fontWeight: "700", color: "#FFFFFF", marginTop: 6 }}>Weather unavailable</Text>
                  <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", marginTop: 1 }}>Tap to try again</Text>
                </TouchableOpacity>
              )}
            </LinearGradient>
          </View>

          {/* ── Search bar (under the weather) — tap to open modal ── */}
          <View style={{ paddingHorizontal: PAD, marginTop: 12 }}>
            <TouchableOpacity className="flex-row items-center pl-4 pr-3 h-[48px] bg-surface rounded-full" style={cardShadow} onPress={openSearch} activeOpacity={0.9}>
              <Ionicons name="search" size={20} color={TEAL} style={{ marginRight: 10 }} />
              <Text className="flex-1 text-[14px] text-[#7A8A8F]" numberOfLines={1}>Search places, events, etc.</Text>
              <View className="w-px h-6 bg-line mx-3" />
              <Ionicons name="options-outline" size={22} color={TEAL} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Quick Access ── */}
        <View className="px-[16px] mb-6" style={{ marginTop: 24 }}>
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-[11px] font-extrabold text-[#12495C] tracking-[1.4px] uppercase">Quick Access</Text>
            <TouchableOpacity className="flex-row items-center gap-0.5" onPress={() => goXploreItem("XploreMain")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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

        {/* ── Upcoming Events ── */}
        {events.length > 0 && (
          <View className="px-[16px] mb-4">
            <SectionHeader title="Upcoming Events" icon="calendar-outline" onSeeAll={() => goCommunity()} />
            <FlatList
              data={events}
              horizontal
              keyExtractor={(item) => String(item.id)}
              showsHorizontalScrollIndicator={false}
              snapToInterval={EVENT_W + EVENT_GAP}
              snapToAlignment="start"
              decelerationRate="fast"
              contentContainerStyle={{ paddingBottom: 6 }}
              onScroll={handleEventScroll}
              scrollEventThrottle={32}
              renderItem={({ item: e }) => {
                const d    = dayjs(e._date)
                const time = e.time || ((d.hour() || d.minute()) ? d.format("HH:mm") : null)
                return (
                  <TouchableOpacity activeOpacity={0.9} onPress={() => goCommunity()}
                    style={[{ width: EVENT_W, height: 96, borderRadius: 18, backgroundColor: "#fff", marginRight: EVENT_GAP }, cardShadow]}>
                    <View style={{ flex: 1, borderRadius: 18, overflow: "hidden" }}>
                      {/* Event photo, full bleed (Soweto1.png when the event has none) */}
                      <CoverImage
                        source={eventImage(e)}
                        fallbackSource={EVENT_FALLBACK_IMAGE}
                        fallbackIcon="calendar"
                        iconSize={26}
                        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" }}
                      />
                      {/* White fade from the left so the text stays readable over the photo */}
                      <LinearGradient
                        pointerEvents="none"
                        colors={["rgba(255,255,255,0.97)", "rgba(255,255,255,0.88)", "rgba(255,255,255,0.35)", "rgba(255,255,255,0)"]}
                        locations={[0, 0.4, 0.68, 0.92]}
                        start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
                        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
                      />
                      <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 9, justifyContent: "space-between" }}>
                        <View style={{ width: "68%" }}>
                          <View style={{ alignSelf: "flex-start", backgroundColor: BRAND, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
                            <Text className="text-[9px] font-extrabold text-white uppercase tracking-[0.5px]" numberOfLines={1}>{e.category || "Event"}</Text>
                          </View>
                          <Text className="text-[14px] font-extrabold text-ink -tracking-[0.2px] mt-1" numberOfLines={1}>{e.title || e.name}</Text>
                        </View>
                        <View style={{ width: "72%" }}>
                          <View className="flex-row items-center">
                            <Ionicons name="calendar-outline" size={12} color={TEAL} />
                            <Text className="text-[11px] font-semibold text-ink ml-1.5" numberOfLines={1}>
                              {[d.format("D MMM"), time].filter(Boolean).join("  •  ")}
                            </Text>
                          </View>
                          {e.location ? (
                            <View className="flex-row items-center mt-0.5">
                              <Ionicons name="location-outline" size={12} color={TEAL} />
                              <Text className="text-[11px] font-semibold text-ink ml-1.5" numberOfLines={1}>{e.location}</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                      {/* Arrow button */}
                      <View style={{ position: "absolute", right: 10, bottom: 10, width: 28, height: 28, borderRadius: 14, backgroundColor: "#FFFFFF", justifyContent: "center", alignItems: "center", shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 3 }}>
                        <Ionicons name="arrow-forward" size={15} color={BRAND} />
                      </View>
                    </View>
                  </TouchableOpacity>
                )
              }}
            />
            {events.length > 1 && (
              <View className="flex-row justify-center items-center gap-1.5 mt-2">
                {events.map((ev, i) => (
                  <View key={ev.id} style={{ width: i === eventIndex ? 14 : 6, height: 6, borderRadius: 3, backgroundColor: i === eventIndex ? TEAL : "#D5D9D9" }} />
                ))}
              </View>
            )}
          </View>
        )}

        {/* ── Top Stories ── */}
        <View className="mb-5">
          <View className="px-[16px]">
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
            contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: 6 }}
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

        {/* ── Community Announcements ── */}
        <View className="px-[16px] mb-5">
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
        <View className="px-[16px] mb-5">
          <SectionHeader icon="book-outline" title={featuredImage?.title || "The Ultimate Guide to Soweto"} subtitle="Discover places, people and experiences." />
          <TouchableOpacity activeOpacity={0.9} onPress={() => goXploreItem("XploreMain")}
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
        <View className="px-[16px]">
          <SectionHeader title="Soweto Townships" onSeeAll={() => goXploreItem("XploreMain")} />
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
        <View className="flex-1 pt-[50px]">

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