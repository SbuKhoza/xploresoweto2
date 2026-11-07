import { useEffect, useMemo, useState } from "react"
import { Modal, View, Text, TextInput, TouchableOpacity, FlatList, Platform } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import GlossyBackground from "./GlossyBackground"
import { getKasiOptions } from "../utils/townshipList"
import { useTownships } from "../hooks/useTownships"

const BRAND = "#E8600A"
const TEAL = "#1B4D5C"

const rowShadow = {
  shadowColor: "#2B5FA8", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 10, elevation: 3,
}

/**
 * Pick-only township chooser (no typing a township name).
 * Options come from utils/townshipList.js plus any township saved in Firestore.
 *   <KasiPicker visible value={city} onClose={...} onSelect={(name) => ...} />
 */
const KasiPicker = ({ visible, value, onClose, onSelect }) => {
  const insets = useSafeAreaInsets()
  const [query, setQuery] = useState("")
  const { townships } = useTownships()   // dynamic + cached offline; hidden townships are excluded

  useEffect(() => { if (visible) setQuery("") }, [visible])

  // Built-in kasi list + every active township from the CMS
  const remoteNames = useMemo(() => townships.map((t) => t.info.name), [townships])

  const options = useMemo(() => getKasiOptions(remoteNames), [remoteNames])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((n) => n.toLowerCase().includes(q)) : options
  }, [options, query])

  const current = (value || "").trim().toLowerCase()

  const renderItem = ({ item }) => {
    const on = item.toLowerCase() === current
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => { onSelect(item); onClose() }}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`Choose ${item}`}
        className="flex-row items-center rounded-2xl px-4 py-3.5 mb-2.5 border"
        style={{ backgroundColor: on ? "#FFF1E8" : "#FFFFFF", borderColor: on ? BRAND : "#DDE2EA", ...rowShadow }}
      >
        <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: on ? BRAND : "#C9E8F3" }}>
          <Ionicons name="location" size={18} color={on ? "#fff" : TEAL} />
        </View>
        <Text className="flex-1 text-[15px] font-bold text-ink ml-3">{item}</Text>
        <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={22} color={on ? BRAND : "#B5BDBF"} />
      </TouchableOpacity>
    )
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-bg">
        <GlossyBackground />

        <View className="px-5" style={{ paddingTop: Platform.OS === "android" ? insets.top + 14 : 22 }}>
          <View className="flex-row items-center">
            <View className="flex-1">
              <Text className="text-[22px] font-extrabold text-ink -tracking-[0.4px]">Choose your township</Text>
              <Text className="text-[13px] text-muted mt-0.5">Pick your kasi from the list.</Text>
            </View>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              className="w-9 h-9 rounded-full bg-surface items-center justify-center border border-line">
              <Ionicons name="close" size={19} color={TEAL} />
            </TouchableOpacity>
          </View>

          <View className="flex-row items-center h-[46px] rounded-full bg-surface px-3.5 border border-line mt-4" style={rowShadow}>
            <Ionicons name="search" size={17} color="#5E7088" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search townships…"
              placeholderTextColor="#9AA9AE"
              autoCapitalize="none"
              autoCorrect={false}
              className="flex-1 ml-2.5 text-[14px] text-ink"
              style={{ paddingVertical: 0 }}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={18} color="#B5BDBF" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <FlatList
          data={filtered}
          keyExtractor={(n) => n}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={<Text className="text-[13px] text-muted text-center mt-8">No township matches “{query}”.</Text>}
        />
      </View>
    </Modal>
  )
}

export default KasiPicker