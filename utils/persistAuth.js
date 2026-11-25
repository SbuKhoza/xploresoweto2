import AsyncStorage from "@react-native-async-storage/async-storage"
import { auth } from "../Firebase/config"
import { onAuthStateChanged, signOut } from "firebase/auth"
import { checkTokenAudience } from "../Firebase/env/tokenAudience"
import NetInfo from "@react-native-community/netinfo"
import { applyStorageEpoch } from "./storageEpoch"

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

// SUPPLEMENTARY environment protection (the primary guard runs before Firebase starts): the session's ID token must have been issued by the
// project this build is configured for. Only a definite mismatch signs the user out; an unreadable token (e.g. offline) does not.
const sessionBelongsToThisProject = async (firebaseUser) => {
  try {
    const result = await firebaseUser.getIdTokenResult()
    return checkTokenAudience(result.claims, auth.app.options.projectId).ok
  } catch (error) {
    return true
  }
}

// Initialize auth listener and handle offline authentication
export const initializeAuth = (setUser, setIsLoading) => {
  // One-time clean-up of state left by builds that used the previous Firebase project, then check for a stored user
  applyStorageEpoch().then(() => getStoredUser()).then((storedUser) => {
    if (storedUser) {
      setUser(storedUser)
    }

    // Then set up the Firebase auth listener
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // Check network status
      const networkState = await NetInfo.fetch()

      if (firebaseUser && !(await sessionBelongsToThisProject(firebaseUser))) {
        await signOut(auth).catch(() => {})
        await clearStoredUser()
        setUser(null)
      } else if (firebaseUser) {
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
