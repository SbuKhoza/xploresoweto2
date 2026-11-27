import { Text, View, TouchableOpacity } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { TEAL, BRAND, MUTED, TILE_THEMES } from "./theme"
import { Stars } from "./ui"
import { isObject, toRating, toCount, toText } from "../../../utils/listingData"

// Building blocks for the detail modals, so every screen reads the same.

export const DetailTitle = ({ name, location, status }) => (
  <View className="flex-row items-start mb-3">
    <View className="flex-1 mr-2">
      <Text className="text-[18px] font-extrabold text-ink -tracking-[0.3px] mb-1">{toText(name) || "Unnamed listing"}</Text>
      {!!toText(location) && (
        <View className="flex-row items-center">
          <Ionicons name="location-sharp" size={13} color={TEAL} />
          <Text className="text-[12.5px] text-muted ml-1 flex-1">{toText(location)}</Text>
        </View>
      )}
    </View>
    {isObject(status) && !!toText(status.label) && (
      <View className="px-2.5 py-1 rounded-full mt-0.5" style={{ backgroundColor: status.color }}>
        <Text className="text-[11px] font-bold text-white">{toText(status.label)}</Text>
      </View>
    )}
  </View>
)

// cells: [{ icon?, big?, rating?, text, label? }]
// Cells that are missing, malformed or entirely empty are skipped, so a listing with partial data shows fewer cells, never a crash.
const cellHasContent = (c) => isObject(c) && ((c.rating !== undefined && c.rating !== null) || !!toText(c.big) || toText(c.text) !== "")

/** { rating, text } for a rating cell, or null when the listing has no valid rating. `text` is "4.5 (12)", "4.5" or "". */
export const ratingCell = (item) => {
  const rating = toRating(item?.rating), reviews = toCount(item?.reviews)
  if (rating === null) return null
  return { rating, text: reviews === null ? String(rating) : `${rating} (${reviews})` }
}

export const MetaCard = ({ cells }) => {
  const shown = (Array.isArray(cells) ? cells : []).filter(cellHasContent)
  if (shown.length === 0) return null
  return (
  <View className="flex-row items-center bg-surface rounded-2xl p-3.5 mb-3 border border-line">
    {shown.map((c, i, arr) => (
      <View key={i} className="flex-1 flex-row items-center">
        <View className="flex-1 items-center gap-1">
          {c.rating !== undefined && c.rating !== null && <Stars rating={c.rating} size={12} />}
          {!!c.icon && (
            <View className="w-8 h-8 rounded-xl bg-teal-light justify-center items-center">
              <Ionicons name={c.icon} size={16} color={TEAL} />
            </View>
          )}
          {!!toText(c.big) && <Text className="text-[15px] font-extrabold text-ink" numberOfLines={1}>{toText(c.big)}</Text>}
          {toText(c.text) !== "" && (
            <Text className="text-[11px] text-ink font-semibold text-center" numberOfLines={1}>{toText(c.text)}</Text>
          )}
          {!!toText(c.label) && <Text className="text-[10px] text-muted uppercase tracking-wider font-bold">{toText(c.label)}</Text>}
        </View>
        {i < arr.length - 1 && <View className="w-px h-10 bg-line" />}
      </View>
    ))}
  </View>
  )
}

export const Section = ({ title, children }) => (
  <View className="mb-4">
    <Text className="text-[11px] font-extrabold text-muted uppercase tracking-wider mb-2">{title}</Text>
    {children}
  </View>
)

// Wrapped chips in the rotating tile colours. `items` may be strings or { name }.
export const Chips = ({ items, icon = "checkmark-circle" }) => {
  // Invalid entries (null, numbers-as-objects, nameless objects …) are skipped; a non-array renders nothing.
  const labels = (Array.isArray(items) ? items : []).map((it) => (isObject(it) ? toText(it.name) : toText(it))).filter(Boolean)
  if (labels.length === 0) return null
  return (
  <View className="flex-row flex-wrap gap-2">
    {labels.map((label, i) => {
      const t = TILE_THEMES[i % TILE_THEMES.length]
      return (
        <View key={i} className={`flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-xl ${t.bgClass}`}>
          <Ionicons name={icon} size={13} color={t.hex} />
          <Text className="text-[12px] text-ink font-medium">{label}</Text>
        </View>
      )
    })}
  </View>
  )
}

// Highlighted one-liner (best time, age restriction, accessibility …)
export const InfoChip = ({ icon, color = TEAL, bgClass = "bg-teal-light", text }) => !toText(text) ? null : (
  <View className={`flex-row items-center gap-1.5 px-3 py-2 rounded-xl mb-3 ${bgClass}`}>
    <Ionicons name={icon} size={14} color={color} />
    <Text className="text-[12px] font-semibold text-ink flex-1">{toText(text)}</Text>
  </View>
)

export const ContactRow = ({ icon, text, onPress, tone = "teal", chevron }) => {
  if (!toText(text)) return null
  const Wrapper = onPress ? TouchableOpacity : View
  const bg = tone === "brand" ? "bg-brand-light" : "bg-teal-light"
  return (
    <Wrapper className="flex-row items-center gap-2.5 bg-surface px-3 py-2.5 rounded-xl border border-line mb-2" onPress={onPress}>
      <View className={`w-8 h-8 rounded-lg justify-center items-center ${bg}`}>
        <Ionicons name={icon} size={15} color={tone === "brand" ? BRAND : TEAL} />
      </View>
      <Text className="text-[13px] text-ink font-medium flex-1" numberOfLines={1}>{toText(text)}</Text>
      {chevron && <Ionicons name={chevron} size={15} color={MUTED} />}
    </Wrapper>
  )
}

export const DirectionsButton = ({ onPress }) => (
  <TouchableOpacity
    className="flex-row items-center justify-center gap-2 bg-teal-light py-2.5 rounded-2xl mb-4 border border-teal/20"
    onPress={onPress}
    activeOpacity={0.85}
  >
    <Ionicons name="navigate" size={15} color={TEAL} />
    <Text className="text-[13px] font-bold text-teal">Get Directions</Text>
  </TouchableOpacity>
)

export const PrimaryButton = ({ label, onPress }) => (
  <TouchableOpacity className="flex-row items-center justify-between bg-brand px-5 py-3 rounded-2xl" onPress={onPress} activeOpacity={0.88}>
    <Text className="text-[14px] font-bold text-white -tracking-tight">{label}</Text>
    <View className="w-8 h-8 rounded-xl bg-white/25 justify-center items-center">
      <Ionicons name="arrow-forward" size={15} color="#FFFFFF" />
    </View>
  </TouchableOpacity>
)
