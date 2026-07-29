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

const MODE_ICON = { bus: "bus", train: "train" }

// Fallback demo data shown before Firestore has a "transport" collection populated,
// so the screen never looks broken out of the box.
const FALLBACK_ROUTES = [
  { id: "b1", mode: "bus", routeName: "Soweto — Johannesburg CBD", operator: "Metrobus 615", origin: "Baragwanath", destination: "Park Station", frequency: "Every 15 min", fare: "R14.50", status: "On Time", departures: ["05:00","05:20","05:40","06:00","06:20","06:40","07:00"], stops: ["Baragwanath","Chris Hani Rd","Nasrec","Crown City","Park Station"] },
  { id: "b2", mode: "bus", routeName: "Orlando — Soweto Theatre", operator: "Rea Vaya T1", origin: "Orlando Stadium", destination: "Thokoza Park", frequency: "Every 10 min", fare: "R13.00", status: "On Time", departures: ["05:30","05:40","05:50","06:00","06:10"], stops: ["Orlando Stadium","Vilakazi St","Soweto Theatre","Thokoza Park"] },
  { id: "t1", mode: "train", routeName: "Naledi — Johannesburg Line", operator: "Metrorail", origin: "Naledi", destination: "Park Station", frequency: "Every 30 min", fare: "R9.50", status: "Delayed", departures: ["06:00","06:30","07:00","07:30"], stops: ["Naledi","Dube","New Canada","Ellis Park","Park Station"] },
  { id: "t2", mode: "train", routeName: "Merafong Line", operator: "Metrorail", origin: "Randfontein", destination: "Johannesburg", frequency: "Every 45 min", fare: "R11.00", status: "On Time", departures: ["05:15","06:00","06:45"], stops: ["Randfontein","Westonaria","Soweto","Johannesburg"] },
]

const Transport = () => {
  const [mode, setMode] = useState("bus")           // "bus" | "train"
  const [expandedId, setExpandedId] = useState(null)
  const scrollProps = useScrollTracking()

  const offlineOptions = useMemo(() => ({ maxAgeMinutes: 30, enableBackgroundRefresh: true }), [])
  const { data, loading, error, isOffline, lastUpdated, refresh } = useOfflineData("transport", offlineOptions)

  const routes = (data && data.length > 0) ? data : FALLBACK_ROUTES
  const usingFallback = !data || data.length === 0

  const filteredRoutes = useMemo(
    () => routes.filter(r => (r.mode || "bus") === mode && r.isActive !== false),
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
              <MaterialCommunityIcons name={MODE_ICON[item.mode] || "bus"} size={24} color="#1B4D5C" />
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
              <Text className="text-xs text-muted font-medium">{item.frequency}</Text>
            </View>
            <View className="flex-row items-center gap-1">
              <Ionicons name="cash-outline" size={13} color="#7A8A8F" />
              <Text className="text-xs text-muted font-medium">{item.fare}</Text>
            </View>
            <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color={isExpanded ? "#E8600A" : "#AAAAAA"} />
          </View>

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

  if (loading && (!data || data.length === 0)) {
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

      {usingFallback && !isOffline && (
        <View className="flex-row items-center justify-center gap-1.5 bg-teal-light py-2 border-b border-teal/20">
          <Ionicons name="information-circle-outline" size={14} color="#1B4D5C" />
          <Text className="text-[13px] text-teal font-semibold">Sample routes — connect Firestore "transport" data for live info</Text>
        </View>
      )}

      {/* Header */}
      <View className="flex-row justify-between items-center px-[22px] pt-3.5 pb-2.5">
        <View>
          <Text className="text-lg font-extrabold text-ink -tracking-tight">Transport</Text>
          <Text className="text-[13px] text-muted font-medium mt-0.5">Bus & train schedules</Text>
        </View>
        <View className="w-11 h-11 rounded-2xl bg-surface justify-center items-center border border-line">
          <Ionicons name="navigate-outline" size={20} color="#1B4D5C" />
        </View>
      </View>

      {/* Mode tab bar */}
      <View className="flex-row bg-surface mx-5 mb-2.5 rounded-2xl p-1 border border-line">
        {[
          { key: "bus",   label: "Bus",   icon: "bus" },
          { key: "train", label: "Train", icon: "train" },
        ].map(tab => (
          <TouchableOpacity key={tab.key}
            className={`flex-1 flex-row items-center justify-center py-2.5 rounded-xl gap-1.5 ${mode === tab.key ? "bg-brand-light" : ""}`}
            onPress={() => { setMode(tab.key); setExpandedId(null) }}>
            <MaterialCommunityIcons name={tab.icon} size={16} color={mode === tab.key ? "#E8600A" : "#AAAAAA"} />
            <Text className={`text-[13px] font-bold ${mode === tab.key ? "text-brand" : "text-[#AAAAAA]"}`}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View className="px-5 py-2">
        <Text className="text-[13px] text-muted font-medium">
          <Text className="font-extrabold text-ink">{filteredRoutes.length}</Text> {mode} route{filteredRoutes.length !== 1 ? "s" : ""} available
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
              <MaterialCommunityIcons name={MODE_ICON[mode]} size={40} color="#1B4D5C" />
            </View>
            <Text className="text-[17px] font-extrabold text-ink">No {mode} routes yet</Text>
            <Text className="text-[13px] text-muted mt-1.5 text-center">Check back later or try the other mode</Text>
          </View>
        )}
        {...scrollProps}
      />

      {lastUpdated && !usingFallback && (
        <View className="flex-row items-center justify-center gap-1 py-2 bg-bg">
          <Ionicons name="time-outline" size={12} color="#BBBBBB" />
          <Text className="text-xs text-[#BBBBBB]">Updated {lastUpdated.toLocaleTimeString()}</Text>
        </View>
      )}
    </View>
  )
}

export default Transport
