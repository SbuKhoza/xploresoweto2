"use client"

import {
  StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView,
  Alert, KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native"
import { useState, useEffect } from "react"
import { Ionicons } from "@expo/vector-icons"
import { registerUser, loginUser, validatePassword } from "../Firebase/authService"
import { storeUserCredentials } from "../utils/persistAuth"
import { isOnline } from "../utils/networkManager"
import { sendPasswordResetEmail, GoogleAuthProvider, signInWithCredential } from "firebase/auth"
import { auth } from "../Firebase/config"
import * as Google from "expo-auth-session/providers/google"
import * as WebBrowser from "expo-web-browser"

// Required for Google auth redirect to close properly
WebBrowser.maybeCompleteAuthSession()

// ── Design tokens — matches Home.js palette ──────────────────────────────────
const ACCENT    = "#1B4D5C"   // Deep teal
const HIGHLIGHT = "#E8600A"   // Vibrant orange
const BG        = "#FDF8F3"   // Warm off-white
const SURFACE   = "#FFFFFF"
const MUTED     = "#7A8A8F"
const HERO_BG   = "#E8F4F7"  // Light teal
const BORDER    = "#C8DFE6"
// ─────────────────────────────────────────────────────────────────────────────

const Authentication = ({ navigation }) => {
  // "login" | "register" | "forgot"
  const [mode, setMode] = useState("login")

  const [formData, setFormData] = useState({
    name: "", username: "", email: "", password: "", confirmPassword: "",
  })
  const [showPassword, setShowPassword]               = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading]                         = useState(false)
  const [googleLoading, setGoogleLoading]             = useState(false)
  const [networkAvailable, setNetworkAvailable]       = useState(true)
  const [resetEmail, setResetEmail]                   = useState("")
  const [resetSent, setResetSent]                     = useState(false)

  // ── Google Auth Session ──
  // Replace YOUR_EXPO_CLIENT_ID, YOUR_IOS_CLIENT_ID, YOUR_ANDROID_CLIENT_ID
  // with your OAuth client IDs from the Google Cloud Console / Firebase Console.
  const [googleRequest, googleResponse, promptGoogleAsync] = Google.useAuthRequest({
    expoClientId:    "YOUR_EXPO_CLIENT_ID",       // for Expo Go
    iosClientId:     "YOUR_IOS_CLIENT_ID",         // for iOS standalone
    androidClientId: "YOUR_ANDROID_CLIENT_ID",     // for Android standalone
  })

  // Handle Google response
  useEffect(() => {
    if (googleResponse?.type === "success") {
      const { id_token } = googleResponse.params
      const credential = GoogleAuthProvider.credential(id_token)
      setGoogleLoading(true)
      signInWithCredential(auth, credential)
        .then(async (result) => {
          await storeUserCredentials(result.user)
          navigation.reset({ index: 0, routes: [{ name: "MainApp" }] })
        })
        .catch((err) => Alert.alert("Google Sign-In Failed", err.message))
        .finally(() => setGoogleLoading(false))
    } else if (googleResponse?.type === "error") {
      Alert.alert("Google Sign-In Failed", googleResponse.error?.message || "Something went wrong")
    }
  }, [googleResponse])

  useEffect(() => {
    isOnline().then(setNetworkAvailable)
  }, [])

  useEffect(() => {
    isOnline().then(setNetworkAvailable)
  }, [])

  const set = (field, value) => setFormData(p => ({ ...p, [field]: value }))

  const resetForm = () => {
    setFormData({ name:"", username:"", email:"", password:"", confirmPassword:"" })
    setShowPassword(false)
    setShowConfirmPassword(false)
  }

  const switchMode = (next) => { resetForm(); setMode(next) }

  // ── Validation ─────────────────────────────────────────────────────────────
  const validateForm = () => {
    if (!networkAvailable) {
      Alert.alert("No Internet Connection", "You need to be online to continue.")
      return false
    }
    if (mode === "register") {
      if (!formData.name.trim()) { Alert.alert("Error", "Full name is required"); return false }
      if (formData.password !== formData.confirmPassword) { Alert.alert("Error", "Passwords do not match"); return false }
    }
    if (!formData.email.trim() && !formData.username.trim()) {
      Alert.alert("Error", "Email or username is required"); return false
    }
    if (!formData.password.trim()) { Alert.alert("Error", "Password is required"); return false }
    if (mode === "register") {
      const v = validatePassword(formData.password)
      if (!v.isValid) {
        let msg = "Password must have:\n"
        if (!v.minLength) msg += "• At least 8 characters\n"
        if (!v.hasNumber) msg += "• At least 1 number\n"
        if (!v.hasSpecialChar) msg += "• At least 1 special character"
        Alert.alert("Invalid Password", msg)
        return false
      }
    }
    return true
  }

  // ── Auth handlers ──────────────────────────────────────────────────────────
  const handleLogin = async () => {
    if (!validateForm()) return
    setLoading(true)
    const result = await loginUser(formData.email || formData.username, formData.password)
    if (result.success) {
      await storeUserCredentials(result.user)
      navigation.reset({ index: 0, routes: [{ name: "MainApp" }] })
    } else {
      Alert.alert("Login Failed", result.error)
    }
    setLoading(false)
  }

  const handleRegister = async () => {
    if (!validateForm()) return
    setLoading(true)
    const result = await registerUser(formData.name, formData.email, formData.password, formData.username || null)
    if (result.success) {
      await storeUserCredentials(result.user)
      Alert.alert("Success", "Account created successfully!", [{
        text: "OK",
        onPress: () => navigation.reset({ index: 0, routes: [{ name: "MainApp" }] }),
      }])
    } else {
      Alert.alert("Registration Failed", result.error)
    }
    setLoading(false)
  }

  const handleGoogleSignIn = async () => {
    if (!networkAvailable) {
      Alert.alert("No Internet Connection", "You need to be online to sign in with Google.")
      return
    }
    // promptGoogleAsync triggers the browser-based OAuth flow.
    // The result is handled in the useEffect above watching googleResponse.
    await promptGoogleAsync()
  }

  const handleForgotPassword = async () => {
    if (!resetEmail.trim()) { Alert.alert("Error", "Please enter your email address"); return }
    if (!networkAvailable) { Alert.alert("No Internet Connection", "You need to be online to reset your password."); return }
    setLoading(true)
    try {
      await sendPasswordResetEmail(auth, resetEmail.trim())
      setResetSent(true)
    } catch (error) {
      const msg = error.code === "auth/user-not-found"
        ? "No account found with this email address."
        : error.code === "auth/invalid-email"
        ? "Please enter a valid email address."
        : "Something went wrong. Please try again."
      Alert.alert("Error", msg)
    } finally {
      setLoading(false)
    }
  }

  // ── Password strength indicator ────────────────────────────────────────────
  const getPasswordStrength = (pw) => {
    if (!pw) return null
    let score = 0
    if (pw.length >= 8) score++
    if (/[0-9]/.test(pw)) score++
    if (/[^A-Za-z0-9]/.test(pw)) score++
    if (pw.length >= 12) score++
    if (score <= 1) return { label: "Weak",   color: "#EF4444", width: "25%" }
    if (score === 2) return { label: "Fair",   color: HIGHLIGHT, width: "50%" }
    if (score === 3) return { label: "Good",   color: "#F59E0B", width: "75%" }
    return             { label: "Strong", color: "#22C55E", width: "100%" }
  }
  const strength = mode === "register" ? getPasswordStrength(formData.password) : null

  // ── Shared input renderer ──────────────────────────────────────────────────
  const Input = ({ icon, placeholder, value, onChange, secure, showToggle, toggleValue, onToggle, keyboardType, autoCapitalize = "none" }) => (
    <View style={styles.inputWrap}>
      <Ionicons name={icon} size={18} color={MUTED} style={styles.inputIcon} />
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor="#B0BFC4"
        value={value}
        onChangeText={onChange}
        secureTextEntry={secure && !toggleValue}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType || "default"}
      />
      {showToggle && (
        <TouchableOpacity onPress={onToggle} hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
          <Ionicons name={toggleValue ? "eye-outline" : "eye-off-outline"} size={18} color={MUTED} />
        </TouchableOpacity>
      )}
    </View>
  )

  // ── Forgot password screen ─────────────────────────────────────────────────
  const renderForgot = () => (
    <View style={styles.card}>
      {resetSent ? (
        <View style={styles.resetSuccess}>
          <View style={styles.resetSuccessIcon}>
            <Ionicons name="mail-open-outline" size={36} color={ACCENT} />
          </View>
          <Text style={styles.resetSuccessTitle}>Check your inbox</Text>
          <Text style={styles.resetSuccessBody}>
            We sent a password reset link to{"\n"}<Text style={styles.resetEmail}>{resetEmail}</Text>
          </Text>
          <TouchableOpacity style={styles.btnPrimary} onPress={() => { setResetSent(false); setResetEmail(""); switchMode("login") }}>
            <Text style={styles.btnPrimaryText}>Back to Login</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <Text style={styles.cardTitle}>Reset Password</Text>
          <Text style={styles.cardSubtitle}>Enter your email and we'll send you a reset link.</Text>

          <Input
            icon="mail-outline"
            placeholder="Email address"
            value={resetEmail}
            onChange={setResetEmail}
            keyboardType="email-address"
          />

          <TouchableOpacity
            style={[styles.btnPrimary, (loading || !networkAvailable) && styles.btnDisabled]}
            onPress={handleForgotPassword}
            disabled={loading || !networkAvailable}
          >
            {loading
              ? <ActivityIndicator color={SURFACE} />
              : <Text style={styles.btnPrimaryText}>Send Reset Link</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity style={styles.backLink} onPress={() => switchMode("login")}>
            <Ionicons name="arrow-back" size={16} color={MUTED} />
            <Text style={styles.backLinkText}>Back to Login</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  )

  // ── Login / Register form ──────────────────────────────────────────────────
  const renderForm = () => (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{mode === "login" ? "Welcome back" : "Create account"}</Text>
      <Text style={styles.cardSubtitle}>
        {mode === "login" ? "Sign in to continue exploring Soweto" : "Join and start exploring Soweto"}
      </Text>

      {/* Google button */}
      <TouchableOpacity
        style={[styles.googleBtn, (!networkAvailable || googleLoading || !googleRequest) && styles.btnDisabled]}
        onPress={handleGoogleSignIn}
        disabled={!networkAvailable || googleLoading || !googleRequest}
        activeOpacity={0.85}
      >
        {googleLoading ? (
          <ActivityIndicator color={ACCENT} size="small" />
        ) : (
          <>
            {/* Google "G" logo using coloured letters — no image needed */}
            <View style={styles.googleLogo}>
              <Text style={styles.googleLogoText}>G</Text>
            </View>
            <Text style={styles.googleBtnText}>Continue with Google</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Divider */}
      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.dividerLine} />
      </View>

      {/* Registration-only fields */}
      {mode === "register" && (
        <>
          <Input icon="person-outline" placeholder="Full Name" value={formData.name}
            onChange={t => set("name", t)} autoCapitalize="words" />
          <Input icon="at-outline" placeholder="Username (optional)" value={formData.username}
            onChange={t => set("username", t)} />
        </>
      )}

      {/* Email / username */}
      {mode === "login" ? (
        <Input icon="mail-outline" placeholder="Email or Username"
          value={formData.email || formData.username}
          onChange={t => {
            if (t.includes("@")) { set("email", t); set("username", "") }
            else { set("username", t); set("email", "") }
          }}
          keyboardType="email-address"
        />
      ) : (
        <Input icon="mail-outline" placeholder="Email address" value={formData.email}
          onChange={t => set("email", t)} keyboardType="email-address" />
      )}

      {/* Password */}
      <Input icon="lock-closed-outline" placeholder="Password" value={formData.password}
        onChange={t => set("password", t)} secure showToggle toggleValue={showPassword}
        onToggle={() => setShowPassword(p => !p)} />

      {/* Password strength */}
      {strength && formData.password.length > 0 && (
        <View style={styles.strengthWrap}>
          <View style={styles.strengthBar}>
            <View style={[styles.strengthFill, { width: strength.width, backgroundColor: strength.color }]} />
          </View>
          <Text style={[styles.strengthLabel, { color: strength.color }]}>{strength.label}</Text>
        </View>
      )}

      {/* Confirm password */}
      {mode === "register" && (
        <Input icon="lock-closed-outline" placeholder="Confirm Password" value={formData.confirmPassword}
          onChange={t => set("confirmPassword", t)} secure showToggle toggleValue={showConfirmPassword}
          onToggle={() => setShowConfirmPassword(p => !p)} />
      )}

      {/* Password requirements */}
      {mode === "register" && (
        <View style={styles.requirementsBox}>
          {[
            { label: "At least 8 characters", met: formData.password.length >= 8 },
            { label: "At least 1 number",     met: /[0-9]/.test(formData.password) },
            { label: "At least 1 special character", met: /[^A-Za-z0-9]/.test(formData.password) },
          ].map((r, i) => (
            <View key={i} style={styles.requirementRow}>
              <Ionicons name={r.met ? "checkmark-circle" : "ellipse-outline"} size={14}
                color={r.met ? "#22C55E" : MUTED} />
              <Text style={[styles.requirementText, r.met && styles.requirementMet]}>{r.label}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Forgot password link */}
      {mode === "login" && (
        <TouchableOpacity style={styles.forgotLink} onPress={() => switchMode("forgot")}>
          <Text style={styles.forgotLinkText}>Forgot password?</Text>
        </TouchableOpacity>
      )}

      {/* Submit */}
      <TouchableOpacity
        style={[styles.btnPrimary, (loading || !networkAvailable) && styles.btnDisabled]}
        onPress={mode === "login" ? handleLogin : handleRegister}
        disabled={loading || !networkAvailable}
        activeOpacity={0.88}
      >
        {loading
          ? <ActivityIndicator color={SURFACE} />
          : <Text style={styles.btnPrimaryText}>{mode === "login" ? "Sign In" : "Create Account"}</Text>
        }
      </TouchableOpacity>

      {/* Toggle mode */}
      <View style={styles.switchRow}>
        <Text style={styles.switchText}>
          {mode === "login" ? "Don't have an account? " : "Already have an account? "}
        </Text>
        <TouchableOpacity onPress={() => switchMode(mode === "login" ? "register" : "login")}>
          <Text style={styles.switchLink}>{mode === "login" ? "Sign Up" : "Sign In"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )

  // ── Root render ────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">

        {/* Decorative background shapes */}
        <View style={styles.decTop} />
        <View style={styles.decBottom} />

        {/* Logo / Branding */}
        <View style={styles.brand}>
          <View style={styles.logoMark}>
            <Ionicons name="compass" size={36} color={SURFACE} />
          </View>
          <Text style={styles.appName}>Xplore Soweto</Text>
          <Text style={styles.tagline}>
            {mode === "login"   ? "Welcome back 👋"          :
             mode === "register" ? "Join the community 🌍"    :
                                   "No worries, we've got you 🔑"}
          </Text>
        </View>

        {/* Offline warning */}
        {!networkAvailable && (
          <View style={styles.offlineWarning}>
            <Ionicons name="cloud-offline-outline" size={16} color={HIGHLIGHT} />
            <Text style={styles.offlineText}>No internet connection. Please connect to continue.</Text>
          </View>
        )}

        {/* Form card */}
        {mode === "forgot" ? renderForgot() : renderForm()}

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

export default Authentication

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  scroll: {
    flexGrow: 1,
    paddingHorizontal: 22,
    paddingTop: 60,
    paddingBottom: 20,
  },

  // Decorative background blobs
  decTop: {
    position: "absolute", top: -60, right: -60,
    width: 220, height: 220, borderRadius: 110,
    backgroundColor: "rgba(232,96,10,0.07)",
  },
  decBottom: {
    position: "absolute", bottom: 40, left: -80,
    width: 260, height: 260, borderRadius: 130,
    backgroundColor: "rgba(27,77,92,0.06)",
  },

  // Branding
  brand: { alignItems: "center", marginBottom: 32 },
  logoMark: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: ACCENT,
    justifyContent: "center", alignItems: "center",
    marginBottom: 14,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3, shadowRadius: 16, elevation: 8,
  },
  appName: {
    fontSize: 28, fontWeight: "800", color: ACCENT,
    letterSpacing: -0.5, marginBottom: 6,
  },
  tagline: { fontSize: 15, color: MUTED, fontWeight: "500" },

  // Offline warning
  offlineWarning: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#FEF0E6",
    borderRadius: 12, padding: 12, marginBottom: 16,
    borderLeftWidth: 3, borderLeftColor: HIGHLIGHT,
  },
  offlineText: { flex: 1, fontSize: 13, color: HIGHLIGHT, fontWeight: "500" },

  // Card
  card: {
    backgroundColor: SURFACE,
    borderRadius: 24, padding: 24,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1, shadowRadius: 20, elevation: 6,
    borderWidth: 1, borderColor: "#E8DDD5",
  },
  cardTitle: {
    fontSize: 22, fontWeight: "800", color: ACCENT,
    letterSpacing: -0.4, marginBottom: 4,
  },
  cardSubtitle: { fontSize: 14, color: MUTED, marginBottom: 22, lineHeight: 20 },

  // Google button
  googleBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, height: 50, borderRadius: 14,
    backgroundColor: SURFACE,
    borderWidth: 1.5, borderColor: BORDER,
    marginBottom: 18,
  },
  googleLogo: {
    width: 26, height: 26, borderRadius: 8,
    backgroundColor: "#4285F4",
    justifyContent: "center", alignItems: "center",
  },
  googleLogoText: { fontSize: 15, fontWeight: "900", color: SURFACE },
  googleBtnText: { fontSize: 15, fontWeight: "700", color: ACCENT },

  // Divider
  divider: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 18 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#E8DDD5" },
  dividerText: { fontSize: 12, color: MUTED, fontWeight: "600" },

  // Input
  inputWrap: {
    flexDirection: "row", alignItems: "center",
    height: 50, paddingHorizontal: 14,
    backgroundColor: HERO_BG,
    borderRadius: 14, marginBottom: 12,
    borderWidth: 1.5, borderColor: BORDER,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 15, color: ACCENT },

  // Password strength
  strengthWrap: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8, marginTop: -4 },
  strengthBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: "#E8DDD5" },
  strengthFill: { height: 4, borderRadius: 2 },
  strengthLabel: { fontSize: 11, fontWeight: "700", width: 46, textAlign: "right" },

  // Requirements
  requirementsBox: {
    backgroundColor: HERO_BG, borderRadius: 12,
    padding: 12, marginBottom: 14, gap: 6,
    borderWidth: 1, borderColor: BORDER,
  },
  requirementRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  requirementText: { fontSize: 12, color: MUTED },
  requirementMet: { color: "#22C55E", fontWeight: "600" },

  // Forgot password link
  forgotLink: { alignSelf: "flex-end", marginBottom: 16, marginTop: -4 },
  forgotLinkText: { fontSize: 13, color: HIGHLIGHT, fontWeight: "700" },

  // Primary button
  btnPrimary: {
    height: 52, borderRadius: 14,
    backgroundColor: ACCENT,
    justifyContent: "center", alignItems: "center",
    marginBottom: 16,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  btnPrimaryText: { color: SURFACE, fontSize: 16, fontWeight: "800" },
  btnDisabled: { backgroundColor: "#C8DFE6", shadowOpacity: 0, elevation: 0 },

  // Switch login/register
  switchRow: { flexDirection: "row", justifyContent: "center", alignItems: "center" },
  switchText: { fontSize: 14, color: MUTED },
  switchLink: { fontSize: 14, color: HIGHLIGHT, fontWeight: "800" },

  // Back link (forgot screen)
  backLink: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, marginTop: 4,
  },
  backLinkText: { fontSize: 14, color: MUTED, fontWeight: "600" },

  // Forgot — reset success state
  resetSuccess: { alignItems: "center", paddingVertical: 10, gap: 10 },
  resetSuccessIcon: {
    width: 80, height: 80, borderRadius: 24,
    backgroundColor: HERO_BG,
    justifyContent: "center", alignItems: "center",
    marginBottom: 6,
  },
  resetSuccessTitle: { fontSize: 20, fontWeight: "800", color: ACCENT },
  resetSuccessBody: { fontSize: 14, color: MUTED, textAlign: "center", lineHeight: 22, marginBottom: 8 },
  resetEmail: { color: ACCENT, fontWeight: "700" },
})