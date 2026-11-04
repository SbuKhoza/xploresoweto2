import { useState, useEffect, useMemo, useRef } from "react"
import {
  Text, View, ScrollView, TouchableOpacity, Image, Modal, RefreshControl,
  ActivityIndicator, useWindowDimensions,
} from "react-native"
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { collection, getDocs } from "firebase/firestore"
import { db } from "../../../Firebase/config"
import { useScrollTracking, AnimatedFlatList } from "../../BottomNav"
import OfflineIndicator from "../../OfflineIndicator"
import {
  TEAL, BRAND, ALL, typeIconFor, getEditorialBadge, getStatusBadge, searchText,
} from "./theme"
import {
  Hero, SearchBar, SectionHeader, CategoryChips, EmptyState, ListingCard,
  FilterSheet, DEFAULT_FILTERS, hasActiveFilters,
} from "./ui"
import { openDirections } from "./openDirections"

/**
 * One list screen for every Xplore category (Stay, Attractions, Recreation,
 * Healthcare, Public Services …). Data is read from Firestore and grouped by
 * each document's `type`; nothing is hard-coded.
 *
 * Props
 *  collectionName   Firestore collection to read
 *  title / subtitle hero text
 *  sectionTitle     heading above the category chips
 *  searchPlaceholder
 *  noun             { one, many } — "restaurant" / "restaurants" …
 *  emptyIcon        MaterialCommunityIcons name for empty / loading states
 *  fallbackType     category for documents without a `type` (optional)
 *  hoursKey         field holding opening hours (used when there is no status)
 *  editorialBadges  show "Top Rated" / "Popular" badges (default true)
 *  openNowLabel     label for the availability filter
 *  extraSorts       [{ label, value, compare(a, b) }]
 *  getCard(item)    → { pill, imageChip, extraBadge, footer, buttonLabel }
 *  renderDetail(item, ctx) → modal body (ctx: closeDetail, openDirections, status)
 */
const ExploreList = ({
  collectionName, title, subtitle, sectionTitle, searchPlaceholder,
  noun = { one: "result", many: "results" },
  emptyIcon = "shape", fallbackType, hoursKey, editorialBadges = true,
  openNowLabel = "Open now", extraSorts = [], getCard, renderDetail,
}) => {
  const [items, setItems]               = useState([])
  const [types, setTypes]               = useState([])
  const [activeTab, setActiveTab]       = useState(undefined) // undefined = not chosen yet
  const [loading, setLoading]           = useState(true)
  const [refreshing, setRefreshing]     = useState(false)
  const [query, setQuery]               = useState("")
  const [filters, setFilters]           = useState(DEFAULT_FILTERS)
  const [filterVisible, setFilterVisible] = useState(false)
  const [favorites, setFavorites]       = useState(new Set())
  const [selected, setSelected]         = useState(null)
  const [modalVisible, setModalVisible] = useState(false)
  const [imageIndex, setImageIndex]     = useState(0)
  const [now, setNow]                   = useState(new Date())

  const scrollProps = useScrollTracking()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const searchRef = useRef(null)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const snap = await getDocs(collection(db, collectionName))
      const list = []
      const typeSet = new Set()
      snap.forEach(d => {
        const data = { id: d.id, ...d.data() }
        const t = typeof data.type === "string" ? data.type.trim() : ""
        data.__type = t || fallbackType || ""
        if (data.__type) typeSet.add(data.__type)
        list.push(data)
      })
      const uniqueTypes = Array.from(typeSet).sort()
      setItems(list)
      setTypes(uniqueTypes)
      setActiveTab(prev => {
        if (prev === ALL) return ALL
        if (prev && uniqueTypes.includes(prev)) return prev
        return uniqueTypes[0] ?? ALL
      })
    } catch {
      setItems([])
      setTypes([])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }
  useEffect(() => { fetchData() }, [])
  const onRefresh = async () => { setRefreshing(true); await fetchData() }

  const sortFns = useMemo(() => {
    const m = {
      rating:  (a, b) => (Number(b.rating)  || 0) - (Number(a.rating)  || 0),
      reviews: (a, b) => (Number(b.reviews) || 0) - (Number(a.reviews) || 0),
    }
    extraSorts.forEach(s => { m[s.value] = s.compare })
    return m
  }, [extraSorts])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = items.filter(r => {
      if (q) {
        if (!searchText(r).includes(q)) return false // searching looks across every category
      } else if (activeTab !== ALL && r.__type !== activeTab) {
        return false
      }
      if (filters.minRating && (Number(r.rating) || 0) < filters.minRating) return false
      if (filters.openNow) {
        const s = getStatusBadge(r, now, hoursKey)
        if (!s || !s.ok) return false
      }
      return true
    })
    const cmp = sortFns[filters.sort]
    if (cmp) list.sort(cmp)
    return list
  }, [items, activeTab, query, filters, now, sortFns, hoursKey])

  const filtersActive = hasActiveFilters(filters)
  const toggleFavorite = (id) => {
    const n = new Set(favorites); n.has(id) ? n.delete(id) : n.add(id); setFavorites(n)
  }
  const openDetail = (r) => { setSelected(r); setImageIndex(0); setModalVisible(true) }
  const closeDetail = () => setModalVisible(false)
  const iconFor = (type) => typeIconFor(type, emptyIcon)

  // ── Card ───────────────────────────────────────────────────────────────────
  const renderCard = ({ item }) => {
    const status    = getStatusBadge(item, now, hoursKey)
    const editorial = editorialBadges ? getEditorialBadge(item) : null
    // A closed / unavailable place always shows that; otherwise the editorial badge wins.
    const badge = status && !status.ok ? status : (editorial || status)
    const card  = getCard ? getCard(item) || {} : {}
    return (
      <ListingCard
        image={Array.isArray(item.images) ? item.images[0] : null}
        fallbackIcon={iconFor(item.__type)}
        badge={badge}
        extraBadge={card.extraBadge}
        imageChip={card.imageChip}
        title={item.name}
        location={item.location}
        rating={item.rating}
        reviews={item.reviews}
        pill={card.pill ? { ...card.pill, muted: card.pill.muted ?? (status ? status.ok === false : false) } : null}
        buttonLabel={card.buttonLabel || "View Details"}
        footer={card.footer}
        favorite={favorites.has(item.id)}
        onToggleFavorite={() => toggleFavorite(item.id)}
        onPress={() => openDetail(item)}
      />
    )
  }

  // ── Loading / empty (hero stays so the back button is always there) ───────
  if (loading && !refreshing && !items.length) {
    return (
      <View className="flex-1 bg-bg">
        <Hero title={title} subtitle={subtitle} />
        <View className="items-center mt-16">
          <ActivityIndicator size="large" color={BRAND} />
          <Text className="text-[14px] font-bold text-ink mt-3">Loading {noun.many}…</Text>
        </View>
      </View>
    )
  }
  if (!items.length) {
    return (
      <View className="flex-1 bg-bg">
        <Hero title={title} subtitle={subtitle} />
        <EmptyState icon={emptyIcon} title={`No ${noun.many} available`} message="Please check back soon" />
      </View>
    )
  }

  const header = (
    <View>
      <Hero title={title} subtitle={subtitle} />
      <SearchBar
        inputRef={searchRef}
        value={query}
        onChangeText={setQuery}
        placeholder={searchPlaceholder}
        onFilterPress={() => setFilterVisible(true)}
        filtersActive={filtersActive}
      />
      <SectionHeader
        title={sectionTitle}
        showingAll={activeTab === ALL && !query}
        onSeeAll={() => { setQuery(""); setActiveTab(ALL) }}
      />
      <CategoryChips
        types={types}
        active={query ? null : activeTab}
        onSelect={(t) => { setQuery(""); setActiveTab(t) }}
        iconFor={iconFor}
      />
      {(!!query.trim() || filtersActive) && (
        <Text className="text-[11.5px] text-muted font-medium px-4 mb-2">
          <Text className="font-extrabold text-ink">{visible.length}</Text>{" "}
          {visible.length === 1 ? noun.one : noun.many} found
        </Text>
      )}
    </View>
  )

  const images = Array.isArray(selected?.images) ? selected.images : []
  const detailStatus = selected ? getStatusBadge(selected, now, hoursKey) : null

  return (
    <View className="flex-1 bg-bg">
      <OfflineIndicator />

      <AnimatedFlatList
        data={visible}
        renderItem={renderCard}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={header}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[BRAND]} tintColor={BRAND} progressViewOffset={insets.top} />}
        ListEmptyComponent={() => (
          <EmptyState
            icon={emptyIcon}
            title={query.trim() ? `No results for “${query.trim()}”` : `No ${noun.many} match`}
            message={filtersActive ? "Try removing some filters" : "Try a different category or pull to refresh"}
          />
        )}
        {...scrollProps}
      />

      <FilterSheet
        visible={filterVisible}
        onClose={() => setFilterVisible(false)}
        filters={filters}
        setFilters={setFilters}
        count={visible.length}
        noun={noun}
        sorts={extraSorts}
        openNowLabel={openNowLabel}
      />

      {/* Detail modal */}
      <Modal animationType="slide" transparent={false} visible={modalVisible} onRequestClose={closeDetail}>
        <View className="flex-1 bg-bg">
          <View className="absolute left-0 right-0 flex-row justify-between px-4 z-10" style={{ top: insets.top + 8 }}>
            <TouchableOpacity className="w-9 h-9 rounded-[12px] justify-center items-center" style={{ backgroundColor: "rgba(20,33,61,0.55)" }} onPress={closeDetail}>
              <Ionicons name="chevron-down" size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity className="w-9 h-9 rounded-[12px] justify-center items-center" style={{ backgroundColor: "rgba(20,33,61,0.55)" }} onPress={() => selected && toggleFavorite(selected.id)}>
              <Ionicons
                name={selected && favorites.has(selected.id) ? "heart" : "heart-outline"}
                size={19}
                color={selected && favorites.has(selected.id) ? "#EF4444" : "#FFFFFF"}
              />
            </TouchableOpacity>
          </View>

          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            {images.length > 0 ? (
              <View>
                <ScrollView
                  horizontal pagingEnabled showsHorizontalScrollIndicator={false}
                  onMomentumScrollEnd={(e) => setImageIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
                >
                  {images.map((img, i) => (
                    <Image key={i} source={{ uri: img }} style={{ width, height: 240 }} resizeMode="cover" />
                  ))}
                </ScrollView>
                {images.length > 1 && (
                  <View className="flex-row justify-center py-2.5 gap-1.5">
                    {images.map((_, i) => (
                      <View key={i} className={`h-1.5 rounded-full ${i === imageIndex ? "w-5 bg-brand" : "w-1.5 bg-line"}`} />
                    ))}
                  </View>
                )}
              </View>
            ) : (
              <View className="h-[200px] bg-teal-light justify-center items-center">
                <MaterialCommunityIcons name={iconFor(selected?.__type)} size={44} color={TEAL} />
              </View>
            )}

            {selected && (
              <View className="p-5">
                {renderDetail(selected, { closeDetail, openDirections, status: detailStatus })}
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  )
}

export default ExploreList
