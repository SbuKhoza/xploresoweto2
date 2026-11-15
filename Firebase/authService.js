import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateProfile, sendEmailVerification } from "firebase/auth"
import { auth } from "./config"
import { storeUserCredentials, clearStoredUser } from "../utils/persistAuth"
import { ensureProfileWithRetry } from "../utils/profileBootstrap"

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

// Turns Firebase Auth errors into messages a person can act on
export const friendlyAuthError = (error) => {
  switch (error?.code) {
    case "auth/email-already-in-use": return "An account with this email already exists. Please sign in instead."
    case "auth/invalid-email": return "That email address doesn't look right."
    case "auth/weak-password": return "Please choose a stronger password."
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials": return "Incorrect email or password."
    case "auth/user-disabled": return "This account has been disabled."
    case "auth/too-many-requests": return "Too many attempts. Please wait a few minutes and try again."
    case "auth/network-request-failed": return "Couldn't reach the server. Check your connection and try again."
    default: return error?.message && !String(error.message).startsWith("Firebase:") ? error.message : "Something went wrong. Please try again."
  }
}

// Register with email + password. Steps: create the account -> set display name -> send the verification email ->
// create users/{uid} through the ensureUserProfile Cloud Function.
// If only the LAST step fails, the account still exists and we report profileReady:false. The app retries the profile
// idempotently on the next launch (see EnrollmentProvider), so the user never has to register again.
export const registerUser = async (name, email, password) => {
  try {
    const passwordValidation = validatePassword(password)
    if (!passwordValidation.isValid) throw new Error("Password does not meet requirements")

    const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password)
    const user = userCredential.user
    await updateProfile(user, { displayName: name.trim() })

    let verificationSent = false
    try { await sendEmailVerification(user); verificationSent = true } catch { /* the user can resend later */ }

    await storeUserCredentials(user)
    const profile = await ensureProfileWithRetry({ displayName: name.trim() })
    return { success: true, user, verificationSent, profileReady: profile.ok }
  } catch (error) {
    return { success: false, error: friendlyAuthError(error) }
  }
}

// Login with email + password (usernames are no longer used for sign-in)
export const loginUser = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, String(email || "").trim(), password)
    await storeUserCredentials(userCredential.user)
    return { success: true, user: userCredential.user }
  } catch (error) {
    return { success: false, error: friendlyAuthError(error) }
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
