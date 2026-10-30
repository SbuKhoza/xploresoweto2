"use client"

import {
  StyleSheet, Text, View, ScrollView, TouchableOpacity, TextInput,
  Image, Alert, StatusBar, Modal, FlatList,
  Dimensions, ActivityIndicator,
} from "react-native"
import { useState, useEffect } from "react"
import { useNavigation } from "@react-navigation/native"
import { SafeAreaView } from "react-native-safe-area-context"
import MaterialIcons from "@expo/vector-icons/MaterialIcons"
import * as ImagePicker from "expo-image-picker"
import { auth, db, storage } from "../../Firebase/config"
import { ref, uploadBytes, getDownloadURL } from "firebase/storage"
import { collection, addDoc, updateDoc, deleteDoc, doc, query, orderBy, onSnapshot, arrayUnion } from "firebase/firestore"
import { onAuthStateChanged } from "firebase/auth"
import { getDoc } from "firebase/firestore"
import { useLoading } from "../../components/context/LoadingContext"

const { width: screenWidth, height: screenHeight } = Dimensions.get("window")

// ── Design tokens ────────────────────────────────────────────────────────────
const ACCENT    = "#1A1A2E"
const HIGHLIGHT = "#E94560"
const BG        = "#F4F6FB"
const SURFACE   = "#FFFFFF"
const MISSING   = "#E94560"   // red-pink — urgent
const WANTED    = "#F59E0B"   // amber — caution
// ─────────────────────────────────────────────────────────────────────────────

const PersonOfInterest = () => {
  const navigation = useNavigation()
  const [activeTab, setActiveTab]           = useState("posts")
  const [posts, setPosts]                   = useState([])
  const [selectedPost, setSelectedPost]     = useState(null)
  const [showComments, setShowComments]     = useState(false)
  const [currentUser, setCurrentUser]       = useState(null)
  const [loading, setLoading]               = useState(true)
  const [editingPost, setEditingPost]       = useState(null)
  const [showEditModal, setShowEditModal]   = useState(false)
  const [imageViewerVisible, setImageViewerVisible] = useState(false)
  const [currentImageIndex, setCurrentImageIndex]   = useState(0)
  const [viewerImages, setViewerImages]     = useState([])
  const [uploadingImages, setUploadingImages] = useState(false)

  const [formData, setFormData] = useState({
    type: "missing", name: "", age: "", height: "",
    description: "", mentalStatus: "", lastSeenLocation: "", images: [],
  })
  const [commentText, setCommentText]   = useState("")
  const [commentImages, setCommentImages] = useState([])

  const { withLoading } = useLoading()

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const userDoc = await getDoc(doc(db, "users", user.uid))
        if (userDoc.exists()) {
          setCurrentUser({
            id: user.uid,
            displayName: userDoc.data().displayName || userDoc.data().name,
            email: userDoc.data().email,
            username: userDoc.data().username,
          })
        }
      } else { setCurrentUser(null) }
      setLoading(false)
    })
    return () => unsubscribe()
  }, [])

  const fetchPosts = async () => {
    try {
      const q = query(collection(db, "Person-Of-Interest"), orderBy("postedAt", "desc"))
      const unsubscribe = onSnapshot(q, async (snap) => {
        const postPromises = snap.docs.map(async (docSnap) => {
          const postData = docSnap.data()
          const userDoc = await getDoc(doc(db, "users", postData.postedBy))
          const userData = userDoc.exists() ? userDoc.data() : { displayName: "Unknown User" }
          return { id: docSnap.id, ...postData, postedBy: { id: postData.postedBy, displayName: userData.displayName || userData.name || "Unknown User" } }
        })
        setPosts(await Promise.all(postPromises))
      })
      return () => unsubscribe()
    } catch (error) { Alert.alert("Error", "Failed to load posts") }
  }

  useEffect(() => { if (currentUser) fetchPosts() }, [currentUser])

  const uploadImageToStorage = async (imageUri, folder = "person-of-interest") => {
    const response = await fetch(imageUri)
    const blob = await response.blob()
    const filename = `${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`
    const storageRef = ref(storage, `${folder}/${filename}`)
    await uploadBytes(storageRef, blob)
    return await getDownloadURL(storageRef)
  }

  const handleImagePicker = async (isComment = false) => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!perm.granted) { Alert.alert("Permission Required", "Permission to access camera roll is required!"); return }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, selectionLimit: isComment ? 3 : 5, quality: 0.8, allowsEditing: false })
      if (!result.canceled && result.assets?.length > 0) {
        setUploadingImages(true)
        try {
          const urls = await Promise.all(result.assets.map(a => uploadImageToStorage(a.uri)))
          isComment ? setCommentImages(p => [...p, ...urls]) : setFormData(p => ({ ...p, images: [...p.images, ...urls] }))
        } catch { Alert.alert("Upload Error", "Failed to upload images. Please try again.") }
        finally { setUploadingImages(false) }
      }
    } catch (error) { Alert.alert("Error", `Failed to open image picker: ${error.message}`); setUploadingImages(false) }
  }

  const removeImage = (index, isComment = false) => {
    isComment ? setCommentImages(p => p.filter((_,i) => i !== index)) : setFormData(p => ({ ...p, images: p.images.filter((_,i) => i !== index) }))
  }

  const resetForm = () => setFormData({ type:"missing", name:"", age:"", height:"", description:"", mentalStatus:"", lastSeenLocation:"", images:[] })

  const handleSubmitPost = async () => {
    if (!formData.name || !formData.age || !formData.description || !formData.lastSeenLocation) { Alert.alert("Error","Please fill in all required fields"); return }
    if (!currentUser) { Alert.alert("Error","You must be logged in to create a post"); return }
    try {
      await addDoc(collection(db, "Person-Of-Interest"), { ...formData, postedBy: currentUser.id, postedAt: new Date(), comments: [] })
      resetForm(); setActiveTab("posts")
      Alert.alert("Success","Person of Interest post created successfully")
    } catch { Alert.alert("Error","Failed to create post") }
  }

  const handleEditPost = (post) => {
    setEditingPost(post)
    setFormData({ type:post.type, name:post.name, age:post.age, height:post.height, description:post.description, mentalStatus:post.mentalStatus, lastSeenLocation:post.lastSeenLocation, images:post.images })
    setShowEditModal(true)
  }

  const handleUpdatePost = async () => {
    if (!formData.name || !formData.age || !formData.description || !formData.lastSeenLocation) { Alert.alert("Error","Please fill in all required fields"); return }
    try {
      await updateDoc(doc(db, "Person-Of-Interest", editingPost.id), { ...formData, updatedAt: new Date() })
      setShowEditModal(false); setEditingPost(null); resetForm()
      Alert.alert("Success","Post updated successfully")
    } catch { Alert.alert("Error","Failed to update post") }
  }

  const handleDeletePost = (postId) => {
    Alert.alert("Delete Post","Are you sure you want to delete this post? This action cannot be undone.",[
      { text:"Cancel", style:"cancel" },
      { text:"Delete", style:"destructive", onPress: async () => {
        try { await deleteDoc(doc(db,"Person-Of-Interest",postId)); Alert.alert("Success","Post deleted successfully") }
        catch { Alert.alert("Error","Failed to delete post") }
      }},
    ])
  }

  const handleAddComment = async () => {
    if (!commentText.trim() && commentImages.length === 0) { Alert.alert("Error","Please add a comment or image"); return }
    if (!currentUser) { Alert.alert("Error","You must be logged in to comment"); return }
    try {
      const newComment = { id: Date.now().toString(), text: commentText, images: commentImages, author: { id: currentUser.id, displayName: currentUser.displayName }, createdAt: new Date().toISOString() }
      await updateDoc(doc(db,"Person-Of-Interest",selectedPost.id), { comments: arrayUnion(newComment) })
      setPosts(p => p.map(post => post.id === selectedPost.id ? { ...post, comments:[...post.comments,newComment] } : post))
      setSelectedPost(p => ({ ...p, comments:[...p.comments,newComment] }))
      setCommentText(""); setCommentImages([])
      Alert.alert("Success","Comment added successfully")
    } catch { Alert.alert("Error","Failed to add comment") }
  }

  const openComments      = (post) => { setSelectedPost(post); setShowComments(true) }
  const openImageViewer   = (images, startIndex = 0) => { setViewerImages(images); setCurrentImageIndex(startIndex); setImageViewerVisible(true) }
  const closeImageViewer  = () => { setImageViewerVisible(false); setViewerImages([]); setCurrentImageIndex(0) }
  const nextImage         = () => setCurrentImageIndex(p => (p+1) % viewerImages.length)
  const previousImage     = () => setCurrentImageIndex(p => (p-1+viewerImages.length) % viewerImages.length)

  // ── Form ─────────────────────────────────────────────────────────────────
  const FormBody = ({ onSubmit, submitLabel }) => (
    <ScrollView style={styles.formScroll} contentContainerStyle={styles.formContent} showsVerticalScrollIndicator={false}>
      {/* Type selector */}
      <View style={styles.typeSelector}>
        {["missing","wanted"].map(t => (
          <TouchableOpacity key={t} style={[styles.typeBtn, formData.type === t && (t==="missing" ? styles.typeBtnMissing : styles.typeBtnWanted)]}
            onPress={() => setFormData(p => ({ ...p, type: t }))}>
            <MaterialIcons name={t==="missing" ? "person-search" : "gavel"} size={18}
              color={formData.type === t ? "#FFF" : "#888"} />
            <Text style={[styles.typeBtnText, formData.type === t && styles.typeBtnTextActive]}>
              {t === "missing" ? "Missing Person" : "Wanted Person"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Name */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Full Name <Text style={styles.required}>*</Text></Text>
        <TextInput style={styles.input} value={formData.name} onChangeText={t => setFormData(p=>({...p,name:t}))} placeholder="Enter full name" placeholderTextColor="#BBB" />
      </View>

      {/* Age + Height */}
      <View style={styles.fieldRow}>
        <View style={[styles.fieldGroup, { flex:1, marginRight:10 }]}>
          <Text style={styles.fieldLabel}>Age <Text style={styles.required}>*</Text></Text>
          <TextInput style={styles.input} value={formData.age} onChangeText={t => setFormData(p=>({...p,age:t}))} placeholder="Age" placeholderTextColor="#BBB" keyboardType="numeric" />
        </View>
        <View style={[styles.fieldGroup, { flex:1 }]}>
          <Text style={styles.fieldLabel}>Height</Text>
          <TextInput style={styles.input} value={formData.height} onChangeText={t => setFormData(p=>({...p,height:t}))} placeholder={'e.g. 5\'8"'} placeholderTextColor="#BBB" />
        </View>
      </View>

      {/* Mental Status */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Mental Status</Text>
        <TextInput style={styles.input} value={formData.mentalStatus} onChangeText={t => setFormData(p=>({...p,mentalStatus:t}))} placeholder="Mental health status (if known)" placeholderTextColor="#BBB" />
      </View>

      {/* Last Seen */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Last Seen Location <Text style={styles.required}>*</Text></Text>
        <TextInput style={styles.input} value={formData.lastSeenLocation} onChangeText={t => setFormData(p=>({...p,lastSeenLocation:t}))} placeholder="Where was this person last seen?" placeholderTextColor="#BBB" />
      </View>

      {/* Description */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Description <Text style={styles.required}>*</Text></Text>
        <TextInput style={[styles.input, styles.textArea]} value={formData.description} onChangeText={t => setFormData(p=>({...p,description:t}))} placeholder="Physical description, clothing, distinguishing features…" placeholderTextColor="#BBB" multiline numberOfLines={4} />
      </View>

      {/* Photos */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Photos</Text>
        <TouchableOpacity style={[styles.photoPickerBtn, uploadingImages && { opacity:0.6 }]} onPress={() => handleImagePicker()} disabled={uploadingImages}>
          {uploadingImages ? <ActivityIndicator size="small" color={HIGHLIGHT} /> : <MaterialIcons name="add-a-photo" size={22} color={HIGHLIGHT} />}
          <Text style={styles.photoPickerText}>{uploadingImages ? "Uploading…" : "Add Photos"}</Text>
        </TouchableOpacity>
        {formData.images.length > 0 && (
          <ScrollView horizontal style={{ marginTop:10 }} showsHorizontalScrollIndicator={false}>
            {formData.images.map((img,i) => (
              <View key={i} style={styles.thumbWrap}>
                <TouchableOpacity onPress={() => openImageViewer(formData.images,i)}>
                  <Image source={{ uri:img }} style={styles.thumb} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.thumbRemove} onPress={() => removeImage(i)}>
                  <MaterialIcons name="close" size={12} color="#FFF" />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      <TouchableOpacity style={styles.submitBtn} onPress={onSubmit} activeOpacity={0.88}>
        <Text style={styles.submitBtnText}>{submitLabel}</Text>
      </TouchableOpacity>
    </ScrollView>
  )

  // ── Post Card ────────────────────────────────────────────────────────────
  const PostCard = ({ post }) => (
    <View style={styles.postCard}>
      {/* Header */}
      <View style={styles.postCardHeader}>
        <View style={[styles.postTypeBadge, { backgroundColor: post.type === "missing" ? MISSING : WANTED }]}>
          <MaterialIcons name={post.type === "missing" ? "person-search" : "gavel"} size={12} color="#FFF" />
          <Text style={styles.postTypeBadgeText}>{post.type.toUpperCase()}</Text>
        </View>
        <Text style={styles.postedBy}>by {post.postedBy.displayName}</Text>
        {currentUser?.id === post.postedBy.id && (
          <View style={styles.postCardActions}>
            <TouchableOpacity style={styles.postActionBtn} onPress={() => handleEditPost(post)}>
              <MaterialIcons name="edit" size={16} color={ACCENT} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.postActionBtn, { backgroundColor:"#FFF0F3" }]} onPress={() => handleDeletePost(post.id)}>
              <MaterialIcons name="delete" size={16} color={HIGHLIGHT} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Name */}
      <Text style={styles.personName}>{post.name}</Text>

      {/* Images */}
      {post.images.length > 0 && (
        <ScrollView horizontal style={styles.postImagesScroll} showsHorizontalScrollIndicator={false}>
          {post.images.map((img,i) => (
            <TouchableOpacity key={i} onPress={() => openImageViewer(post.images,i)} activeOpacity={0.9}>
              <Image source={{ uri:img }} style={styles.postImg} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Details grid */}
      <View style={styles.detailsGrid}>
        {[
          { label:"Age", value:post.age },
          { label:"Height", value:post.height },
          { label:"Mental Status", value:post.mentalStatus },
          { label:"Last Seen", value:post.lastSeenLocation },
        ].filter(d => d.value).map((d,i) => (
          <View key={i} style={styles.detailChip}>
            <Text style={styles.detailChipLabel}>{d.label}</Text>
            <Text style={styles.detailChipValue}>{d.value}</Text>
          </View>
        ))}
      </View>

      {/* Description */}
      <Text style={styles.postDescription}>{post.description}</Text>

      {/* Comments button */}
      <TouchableOpacity style={styles.commentsBtn} onPress={() => openComments(post)}>
        <MaterialIcons name="comment" size={18} color={ACCENT} />
        <Text style={styles.commentsBtnText}>{post.comments.length} Comment{post.comments.length !== 1 ? "s" : ""}</Text>
      </TouchableOpacity>
    </View>
  )

  // ── States ───────────────────────────────────────────────────────────────
  if (loading) return (
    <SafeAreaView style={styles.container}>
      <View style={styles.stateScreen}>
        <ActivityIndicator size="large" color={HIGHLIGHT} />
      </View>
    </SafeAreaView>
  )

  if (!currentUser) return (
    <SafeAreaView style={styles.container}>
      <View style={styles.stateScreen}>
        <View style={styles.stateIconWrap}><MaterialIcons name="lock-outline" size={36} color={ACCENT} /></View>
        <Text style={styles.stateText}>Please log in</Text>
        <Text style={styles.stateSubText}>You must be logged in to use Person of Interest</Text>
      </View>
    </SafeAreaView>
  )

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Person of Interest</Text>
          <Text style={styles.headerSubtitle}>Missing & wanted persons</Text>
        </View>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {[{ key:"posts", icon:"list", label:"Posts" }, { key:"create", icon:"add-circle-outline", label:"Report" }].map(t => (
          <TouchableOpacity key={t.key} style={[styles.tabBarItem, activeTab === t.key && styles.tabBarItemActive]}
            onPress={() => setActiveTab(t.key)}>
            <MaterialIcons name={t.icon} size={18} color={activeTab === t.key ? HIGHLIGHT : "#AAA"} />
            <Text style={[styles.tabBarLabel, activeTab === t.key && styles.tabBarLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === "posts" ? (
        <FlatList
          data={posts}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <PostCard post={item} />}
          contentContainerStyle={styles.postsList}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={() => (
            <View style={styles.stateScreen}>
              <View style={styles.stateIconWrap}><MaterialIcons name="person-search" size={36} color={ACCENT} /></View>
              <Text style={styles.stateText}>No posts yet</Text>
              <Text style={styles.stateSubText}>Be the first to report a person of interest</Text>
            </View>
          )}
        />
      ) : (
        <FormBody onSubmit={handleSubmitPost} submitLabel="Submit Report" />
      )}

      {/* Edit Modal */}
      <Modal visible={showEditModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.sheetContainer}>
          <View style={styles.sheetHeader}>
            <TouchableOpacity style={styles.sheetCloseBtn} onPress={() => { setShowEditModal(false); setEditingPost(null); resetForm() }}>
              <MaterialIcons name="close" size={20} color={ACCENT} />
            </TouchableOpacity>
            <Text style={styles.sheetTitle}>Edit Post</Text>
            <TouchableOpacity style={styles.sheetSaveBtn} onPress={handleUpdatePost}>
              <Text style={styles.sheetSaveText}>Save</Text>
            </TouchableOpacity>
          </View>
          <FormBody onSubmit={handleUpdatePost} submitLabel="Save Changes" />
        </SafeAreaView>
      </Modal>

      {/* Comments Modal */}
      <Modal visible={showComments} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.sheetContainer}>
          <View style={styles.sheetHeader}>
            <TouchableOpacity style={styles.sheetCloseBtn} onPress={() => setShowComments(false)}>
              <MaterialIcons name="close" size={20} color={ACCENT} />
            </TouchableOpacity>
            <Text style={styles.sheetTitle}>Comments</Text>
            <View style={{ width:44 }} />
          </View>

          {selectedPost && (
            <>
              <ScrollView style={{ flex:1 }} contentContainerStyle={{ padding:16 }} showsVerticalScrollIndicator={false}>
                {selectedPost.comments.length === 0 && (
                  <View style={[styles.stateScreen, { paddingVertical:40 }]}>
                    <Text style={styles.stateSubText}>No comments yet. Be the first!</Text>
                  </View>
                )}
                {selectedPost.comments.map(comment => (
                  <View key={comment.id} style={styles.commentCard}>
                    <View style={styles.commentHeader}>
                      <View style={styles.commentAvatar}>
                        <Text style={styles.commentAvatarLetter}>{comment.author.displayName?.[0]?.toUpperCase() || "?"}</Text>
                      </View>
                      <View style={{ flex:1 }}>
                        <Text style={styles.commentAuthor}>{comment.author.displayName}</Text>
                        <Text style={styles.commentDate}>{new Date(comment.createdAt).toLocaleDateString()}</Text>
                      </View>
                    </View>
                    {comment.text ? <Text style={styles.commentText}>{comment.text}</Text> : null}
                    {comment.images.length > 0 && (
                      <ScrollView horizontal style={{ marginTop:8 }} showsHorizontalScrollIndicator={false}>
                        {comment.images.map((img,i) => (
                          <TouchableOpacity key={i} onPress={() => openImageViewer(comment.images,i)}>
                            <Image source={{ uri:img }} style={styles.commentImg} />
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                ))}
              </ScrollView>

              {/* Add comment */}
              <View style={styles.addComment}>
                {commentImages.length > 0 && (
                  <ScrollView horizontal style={{ marginBottom:8 }} showsHorizontalScrollIndicator={false}>
                    {commentImages.map((img,i) => (
                      <View key={i} style={styles.thumbWrap}>
                        <Image source={{ uri:img }} style={[styles.thumb,{width:44,height:44}]} />
                        <TouchableOpacity style={styles.thumbRemove} onPress={() => removeImage(i,true)}>
                          <MaterialIcons name="close" size={10} color="#FFF" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </ScrollView>
                )}
                <TextInput style={styles.commentInput} value={commentText} onChangeText={setCommentText} placeholder="Add a comment…" placeholderTextColor="#BBB" multiline />
                <View style={styles.commentActions}>
                  <TouchableOpacity style={styles.commentPhotoBtn} onPress={() => handleImagePicker(true)}>
                    <MaterialIcons name="add-a-photo" size={20} color={ACCENT} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.commentSendBtn} onPress={handleAddComment}>
                    <Text style={styles.commentSendText}>Send</Text>
                    <MaterialIcons name="send" size={16} color="#FFF" />
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}
        </SafeAreaView>
      </Modal>

      {/* Image Viewer */}
      <Modal visible={imageViewerVisible} transparent animationType="fade" onRequestClose={closeImageViewer}>
        <View style={styles.viewerContainer}>
          <TouchableOpacity style={styles.viewerClose} onPress={closeImageViewer}>
            <MaterialIcons name="close" size={28} color="#FFF" />
          </TouchableOpacity>
          {viewerImages.length > 0 && (
            <Image source={{ uri:viewerImages[currentImageIndex] }} style={styles.viewerImage} resizeMode="contain" />
          )}
          {viewerImages.length > 1 && (
            <>
              <TouchableOpacity style={styles.viewerNav} onPress={previousImage}>
                <MaterialIcons name="chevron-left" size={36} color="#FFF" />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.viewerNav, styles.viewerNavRight]} onPress={nextImage}>
                <MaterialIcons name="chevron-right" size={36} color="#FFF" />
              </TouchableOpacity>
              <View style={styles.viewerCounter}>
                <Text style={styles.viewerCounterText}>{currentImageIndex+1} / {viewerImages.length}</Text>
              </View>
            </>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex:1, backgroundColor:BG },

  stateScreen: { flex:1, justifyContent:"center", alignItems:"center", padding:40 },
  stateIconWrap: { width:80, height:80, borderRadius:24, backgroundColor:"#EEF2FF", justifyContent:"center", alignItems:"center", marginBottom:16 },
  stateText: { fontSize:18, fontWeight:"700", color:ACCENT, marginBottom:6 },
  stateSubText: { fontSize:14, color:"#999", textAlign:"center" },

  header: { paddingHorizontal:22, paddingTop:14, paddingBottom:6 },
  headerTitle: { fontSize:26, fontWeight:"800", color:ACCENT, letterSpacing:-0.5 },
  headerSubtitle: { fontSize:13, color:"#888", fontWeight:"500", marginTop:1 },

  tabBar: { flexDirection:"row", backgroundColor:SURFACE, marginHorizontal:20, marginVertical:10, borderRadius:16, padding:4, shadowColor:ACCENT, shadowOffset:{width:0,height:2}, shadowOpacity:0.07, shadowRadius:8, elevation:2 },
  tabBarItem: { flex:1, flexDirection:"row", alignItems:"center", justifyContent:"center", paddingVertical:10, borderRadius:12, gap:6 },
  tabBarItemActive: { backgroundColor:"#FFF0F3" },
  tabBarLabel: { fontSize:13, fontWeight:"600", color:"#AAA" },
  tabBarLabelActive: { color:HIGHLIGHT, fontWeight:"700" },

  postsList: { paddingHorizontal:16, paddingTop:4, paddingBottom:120 },

  postCard: { backgroundColor:SURFACE, borderRadius:20, marginBottom:16, padding:16, shadowColor:ACCENT, shadowOffset:{width:0,height:4}, shadowOpacity:0.08, shadowRadius:10, elevation:3 },
  postCardHeader: { flexDirection:"row", alignItems:"center", marginBottom:10, gap:8 },
  postTypeBadge: { flexDirection:"row", alignItems:"center", paddingHorizontal:10, paddingVertical:5, borderRadius:20, gap:4 },
  postTypeBadgeText: { fontSize:10, fontWeight:"800", color:"#FFF", letterSpacing:0.5 },
  postedBy: { flex:1, fontSize:12, color:"#888" },
  postCardActions: { flexDirection:"row", gap:6 },
  postActionBtn: { width:32, height:32, borderRadius:10, backgroundColor:"#EEF2FF", justifyContent:"center", alignItems:"center" },
  personName: { fontSize:20, fontWeight:"900", color:ACCENT, marginBottom:12, letterSpacing:-0.3 },
  postImagesScroll: { marginBottom:14 },
  postImg: { width:130, height:130, borderRadius:14, marginRight:10 },
  detailsGrid: { flexDirection:"row", flexWrap:"wrap", gap:8, marginBottom:12 },
  detailChip: { backgroundColor:BG, paddingHorizontal:12, paddingVertical:8, borderRadius:12 },
  detailChipLabel: { fontSize:10, fontWeight:"700", color:"#AAA", textTransform:"uppercase", letterSpacing:0.5, marginBottom:2 },
  detailChipValue: { fontSize:13, fontWeight:"600", color:ACCENT },
  postDescription: { fontSize:14, color:"#555", lineHeight:21, marginBottom:14 },
  commentsBtn: { flexDirection:"row", alignItems:"center", gap:8, paddingTop:12, borderTopWidth:1, borderTopColor:"#F0F0F0" },
  commentsBtnText: { fontSize:14, fontWeight:"600", color:ACCENT },

  // Form
  formScroll: { flex:1 },
  formContent: { paddingHorizontal:20, paddingTop:16, paddingBottom:80 },
  typeSelector: { flexDirection:"row", gap:10, marginBottom:20 },
  typeBtn: { flex:1, flexDirection:"row", alignItems:"center", justifyContent:"center", gap:8, paddingVertical:14, borderRadius:16, backgroundColor:"#F0F0F0", borderWidth:1.5, borderColor:"transparent" },
  typeBtnMissing: { backgroundColor:MISSING, borderColor:MISSING },
  typeBtnWanted: { backgroundColor:WANTED, borderColor:WANTED },
  typeBtnText: { fontSize:13, fontWeight:"700", color:"#888" },
  typeBtnTextActive: { color:"#FFF" },
  fieldGroup: { marginBottom:14 },
  fieldRow: { flexDirection:"row" },
  fieldLabel: { fontSize:13, fontWeight:"700", color:ACCENT, marginBottom:6, textTransform:"uppercase", letterSpacing:0.5 },
  required: { color:HIGHLIGHT },
  input: { borderWidth:1.5, borderColor:"#E8ECF4", borderRadius:12, paddingHorizontal:14, paddingVertical:12, fontSize:15, color:ACCENT, backgroundColor:SURFACE },
  textArea: { height:100, textAlignVertical:"top" },
  photoPickerBtn: { flexDirection:"row", alignItems:"center", justifyContent:"center", gap:8, borderWidth:2, borderColor:HIGHLIGHT, borderStyle:"dashed", borderRadius:14, paddingVertical:18, backgroundColor:"#FFF9FA" },
  photoPickerText: { fontSize:15, fontWeight:"700", color:HIGHLIGHT },
  thumbWrap: { position:"relative", marginRight:10 },
  thumb: { width:72, height:72, borderRadius:12 },
  thumbRemove: { position:"absolute", top:-5, right:-5, width:20, height:20, borderRadius:10, backgroundColor:HIGHLIGHT, alignItems:"center", justifyContent:"center" },
  submitBtn: { backgroundColor:ACCENT, borderRadius:16, paddingVertical:16, alignItems:"center", marginTop:6, shadowColor:ACCENT, shadowOffset:{width:0,height:6}, shadowOpacity:0.3, shadowRadius:10, elevation:5 },
  submitBtnText: { color:"#FFF", fontSize:16, fontWeight:"800" },

  // Sheet
  sheetContainer: { flex:1, backgroundColor:BG },
  sheetHeader: { flexDirection:"row", alignItems:"center", justifyContent:"space-between", paddingHorizontal:20, paddingVertical:16, backgroundColor:SURFACE, borderBottomWidth:1, borderBottomColor:"#F0F0F0" },
  sheetCloseBtn: { width:38, height:38, borderRadius:12, backgroundColor:BG, justifyContent:"center", alignItems:"center" },
  sheetTitle: { fontSize:17, fontWeight:"800", color:ACCENT },
  sheetSaveBtn: { backgroundColor:HIGHLIGHT, paddingHorizontal:16, paddingVertical:8, borderRadius:12 },
  sheetSaveText: { color:"#FFF", fontSize:14, fontWeight:"700" },

  // Comments
  commentCard: { backgroundColor:SURFACE, borderRadius:16, padding:14, marginBottom:10, shadowColor:ACCENT, shadowOffset:{width:0,height:2}, shadowOpacity:0.05, shadowRadius:6, elevation:1 },
  commentHeader: { flexDirection:"row", alignItems:"center", gap:10, marginBottom:8 },
  commentAvatar: { width:38, height:38, borderRadius:12, backgroundColor:ACCENT, justifyContent:"center", alignItems:"center" },
  commentAvatarLetter: { fontSize:15, fontWeight:"800", color:"#FFF" },
  commentAuthor: { fontSize:14, fontWeight:"700", color:ACCENT },
  commentDate: { fontSize:11, color:"#BBB", marginTop:1 },
  commentText: { fontSize:14, color:"#555", lineHeight:20 },
  commentImg: { width:60, height:60, borderRadius:10, marginRight:8 },
  addComment: { backgroundColor:SURFACE, padding:16, borderTopWidth:1, borderTopColor:"#F0F0F0" },
  commentInput: { borderWidth:1.5, borderColor:"#E8ECF4", borderRadius:12, paddingHorizontal:14, paddingVertical:10, fontSize:14, color:ACCENT, maxHeight:80, marginBottom:10 },
  commentActions: { flexDirection:"row", justifyContent:"space-between", alignItems:"center" },
  commentPhotoBtn: { width:42, height:42, borderRadius:12, backgroundColor:BG, justifyContent:"center", alignItems:"center" },
  commentSendBtn: { flexDirection:"row", alignItems:"center", gap:6, backgroundColor:ACCENT, borderRadius:12, paddingHorizontal:18, paddingVertical:10 },
  commentSendText: { color:"#FFF", fontSize:14, fontWeight:"700" },

  // Viewer
  viewerContainer: { flex:1, backgroundColor:"rgba(0,0,0,0.92)", justifyContent:"center", alignItems:"center" },
  viewerClose: { position:"absolute", top:50, right:20, zIndex:10, width:44, height:44, borderRadius:14, backgroundColor:"rgba(255,255,255,0.15)", justifyContent:"center", alignItems:"center" },
  viewerImage: { width:screenWidth, height:screenHeight*0.8 },
  viewerNav: { position:"absolute", left:16, top:"50%", width:44, height:44, borderRadius:14, backgroundColor:"rgba(255,255,255,0.15)", justifyContent:"center", alignItems:"center" },
  viewerNavRight: { left:undefined, right:16 },
  viewerCounter: { position:"absolute", bottom:50, backgroundColor:"rgba(0,0,0,0.6)", paddingHorizontal:16, paddingVertical:8, borderRadius:20 },
  viewerCounterText: { color:"#FFF", fontSize:15, fontWeight:"600" },
})

export default PersonOfInterest