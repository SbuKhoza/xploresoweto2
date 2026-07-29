import { useState, useEffect } from "react"
import { StyleSheet, Text, View, TouchableOpacity, SafeAreaView, StatusBar } from "react-native"
import { useNavigation } from "@react-navigation/native"
import FontAwesome from "react-native-vector-icons/FontAwesome"
import MaterialIcons from "react-native-vector-icons/MaterialIcons"
import Ionicons from "react-native-vector-icons/Ionicons"
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons"
import { collection, getDocs } from "firebase/firestore"
import { db } from "../Firebase/config"
import { useScrollTracking, AnimatedFlatList } from "../components/BottomNav"

const ACCENT = "#1A1A2E"
const HIGHLIGHT = "#E94560"
const BG = "#F4F6FB"
const SURFACE = "#FFFFFF"

// Soft background tints per icon type for visual variety
const ICON_BG_COLORS = [
  "#EEF2FF", "#FFF0F3", "#F0FFF4", "#FFFBEB",
  "#F5F3FF", "#FFF7ED", "#F0F9FF", "#FDF2F8",
]

export default function Xplore() {
  const navigation = useNavigation()
  const [viewMode, setViewMode] = useState("grid")
  const [numColumns, setNumColumns] = useState(2)
  const [itemWidth, setItemWidth] = useState(null)
  const [exploreItems, setExploreItems] = useState([])
  const [dataLoading, setDataLoading] = useState(true)
  const [error, setError] = useState(null)

  const scrollProps = useScrollTracking()

  const fetchXploreMenuData = async () => {
    try {
      setDataLoading(true)
      setError(null)

      const xploreMenuRef = collection(db, "xplore-menu")
      const snapshot = await getDocs(xploreMenuRef)

      if (snapshot.empty) {
        setExploreItems([])
        return
      }

      const menuItems = []
      snapshot.forEach((doc) => {
        const data = { id: doc.id, ...doc.data() }
        if (data.isActive !== false) menuItems.push(data)
      })

      menuItems.sort((a, b) => (a.order || 0) - (b.order || 0))
      setExploreItems(menuItems)
    } catch (error) {
      console.error("Error fetching xplore menu data:", error)
      setError("Failed to load menu items")
      setExploreItems([])
    } finally {
      setDataLoading(false)
    }
  }

  useEffect(() => {
    fetchXploreMenuData()
  }, [])

  const handleItemPress = (item) => {
    navigation.navigate(item.screen)
  }

  const onLayoutChange = (event) => {
    const { width } = event.nativeEvent.layout
    const calculatedWidth = (width - 20 - numColumns * 20) / numColumns
    setItemWidth(calculatedWidth)
  }

  const renderIcon = (item) => {
    switch (item.iconType) {
      case "FontAwesome":
        return <FontAwesome name={item.icon} size={24} color={ACCENT} />
      case "MaterialIcons":
        return <MaterialIcons name={item.icon} size={24} color={ACCENT} />
      case "Ionicons":
        return <Ionicons name={item.icon} size={30} color={ACCENT} />
      case "MaterialCommunityIcons":
        return <MaterialCommunityIcons name={item.icon} size={24} color={ACCENT} />
      default:
        return <FontAwesome name="question-circle" size={28} color={ACCENT} />
    }
  }

  // Grid Item Component
  const GridItem = ({ item, itemWidth, index }) => (
    <TouchableOpacity
      style={[styles.gridItem, itemWidth ? { width: itemWidth } : null]}
      onPress={() => handleItemPress(item)}
      activeOpacity={0.8}
    >
      <View style={[styles.iconContainer, { backgroundColor: ICON_BG_COLORS[index % ICON_BG_COLORS.length] }]}>
        {renderIcon(item)}
      </View>
      <Text style={styles.gridItemTitle}>{item.title}</Text>
    </TouchableOpacity>
  )

  // List Item Component
  const ListItem = ({ item, index }) => (
    <TouchableOpacity style={styles.listItem} onPress={() => handleItemPress(item)} activeOpacity={0.8}>
      <View style={[styles.listIconContainer, { backgroundColor: ICON_BG_COLORS[index % ICON_BG_COLORS.length] }]}>
        {renderIcon(item)}
      </View>
      <Text style={styles.listItemTitle}>{item.title}</Text>
      <View style={styles.listChevronContainer}>
        <MaterialIcons name="chevron-right" size={20} color={ACCENT} />
      </View>
    </TouchableOpacity>
  )

  // Loading state
  if (dataLoading) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.stateIconContainer}>
          <MaterialIcons name="explore" size={40} color={ACCENT} />
        </View>
        <Text style={styles.stateText}>Loading menu...</Text>
      </SafeAreaView>
    )
  }

  // Error state
  if (error) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
        <StatusBar barStyle="dark-content" />
        <View style={[styles.stateIconContainer, { backgroundColor: "#FFF0F3" }]}>
          <MaterialIcons name="error-outline" size={40} color={HIGHLIGHT} />
        </View>
        <Text style={styles.stateText}>Oops!</Text>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={fetchXploreMenuData} activeOpacity={0.85}>
          <Text style={styles.retryButtonText}>Try Again</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  // Empty state
  if (exploreItems.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.stateIconContainer}>
          <MaterialIcons name="explore-off" size={40} color={ACCENT} />
        </View>
        <Text style={styles.stateText}>Nothing here yet</Text>
        <Text style={styles.emptySubText}>Check back later or contact support</Text>
        <TouchableOpacity style={styles.retryButton} onPress={fetchXploreMenuData} activeOpacity={0.85}>
          <Text style={styles.retryButtonText}>Refresh</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.headerTitle}>Explore</Text>
          <Text style={styles.headerSubtitle}>Discover Soweto</Text>
        </View>
        <View style={styles.viewToggle}>
          <TouchableOpacity
            style={[styles.toggleButton, viewMode === "grid" && styles.activeToggle]}
            onPress={() => setViewMode("grid")}
          >
            <MaterialIcons name="grid-view" size={20} color={viewMode === "grid" ? ACCENT : "#AAAAAA"} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleButton, viewMode === "list" && styles.activeToggle]}
            onPress={() => setViewMode("list")}
          >
            <MaterialIcons name="view-list" size={20} color={viewMode === "list" ? ACCENT : "#AAAAAA"} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      {viewMode === "grid" ? (
        <View style={styles.gridContainer} onLayout={onLayoutChange}>
          <AnimatedFlatList
            data={exploreItems}
            keyExtractor={(item) => item.id}
            renderItem={({ item, index }) => <GridItem item={item} itemWidth={itemWidth} index={index} />}
            numColumns={numColumns}
            contentContainerStyle={styles.gridContent}
            showsVerticalScrollIndicator={false}
            {...scrollProps}
          />
        </View>
      ) : (
        <AnimatedFlatList
          data={exploreItems}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => <ListItem item={item} index={index} />}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
          {...scrollProps}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  // ── Header ──
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: ACCENT,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    color: "#888888",
    fontWeight: "500",
    marginTop: 1,
  },
  // ── State screens ──
  stateIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: "#EEF2FF",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  stateText: {
    fontSize: 18,
    fontWeight: "700",
    color: ACCENT,
    marginBottom: 6,
  },
  errorText: {
    fontSize: 14,
    color: "#FF6B6B",
    textAlign: "center",
    marginBottom: 20,
    paddingHorizontal: 40,
  },
  emptySubText: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
    marginBottom: 20,
    paddingHorizontal: 40,
  },
  retryButton: {
    backgroundColor: ACCENT,
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 14,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  retryButtonText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  // ── Toggle ──
  viewToggle: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 2,
  },
  toggleButton: {
    padding: 7,
    borderRadius: 9,
  },
  activeToggle: {
    backgroundColor: "#EEF2FF",
  },
  // ── Grid ──
  gridContainer: {
    flex: 1,
    paddingHorizontal: 10,
  },
  gridContent: {
    paddingVertical: 10,
    paddingBottom: 80,
  },
  gridItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    margin: 7,
    borderRadius: 20,
    backgroundColor: SURFACE,
    padding: 18,
    height: 130,
    elevation: 2,
    shadowColor: "#1A1A2E",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  iconContainer: {
    width: 54,
    height: 54,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },
  gridItemTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: ACCENT,
    textAlign: "center",
    letterSpacing: 0.1,
  },
  // ── List ──
  listContainer: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 100,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: SURFACE,
    borderRadius: 18,
    marginBottom: 12,
    padding: 14,
    elevation: 2,
    shadowColor: "#1A1A2E",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
  },
  listIconContainer: {
    width: 50,
    height: 50,
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  listItemTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    color: ACCENT,
    letterSpacing: 0.1,
  },
  listChevronContainer: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: "#F0F0F0",
    justifyContent: "center",
    alignItems: "center",
  },
})