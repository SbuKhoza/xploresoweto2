import { View, Text, ActivityIndicator, StyleSheet, Modal, Dimensions } from "react-native"

const { width, height } = Dimensions.get("window")

const GlobalLoader = ({ visible, message = "Loading..." }) => {
  return (
    <Modal transparent={true} animationType="fade" visible={visible} statusBarTranslucent={true}>
      <View style={styles.overlay}>
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>{message}</Text>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    width: width,
    height: height,
  },
  loaderContainer: {
    backgroundColor: "white",
    padding: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 150,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    color: "#333",
    fontWeight: "500",
    textAlign: "center",
  },
})

export default GlobalLoader
