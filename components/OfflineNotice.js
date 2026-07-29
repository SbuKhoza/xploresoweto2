"use client"

import React from "react"
import { View, Text, StyleSheet, Animated } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Ionicons } from "@expo/vector-icons"

const OfflineNotice = () => {
  const insets = useSafeAreaInsets()
  const opacity = new Animated.Value(0)

  React.useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.delay(500),
    ]).start()
  }, [])

  return (
    <Animated.View style={[styles.container, { paddingTop: insets.top, opacity }]}>
      <View style={styles.content}>
        <Ionicons name="cloud-offline-outline" size={20} color="white" />
        <Text style={styles.text}>No Internet Connection</Text>
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: "#BC5C2E",
    zIndex: 1000,
  },
  content: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 8,
  },
  text: {
    color: "white",
    fontSize: 14,
    fontWeight: "500",
    marginLeft: 8,
  },
})

export default OfflineNotice
