import { Modal, View, Text, ScrollView, TouchableOpacity, Platform } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import CoverImage from "./CoverImage"

const TEAL  = "#1B4D5C"
const BRAND = "#E8600A"

/**
 * Full-article / full-event sheet shared by the News and Events screens.
 *  - meta:    [{ icon, text }]   info rows under the title
 *  - body:    string, paragraphs split on new lines
 *  - actions: [{ icon, label, onPress, primary }]
 */
const DetailSheet = ({ visible, onClose, image, fallbackImage, fallbackIcon, pill, pillColor = BRAND, title, meta = [], body, actions = [] }) => {
  const insets = useSafeAreaInsets()
  const paragraphs = String(body || "").split(/\n+/).map((p) => p.trim()).filter(Boolean)

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-bg">
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
          <View style={{ height: 250 }}>
            <CoverImage source={image} fallbackSource={fallbackImage} fallbackIcon={fallbackIcon} iconSize={40} style={{ width: "100%", height: "100%" }} />
            <LinearGradient
              pointerEvents="none"
              colors={["rgba(0,0,0,0.35)", "rgba(0,0,0,0)"]}
              style={{ position: "absolute", top: 0, left: 0, right: 0, height: 90 }}
            />
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{
                position: "absolute", right: 14, top: Platform.OS === "android" ? insets.top + 8 : 14,
                width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.95)",
                justifyContent: "center", alignItems: "center",
              }}
            >
              <Ionicons name="close" size={20} color={TEAL} />
            </TouchableOpacity>
          </View>

          <View className="bg-bg px-5 pt-5" style={{ marginTop: -22, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
            {pill ? (
              <View style={{ alignSelf: "flex-start", backgroundColor: pillColor, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 }}>
                <Text className="text-[10px] font-extrabold text-white uppercase tracking-[0.6px]">{pill}</Text>
              </View>
            ) : null}

            <Text className="text-[22px] font-extrabold text-ink -tracking-[0.4px] mt-2.5" style={{ lineHeight: 28 }}>{title}</Text>

            {meta.length > 0 && (
              <View className="mt-3 gap-1.5">
                {meta.map((m, i) => (
                  <View key={i} className="flex-row items-center">
                    <Ionicons name={m.icon} size={15} color={TEAL} />
                    <Text className="text-[13px] font-semibold text-ink-soft ml-2 flex-1">{m.text}</Text>
                  </View>
                ))}
              </View>
            )}

            {actions.length > 0 && (
              <View className="flex-row gap-2.5 mt-4">
                {actions.map((a, i) => (
                  <TouchableOpacity
                    key={i}
                    activeOpacity={0.85}
                    onPress={a.onPress}
                    className={`flex-1 flex-row items-center justify-center py-3 rounded-2xl ${a.primary ? "bg-brand" : "bg-surface border border-line"}`}
                  >
                    <Ionicons name={a.icon} size={16} color={a.primary ? "#fff" : TEAL} />
                    <Text className={`text-[13px] font-extrabold ml-1.5 ${a.primary ? "text-white" : "text-teal"}`}>{a.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {paragraphs.length > 0 && <View className="h-px bg-line mt-5 mb-4" />}
            {paragraphs.map((p, i) => (
              <Text key={i} className="text-[14.5px] text-ink leading-6 mb-3">{p}</Text>
            ))}
          </View>
        </ScrollView>
      </View>
    </Modal>
  )
}

export default DetailSheet
