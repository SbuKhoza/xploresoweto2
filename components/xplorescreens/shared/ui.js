import { useCallback } from "react"
import {
  Text, View, ScrollView, TouchableOpacity, Image, TextInput, Modal, Pressable,
  Keyboard, BackHandler, useWindowDimensions,
} from "react-native"
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import {
  TEAL, BRAND, MUTED, STAR, ALL, HERO_IMAGE, HERO_RATIO, HERO_BODY_H,
  cardShadow, softShadow,
} from "./theme"

// ── Stars ────────────────────────────────────────────────────────────────────
export const Stars = ({ rating, size = 12 }) => {
  const r = Math.max(0, Math.min(5, Math.round((Number(rating) || 0) * 2) / 2))
  const full = Math.floor(r), half = r % 1 !== 0, empty = 5 - full - (half ? 1 : 0)
  return (
    <View className="flex-row items-center">
      {Array(full).fill(0).map((_, i) => <Ionicons key={`f${i}`} name="star" size={size} color={STAR} />)}
      {half && <Ionicons name="star-half" size={size} color={STAR} />}
      {Array(empty).fill(0).map((_, i) => <Ionicons key={`e${i}`} name="star-outline" size={size} color={STAR} />)}
    </View>
  )
}

// ── Hero (back + bell, title, towers artwork) ────────────────────────────────
export const Hero = ({ title, subtitle }) => {
  const insets = useSafeAreaInsets()
  const { width: winW } = useWindowDimensions()
  const navigation = useNavigation()
  const route = useRoute()

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

  const heroH = insets.top + HERO_BODY_H
  const imgW  = heroH * HERO_RATIO
  // Keep the cooling towers on the right-hand side of the hero.
  const imgLeft = Math.min(0, Math.max(winW - imgW, winW * 0.64 - imgW * 0.52))
  const roundBtn = "w-[34px] h-[34px] rounded-[12px] bg-surface justify-center items-center"

  return (
    <View style={{ height: heroH, overflow: "hidden", backgroundColor: "#CFE6F2" }}>
      <Image
        source={HERO_IMAGE}
        style={{ position: "absolute", top: 0, left: imgLeft, width: imgW, height: heroH }}
        resizeMode="cover"
      />
      <LinearGradient
        colors={["rgba(245,247,250,0.96)", "rgba(245,247,250,0.82)", "rgba(245,247,250,0)"]}
        locations={[0, 0.42, 0.78]}
        start={{ x: 0, y: 0.4 }}
        end={{ x: 1, y: 0.6 }}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        pointerEvents="none"
      />

      <View
        className="flex-row justify-between items-center px-4"
        style={{ position: "absolute", top: insets.top + 10, left: 0, right: 0 }}
      >
        <TouchableOpacity className={roundBtn} style={softShadow} onPress={handleBack} accessibilityLabel="Go back" activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={17} color={TEAL} />
        </TouchableOpacity>
        <TouchableOpacity className={roundBtn} style={softShadow} accessibilityLabel="Notifications" activeOpacity={0.8}>
          <Ionicons name="notifications-outline" size={16} color={TEAL} />
        </TouchableOpacity>
      </View>

      <View style={{ position: "absolute", left: 20, bottom: 36, right: 20 }}>
        <Text className="text-[24px] font-extrabold text-ink -tracking-[0.5px]" style={{ lineHeight: 28 }} numberOfLines={1}>
          {title}
        </Text>
        <View
          className="bg-brand rounded-full"
          style={{ width: 84, height: 3, marginTop: 1, transform: [{ rotate: "-1deg" }] }}
        />
        {!!subtitle && (
          <Text className="text-[12px] font-medium text-ink mt-2" style={{ lineHeight: 16 }}>
            {subtitle}
          </Text>
        )}
      </View>
    </View>
  )
}

// ── Search bar (overlaps the hero) ───────────────────────────────────────────
export const SearchBar = ({ value, onChangeText, placeholder, onFilterPress, filtersActive, inputRef }) => (
  <View className="px-4" style={{ marginTop: -24, zIndex: 5 }}>
    <View className="flex-row items-center bg-surface rounded-full pl-4 pr-3 h-[48px]" style={softShadow}>
      <Ionicons name="search" size={20} color={TEAL} style={{ marginRight: 10 }} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#8C999D"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        className="flex-1 text-[14px] text-ink"
        style={{ paddingVertical: 0 }}
      />
      {value.length > 0 && (
        <TouchableOpacity onPress={() => onChangeText("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} className="mr-2" accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={17} color="#B5BDBF" />
        </TouchableOpacity>
      )}
      {!!onFilterPress && (
        <>
          <View className="w-px h-6 bg-line mx-3" />
          <TouchableOpacity
            onPress={() => { Keyboard.dismiss(); onFilterPress() }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Filters"
            activeOpacity={0.8}
          >
            <Ionicons name="options-outline" size={22} color={TEAL} />
            {filtersActive && <View className="absolute -top-0.5 -right-0.5 w-[8px] h-[8px] rounded-full bg-brand border-[1.5px] border-surface" />}
          </TouchableOpacity>
        </>
      )}
    </View>
  </View>
)

// ── Section header ("Eat & Drink" style) ─────────────────────────────────────
export const SectionHeader = ({ title, showingAll, onSeeAll }) => (
  <View className="flex-row items-center justify-between px-4 mt-5 mb-2.5">
    <View className="flex-row items-center gap-2">
      <View className="w-[3px] h-[18px] rounded bg-brand" />
      <Text className="text-[16px] font-extrabold text-ink -tracking-[0.3px]">{title}</Text>
    </View>
    {showingAll ? (
      <Text className="text-[12px] font-semibold text-muted">Showing all</Text>
    ) : (
      <TouchableOpacity className="flex-row items-center gap-0.5" onPress={onSeeAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text className="text-[12px] font-bold text-brand underline">See All</Text>
        <Ionicons name="chevron-forward" size={13} color={BRAND} />
      </TouchableOpacity>
    )}
  </View>
)

// ── Category chips (built from the types found in Firestore) ─────────────────
export const CategoryChips = ({ types, active, onSelect, iconFor }) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    style={{ flexGrow: 0, flexShrink: 0 }}
    contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12, paddingTop: 2 }}
  >
    {types.map((type) => {
      const isActive = active === type
      return (
        <TouchableOpacity key={type} className="mr-2" activeOpacity={0.85} onPress={() => onSelect(type)}>
          <View
            style={{
              minWidth: 40, height: 50, borderRadius: 50, paddingHorizontal: 9,
              alignItems: "center", justifyContent: "center", backgroundColor: "#f1ede62b",
            }}
          >
            <MaterialCommunityIcons name={iconFor(type)} size={19} color={TEAL} />
            <Text className={`text-[10px] mt-0.5 ${isActive ? "font-extrabold text-ink" : "font-bold text-muted"}`} numberOfLines={1}>
              {type}
            </Text>
            <View className={`rounded-full mt-0.5 ${isActive ? "bg-brand" : "bg-transparent"}`} style={{ width: 20, height: 2 }} />
          </View>
        </TouchableOpacity>
      )
    })}
  </ScrollView>
)

// ── Empty / loading state ────────────────────────────────────────────────────
export const EmptyState = ({ icon = "shape", title, message }) => (
  <View className="items-center py-12 px-10">
    <View className="w-16 h-16 rounded-[22px] bg-teal-light justify-center items-center mb-3">
      <MaterialCommunityIcons name={icon} size={26} color={TEAL} />
    </View>
    <Text className="text-[15px] font-bold text-ink text-center">{title}</Text>
    {!!message && <Text className="text-[12px] text-muted mt-1.5 text-center">{message}</Text>}
  </View>
)

// ── Listing card ─────────────────────────────────────────────────────────────
//  badge      { label, color, icon?, dot? }   top-left
//  extraBadge { label, color, icon? }         under the badge
//  imageChip  { text, sub?, icon? }           bottom-left of the photo
//  pill       { icon, text, muted? }          right of the body
//  footer     { icon?, text, color?, lines? } full-width line under the body
export const ListingCard = ({
  image, fallbackIcon = "shape", badge, extraBadge, imageChip,
  title, location, rating, reviews, pill, buttonLabel = "View Details", footer,
  favorite, onToggleFavorite, onPress,
}) => {
  const hasRating = rating !== undefined && rating !== null && rating !== ""
  const reviewsNum = Number(reviews)
  const showReviews = reviews !== undefined && reviews !== null && reviews !== "" && !Number.isNaN(reviewsNum)

  return (
    <View className="px-4">
      <TouchableOpacity className="bg-surface rounded-[22px] mb-3.5 overflow-hidden" style={cardShadow} onPress={onPress} activeOpacity={0.92}>
        <View className="h-[150px] bg-teal-light justify-center items-center">
          {image ? (
            <Image source={{ uri: image }} className="w-full h-full" resizeMode="cover" />
          ) : (
            <MaterialCommunityIcons name={fallbackIcon} size={34} color={TEAL} />
          )}

          {badge && (
            <View className="absolute top-2.5 left-2.5 flex-row items-center px-2.5 py-1 rounded-full" style={{ backgroundColor: badge.color }}>
              {badge.icon ? (
                <Ionicons name={badge.icon} size={11} color="#FFFFFF" style={{ marginRight: 4 }} />
              ) : (
                <View className="w-[6px] h-[6px] rounded-full bg-white mr-1.5" />
              )}
              <Text className="text-[11px] font-bold text-white">{badge.label}</Text>
            </View>
          )}
          {extraBadge && (
            <View className="absolute top-[40px] left-2.5 flex-row items-center px-2.5 py-1 rounded-full" style={{ backgroundColor: extraBadge.color }}>
              {!!extraBadge.icon && <Ionicons name={extraBadge.icon} size={11} color="#FFFFFF" style={{ marginRight: 4 }} />}
              <Text className="text-[11px] font-bold text-white">{extraBadge.label}</Text>
            </View>
          )}

          {imageChip && (
            <View className="absolute bottom-2.5 left-2.5 flex-row items-center bg-white/95 px-2.5 py-1 rounded-full">
              {!!imageChip.icon && <Ionicons name={imageChip.icon} size={12} color={TEAL} style={{ marginRight: 4 }} />}
              <Text className="text-[12px] font-extrabold text-ink">{imageChip.text}</Text>
              {!!imageChip.sub && <Text className="text-[10px] text-muted font-medium ml-0.5">{imageChip.sub}</Text>}
            </View>
          )}

          <TouchableOpacity
            className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full justify-center items-center"
            style={{ backgroundColor: "rgba(20,33,61,0.55)" }}
            onPress={onToggleFavorite}
            accessibilityLabel={favorite ? "Remove from favourites" : "Add to favourites"}
          >
            <Ionicons name={favorite ? "heart" : "heart-outline"} size={16} color={favorite ? "#EF4444" : "#FFFFFF"} />
          </TouchableOpacity>
        </View>

        <View className="flex-row items-center px-3 pt-2.5 pb-3">
          <View className="flex-1 mr-2.5">
            <Text className="text-[15px] font-extrabold text-ink -tracking-[0.2px]" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {title}
            </Text>
            {!!location && (
              <View className="flex-row items-center mt-1">
                <Ionicons name="location-sharp" size={12} color={TEAL} />
                <Text className="text-[11.5px] text-ink-soft ml-1 flex-1" numberOfLines={1}>{location}</Text>
              </View>
            )}
            {hasRating && (
              <View className="flex-row items-center mt-1">
                <Stars rating={rating} size={12} />
                {showReviews && (
                  <Text className="text-[10.5px] text-muted ml-1" numberOfLines={1}>
                    ({reviewsNum} {reviewsNum === 1 ? "review" : "reviews"})
                  </Text>
                )}
              </View>
            )}
          </View>

          <View className="flex-row items-center">
            {pill && (
              <View className={`flex-row items-center px-2 py-1.5 rounded-full mr-1.5 ${pill.muted ? "bg-line" : "bg-teal-light"}`}>
                <Ionicons name={pill.icon} size={12} color={pill.muted ? MUTED : TEAL} />
                <Text className={`text-[10.5px] font-bold ml-1 ${pill.muted ? "text-muted" : "text-teal"}`} numberOfLines={1}>
                  {pill.text}
                </Text>
              </View>
            )}
            <TouchableOpacity className="flex-row items-center bg-brand pl-3 pr-2.5 py-2 rounded-full" onPress={onPress} activeOpacity={0.88}>
              <Text className="text-[11.5px] font-bold text-white mr-1">{buttonLabel}</Text>
              <Ionicons name="arrow-forward" size={12} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>

        {footer && (
          <View className="flex-row items-center px-3 pb-3 -mt-1">
            {!!footer.icon && <Ionicons name={footer.icon} size={13} color={footer.color || MUTED} style={{ marginRight: 5 }} />}
            <Text className="text-[11.5px] flex-1" style={{ color: footer.color || MUTED }} numberOfLines={footer.lines || 1}>
              {footer.text}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  )
}

// ── Filter sheet ─────────────────────────────────────────────────────────────
const FilterChip = ({ label, active, onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={0.8}
    className={`px-3.5 py-2 rounded-full mr-2 mb-2 border ${active ? "bg-teal border-teal" : "bg-surface border-line"}`}
  >
    <Text className={`text-[12px] font-bold ${active ? "text-white" : "text-ink"}`}>{label}</Text>
  </TouchableOpacity>
)

export const DEFAULT_FILTERS = { openNow: false, minRating: 0, sort: "default" }
export const hasActiveFilters = (f) => f.openNow || f.minRating > 0 || f.sort !== "default"

export const FilterSheet = ({
  visible, onClose, filters, setFilters, count, noun = { one: "result", many: "results" },
  sorts, showOpenNow = true, openNowLabel = "Open now",
}) => {
  const insets = useSafeAreaInsets()
  const active = hasActiveFilters(filters)
  const allSorts = [
    { label: "Recommended", value: "default" },
    { label: "Top rated", value: "rating" },
    { label: "Most reviewed", value: "reviews" },
    ...(sorts || []),
  ]
  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: "rgba(20,33,61,0.45)" }} onPress={onClose}>
        <Pressable
          className="bg-bg px-5 pt-3"
          style={{ borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: Math.max(insets.bottom, 16) + 8 }}
          onPress={() => {}}
        >
          <View className="self-center w-10 h-1 rounded-full bg-line mb-4" />
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-[16px] font-extrabold text-ink -tracking-[0.3px]">Filters</Text>
            <TouchableOpacity onPress={() => setFilters(DEFAULT_FILTERS)} disabled={!active}>
              <Text className={`text-[12px] font-bold ${active ? "text-brand" : "text-muted"}`}>Reset</Text>
            </TouchableOpacity>
          </View>

          <Text className="text-[11px] font-extrabold text-muted uppercase tracking-wider mb-2">Sort by</Text>
          <View className="flex-row flex-wrap mb-3">
            {allSorts.map(s => (
              <FilterChip key={s.value} label={s.label} active={filters.sort === s.value} onPress={() => setFilters(f => ({ ...f, sort: s.value }))} />
            ))}
          </View>

          <Text className="text-[11px] font-extrabold text-muted uppercase tracking-wider mb-2">Minimum rating</Text>
          <View className="flex-row flex-wrap mb-3">
            {[["Any", 0], ["4.0+", 4], ["4.5+", 4.5]].map(([label, v]) => (
              <FilterChip key={label} label={label} active={filters.minRating === v} onPress={() => setFilters(f => ({ ...f, minRating: v }))} />
            ))}
          </View>

          {showOpenNow && (
            <>
              <Text className="text-[11px] font-extrabold text-muted uppercase tracking-wider mb-2">Availability</Text>
              <View className="flex-row flex-wrap mb-4">
                <FilterChip label={openNowLabel} active={filters.openNow} onPress={() => setFilters(f => ({ ...f, openNow: !f.openNow }))} />
              </View>
            </>
          )}

          <TouchableOpacity className="bg-brand rounded-full py-3 items-center" onPress={onClose} activeOpacity={0.88}>
            <Text className="text-[14px] font-bold text-white">
              Show {count} {count === 1 ? noun.one : noun.many}
            </Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

export { ALL }