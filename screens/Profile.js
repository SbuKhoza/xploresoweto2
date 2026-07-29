"use client"

import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal, // Added Modal import for fullscreen image view
} from "react-native"
import { useState, useEffect } from "react"
import { Ionicons } from "@expo/vector-icons"
import * as ImagePicker from "expo-image-picker"
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

export default function Profile({ navigation }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [showFullScreenImage, setShowFullScreenImage] = useState(false) // Added state for fullscreen image modal

  // Form states
  const [profileData, setProfileData] = useState({
    name: "",
    email: "",
    phone: "",
    city: "",
    username: "",
  })

  // Password change states
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [passwordData, setPasswordData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  })
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  })

  // Load user data on component mount
  useEffect(() => {
    loadUserData()
  }, [])

  const loadUserData = async () => {
    try {
      const currentUser = auth.currentUser
      if (!currentUser) {
        navigation.replace("Authentication")
        return
      }

      setUser(currentUser)

      // Get additional user data from Firestore
      const userDoc = await getDoc(doc(db, "users", currentUser.uid))
      if (userDoc.exists()) {
        const userData = userDoc.data()
        setProfileData({
          name: userData.name || currentUser.displayName || "",
          email: userData.email || currentUser.email || "",
          phone: userData.phone || "",
          city: userData.city || "",
          username: userData.username || "",
        })
      }
    } catch (error) {
      console.error("Error loading user data:", error)
      Alert.alert("Error", "Failed to load profile data")
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (field, value) => {
    setProfileData((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  const handlePasswordInputChange = (field, value) => {
    setPasswordData((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  const togglePasswordVisibility = (field) => {
    setShowPasswords((prev) => ({
      ...prev,
      [field]: !prev[field],
    }))
  }

  const pickImage = async () => {
    try {
      // Request permission
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync()

      if (permissionResult.granted === false) {
        Alert.alert("Permission Required", "Permission to access camera roll is required!")
        return
      }

      // Launch image picker
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
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
      // Convert image to blob
      const response = await fetch(imageUri)
      const blob = await response.blob()

      // Create storage reference
      const imageRef = ref(storage, `profile-images/${user.uid}`)

      // Upload image
      await uploadBytes(imageRef, blob)

      // Get download URL
      const downloadURL = await getDownloadURL(imageRef)

      // Update user profile
      await firebaseUpdateProfile(user, {
        photoURL: downloadURL,
      })

      // Update Firestore document
      await updateDoc(doc(db, "users", user.uid), {
        photoURL: downloadURL,
      })

      // Refresh user data
      await loadUserData()

      Alert.alert("Success", "Profile image updated successfully!")
    } catch (error) {
      console.error("Error uploading image:", error)
      Alert.alert("Error", "Failed to update profile image")
    } finally {
      setUploadingImage(false)
    }
  }

  const updateUserProfile = async () => {
    if (!user) return

    // Validate required fields
    if (!profileData.name.trim()) {
      Alert.alert("Error", "Name is required")
      return
    }

    setUpdating(true)
    try {
      // Update Firebase Auth profile
      await firebaseUpdateProfile(user, {
        displayName: profileData.name,
      })

      // Update Firestore document
      await updateDoc(doc(db, "users", user.uid), {
        name: profileData.name,
        phone: profileData.phone,
        city: profileData.city,
        updatedAt: new Date(),
      })

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

    // Validate passwords
    if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
      Alert.alert("Error", "All password fields are required")
      return
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      Alert.alert("Error", "New passwords do not match")
      return
    }

    // Validate new password strength
    const passwordValidation = validatePassword(passwordData.newPassword)
    if (!passwordValidation.isValid) {
      let errorMsg = "New password must have:\n"
      if (!passwordValidation.minLength) errorMsg += "• At least 8 characters\n"
      if (!passwordValidation.hasNumber) errorMsg += "• At least 1 number\n"
      if (!passwordValidation.hasSpecialChar) errorMsg += "• At least 1 special character"

      Alert.alert("Invalid Password", errorMsg)
      return
    }

    setUpdating(true)
    try {
      // Re-authenticate user with current password
      const credential = EmailAuthProvider.credential(user.email, passwordData.currentPassword)
      await reauthenticateWithCredential(user, credential)

      // Update password
      await updatePassword(user, passwordData.newPassword)

      // Clear password form
      setPasswordData({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      })
      setShowPasswordForm(false)

      Alert.alert("Success", "Password changed successfully!")
    } catch (error) {
      console.error("Error changing password:", error)
      if (error.code === "auth/wrong-password") {
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
            if (result.success) {
              if (navigation && navigation.reset) {
                navigation.reset({
                  index: 0,
                  routes: [{ name: "Authentication" }],
                })
              } else if (navigation && navigation.navigate) {
                navigation.navigate("Authentication")
              } else if (navigation && navigation.replace) {
                navigation.replace("Authentication")
              } else {
                console.log("[v0] Navigation object not available, logout successful but cannot navigate")
                Alert.alert("Success", "Logged out successfully! Please restart the app.")
              }
            } else {
              Alert.alert("Error", "Failed to logout")
            }
          } catch (error) {
            console.error("Logout error:", error)
            if (navigation && navigation.reset) {
              navigation.reset({
                index: 0,
                routes: [{ name: "Authentication" }],
              })
            } else if (navigation && navigation.navigate) {
              navigation.navigate("Authentication")
            } else if (navigation && navigation.replace) {
              navigation.replace("Authentication")
            }
          }
        },
      },
    ])
  }

  const handleImagePress = () => {
    if (user?.photoURL) {
      setShowFullScreenImage(true)
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#BC5C2E" />
        <Text style={styles.loadingText}>Loading profile...</Text>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>My Profile</Text>
        </View>

        {/* Profile Image Section */}
        <View style={styles.imageSection}>
          <View style={styles.imageContainer}>
            <TouchableOpacity onPress={handleImagePress} disabled={!user?.photoURL}>
              {user?.photoURL ? (
                <Image source={{ uri: user.photoURL }} style={styles.profileImage} />
              ) : (
                <View style={styles.placeholderImage}>
                  <Ionicons name="person" size={60} color="#BC5C2E" />
                </View>
              )}
            </TouchableOpacity>
            {uploadingImage && (
              <View style={styles.imageOverlay}>
                <ActivityIndicator size="small" color="#FFF" />
              </View>
            )}
          </View>
          <TouchableOpacity style={styles.changeImageButton} onPress={pickImage} disabled={uploadingImage}>
            <Ionicons name="camera" size={16} color="#FFF" />
            <Text style={styles.changeImageText}>Change Photo</Text>
          </TouchableOpacity>
        </View>

        {/* Profile Form */}
        <View style={styles.formContainer}>
          <Text style={styles.sectionTitle}>Personal Information</Text>

          {/* Name */}
          <View style={styles.inputContainer}>
            <Ionicons name="person-outline" size={20} color="#BC5C2E" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Full Name"
              placeholderTextColor="#999"
              value={profileData.name}
              onChangeText={(text) => handleInputChange("name", text)}
            />
          </View>

          {/* Email (Read-only) */}
          <View style={[styles.inputContainer, styles.readOnlyInput]}>
            <Ionicons name="mail-outline" size={20} color="#999" style={styles.inputIcon} />
            <TextInput
              style={[styles.input, styles.readOnlyText]}
              placeholder="Email Address"
              placeholderTextColor="#999"
              value={profileData.email}
              editable={false}
            />
          </View>

          {/* Username (Read-only) */}
          {profileData.username && (
            <View style={[styles.inputContainer, styles.readOnlyInput]}>
              <Ionicons name="at-outline" size={20} color="#999" style={styles.inputIcon} />
              <TextInput
                style={[styles.input, styles.readOnlyText]}
                placeholder="Username"
                placeholderTextColor="#999"
                value={profileData.username}
                editable={false}
              />
            </View>
          )}

          {/* Phone */}
          <View style={styles.inputContainer}>
            <Ionicons name="call-outline" size={20} color="#BC5C2E" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Phone Number"
              placeholderTextColor="#999"
              value={profileData.phone}
              onChangeText={(text) => handleInputChange("phone", text)}
              keyboardType="phone-pad"
            />
          </View>

          {/* City/Town/Township */}
          <View style={styles.inputContainer}>
            <Ionicons name="location-outline" size={20} color="#BC5C2E" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="City, Town or Township"
              placeholderTextColor="#999"
              value={profileData.city}
              onChangeText={(text) => handleInputChange("city", text)}
            />
          </View>

          {/* Update Profile Button */}
          <TouchableOpacity
            style={[styles.updateButton, updating && styles.disabledButton]}
            onPress={updateUserProfile}
            disabled={updating}
          >
            <Text style={styles.updateButtonText}>{updating ? "Updating..." : "Update Profile"}</Text>
          </TouchableOpacity>
        </View>

        {/* Password Section */}
        <View style={styles.formContainer}>
          <TouchableOpacity style={styles.sectionHeader} onPress={() => setShowPasswordForm(!showPasswordForm)}>
            <Text style={styles.sectionTitle}>Change Password</Text>
            <Ionicons name={showPasswordForm ? "chevron-up" : "chevron-down"} size={20} color="#BC5C2E" />
          </TouchableOpacity>

          {showPasswordForm && (
            <View style={styles.passwordForm}>
              {/* Current Password */}
              <View style={styles.inputContainer}>
                <Ionicons name="lock-closed-outline" size={20} color="#BC5C2E" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Current Password"
                  placeholderTextColor="#999"
                  value={passwordData.currentPassword}
                  onChangeText={(text) => handlePasswordInputChange("currentPassword", text)}
                  secureTextEntry={!showPasswords.current}
                  autoCapitalize="none"
                />
                <TouchableOpacity style={styles.eyeIcon} onPress={() => togglePasswordVisibility("current")}>
                  <Ionicons
                    name={showPasswords.current ? "eye-outline" : "eye-off-outline"}
                    size={20}
                    color="#BC5C2E"
                  />
                </TouchableOpacity>
              </View>

              {/* New Password */}
              <View style={styles.inputContainer}>
                <Ionicons name="lock-closed-outline" size={20} color="#BC5C2E" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="New Password"
                  placeholderTextColor="#999"
                  value={passwordData.newPassword}
                  onChangeText={(text) => handlePasswordInputChange("newPassword", text)}
                  secureTextEntry={!showPasswords.new}
                  autoCapitalize="none"
                />
                <TouchableOpacity style={styles.eyeIcon} onPress={() => togglePasswordVisibility("new")}>
                  <Ionicons name={showPasswords.new ? "eye-outline" : "eye-off-outline"} size={20} color="#BC5C2E" />
                </TouchableOpacity>
              </View>

              {/* Confirm New Password */}
              <View style={styles.inputContainer}>
                <Ionicons name="lock-closed-outline" size={20} color="#BC5C2E" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Confirm New Password"
                  placeholderTextColor="#999"
                  value={passwordData.confirmPassword}
                  onChangeText={(text) => handlePasswordInputChange("confirmPassword", text)}
                  secureTextEntry={!showPasswords.confirm}
                  autoCapitalize="none"
                />
                <TouchableOpacity style={styles.eyeIcon} onPress={() => togglePasswordVisibility("confirm")}>
                  <Ionicons
                    name={showPasswords.confirm ? "eye-outline" : "eye-off-outline"}
                    size={20}
                    color="#BC5C2E"
                  />
                </TouchableOpacity>
              </View>

              {/* Password Requirements */}
              <View style={styles.passwordRequirements}>
                <Text style={styles.requirementsTitle}>Password Requirements:</Text>
                <Text style={styles.requirementText}>• Minimum 8 characters</Text>
                <Text style={styles.requirementText}>• At least 1 number</Text>
                <Text style={styles.requirementText}>• At least 1 special character</Text>
              </View>

              {/* Change Password Button */}
              <TouchableOpacity
                style={[styles.updateButton, updating && styles.disabledButton]}
                onPress={changePassword}
                disabled={updating}
              >
                <Text style={styles.updateButtonText}>{updating ? "Changing..." : "Change Password"}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Logout Section */}
        <View style={styles.formContainer}>
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={20} color="#FFF" />
            <Text style={styles.logoutButtonText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal
        visible={showFullScreenImage}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowFullScreenImage(false)}
      >
        <View style={styles.fullScreenContainer}>
          <TouchableOpacity style={styles.fullScreenOverlay} onPress={() => setShowFullScreenImage(false)}>
            <View style={styles.fullScreenImageContainer}>
              <Image source={{ uri: user?.photoURL }} style={styles.fullScreenImage} resizeMode="contain" />
              <TouchableOpacity style={styles.closeButton} onPress={() => setShowFullScreenImage(false)}>
                <Ionicons name="close" size={30} color="#FFF" />
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F6F6F6",
    marginBottom: 30,
  },
  centered: {
    justifyContent: "center",
    alignItems: "center",
  },
  scrollContainer: {
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  header: {
    alignItems: "center",
    marginBottom: 30,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#BC5C2E",
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: "#666",
  },
  imageSection: {
    alignItems: "center",
    marginBottom: 30,
  },
  imageContainer: {
    position: "relative",
    marginBottom: 15,
  },
  profileImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: "#BC5C2E",
  },
  placeholderImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#F0F0F0",
    borderWidth: 3,
    borderColor: "#BC5C2E",
    justifyContent: "center",
    alignItems: "center",
  },
  imageOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 60,
    justifyContent: "center",
    alignItems: "center",
  },
  changeImageButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#BC5C2E",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  changeImageText: {
    color: "#FFF",
    marginLeft: 8,
    fontWeight: "600",
  },
  formContainer: {
    backgroundColor: "white",
    borderRadius: 15,
    padding: 20,
    marginBottom: 20,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#BC5C2E",
    marginBottom: 5,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#ECCCAF",
    borderRadius: 10,
    paddingHorizontal: 15,
    paddingVertical: 4, // Reduced padding from 12 to 8 to decrease height
    marginBottom: 15,
    backgroundColor: "#F9F9F9",
  },
  readOnlyInput: {
    backgroundColor: "#F5F5F5",
    borderColor: "#E0E0E0",
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: "#000",
  },
  readOnlyText: {
    color: "#666",
  },
  eyeIcon: {
    padding: 5,
  },
  passwordForm: {
    marginTop: 10,
  },
  passwordRequirements: {
    marginBottom: 20,
    padding: 15,
    backgroundColor: "#FFF8F5",
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#BC5C2E",
  },
  requirementsTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#BC5C2E",
    marginBottom: 5,
  },
  requirementText: {
    fontSize: 12,
    color: "#666",
    marginBottom: 2,
  },
  updateButton: {
    backgroundColor: "#BC5C2E",
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: "center",
    elevation: 2,
    shadowColor: "#BC5C2E",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  disabledButton: {
    backgroundColor: "#ECCCAF",
    elevation: 0,
    shadowOpacity: 0,
  },
  updateButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
  logoutButton: {
    flexDirection: "row",
    backgroundColor: "#DC3545",
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
    shadowColor: "#DC3545",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  logoutButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
    marginLeft: 8,
  },
  fullScreenContainer: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  fullScreenOverlay: {
    flex: 1,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  fullScreenImageContainer: {
    width: "90%",
    height: "80%",
    position: "relative",
  },
  fullScreenImage: {
    width: "100%",
    height: "100%",
  },
  closeButton: {
    position: "absolute",
    top: -50,
    right: 10,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    borderRadius: 20,
    padding: 10,
  },
})
