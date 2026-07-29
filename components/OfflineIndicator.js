import React, { useState, useEffect } from 'react'
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { syncDataWithServer, isOnline } from '../utils/networkManager'

const OfflineIndicator = () => {
  const insets = useSafeAreaInsets()
  const [isVisible, setIsVisible] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const opacity = new Animated.Value(0)

  useEffect(() => {
    if (isVisible) {
      Animated.timing(opacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start()
    } else {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start()
    }
  }, [isVisible])

  const handleSync = async () => {
    const online = await isOnline()
    if (!online) return

    setIsSyncing(true)
    try {
      await syncDataWithServer()
    } catch (error) {
      console.error('Manual sync failed:', error)
    } finally {
      setIsSyncing(false)
    }
  }

  if (!isVisible) return null

  return (
    <Animated.View style={[
      styles.container, 
      { paddingTop: insets.top, opacity }
    ]}>
      <View style={styles.content}>
        <Ionicons 
          name="cloud-offline-outline" 
          size={20} 
          color="white" 
        />
        <Text style={styles.text}>
          {isSyncing ? 'Syncing...' : 'Using offline data'}
        </Text>
        {!isSyncing && (
          <TouchableOpacity onPress={handleSync} style={styles.syncButton}>
            <Ionicons name="refresh" size={16} color="white" />
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#BC5C2E',
    zIndex: 1000,
  },
  content: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
  },
  text: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
  },
  syncButton: {
    marginLeft: 8,
    padding: 4,
  },
})

export default OfflineIndicator