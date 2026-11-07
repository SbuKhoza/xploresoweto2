import { useState, useMemo, useEffect } from "react"
import { Modal, View, Text, ScrollView, TouchableOpacity, Platform, Image } from "react-native"
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { getTownshipInfo } from "../../utils/townships"

const TEAL = "#1B4D5C"
const BRAND = "#E8600A"

// Avatar colours for the "Local legends" cards
const AVATAR_COLORS = ["#E8600A", "#0A86B4", "#1FA463", "#7A4FE0", "#E0356F", "#0E8F94", "#D99A00", "#12407E"]

const initials = (name = "") =>
  name.replace(/["“”].*?["“”]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")

const cardShadow = {
  shadowColor: "#2B5FA8", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.14, shadowRadius: 14, elevation: 4,
}

const TABS = [
  { key: "about",    label: "About",    icon: "information-circle" },
  { key: "history",  label: "History",  icon: "time" },
  { key: "people",   label: "Legends",  icon: "star" },
  { key: "places",   label: "Places",   icon: "location" },
]

/**
 * Township info sheet: overview, history timeline, local celebrities, landmarks
 * and fun facts. Pass a township name (string) or a Firestore township document.
 *  - onExplore(name): optional — shows an "Explore places in …" button.
 */
const TownshipSheet = ({ visible, onClose, township, index = 0, onExplore }) => {
  const insets = useSafeAreaInsets()
  const [tab, setTab] = useState("about")
  const info = useMemo(() => (township ? getTownshipInfo(township, index) : null), [township, index])

  useEffect(() => { if (visible) setTab("about") }, [visible, township])

  if (!info) return null
  const [c1, c2] = info.colors

  // Only offer tabs that have content
  const tabs = TABS.filter((t) => {
    if (t.key === "history") return info.history.length > 0
    if (t.key === "people") return info.people.length > 0
    if (t.key === "places") return info.landmarks.length > 0 || info.facts.length > 0
    return true
  })

  const Section = ({ title, children }) => (
    <View className="mt-5">
      <Text className="text-[15px] font-extrabold text-ink mb-2.5">{title}</Text>
      {children}
    </View>
  )

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-bg">
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>

          {/* ── Hero ── */}
          <LinearGradient colors={[c1, c2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ paddingTop: Platform.OS === "android" ? insets.top + 18 : 26, paddingBottom: 44, paddingHorizontal: 20, overflow: "hidden" }}>
            {info.imageUrl ? (
              <Image source={{ uri: info.imageUrl }} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.35 }} resizeMode="cover" />
            ) : null}
            {/* glassy highlight */}
            <LinearGradient pointerEvents="none" colors={["rgba(255,255,255,0.28)", "rgba(255,255,255,0)"]}
              style={{ position: "absolute", top: 0, left: 0, right: 0, height: "70%" }} />
            <View style={{ position: "absolute", right: -40, top: -40, width: 160, height: 160, borderRadius: 80, backgroundColor: "rgba(255,255,255,0.12)" }} />

            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ alignSelf: "flex-end", width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.95)", justifyContent: "center", alignItems: "center" }}>
              <Ionicons name="close" size={20} color={TEAL} />
            </TouchableOpacity>

            <View style={{ alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.22)", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, marginTop: 6 }}>
              <Text className="text-[10px] font-extrabold text-white uppercase tracking-[0.6px]">Soweto township</Text>
            </View>
            <Text className="text-[30px] font-extrabold text-white -tracking-[0.6px] mt-2.5">{info.name}</Text>
            {info.area ? <Text className="text-[13px] font-semibold text-white mt-0.5" style={{ opacity: 0.9 }}>{info.area}</Text> : null}
            <Text className="text-[14px] text-white mt-2.5" style={{ lineHeight: 20, opacity: 0.95 }}>{info.tagline}</Text>
          </LinearGradient>

          {/* ── Body ── */}
          <View className="bg-bg px-4" style={{ marginTop: -22, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16 }}>

            {/* Quick facts */}
            <View className="flex-row gap-2.5">
              {info.established ? (
                <View className="flex-1 bg-surface rounded-2xl p-3 border border-line" style={cardShadow}>
                  <Ionicons name="calendar" size={16} color={c1} />
                  <Text className="text-[10px] font-bold text-muted uppercase mt-1.5">Established</Text>
                  <Text className="text-[14px] font-extrabold text-ink mt-0.5">{info.established}</Text>
                </View>
              ) : null}
              <View className="flex-1 bg-surface rounded-2xl p-3 border border-line" style={cardShadow}>
                <Ionicons name="people" size={16} color={c1} />
                <Text className="text-[10px] font-bold text-muted uppercase mt-1.5">Local legends</Text>
                <Text className="text-[14px] font-extrabold text-ink mt-0.5">{info.people.length > 0 ? `${info.people.length} featured` : "Coming soon"}</Text>
              </View>
              {info.landmarks.length > 0 ? (
                <View className="flex-1 bg-surface rounded-2xl p-3 border border-line" style={cardShadow}>
                  <Ionicons name="location" size={16} color={c1} />
                  <Text className="text-[10px] font-bold text-muted uppercase mt-1.5">Landmarks</Text>
                  <Text className="text-[14px] font-extrabold text-ink mt-0.5">{info.landmarks.length}</Text>
                </View>
              ) : null}
            </View>

            {onExplore ? (
              <TouchableOpacity activeOpacity={0.85} onPress={() => onExplore(info.name)}
                className="flex-row items-center justify-center py-3.5 rounded-2xl mt-4" style={{ backgroundColor: BRAND, ...cardShadow }}>
                <Ionicons name="search" size={16} color="#fff" />
                <Text className="text-[14px] font-extrabold text-white ml-2">Explore places in {info.name}</Text>
              </TouchableOpacity>
            ) : null}

            {/* Tabs */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-5" contentContainerStyle={{ gap: 8 }}>
              {tabs.map((t) => {
                const on = tab === t.key
                return (
                  <TouchableOpacity key={t.key} activeOpacity={0.85} onPress={() => setTab(t.key)}
                    className="flex-row items-center px-4 py-2.5 rounded-full"
                    style={{ backgroundColor: on ? c1 : "#FFFFFF", borderWidth: 1, borderColor: on ? c1 : "#DDE2EA" }}>
                    <Ionicons name={on ? t.icon : `${t.icon}-outline`} size={15} color={on ? "#fff" : TEAL} />
                    <Text className="text-[13px] font-extrabold ml-1.5" style={{ color: on ? "#fff" : TEAL }}>{t.label}</Text>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>

            {/* ── ABOUT ── */}
            {tab === "about" && (
              <View>
                <Section title={`About ${info.name}`}>
                  <View className="bg-surface rounded-2xl p-4 border border-line" style={cardShadow}>
                    <Text className="text-[14.5px] text-ink leading-6">{info.overview || `More about ${info.name} is coming soon.`}</Text>
                  </View>
                </Section>
                {info.namedAfter ? (
                  <Section title="Where the name comes from">
                    <View className="flex-row bg-surface rounded-2xl p-4 border border-line" style={cardShadow}>
                      <Ionicons name="bookmark" size={18} color={c1} />
                      <Text className="flex-1 text-[14px] text-ink leading-6 ml-2.5">Named after {info.namedAfter}.</Text>
                    </View>
                  </Section>
                ) : null}
                {info.people.length > 0 && (
                  <Section title="Local legends">
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                      {info.people.slice(0, 6).map((p, i) => (
                        <TouchableOpacity key={p.name} activeOpacity={0.85} onPress={() => setTab("people")}
                          className="items-center bg-surface rounded-2xl py-3 px-2 border border-line" style={{ width: 104, ...cardShadow }}>
                          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length], alignItems: "center", justifyContent: "center" }}>
                            <Text className="text-[17px] font-extrabold text-white">{initials(p.name)}</Text>
                          </View>
                          <Text className="text-[12px] font-extrabold text-ink mt-2 text-center" numberOfLines={2}>{p.name.replace(/"/g, "")}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </Section>
                )}
              </View>
            )}

            {/* ── HISTORY ── */}
            {tab === "history" && (
              <Section title="Timeline">
                {info.history.map((h, i) => (
                  <View key={i} className="flex-row">
                    <View className="items-center" style={{ width: 22 }}>
                      <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: c1, borderWidth: 3, borderColor: "#fff", ...cardShadow }} />
                      {i < info.history.length - 1 && <View style={{ flex: 1, width: 2, backgroundColor: c1, opacity: 0.25, marginTop: 2 }} />}
                    </View>
                    <View className="flex-1 pb-4 pl-2">
                      {h.year ? (
                        <View style={{ alignSelf: "flex-start", backgroundColor: c1, paddingHorizontal: 9, paddingVertical: 2, borderRadius: 999 }}>
                          <Text className="text-[11px] font-extrabold text-white">{h.year}</Text>
                        </View>
                      ) : null}
                      <View className="bg-surface rounded-2xl p-3.5 border border-line mt-1.5" style={cardShadow}>
                        <Text className="text-[14px] text-ink leading-[21px]">{h.text}</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </Section>
            )}

            {/* ── PEOPLE ── */}
            {tab === "people" && (
              <Section title={`Famous faces from ${info.name}`}>
                {info.people.map((p, i) => (
                  <View key={p.name + i} className="flex-row items-center bg-surface rounded-2xl p-3.5 border border-line mb-2.5" style={cardShadow}>
                    <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length], alignItems: "center", justifyContent: "center" }}>
                      <Text className="text-[16px] font-extrabold text-white">{initials(p.name)}</Text>
                    </View>
                    <View className="flex-1 ml-3">
                      <Text className="text-[14.5px] font-extrabold text-ink">{p.name}</Text>
                      {p.role ? <Text className="text-[12px] font-bold mt-0.5" style={{ color: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>{p.role}</Text> : null}
                      {p.note ? <Text className="text-[12.5px] text-muted mt-1" style={{ lineHeight: 18 }}>{p.note}</Text> : null}
                    </View>
                  </View>
                ))}
              </Section>
            )}

            {/* ── PLACES & FACTS ── */}
            {tab === "places" && (
              <View>
                {info.landmarks.length > 0 && (
                  <Section title="Landmarks & places to know">
                    {info.landmarks.map((l, i) => (
                      <View key={l.name + i} className="flex-row bg-surface rounded-2xl p-3.5 border border-line mb-2.5" style={cardShadow}>
                        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c1, alignItems: "center", justifyContent: "center" }}>
                          <MaterialCommunityIcons name={l.icon || "map-marker"} size={21} color="#fff" />
                        </View>
                        <View className="flex-1 ml-3">
                          <Text className="text-[14.5px] font-extrabold text-ink">{l.name}</Text>
                          {l.text ? <Text className="text-[12.5px] text-muted mt-1" style={{ lineHeight: 18 }}>{l.text}</Text> : null}
                        </View>
                      </View>
                    ))}
                  </Section>
                )}
                {info.facts.length > 0 && (
                  <Section title="Did you know?">
                    {info.facts.map((f, i) => (
                      <View key={i} className="flex-row bg-surface rounded-2xl p-3.5 border border-line mb-2.5" style={cardShadow}>
                        <Ionicons name="bulb" size={18} color="#D99A00" />
                        <Text className="flex-1 text-[13.5px] text-ink leading-5 ml-2.5">{f}</Text>
                      </View>
                    ))}
                  </Section>
                )}
              </View>
            )}

          </View>
        </ScrollView>
      </View>
    </Modal>
  )
}

export default TownshipSheet