import {
  Text, View, ScrollView, TextInput, TouchableOpacity,
  Image, Dimensions, Modal, FlatList, ActivityIndicator, Keyboard,
} from "react-native"
import { useState, useEffect, useRef, useCallback } from "react"
import { Ionicons } from "@expo/vector-icons"
import { onAuthStateChanged } from "firebase/auth"
import { doc, getDoc, collection, getDocs } from "firebase/firestore"
import { auth, db } from "../Firebase/config"
import { useNavigation } from "@react-navigation/native"

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

const Home = () => {
  const navigation    = useNavigation()
  const [userDisplayName, setUserDisplayName] = useState("User")
  const [loading, setLoading]                 = useState(true)
  const [featuredImage, setFeaturedImage]     = useState(null)
  const [townships, setTownships]             = useState([])
  const [dataLoading, setDataLoading]         = useState(true)
  const [screenData, setScreenData]           = useState(Dimensions.get("window"))

  // ── Search state ──
  const [searchQuery, setSearchQuery]         = useState("")
  const [searchVisible, setSearchVisible]     = useState(false)
  const [searchResults, setSearchResults]     = useState([])
  const [searchLoading, setSearchLoading]     = useState(false)
  const [searchCache, setSearchCache]         = useState(null) // all docs cached after first search
  const searchInputRef                        = useRef(null)
  const debounceTimer                         = useRef(null)

  const quickLinks = [
    { id: "1", name: "Transport",    icon: "bus",         screen: "Transport"   },
    { id: "2", name: "Restaurants",  icon: "restaurant",  screen: "Restaurants" },
    { id: "3", name: "Attractions",  icon: "map",         screen: "Attraction"  },
    { id: "4", name: "Emergency",    icon: "medical",     screen: "Emergency"   },
  ]

  const handleQuickLinkPress = (screenName) => {
    try { navigation.navigate("Xplore", { screen: screenName }) }
    catch (e) { console.error(`Navigation error to ${screenName}:`, e) }
  }

  const getGreeting = () => {
    const h = new Date().getHours()
    if (h < 12) return "Good Morning"
    if (h < 17) return "Good Afternoon"
    return "Good Evening"
  }

  const getFeaturedImageHeight = () => {
    const { width, height } = screenData
    return width >= 668 ? height * 0.59 : height * 0.45
  }

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
      setTownships([{ id:"1",name:"Orlando" },{ id:"2",name:"Diepkloof" },{ id:"3",name:"Pimville" },{ id:"4",name:"Meadowlands" }])
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
    return () => { sub?.remove(); unsub() }
  }, [])

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

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <ScrollView className="flex-1 bg-bg" showsVerticalScrollIndicator={false}>

        {/* ── Hero Banner ── */}
        <View className="relative overflow-hidden bg-teal-light rounded-b-[28px] mb-5 px-[22px] pt-4 pb-[18px]">
          <View className="absolute w-[200px] h-[200px] rounded-full -top-[70px] -right-10" style={{ backgroundColor: "rgba(232,96,10,0.08)" }} />
          <View className="absolute w-[90px] h-[90px] rounded-full top-2.5 right-[60px]" style={{ backgroundColor: "rgba(27,77,92,0.07)" }} />
          <View className="absolute w-[50px] h-[50px] rounded-full bottom-5 -left-[15px]" style={{ backgroundColor: "rgba(232,96,10,0.12)" }} />

          <View className="flex-row justify-between items-start mb-2">
            <View className="flex-1">
              <Text className="text-[13px] text-muted font-medium mb-0.5">{getGreeting()} 👋</Text>
              <Text className="text-xl font-extrabold text-ink -tracking-[0.4px]">Aweh, {loading ? "User" : userDisplayName}!</Text>
            </View>
            <TouchableOpacity className="w-[42px] h-[42px] justify-center items-center rounded-2xl bg-surface border border-[#b8c5c9]">
              <Ionicons name="notifications-outline" size={22} color="#1B4D5C" />
              <View className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-brand border-[1.5px] border-teal-light" />
            </TouchableOpacity>
          </View>

          {/* Search bar — tap to open modal */}
          <TouchableOpacity className="flex-row items-center px-3.5 h-12 bg-surface rounded-2xl border border-[#C8DFE6]" onPress={openSearch} activeOpacity={0.85}>
            <Ionicons name="search" size={17} color="#7A8A8F" style={{ marginRight: 10 }} />
            <Text className="flex-1 text-sm text-[#B0BFC4]">Search places, events, etc.</Text>
            <View className="w-px h-[18px] bg-[#DDE8EB] ml-2" />
            <View className="ml-2 w-[30px] h-[30px] rounded-[10px] bg-teal-light justify-center items-center">
              <Ionicons name="options-outline" size={15} color="#1B4D5C" />
            </View>
          </TouchableOpacity>
        </View>

        {/* ── Quick Links ── */}
        <View className="px-[22px] mb-[26px]">
          <Text className="text-[11px] font-bold text-muted tracking-[1.4px] uppercase mb-3.5">Quick Access</Text>
          <View className="flex-row justify-between">
            {quickLinks.map(link => (
              <TouchableOpacity key={link.id} className="items-center w-[23%]"
                onPress={() => handleQuickLinkPress(link.screen)} activeOpacity={0.75}>
                <View className="w-12 h-12 rounded-[18px] justify-center items-center mb-2 bg-teal">
                  <Ionicons name={link.icon} size={22} color="#FFFFFF" />
                </View>
                <Text className="text-[11px] text-ink text-center font-bold tracking-tight">{link.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Featured ── */}
        <View className="px-[22px] mb-7">
          <View className="flex-row items-center justify-between mb-3.5">
            <View className="flex-row items-center flex-1 gap-2.5">
              <View className="w-1 h-[22px] rounded bg-brand" />
              <Text className="flex-1 text-base font-extrabold text-ink -tracking-[0.2px]">{featuredImage?.title || "The Ultimate Guide to Soweto"}</Text>
            </View>
            <View className="px-2.5 py-1.5 rounded-full bg-brand-light border border-[#F5C9A8]">
              <Text className="text-[11px] text-brand font-bold tracking-wide">✦ Featured</Text>
            </View>
          </View>

          <View className="rounded-[24px] overflow-hidden border border-[#E8DDD5]" style={{ height: getFeaturedImageHeight() }}>
            {dataLoading ? (
              <View className="w-full h-full bg-[#EDE8E2] justify-center items-center">
                <Ionicons name="image-outline" size={40} color="#C8CBD8" />
                <Text className="text-[#AAAAAA] text-sm mt-2">Loading...</Text>
              </View>
            ) : (
              <>
                <Image
                  source={featuredImage?.imageUrl ? { uri: featuredImage.imageUrl } : require("../assets/Soweto1.png")}
                  className="w-full h-full"
                  resizeMode="cover"
                />
                <View className="absolute top-0 left-0 right-0 h-[30%] bg-black/15" />
                <View className="absolute bottom-0 left-0 right-0 h-[45%] bg-black/[.38]" />
                <View className="absolute bottom-4 left-4 flex-row items-center gap-1 bg-white/[.18] px-2.5 py-1.5 rounded-full border border-white/25">
                  <Ionicons name="location" size={12} color="rgba(255,255,255,0.9)" />
                  <Text className="text-xs text-surface font-semibold">Soweto, South Africa</Text>
                </View>
              </>
            )}
          </View>
        </View>

        {/* ── Townships ── */}
        <View className="mb-1">
          <View className="flex-row justify-between items-center px-[22px] mb-4">
            <View>
              <Text className="text-[17px] font-extrabold text-ink -tracking-[0.2px] mb-1">Soweto Townships</Text>
              <View className="w-7 h-[3px] rounded bg-brand" />
            </View>
            <TouchableOpacity className="flex-row items-center gap-0.5">
              <Text className="text-[13px] text-muted font-semibold">See All</Text>
              <Ionicons name="chevron-forward" size={14} color="#7A8A8F" />
            </TouchableOpacity>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingLeft: 22, paddingRight: 5 }}>
            {dataLoading ? (
              <View className="w-[175px] mr-3">
                <View className="w-[175px] h-[58px] rounded-2xl bg-surface flex-row items-center overflow-hidden border border-[#E5DDD6]">
                  <View className="ml-2.5 rounded-xl w-[38px] h-[38px] bg-teal justify-center items-center">
                    <Text className="text-lg font-extrabold text-surface">…</Text>
                  </View>
                  <Text className="flex-1 text-sm font-semibold text-ink ml-2.5">Loading...</Text>
                </View>
              </View>
            ) : (
              townships.map(t => (
                <TouchableOpacity key={t.id} className="w-[175px] mr-3" activeOpacity={0.8}>
                  <View className="w-[175px] h-[58px] rounded-2xl bg-surface flex-row items-center overflow-hidden border border-[#E5DDD6]">
                    <View className="ml-2.5 rounded-xl w-[38px] h-[38px] bg-teal justify-center items-center">
                      <Text className="text-lg font-extrabold text-surface">{t.name.charAt(0)}</Text>
                    </View>
                    <Text className="flex-1 text-sm font-semibold text-ink ml-2.5">{t.name}</Text>
                    <Ionicons name="chevron-forward" size={14} color="#C0C4D6" style={{ marginRight: 12 }} />
                  </View>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>

        <View className="h-[100px]" />
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
