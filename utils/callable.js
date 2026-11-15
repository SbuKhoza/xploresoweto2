import { Alert } from "react-native"
import { httpsCallable } from "firebase/functions"
import { sendEmailVerification } from "firebase/auth"
import { auth, functions } from "../Firebase/config"

// Calls a Cloud Function (region africa-south1, configured in Firebase/config). Throws an Error whose
// .code is the function's code without the "functions/" prefix and whose .message is safe to show to the user.
export const callFunction = async (name, data = {}) => {
  try {
    const res = await httpsCallable(functions, name)(data)
    return res.data
  } catch (e) {
    const code = String(e?.code || "internal").replace(/^functions\//, "")
    const err = new Error(friendlyCallableMessage(code, e?.message))
    err.code = code
    throw err
  }
}

export const friendlyCallableMessage = (code, raw = "") => {
  if (raw === "email-not-verified" || code === "failed-precondition" && /email-not-verified/.test(raw)) return "Please verify your email address first."
  if (raw === "listing-not-bookable") return "Online requests aren't available for this listing yet. Please use the contact details shown."
  if (raw === "not-eligible") return "You can review this business after a completed, confirmed service."
  switch (code) {
    case "unauthenticated": return "Please sign in again."
    case "permission-denied": return "You don't have permission to do that."
    case "unavailable": case "deadline-exceeded": case "internal": return "We couldn't reach the server. Check your connection and try again."
    case "not-found": return "That isn't available right now."
    case "resource-exhausted": return "You've reached a limit. Please try again later."
    case "invalid-argument": return "Some details look invalid. Please check and try again."
    default: return "Something went wrong. Please try again."
  }
}

// ---- email verification (required for provider applications, bookings, service requests and reviews)
export const isEmailNotVerified = (e) => e?.code === "failed-precondition" && /verify your email/i.test(e?.message || "")
export const resendVerificationEmail = async () => {
  if (!auth.currentUser) throw new Error("Please sign in again.")
  await sendEmailVerification(auth.currentUser)
}
// Reloads the user and refreshes the ID token so the server sees email_verified = true. Returns true when verified.
export const refreshEmailVerification = async () => {
  const u = auth.currentUser
  if (!u) return false
  await u.reload()
  await u.getIdToken(true)
  return u.emailVerified === true
}
export const showVerifyEmailAlert = (onVerified) =>
  Alert.alert(
    "Verify your email",
    "Please verify your email address to continue. We sent you a link when you signed up; check your inbox and spam folder.",
    [
      { text: "Cancel", style: "cancel" },
      { text: "Resend email", onPress: async () => { try { await resendVerificationEmail(); Alert.alert("Email sent", "Check your inbox for the verification link.") } catch { Alert.alert("Couldn't send", "Please try again in a few minutes.") } } },
      { text: "I've verified", onPress: async () => {
          try { (await refreshEmailVerification()) ? onVerified?.() : Alert.alert("Not verified yet", "Open the link in the email first, then try again.") }
          catch { Alert.alert("Couldn't check", "Check your connection and try again.") }
      } },
    ],
  )
// Shows the right alert for a failed callable. Returns true if it was an email-verification problem.
export const alertCallableError = (e, { title = "Something went wrong", onVerified } = {}) => {
  if (isEmailNotVerified(e)) { showVerifyEmailAlert(onVerified); return true }
  Alert.alert(title, e?.message || "Please try again.")
  return false
}
