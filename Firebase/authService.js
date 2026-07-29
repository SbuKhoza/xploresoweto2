import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateProfile } from "firebase/auth"
import { doc, setDoc, query, where, collection, getDocs } from "firebase/firestore"
import { auth, db } from "./config" // Adjust the import path as necessary
import { storeUserCredentials, clearStoredUser } from "../utils/persistAuth"

// Password validation function
export const validatePassword = (password) => {
  const minLength = password.length >= 8
  const hasNumber = /\d/.test(password)
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password)

  return {
    isValid: minLength && hasNumber && hasSpecialChar,
    minLength,
    hasNumber,
    hasSpecialChar,
  }
}

// Check if username exists
export const checkUsernameExists = async (username) => {
  if (!username) return false

  const q = query(collection(db, "users"), where("username", "==", username))
  const querySnapshot = await getDocs(q)
  return !querySnapshot.empty
}

// Register user
export const registerUser = async (name, email, password, username = null) => {
  try {
    // Validate password
    const passwordValidation = validatePassword(password)
    if (!passwordValidation.isValid) {
      throw new Error("Password does not meet requirements")
    }

    // Check if username exists (if provided)
    if (username) {
      const usernameExists = await checkUsernameExists(username)
      if (usernameExists) {
        throw new Error("Username already exists")
      }
    }

    // Create user account
    const userCredential = await createUserWithEmailAndPassword(auth, email, password)
    const user = userCredential.user

    // Update user profile with display name
    await updateProfile(user, {
      displayName: name,
    })

    // Store additional user data in Firestore
    await setDoc(doc(db, "users", user.uid), {
      name: name,
      email: email,
      username: username || null,
      createdAt: new Date(),
      uid: user.uid,
    })

    // Store user data for offline access
    await storeUserCredentials(user)

    return { success: true, user }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

// Login user with email or username
export const loginUser = async (emailOrUsername, password) => {
  try {
    let email = emailOrUsername

    // Check if input is username (no @ symbol)
    if (!emailOrUsername.includes("@")) {
      // Query Firestore to find user by username
      const q = query(collection(db, "users"), where("username", "==", emailOrUsername))
      const querySnapshot = await getDocs(q)

      if (querySnapshot.empty) {
        throw new Error("Username not found")
      }

      // Get email from the user document
      const userDoc = querySnapshot.docs[0]
      email = userDoc.data().email
    }

    // Sign in with email and password
    const userCredential = await signInWithEmailAndPassword(auth, email, password)

    // Store user data for offline access
    await storeUserCredentials(userCredential.user)

    return { success: true, user: userCredential.user }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

// Logout user
export const logoutUser = async () => {
  try {
    await signOut(auth)
    await clearStoredUser()
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
}
