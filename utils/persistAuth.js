import AsyncStorage from "@react-native-async-storage/async-storage"
import { auth } from "../Firebase/config"
import { onAuthStateChanged } from "firebase/auth"
import NetInfo from "@react-native-community/netinfo"

// Store user credentials securely
export const storeUserCredentials = async (user) => {
  if (!user) return

  try {
    const userData = {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
    }

    await AsyncStorage.setItem("user", JSON.stringify(userData))
  } catch (error) {
    console.error("Error storing user data:", error)
  }
}

// Get stored user credentials
export const getStoredUser = async () => {
  try {
    const userData = await AsyncStorage.getItem("user")
    return userData ? JSON.parse(userData) : null
  } catch (error) {
    console.error("Error retrieving user data:", error)
    return null
  }
}

// Clear stored user credentials on logout
export const clearStoredUser = async () => {
  try {
    await AsyncStorage.removeItem("user")
  } catch (error) {
    console.error("Error clearing user data:", error)
  }
}

// Initialize auth listener and handle offline authentication
export const initializeAuth = (setUser, setIsLoading) => {
  // First check if we have a stored user
  getStoredUser().then((storedUser) => {
    if (storedUser) {
      setUser(storedUser)
    }

    // Then set up the Firebase auth listener
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // Check network status
      const networkState = await NetInfo.fetch()

      if (firebaseUser) {
        // User is signed in, store credentials for offline access
        await storeUserCredentials(firebaseUser)
        setUser(firebaseUser)
      } else if (!networkState.isConnected) {
        // Offline and no Firebase user, use stored user if available
        const offlineUser = await getStoredUser()
        setUser(offlineUser)
      } else {
        // Online but no user
        await clearStoredUser()
        setUser(null)
      }

      setIsLoading(false)
    })

    return unsubscribe
  })
}
