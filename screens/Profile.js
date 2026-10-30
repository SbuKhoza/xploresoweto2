"use client"

import {
  Text, View, TextInput, TouchableOpacity, ScrollView, Alert, Image,
  ActivityIndicator, KeyboardAvoidingView, Platform, Modal,
} from "react-native"
import { useState, useEffect, useMemo } from "react"
import { Ionicons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import * as ImagePicker from "expo-image-picker"
import dayjs from "dayjs"
import { auth, db, storage } from "../Firebase/config"
import { doc, getDoc, updateDoc } from "firebase/firestore"
import {
  updateProfile as firebaseUpdateProfile,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from "firebase/auth"
import { ref, uploadBytes, getDownloadURL } from "firebase/storage"
import { logoutUser, validatePassword } from "../Firebase/authService"
import { uriToBlob } from "../utils/uriToBlob"

// ── Design tokens (mirror tailwind.config.js / Home) ────────────────────────
const TEAL  = "#1B4D5C"
const BRAND = "#E8600A"
const MUTED = "#7A8A8F"

const cardShadow = {
  shadowColor: TEAL,
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 12,
  elevation: 3,
}

// ── Reusable pieces (defined outside Profile so inputs keep focus) ──────────
const Card = ({ children, style }) => (
  <View className="bg-surface rounded-[20px] p-4 mb-4" style={[cardShadow, style]}>{children}</View>
)

const CardHeader = ({ icon, tint = "#E8F4F7", color = TEAL, title, subtitle, right }) => (
  <View className="flex-row items-center mb-3.5">
    <View className="w-9 h-9 rounded-xl justify-center items-center mr-3" style={{ backgroundColor: tint }}>
      <Ionicons name={icon} size={18} color={color} />
    </View>
    <View className="flex-1">
      <Text className="text-[15px] font-extrabold text-ink -tracking-[0.2px]">{title}</Text>
      {subtitle ? <Text className="text-[11.5px] text-muted mt-px">{subtitle}</Text> : null}
    </View>
    {right}
  </View>
)

const Field = ({ icon, label, value, onChangeText, placeholder, editable = true, keyboardType, secureTextEntry, autoCapitalize, right }) => {
  const [focused, setFocused] = useState(false)
  return (
    <View className="mb-3">
      <Text className="text-[10.5px] font-bold text-muted uppercase tracking-[0.8px] mb-1.5">{label}</Text>
      <View
        className="flex-row items-center h-[46px] rounded-xl px-3"
        style={{
          backgroundColor: editable ? "#FFFFFF" : "#F4F1EC",
          borderWidth: 1.5,
          borderColor: !editable ? "transparent" : focused ? TEAL : "#ECE6DD",
        }}
      >
        <Ionicons name={icon} size={17} color={editable ? TEAL : "#9AA9AE"} />
        <TextInput
          style={{ flex: 1, marginLeft: 10, fontSize: 14, color: editable ? "#14213D" : "#7A8A8F", paddingVertical: 0 }}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#B0BFC4"
          editable={editable}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {!editable && <Ionicons name="lock-closed" size={13} color="#B5BDBF" />}
        {right}
      </View>
    </View>
  )
}

const Requirement = ({ ok, text }) => (
  <View className="flex-row items-center mb-1">
    <Ionicons name={ok ? "checkmark-circle" : "ellipse-outline"} size={15} color={ok ? "#22A559" : "#B5BDBF"} />
    <Text className="text-[12px] ml-2" style={{ color: ok ? "#1E8E4E" : MUTED }}>{text}</Text>
  </View>
)

const PrimaryButton = ({ label, icon, onPress, disabled, loading, color = BRAND }) => (
  <TouchableOpacity
    onPress={onPress}
    disabled={disabled}
    activeOpacity={0.85}
    className="h-[46px] rounded-xl flex-row justify-center items-center mt-1"
    style={{ backgroundColor: color, opacity: disabled ? 0.45 : 1 }}
  >
    {loading
      ? <ActivityIndicator size="small" color="#FFF" />
      : <>
          {icon && <Ionicons name={icon} size={17} color="#FFF" style={{ marginRight: 8 }} />}
          <Text className="text-[14px] font-bold text-white">{label}</Text>
        </>}
  </TouchableOpacity>
)

const initialsOf = (name = "") =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("")

export default function Profile() {
  const insets = useSafeAreaInsets()

  const [user, setUser] = useState(null)
  const [photoURL, setPhotoURL] = useState(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [showFullScreenImage, setShowFullScreenImage] = useState(false)

  // Form states
  const emptyProfile = { name: "", email: "", phone: "", city: "", username: "" }
  const [profileData, setProfileData] = useState(emptyProfile)
  const [savedProfile, setSavedProfile] = useState(emptyProfile) // last values stored in Firestore

  // Password change states
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [passwordData, setPasswordData] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" })
  const [showPasswords, setShowPasswords] = useState({ current: false, new: false, confirm: false })

  useEffect(() => { loadUserData() }, [])

  const loadUserData = async () => {
    try {
      const currentUser = auth.currentUser
      // If there is no session the root navigator already shows the auth screens.
      if (!currentUser) return

      setUser(currentUser)
      setPhotoURL(currentUser.photoURL || null)

      const userDoc = await getDoc(doc(db, "users", currentUser.uid))
      const userData = userDoc.exists() ? userDoc.data() : {}
      const loaded = {
        name:     userData.name || currentUser.displayName || "",
        email:    userData.email || currentUser.email || "",
        phone:    userData.phone || "",
        city:     userData.city || "",
        username: userData.username || "",
      }
      if (userData.photoURL) setPhotoURL(userData.photoURL)
      setProfileData(loaded)
      setSavedProfile(loaded)
    } catch (error) {
      console.error("Error loading user data:", error)
      Alert.alert("Error", "Failed to load profile data")
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (field, value) => setProfileData(prev => ({ ...prev, [field]: value }))
  const handlePasswordInputChange = (field, value) => setPasswordData(prev => ({ ...prev, [field]: value }))
  const togglePasswordVisibility = (field) => setShowPasswords(prev => ({ ...prev, [field]: !prev[field] }))

  const isDirty = useMemo(
    () => ["name", "phone", "city"].some(k => (profileData[k] || "").trim() !== (savedProfile[k] || "").trim()),
    [profileData, savedProfile]
  )

  const pwdCheck = useMemo(() => validatePassword(passwordData.newPassword), [passwordData.newPassword])
  const pwdMatch = passwordData.confirmPassword.length > 0 && passwordData.newPassword === passwordData.confirmPassword

  const pickImage = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (permissionResult.granted === false) {
        Alert.alert("Permission Required", "Permission to access your photos is required!")
        return
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      })
      if (!result.canceled && result.assets[0]) {
        await uploadProfileImage(result.assets[0].uri)
      }
    } catch (error) {
      console.error("Error picking image:", error)
      Alert.alert("Error", "Failed to pick image")
    }
  }

  const uploadProfileImage = async (imageUri) => {
    if (!user) return
    setUploadingImage(true)
    try {
      const blob = await uriToBlob(imageUri)
      const imageRef = ref(storage, `profile-images/${user.uid}`)
      await uploadBytes(imageRef, blob, { contentType: blob.type || "image/jpeg" })
      blob.close?.() // free the native blob
      const downloadURL = await getDownloadURL(imageRef)

      await firebaseUpdateProfile(user, { photoURL: downloadURL })
      await updateDoc(doc(db, "users", user.uid), { photoURL: downloadURL })

      setPhotoURL(downloadURL)
      Alert.alert("Success", "Profile photo updated!")
    } catch (error) {
      console.error("Error uploading image:", error?.code, error?.message || error)
      const denied = error?.code === "storage/unauthorized"
      Alert.alert(
        "Error",
        denied
          ? "You don't have permission to upload this photo. Check your Firebase Storage rules."
          : "Failed to update profile photo"
      )
    } finally {
      setUploadingImage(false)
    }
  }

  const updateUserProfile = async () => {
    if (!user) return
    if (!profileData.name.trim()) {
      Alert.alert("Error", "Name is required")
      return
    }
    setUpdating(true)
    try {
      await firebaseUpdateProfile(user, { displayName: profileData.name })
      await updateDoc(doc(db, "users", user.uid), {
        name: profileData.name,
        phone: profileData.phone,
        city: profileData.city,
        updatedAt: new Date(),
      })
      setSavedProfile(profileData)
      Alert.alert("Success", "Profile updated successfully!")
    } catch (error) {
      console.error("Error updating profile:", error)
      Alert.alert("Error", "Failed to update profile")
    } finally {
      setUpdating(false)
    }
  }

  const changePassword = async () => {
    if (!user) return
    if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
      Alert.alert("Error", "All password fields are required")
      return
    }
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      Alert.alert("Error", "New passwords do not match")
      return
    }
    if (!pwdCheck.isValid) {
      let errorMsg = "New password must have:\n"
      if (!pwdCheck.minLength) errorMsg += "• At least 8 characters\n"
      if (!pwdCheck.hasNumber) errorMsg += "• At least 1 number\n"
      if (!pwdCheck.hasSpecialChar) errorMsg += "• At least 1 special character"
      Alert.alert("Invalid Password", errorMsg)
      return
    }

    setUpdating(true)
    try {
      const credential = EmailAuthProvider.credential(user.email, passwordData.currentPassword)
      await reauthenticateWithCredential(user, credential)
      await updatePassword(user, passwordData.newPassword)

      setPasswordData({ currentPassword: "", newPassword: "", confirmPassword: "" })
      setShowPasswordForm(false)
      Alert.alert("Success", "Password changed successfully!")
    } catch (error) {
      console.error("Error changing password:", error)
      if (error.code === "auth/wrong-password" || error.code === "auth/invalid-credential") {
        Alert.alert("Error", "Current password is incorrect")
      } else {
        Alert.alert("Error", "Failed to change password")
      }
    } finally {
      setUpdating(false)
    }
  }

  const handleLogout = () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          try {
            const result = await logoutUser()
            // On success the auth listener in App.js switches to the login screens.
            if (!result.success) Alert.alert("Error", "Failed to logout")
          } catch (error) {
            console.error("Logout error:", error)
            Alert.alert("Error", "Failed to logout")
          }
        },
      },
    ])
  }

  const eyeButton = (field) => (
    <TouchableOpacity onPress={() => togglePasswordVisibility(field)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
      <Ionicons name={showPasswords[field] ? "eye-outline" : "eye-off-outline"} size={18} color={TEAL} />
    </TouchableOpacity>
  )

  if (loading) {
    return (
      <View className="flex-1 bg-bg justify-center items-center">
        <ActivityIndicator size="large" color={BRAND} />
        <Text className="text-[13px] text-muted mt-3">Loading profile…</Text>
      </View>
    )
  }

  const displayName  = profileData.name || user?.displayName || "Your name"
  const initials     = initialsOf(profileData.name || user?.displayName || "")
  const memberSince  = user?.metadata?.creationTime ? dayjs(user.metadata.creationTime).format("MMM YYYY") : null

  return (
    <KeyboardAvoidingView className="flex-1 bg-bg" behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 120 }}>

        {/* ── Hero ── */}
        <LinearGradient
          colors={["#1B4D5C", "#2B6F80"]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ paddingTop: insets.top + 14, paddingBottom: 54, paddingHorizontal: 22, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: "hidden" }}
        >
          <View pointerEvents="none" style={{ position: "absolute", width: 190, height: 190, borderRadius: 95, top: -70, right: -50, backgroundColor: "rgba(232,96,10,0.16)" }} />
          <View pointerEvents="none" style={{ position: "absolute", width: 90, height: 90, borderRadius: 45, bottom: 10, left: -30, backgroundColor: "rgba(255,255,255,0.07)" }} />

          <Text className="text-[13px] font-semibold text-white/70 text-center mb-3.5 tracking-[0.4px]">My Profile</Text>

          <View className="items-center">
            <View>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={photoURL ? () => setShowFullScreenImage(true) : pickImage}
                style={{ width: 92, height: 92, borderRadius: 46, borderWidth: 3, borderColor: "#FFFFFF", overflow: "hidden", backgroundColor: "#E8F4F7", justifyContent: "center", alignItems: "center" }}
              >
                {photoURL ? (
                  <Image source={{ uri: photoURL }} style={{ width: "100%", height: "100%" }} />
                ) : initials ? (
                  <Text className="text-[30px] font-extrabold" style={{ color: TEAL }}>{initials}</Text>
                ) : (
                  <Ionicons name="person" size={40} color={TEAL} />
                )}
                {uploadingImage && (
                  <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center" }}>
                    <ActivityIndicator size="small" color="#FFF" />
                  </View>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={pickImage}
                disabled={uploadingImage}
                activeOpacity={0.85}
                className="absolute bottom-0 right-0 w-[30px] h-[30px] rounded-full justify-center items-center bg-brand"
                style={{ borderWidth: 2.5, borderColor: "#FFFFFF" }}
              >
                <Ionicons name="camera" size={14} color="#FFF" />
              </TouchableOpacity>
            </View>

            <Text className="text-[20px] font-extrabold text-white mt-3 -tracking-[0.3px]" numberOfLines={1}>{displayName}</Text>
            <Text className="text-[12.5px] text-white/75 mt-0.5" numberOfLines={1}>
              {profileData.username ? `@${profileData.username}` : profileData.email}
            </Text>

            {(profileData.city || memberSince) ? (
              <View className="flex-row flex-wrap justify-center gap-2 mt-3">
                {profileData.city ? (
                  <View className="flex-row items-center px-2.5 py-1 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.16)" }}>
                    <Ionicons name="location" size={12} color="#FFF" />
                    <Text className="text-[11px] font-semibold text-white ml-1">{profileData.city}</Text>
                  </View>
                ) : null}
                {memberSince ? (
                  <View className="flex-row items-center px-2.5 py-1 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.16)" }}>
                    <Ionicons name="calendar-outline" size={12} color="#FFF" />
                    <Text className="text-[11px] font-semibold text-white ml-1">Member since {memberSince}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        </LinearGradient>

        {/* ── Content cards (overlap the hero) ── */}
        <View className="px-[22px] -mt-6">

          {/* Personal information */}
          <Card>
            <CardHeader icon="person-outline" title="Personal Information" subtitle="Keep your details up to date" />

            <Field icon="person-outline" label="Full name" placeholder="Your full name" value={profileData.name} onChangeText={(t) => handleInputChange("name", t)} />
            <Field icon="mail-outline" label="Email" value={profileData.email} editable={false} />
            {profileData.username ? <Field icon="at-outline" label="Username" value={profileData.username} editable={false} /> : null}
            <Field icon="call-outline" label="Phone" placeholder="Phone number" keyboardType="phone-pad" value={profileData.phone} onChangeText={(t) => handleInputChange("phone", t)} />
            <Field icon="location-outline" label="City / Township" placeholder="e.g. Orlando, Soweto" value={profileData.city} onChangeText={(t) => handleInputChange("city", t)} />

            <PrimaryButton
              label={isDirty ? "Save Changes" : "No changes to save"}
              icon={isDirty ? "checkmark-circle-outline" : undefined}
              onPress={updateUserProfile}
              disabled={!isDirty || updating}
              loading={updating && !showPasswordForm}
            />
          </Card>

          {/* Security */}
          <Card>
            <TouchableOpacity activeOpacity={0.8} onPress={() => setShowPasswordForm(v => !v)}>
              <CardHeader
                icon="shield-checkmark-outline" tint="#FFF1E8" color={BRAND}
                title="Password & Security" subtitle="Change your password"
                right={<Ionicons name={showPasswordForm ? "chevron-up" : "chevron-down"} size={18} color={MUTED} />}
              />
            </TouchableOpacity>

            {showPasswordForm && (
              <View>
                <Field icon="lock-closed-outline" label="Current password" placeholder="Enter current password"
                  value={passwordData.currentPassword} onChangeText={(t) => handlePasswordInputChange("currentPassword", t)}
                  secureTextEntry={!showPasswords.current} autoCapitalize="none" right={eyeButton("current")} />
                <Field icon="key-outline" label="New password" placeholder="Enter new password"
                  value={passwordData.newPassword} onChangeText={(t) => handlePasswordInputChange("newPassword", t)}
                  secureTextEntry={!showPasswords.new} autoCapitalize="none" right={eyeButton("new")} />
                <Field icon="key-outline" label="Confirm new password" placeholder="Repeat new password"
                  value={passwordData.confirmPassword} onChangeText={(t) => handlePasswordInputChange("confirmPassword", t)}
                  secureTextEntry={!showPasswords.confirm} autoCapitalize="none" right={eyeButton("confirm")} />

                <View className="rounded-xl p-3 mb-3" style={{ backgroundColor: "#F7F5F1" }}>
                  <Requirement ok={pwdCheck.minLength}      text="At least 8 characters" />
                  <Requirement ok={pwdCheck.hasNumber}      text="At least 1 number" />
                  <Requirement ok={pwdCheck.hasSpecialChar} text="At least 1 special character" />
                  <Requirement ok={pwdMatch}                text="Passwords match" />
                </View>

                <PrimaryButton
                  label="Update Password" icon="lock-closed-outline" color={TEAL}
                  onPress={changePassword}
                  disabled={updating || !pwdCheck.isValid || !pwdMatch || !passwordData.currentPassword}
                  loading={updating && showPasswordForm}
                />
              </View>
            )}
          </Card>

          {/* Logout */}
          <TouchableOpacity
            onPress={handleLogout}
            activeOpacity={0.85}
            className="h-12 rounded-2xl flex-row justify-center items-center bg-danger-light"
            style={{ borderWidth: 1.5, borderColor: "#F7C9C9" }}
          >
            <Ionicons name="log-out-outline" size={19} color="#DC3B3B" />
            <Text className="text-[14px] font-bold ml-2" style={{ color: "#DC3B3B" }}>Log Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Full-screen photo viewer */}
      <Modal visible={showFullScreenImage} transparent animationType="fade" onRequestClose={() => setShowFullScreenImage(false)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setShowFullScreenImage(false)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)", justifyContent: "center", alignItems: "center" }}>
          <View style={{ width: "90%", height: "75%" }}>
            <Image source={{ uri: photoURL }} style={{ width: "100%", height: "100%" }} resizeMode="contain" />
          </View>
          <TouchableOpacity
            onPress={() => setShowFullScreenImage(false)}
            style={{ position: "absolute", top: insets.top + 14, right: 18, backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 20, padding: 8 }}
          >
            <Ionicons name="close" size={24} color="#FFF" />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  )
}