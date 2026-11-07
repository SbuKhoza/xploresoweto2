"use client"
import { useState, useMemo, useCallback } from "react"
import {
  Text, View, TouchableOpacity, ActivityIndicator, RefreshControl,
} from "react-native"
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons"
import { useScrollTracking, AnimatedFlatList } from "../BottomNav"
import { useOfflineData } from "../../hooks/useOfflineData"
import OfflineIndicator from "../OfflineIndicator"

// ── Status → color mapping ───────────────────────────────────────────────────
const STATUS_STYLES = {
  "On Time":   { bg: "bg-success-light", text: "text-success", dot: "bg-success" },
  "Delayed":   { bg: "bg-warning-light", text: "text-warning", dot: "bg-warning" },
  "Suspended": { bg: "bg-danger-light",  text: "text-danger",  dot: "bg-danger"  },
}
const DEFAULT_STATUS_STYLE = { bg: "bg-teal-light", text: "text-teal", dot: "bg-teal" }

// Mode metadata. Modes are dynamic: any `mode` value found in Firestore gets its own tab;
// these just provide nicer labels/icons/ordering for the common ones.
const MODE_ICON = { bus: "bus", train: "train", taxi: "taxi", tram: "tram" }
const MODE_ORDER = ["bus", "train", "taxi"]
const modeLabel = (m) => m.charAt(0).toUpperCase() + m.slice(1)

const Transport = () => {
  const [selectedMode, setSelectedMode] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const scrollProps = useScrollTracking()

  const offlineOptions = useMemo(() => ({ maxAgeMinutes: 30, enableBackgroundRefresh: true }), [])
  const { data, loading, isOffline, lastUpdated, refresh } = useOfflineData("transport", offlineOptions)

  // Fully dynamic: only active routes from Firestore, ordered by the CMS `order` field
  const routes = useMemo(
    () => (data || [])
      .filter(r => r.isActive !== false && r.routeName)
      .sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || String(a.routeName).localeCompare(String(b.routeName))),
    [data]
  )

  // Tabs = the modes that actually have routes
  const modes = useMemo(() => {
    const found = [...new Set(routes.map(r => (r.mode || "bus").toLowerCase()))]
    return found.sort((a, b) => {
      const ia = MODE_ORDER.indexOf(a), ib = MODE_ORDER.indexOf(b)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b)
    })
  }, [routes])
  const mode = modes.includes(selectedMode) ? selectedMode : modes[0]

  const filteredRoutes = useMemo(
    () => routes.filter(r => (r.mode || "bus").toLowerCase() === mode),
    [routes, mode]
  )

  const toggleExpand = useCallback((id) => {
    setExpandedId(prev => (prev === id ? null : id))
  }, [])

  const RouteCard = useCallback(({ item }) => {
    const isExpanded = expandedId === item.id
    const statusStyle = STATUS_STYLES[item.status] || DEFAULT_STATUS_STYLE
    const nextDepartures = (item.departures || []).slice(0, 4)

    return (
      <View className={`bg-surface rounded-2xl mb-3 overflow-hidden border border-line ${isExpanded ? "shadow-md" : "shadow-sm"}`}>
        <TouchableOpacity className="p-4" activeOpacity={0.85} onPress={() => toggleExpand(item.id)}>
          <View className="flex-row items-center gap-3">
            <View className="w-12 h-12 rounded-2xl bg-teal-light justify-center items-center">
              <MaterialCommunityIcons name={MODE_ICON[(item.mode || "bus").toLowerCase()] || "bus-multiple"} size={24} color="#1B4D5C" />
            </View>
            <View className="flex-1">
              <Text className="text-[15px] font-extrabold text-ink -tracking-tight" numberOfLines={1}>{item.routeName}</Text>
              <Text className="text-xs text-muted font-medium mt-0.5" numberOfLines={1}>{item.operator}</Text>
            </View>
            <View className={`px-2.5 py-1 rounded-full flex-row items-center gap-1 ${statusStyle.bg}`}>
              <View className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
              <Text className={`text-[10px] font-extrabold uppercase tracking-wide ${statusStyle.text}`}>{item.status}</Text>
            </View>
          </View>

          <View className="flex-row items-center mt-3 gap-2">
            <Ionicons name="ellipse" size={7} color="#1B4D5C" />
            <Text className="text-xs text-ink font-semibold flex-1" numberOfLines={1}>{item.origin}</Text>
          </View>
          <View className="ml-[3px] w-px h-3 bg-line" />
          <View className="flex-row items-center gap-2">
            <Ionicons name="location" size={9} color="#E8600A" />
            <Text className="text-xs text-ink font-semibold flex-1" numberOfLines={1}>{item.destination}</Text>
          </View>

          <View className="flex-row items-center justify-between mt-3">
            <View className="flex-row items-center gap-1">
              <Ionicons name="time-outline" size={13} color="#7A8A8F" />
              <Text className="text-xs text-muted font-medium">{[item.frequency, item.days].filter(Boolean).join(" · ")}</Text>
            </View>
            <View className="flex-row items-center gap-1">
              <Ionicons name="cash-outline" size={13} color="#7A8A8F" />
              <Text className="text-xs text-muted font-medium">{item.fare}</Text>
            </View>
            <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color={isExpanded ? "#E8600A" : "#AAAAAA"} />
          </View>

          {item.notice ? (
            <View className="flex-row items-start gap-1.5 mt-3 px-3 py-2 rounded-xl bg-warning-light">
              <Ionicons name="warning-outline" size={14} color="#92400E" style={{ marginTop: 1 }} />
              <Text className="flex-1 text-[12px] font-semibold text-[#92400E]">{item.notice}</Text>
            </View>
          ) : null}

          {nextDepartures.length > 0 && (
            <View className="flex-row flex-wrap gap-2 mt-3">
              {nextDepartures.map((t, i) => (
                <View key={i} className="px-2.5 py-1 rounded-lg bg-bg border border-line">
                  <Text className="text-[11px] font-bold text-ink">{t}</Text>
                </View>
              ))}
            </View>
          )}
        </TouchableOpacity>

        {isExpanded && (
          <View className="px-4 pb-4 pt-1 border-t border-line gap-3">
            {item.stops?.length > 0 && (
              <View>
                <Text className="text-[11px] font-extrabold text-muted uppercase tracking-wider mb-2">Stops along the route</Text>
                {item.stops.map((s, i) => (
                  <View key={i} className="flex-row items-center gap-2 mb-1.5">
                    <View className={`w-2 h-2 rounded-full ${i === 0 || i === item.stops.length - 1 ? "bg-brand" : "bg-line"}`} />
                    <Text className="text-[13px] text-ink">{s}</Text>
                  </View>
                ))}
              </View>
            )}
            {item.departures?.length > 0 && (
              <View>
                <Text className="text-[11px] font-extrabold text-muted uppercase tracking-wider mb-2">All departures today</Text>
                <View className="flex-row flex-wrap gap-2">
                  {item.departures.map((t, i) => (
                    <View key={i} className="px-2.5 py-1 rounded-lg bg-teal-light">
                      <Text className="text-[11px] font-bold text-teal">{t}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}
      </View>
    )
  }, [expandedId, toggleExpand])

  const renderItem = useCallback(({ item }) => <RouteCard item={item} />, [RouteCard])

  if (loading && routes.length === 0) {
    return (
      <View className="flex-1 bg-bg justify-center items-center px-10">
        <View className="w-20 h-20 rounded-3xl bg-teal-light justify-center items-center mb-4">
          <MaterialCommunityIcons name="bus-clock" size={36} color="#1B4D5C" />
        </View>
        <ActivityIndicator size="large" color="#E8600A" style={{ marginTop: 8 }} />
        <Text className="text-base font-bold text-ink mt-3 text-center">Loading transit schedules…</Text>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-bg">
      <OfflineIndicator />

      {isOffline && (
        <View className="flex-row items-center justify-center gap-1.5 bg-warning-light py-2 border-b border-warning/30">
          <Ionicons name="cloud-offline-outline" size={14} color="#92400E" />
          <Text className="text-[13px] text-[#92400E] font-semibold">Showing cached schedules</Text>
        </View>
      )}


      {/* Header */}
      <View className="flex-row justify-between items-center px-[22px] pt-3.5 pb-2.5">
        <View>
          <Text className="text-lg font-extrabold text-ink -tracking-tight">Transport</Text>
          <Text className="text-[13px] text-muted font-medium mt-0.5">Live routes & schedules</Text>
        </View>
        <View className="w-11 h-11 rounded-2xl bg-surface justify-center items-center border border-line">
          <Ionicons name="navigate-outline" size={20} color="#1B4D5C" />
        </View>
      </View>

      {/* Mode tab bar — built from whatever modes exist in Firestore */}
      {modes.length > 1 && (
        <View className="flex-row bg-surface mx-5 mb-2.5 rounded-2xl p-1 border border-line">
          {modes.map(m => (
            <TouchableOpacity key={m}
              className={`flex-1 flex-row items-center justify-center py-2.5 rounded-xl gap-1.5 ${mode === m ? "bg-brand-light" : ""}`}
              onPress={() => { setSelectedMode(m); setExpandedId(null) }}>
              <MaterialCommunityIcons name={MODE_ICON[m] || "bus-multiple"} size={16} color={mode === m ? "#E8600A" : "#AAAAAA"} />
              <Text className={`text-[13px] font-bold ${mode === m ? "text-brand" : "text-[#AAAAAA]"}`}>{modeLabel(m)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View className="px-5 py-2">
        <Text className="text-[13px] text-muted font-medium">
          <Text className="font-extrabold text-ink">{filteredRoutes.length}</Text> {mode || "transport"} route{filteredRoutes.length !== 1 ? "s" : ""} available
        </Text>
      </View>

      <AnimatedFlatList
        data={filteredRoutes}
        keyExtractor={item => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} colors={["#E8600A"]} tintColor="#E8600A" />}
        ListEmptyComponent={() => (
          <View className="items-center py-16">
            <View className="w-20 h-20 rounded-3xl bg-teal-light justify-center items-center mb-4">
              <MaterialCommunityIcons name={isOffline ? "cloud-off-outline" : "bus-clock"} size={40} color="#1B4D5C" />
            </View>
            <Text className="text-[17px] font-extrabold text-ink">{isOffline ? "You're offline" : "No routes yet"}</Text>
            <Text className="text-[13px] text-muted mt-1.5 text-center">
              {isOffline ? "Connect once to download the latest schedules." : "Transport routes will appear here as soon as they're added."}
            </Text>
          </View>
        )}
        {...scrollProps}
      />

      {lastUpdated && (
        <View className="flex-row items-center justify-center gap-1 py-2 bg-bg">
          <Ionicons name="time-outline" size={12} color="#BBBBBB" />
          <Text className="text-xs text-[#BBBBBB]">Updated {lastUpdated.toLocaleTimeString()}</Text>
        </View>
      )}
    </View>
  )
}

export default Transport
