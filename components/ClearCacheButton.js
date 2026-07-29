import { TouchableOpacity, Text, StyleSheet, Alert } from "react-native"
import { clearAllOfflineCache, clearCollectionCache } from "../utils/clearOfflineCache"

const ClearCacheButton = ({ collectionName, onCacheCleared }) => {
  const handleClearCache = async () => {
    Alert.alert(
      "Clear Cache",
      `Are you sure you want to clear the ${collectionName || "all"} cache? This will force fresh data from the server.`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Clear Cache",
          onPress: async () => {
            try {
              if (collectionName) {
                await clearCollectionCache(collectionName)
              } else {
                await clearAllOfflineCache()
              }

              Alert.alert("Success", "Cache cleared successfully!")

              // Callback to refresh data
              if (onCacheCleared) {
                onCacheCleared()
              }
            } catch (error) {
              Alert.alert("Error", "Failed to clear cache")
              console.error("Cache clear error:", error)
            }
          },
        },
      ],
    )
  }

  return (
    <TouchableOpacity style={styles.button} onPress={handleClearCache}>
      <Text style={styles.buttonText}>🗑️ Clear {collectionName || "All"} Cache</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: "#FF6B6B",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    margin: 8,
  },
  buttonText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
})

export default ClearCacheButton
