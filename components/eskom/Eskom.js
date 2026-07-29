"use client"

import { useEffect, useState } from "react"
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from "react-native"
import { getUserLocation, reverseGeocode } from "../../utils/getLocation"
import { useOfflineData } from "../../hooks/useOfflineData"
import { seedFirestoreIfNeeded } from "../../utils/seedLoadshedding"

const getEskomStage = async () => {
  try {
    const response = await fetch("https://loadshedding.eskom.co.za/LoadShedding/GetStatus")
    const stageCode = await response.text()
    const stageNumber = Number.parseInt(stageCode, 10) - 1
    return stageNumber > 0 ? stageNumber : 0
  } catch (error) {
    console.warn("Failed to fetch Eskom stage:", error)
    return 0
  }
}

const getCurrentTimeSlots = (schedule, currentStage, currentDay) => {
  if (!schedule || currentStage === 0) return []

  const today = currentDay.toLowerCase()
  const currentSlots = []

  // Get cumulative stages (e.g., stage 3 includes stage 1 and 2)
  for (let stage = 1; stage <= currentStage; stage++) {
    const stageKey = `stage_${stage}`
    if (schedule[stageKey] && schedule[stageKey][today]) {
      currentSlots.push(...schedule[stageKey][today])
    }
  }

  return [...new Set(currentSlots)] // Remove duplicates
}

const getCurrentDay = () => {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
  return days[new Date().getDay()]
}

const ImprovedEskom = () => {
  const [searchQuery, setSearchQuery] = useState("")
  const [detectedSuburb, setDetectedSuburb] = useState(null)
  const [filteredData, setFilteredData] = useState([])
  const [loadingLocation, setLoadingLocation] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [currentStage, setCurrentStage] = useState(0)
  const [selectedSuburb, setSelectedSuburb] = useState(null)
  const [currentDay] = useState(getCurrentDay())

  const {
    data: schedules,
    loading,
    refresh,
  } = useOfflineData("loadshedding", {
    orderByField: "suburb",
    enableBackgroundRefresh: true,
    maxAgeMinutes: 60,
  })

  useEffect(() => {
    seedFirestoreIfNeeded()
  }, [])

  useEffect(() => {
    const init = async () => {
      try {
        const coords = await getUserLocation()
        if (coords) {
          const suburb = await reverseGeocode(coords.latitude, coords.longitude)
          setDetectedSuburb(suburb)
          setSearchQuery(suburb)
        }
      } catch (error) {
        console.warn("Location detection failed:", error)
      } finally {
        setLoadingLocation(false)
      }

      const liveStage = await getEskomStage()
      setCurrentStage(liveStage)
    }

    init()
  }, [])

  useEffect(() => {
    if (searchQuery.length === 0) {
      setFilteredData([])
      return
    }

    const filtered = schedules.filter(
      (item) => item.suburb && item.suburb.toLowerCase().includes(searchQuery.toLowerCase()),
    )
    setFilteredData(filtered)
  }, [searchQuery, schedules])

  const handleRefresh = async () => {
    setRefreshing(true)
    await refresh()
    const liveStage = await getEskomStage()
    setCurrentStage(liveStage)
    setRefreshing(false)
  }

  const renderCurrentSchedule = (schedule) => {
    if (currentStage === 0) {
      return (
        <View style={styles.noLoadsheddingContainer}>
          <Text style={styles.noLoadshedding}>No Load Shedding Currently</Text>
        </View>
      )
    }

    const todaySlots = getCurrentTimeSlots(schedule, currentStage, currentDay)

    if (todaySlots.length === 0) {
      return (
        <View style={styles.noSlotsContainer}>
          <Text style={styles.noSlots}>No load shedding scheduled for today</Text>
        </View>
      )
    }

    return (
      <View style={styles.currentScheduleContainer}>
        <Text style={styles.todayHeader}>Today's Schedule (Stage {currentStage}):</Text>
        {todaySlots.map((slot, index) => (
          <Text key={index} style={styles.currentSlot}>
            • {slot}
          </Text>
        ))}
      </View>
    )
  }

  const renderFullSchedule = (schedule) => {
    const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

    return Object.keys(schedule || {})
      .filter((stageKey) => stageKey.startsWith("stage_"))
      .sort()
      .map((stageKey) => (
        <View key={stageKey} style={styles.scheduleBlock}>
          <Text style={styles.stageHeader}>{stageKey.replace("_", " ").toUpperCase()}</Text>
          {days.map((day) => {
            const daySlots = schedule[stageKey]?.[day] || []
            if (daySlots.length === 0) return null

            return (
              <View key={day} style={styles.dayContainer}>
                <Text style={styles.dayText}>{day.charAt(0).toUpperCase() + day.slice(1)}:</Text>
                {daySlots.map((slot, index) => (
                  <Text key={index} style={styles.slot}>
                    • {slot}
                  </Text>
                ))}
              </View>
            )
          })}
        </View>
      ))
  }

  const renderSchedule = ({ item }) => {
    if (!item.schedule) {
      return (
        <View style={styles.card}>
          <Text style={styles.suburb}>{item.suburb}</Text>
          <Text style={styles.errorText}>No schedule data available</Text>
        </View>
      )
    }

    const isSelected = selectedSuburb === item.suburb
    const stageDisplay = currentStage > 0 ? `Stage ${currentStage}` : "No Load Shedding"

    return (
      <View style={styles.card}>
        <Text style={styles.suburb}>{item.suburb}</Text>
        <Text style={styles.status}>Currently: {stageDisplay}</Text>

        {renderCurrentSchedule(item.schedule)}

        {isSelected ? (
          <>
            <View style={styles.separator} />
            <Text style={styles.fullScheduleHeader}>Full Weekly Schedule:</Text>
            {renderFullSchedule(item.schedule)}
            <TouchableOpacity style={styles.closeButton} onPress={() => setSelectedSuburb(null)}>
              <Text style={styles.closeButtonText}>Close Full Schedule</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={styles.expandButton} onPress={() => setSelectedSuburb(item.suburb)}>
            <Text style={styles.expandButtonText}>View Full Weekly Schedule</Text>
          </TouchableOpacity>
        )}
      </View>
    )
  }

  const renderEmptyState = () => {
    if (loading) return null

    if (schedules.length === 0) {
      return (
        <View style={styles.emptyStateContainer}>
          <Text style={styles.emptyStateTitle}>No Data Available</Text>
          <Text style={styles.emptyStateText}>Load shedding data is being updated. Please try refreshing.</Text>
          <TouchableOpacity style={styles.refreshButton} onPress={handleRefresh}>
            <Text style={styles.refreshButtonText}>Refresh Data</Text>
          </TouchableOpacity>
        </View>
      )
    }

    return (
      <View style={styles.emptyStateContainer}>
        <Text style={styles.emptyStateTitle}>No matching suburbs found</Text>
        <Text style={styles.emptyStateText}>Try searching for a different suburb name</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search your suburb"
          value={searchQuery}
          onChangeText={(text) => {
            setSearchQuery(text)
            setSelectedSuburb(null)
          }}
        />
        {detectedSuburb && <Text style={styles.detectedLocation}>Detected: {detectedSuburb}</Text>}
      </View>

      {loading || loadingLocation ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading suburbs...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredData}
          keyExtractor={(item) => item.suburb || Math.random().toString()}
          renderItem={renderSchedule}
          ListEmptyComponent={renderEmptyState}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  )
}

export default ImprovedEskom

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  header: {
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  searchInput: {
    backgroundColor: "#f8f8f8",
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    borderColor: "#ddd",
    borderWidth: 1,
  },
  detectedLocation: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 8,
    color: "#666",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  suburb: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
  },
  status: {
    fontSize: 16,
    color: "#666",
    marginTop: 4,
    marginBottom: 8,
  },
  currentScheduleContainer: {
    backgroundColor: "#f0f8ff",
    padding: 12,
    borderRadius: 8,
    marginVertical: 8,
  },
  todayHeader: {
    fontSize: 16,
    fontWeight: "600",
    color: "#007AFF",
    marginBottom: 8,
  },
  currentSlot: {
    fontSize: 14,
    color: "#333",
    marginLeft: 8,
    marginBottom: 2,
  },
  noLoadsheddingContainer: {
    backgroundColor: "#f0f8f0",
    padding: 12,
    borderRadius: 8,
    marginVertical: 8,
  },
  noLoadshedding: {
    fontSize: 16,
    fontWeight: "600",
    color: "#28a745",
    textAlign: "center",
  },
  noSlotsContainer: {
    backgroundColor: "#f8f8f0",
    padding: 12,
    borderRadius: 8,
    marginVertical: 8,
  },
  noSlots: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
  separator: {
    height: 1,
    backgroundColor: "#e0e0e0",
    marginVertical: 16,
  },
  fullScheduleHeader: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
  },
  scheduleBlock: {
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  stageHeader: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#007AFF",
    marginBottom: 8,
  },
  dayContainer: {
    marginBottom: 8,
  },
  dayText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#444",
    marginBottom: 4,
  },
  slot: {
    fontSize: 14,
    marginLeft: 12,
    color: "#555",
    marginBottom: 2,
  },
  expandButton: {
    backgroundColor: "#007AFF",
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  expandButtonText: {
    color: "#fff",
    textAlign: "center",
    fontSize: 14,
    fontWeight: "600",
  },
  closeButton: {
    backgroundColor: "#666",
    padding: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  closeButtonText: {
    color: "#fff",
    textAlign: "center",
    fontSize: 14,
    fontWeight: "600",
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 16,
  },
  refreshButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  refreshButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  errorText: {
    color: "#dc3545",
    fontSize: 14,
    fontStyle: "italic",
  },
})
