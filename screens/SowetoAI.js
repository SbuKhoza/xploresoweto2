// "The ultimate guide to Soweto" — chat with the database-powered assistant (Stage 2B backend, callables ai*).
// No LLM and no provider key in the app: every answer comes from the Cloud Function, which reads XploreSoweto's own listings.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Image, Modal, Alert, Keyboard,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useNavigation } from "@react-navigation/native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import NetInfo from "@react-native-community/netinfo"
import { auth } from "../Firebase/config"
import { useEnrollment, DEFAULT_GREETING } from "../utils/enrollment"
import { callFunction, resendVerificationEmail, refreshEmailVerification } from "../utils/callable"
import { newRequestId } from "../utils/requestId"
import { getUserLocation } from "../utils/getLocation"
import { createAiApi, createSendState } from "../utils/ai/aiClient"
import { describeAiError } from "../utils/ai/errors"
import { assistantItemFromResponse, itemsFromConversation, blockStyle, screenForCard } from "../utils/ai/blocks"
import { canCallAssistant, locationDecision } from "../utils/ai/gates"
import { TEAL, BRAND, INK, MUTED, STAR } from "../components/xplorescreens/shared/theme"

const api = createAiApi(callFunction)
const SUGGESTIONS = [
  "What are the best places to visit in Soweto?",
  "Find restaurants near me.",
  "Plan a day exploring Soweto.",
  "What events are happening?",
  "Where can I experience Soweto culture?",
]
const TONE = { ok: { bg: "#E8F5EE", fg: "#1F7A4D" }, info: { bg: "#E7F1F4", fg: TEAL }, warn: { bg: "#FFF4E0", fg: "#9A6200" }, plain: null }
const shadow = { shadowColor: TEAL, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 2 }

const Chip = ({ text, onPress, disabled }) => (
  <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={0.8} accessibilityRole="button"
    style={{ borderWidth: 1, borderColor: "#CFE0E5", backgroundColor: "#FFFFFF", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, marginRight: 8, marginBottom: 8, opacity: disabled ? 0.5 : 1 }}>
    <Text style={{ color: TEAL, fontSize: 13, fontWeight: "600" }}>{text}</Text>
  </TouchableOpacity>
)

const Card = ({ c, offered, onOpen }) => {
  if (c.unavailable) {
    return (
      <View style={{ width: 230, marginRight: 10, borderRadius: 16, backgroundColor: "#EEF1F4", padding: 14, justifyContent: "center" }}>
        <Text style={{ color: MUTED, fontWeight: "700", fontSize: 13 }}>No longer available</Text>
        <Text style={{ color: MUTED, fontSize: 12, marginTop: 4 }}>This listing was removed or paused since the answer.</Text>
      </View>
    )
  }
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={() => onOpen(c)} accessibilityRole="button" accessibilityLabel={`Open ${c.title}`}
      style={{ width: 230, marginRight: 10, borderRadius: 18, backgroundColor: "#fff", overflow: "hidden", ...shadow }}>
      <View style={{ height: 96, backgroundColor: "#E7F1F4", alignItems: "center", justifyContent: "center" }}>
        {c.image ? <Image source={{ uri: c.image }} style={{ width: "100%", height: "100%" }} resizeMode="cover" /> : <Ionicons name={c.kind === "event" ? "calendar-outline" : "location-outline"} size={28} color={TEAL} />}
        {c.status ? (
          <View style={{ position: "absolute", top: 8, left: 8, backgroundColor: c.status === "Open now" ? "#22C55E" : "#6B7280", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
            <Text style={{ color: "#fff", fontSize: 10.5, fontWeight: "700" }}>{c.status}</Text>
          </View>
        ) : null}
      </View>
      <View style={{ padding: 10 }}>
        <Text numberOfLines={1} style={{ color: INK, fontWeight: "800", fontSize: 14 }}>{c.title}</Text>
        {c.subtitle ? <Text numberOfLines={2} style={{ color: "#5E7088", fontSize: 12, marginTop: 2 }}>{c.subtitle}</Text> : null}
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
          {c.rating !== null ? (
            <View style={{ flexDirection: "row", alignItems: "center", marginRight: 10 }}>
              <Ionicons name="star" size={12} color={STAR} />
              <Text style={{ color: INK, fontSize: 12, fontWeight: "700", marginLeft: 3 }}>{c.rating}{c.reviewCount !== null ? ` (${c.reviewCount})` : ""}</Text>
            </View>
          ) : null}
          {c.priceText ? <Text style={{ color: BRAND, fontSize: 12, fontWeight: "700" }}>{c.priceText}</Text> : null}
        </View>
        {c.distance ? <Text style={{ color: MUTED, fontSize: 11, marginTop: 4 }}>{c.distance}</Text> : null}
        {offered ? <Text style={{ color: TEAL, fontSize: 11.5, fontWeight: "700", marginTop: 6 }}>Booking request available</Text> : null}
      </View>
    </TouchableOpacity>
  )
}

const AssistantBubble = ({ m, onFollowUp, onOpenCard, busy }) => (
  <View style={{ marginBottom: 14, alignItems: "flex-start" }}>
    <View style={{ maxWidth: "94%", width: "100%" }}>
      {m.languageNotice ? <Text style={{ color: "#9A6200", fontSize: 12, marginBottom: 6 }}>{m.languageNotice}</Text> : null}
      {m.blocks.map((b, i) => {
        const st = blockStyle(b.type), tone = TONE[st.tone]
        return (
          <View key={i} style={{ backgroundColor: "#fff", borderRadius: 18, borderTopLeftRadius: 6, padding: 12, marginBottom: 6, ...shadow }}>
            {st.label ? (
              <View style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start", backgroundColor: tone.bg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 6 }}>
                <Ionicons name={st.icon} size={12} color={tone.fg} />
                <Text style={{ color: tone.fg, fontSize: 11, fontWeight: "700", marginLeft: 4 }}>{st.label}</Text>
              </View>
            ) : null}
            <Text selectable style={{ color: INK, fontSize: 15, lineHeight: 21 }}>{b.text}</Text>
          </View>
        )
      })}
      {m.distanceNote ? <Text style={{ color: MUTED, fontSize: 11.5, marginBottom: 6 }}>{m.distanceNote}</Text> : null}
      {m.cards.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 4 }} contentContainerStyle={{ paddingVertical: 6, paddingRight: 8 }}>
          {m.cards.map((c) => <Card key={c.ref} c={c} offered={m.bookingOffers.some((o) => o.ref === c.ref)} onOpen={onOpenCard} />)}
        </ScrollView>
      ) : null}
      {m.bookingOffers.length ? (
        <View style={{ backgroundColor: "#FFF4E0", borderRadius: 14, padding: 10, marginBottom: 6 }}>
          <Text style={{ color: "#7A4A00", fontSize: 12.5, lineHeight: 18 }}>
            {m.bookingNote || "Booking is a request only: the provider accepts or declines it, and nothing is confirmed until they respond."}
          </Text>
          {m.bookingOffers.map((o) => {
            const card = m.cards.find((c) => c.ref === o.ref)
            return (
              <TouchableOpacity key={o.ref} onPress={() => card && onOpenCard(card)} activeOpacity={0.85} style={{ marginTop: 8, backgroundColor: BRAND, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12 }}>
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>Open {o.title} to request a booking</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      ) : null}
      {m.followUps.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 }}>
          {m.followUps.map((f) => <Chip key={f} text={f} disabled={busy} onPress={() => onFollowUp(f)} />)}
        </View>
      ) : null}
    </View>
  </View>
)

const UserBubble = ({ text }) => (
  <View style={{ alignItems: "flex-end", marginBottom: 12 }}>
    <View style={{ maxWidth: "84%", backgroundColor: TEAL, borderRadius: 18, borderTopRightRadius: 6, paddingHorizontal: 14, paddingVertical: 10 }}>
      <Text selectable style={{ color: "#fff", fontSize: 15, lineHeight: 21 }}>{text}</Text>
    </View>
  </View>
)

export default function SowetoAI() {
  const navigation = useNavigation()
  const { enrollment } = useEnrollment()
  const greeting = enrollment?.greeting || DEFAULT_GREETING          // chosen by the user at sign-up
  const firstName = String(enrollment?.displayName || auth.currentUser?.displayName || "").trim().split(/\s+/)[0]
  const insets = useSafeAreaInsets()
  const scrollRef = useRef(null)
  const send = useRef(createSendState(newRequestId)).current
  const [items, setItems] = useState([])
  const [text, setText] = useState("")
  const [conversationId, setConversationId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)       // { ...describeAiError, text, message } — message is the preserved failed text
  const [usage, setUsage] = useState(null)       // { dailyLimit, remainingToday }
  const [retentionDays, setRetentionDays] = useState(null)
  const [online, setOnline] = useState(true)
  const [verified, setVerified] = useState(() => canCallAssistant(auth.currentUser))
  const [verifyMsg, setVerifyMsg] = useState("")
  const [locAsk, setLocAsk] = useState(null)     // text waiting for the user's location choice
  const [locOptOut, setLocOptOut] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState({ loading: false, error: null, rows: [] })

  useEffect(() => NetInfo.addEventListener((s) => setOnline(!(s.isConnected === false || s.isInternetReachable === false))), [])
  useEffect(() => { setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60) }, [items, busy, error, locAsk])

  const loadUsage = useCallback(async () => {
    try { const u = await api.usage(); setUsage({ dailyLimit: u.dailyLimit, remainingToday: u.remainingToday }); setRetentionDays(u.retentionDays ?? null) } catch { /* usage is optional */ }
  }, [])
  useEffect(() => { if (verified.allowed) loadUsage() }, [verified.allowed, loadUsage])

  const submit = useCallback(async (raw, location) => {
    const message = String(raw || "").trim()
    if (!message) return
    const gate = canCallAssistant(auth.currentUser)
    if (!gate.allowed) { setVerified(gate); return }              // never send a request we know will fail
    if (!online) { setError({ ...describeAiError(null, { offline: true }), message }); return }
    const requestId = send.begin(message)
    if (!requestId) return                                        // already sending: ignore duplicate taps
    setBusy(true); setError(null); setLocAsk(null)
    setItems((prev) => {
      const kept = prev.filter((x) => !x.pendingUser || x.pendingUser === message) // drop a failed message the user replaced
      return kept.some((x) => x.pendingUser === message) ? kept : [...kept, { role: "user", id: `p-${requestId}`, text: message, pendingUser: message }]
    })
    try {
      const r = await api.chat({ message, requestId, conversationId, location })
      send.succeed()
      if (r.conversationId) setConversationId(r.conversationId)
      if (r.usage) setUsage(r.usage)
      setItems((prev) => [...prev.map((x) => (x.pendingUser ? { ...x, pendingUser: undefined } : x)), assistantItemFromResponse(r)])
      setText("")
    } catch (e) {
      send.fail()
      const d = describeAiError(e)
      if (d.kind === "verify") setVerified({ allowed: false, reason: "verify" })
      if (d.kind === "missing") setConversationId(null)             // stale id: the retry starts a new conversation
      setError({ ...d, message })
      setText(message) // preserved
    } finally { setBusy(false) }
  }, [conversationId, online, send])

  const onSend = (t = text) => {
    const message = String(t || "").trim()
    if (!message || busy) return
    Keyboard.dismiss()
    if (locationDecision({ text: message, consent: locOptOut ? "declined" : "unknown" }) === "ask") { setLocAsk(message); return }
    submit(message, null)
  }
  const shareLocationThenSend = async () => {
    const message = locAsk
    setLocAsk(null)
    const loc = await getUserLocation()                           // asks the OS permission now, after the user's explicit choice
    if (!loc) Alert.alert("Location not shared", "Location wasn't available, so I'll answer without it.")
    submit(message, loc || null)                                  // coordinates are used for this one request only, never stored or logged
  }
  const retry = () => { if (error?.message) submit(error.message, null) }  // same text => same requestId

  const newChat = () => {
    if (busy) return
    send.reset(); setItems([]); setConversationId(null); setError(null); setText(""); setLocAsk(null)
  }

  const openCard = (c) => {
    const target = screenForCard(c)
    if (!target) { Alert.alert("Unavailable", "That listing can't be opened from here right now."); return }
    navigation.navigate("MainApp", { screen: target.tab, params: { screen: target.screen, params: { from: "SowetoAI" } } })
  }

  const loadHistory = async () => {
    setHistoryOpen(true); setHistory({ loading: true, error: null, rows: [] })
    try { const r = await api.list(); setHistory({ loading: false, error: null, rows: r.conversations || [] }) }
    catch (e) { setHistory({ loading: false, error: describeAiError(e).text, rows: [] }) }
  }
  const openConversation = async (id) => {
    setHistory((h) => ({ ...h, loading: true }))
    try {
      const r = await api.open(id)
      send.reset(); setItems(itemsFromConversation(r)); setConversationId(id); setError(null); setHistoryOpen(false)
    } catch (e) { setHistory((h) => ({ ...h, loading: false, error: describeAiError(e).text })) }
  }
  const deleteConversation = (id) => Alert.alert("Delete conversation", "This permanently deletes this conversation from our servers.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: async () => {
      try { await api.remove(id); setHistory((h) => ({ ...h, rows: h.rows.filter((r) => r.conversationId !== id) })); if (id === conversationId) newChat() }
      catch (e) { Alert.alert("Couldn't delete", describeAiError(e).text) }
    } },
  ])
  const deleteAll = () => Alert.alert("Delete all my assistant data",
    "This permanently deletes every conversation you've had with the assistant. It can't be undone.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete everything", style: "destructive", onPress: async () => {
      try { const r = await api.removeAll(); newChat(); setHistory({ loading: false, error: null, rows: [] }); Alert.alert("Deleted", `${r.conversations ?? 0} conversation(s) deleted.`) }
      catch (e) { Alert.alert("Couldn't delete", describeAiError(e).text) }
    } },
  ])

  const resend = async () => {
    try { await resendVerificationEmail(); setVerifyMsg("Verification email sent. Check your inbox and spam folder.") }
    catch { setVerifyMsg("Couldn't send the email. Please try again in a few minutes.") }
  }
  const recheck = async () => {
    try {
      const ok = await refreshEmailVerification()
      if (ok) { setVerified({ allowed: true, reason: null }); setVerifyMsg(""); if (error?.kind === "verify") setError(null) }
      else setVerifyMsg("Not verified yet. Open the link in the email first, then tap again.")
    } catch { setVerifyMsg("Couldn't check. Check your connection and try again.") }
  }

  const empty = items.length === 0
  const lowUsage = usage && usage.remainingToday <= 5
  const retention = useMemo(() => (retentionDays ? `Chats are saved to your account and set to expire ${retentionDays} days after the last message. You can delete them any time.` : "Chats are saved to your account. You can delete them any time."), [retentionDays])

  return (
    <View style={{ flex: 1, backgroundColor: "#F5F7FA" }}>
      {/* header */}
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 14, paddingBottom: 10, backgroundColor: TEAL, flexDirection: "row", alignItems: "center" }}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ padding: 4 }}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginHorizontal: 8 }}>
          <Text numberOfLines={1} style={{ color: "#fff", fontWeight: "800", fontSize: 17 }}>Malloya</Text>
          <Text numberOfLines={1} style={{ color: "#CFE0E5", fontSize: 11.5 }}>{usage ? `The ultimate guide to Soweto · ${usage.remainingToday} of ${usage.dailyLimit} left today` : "The ultimate guide to Soweto"}</Text>
        </View>
        <TouchableOpacity onPress={loadHistory} accessibilityLabel="Conversation history" style={{ padding: 6 }}><Ionicons name="time-outline" size={22} color="#fff" /></TouchableOpacity>
        <TouchableOpacity onPress={newChat} disabled={busy} accessibilityLabel="New conversation" style={{ padding: 6, opacity: busy ? 0.5 : 1 }}><Ionicons name="create-outline" size={22} color="#fff" /></TouchableOpacity>
      </View>

      {!online ? (
        <View style={{ backgroundColor: "#FDECEC", paddingVertical: 6, paddingHorizontal: 14 }}>
          <Text style={{ color: "#B42318", fontSize: 12.5 }}>You're offline. The assistant needs an internet connection.</Text>
        </View>
      ) : null}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0}>
        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
          {empty ? (
            <View style={{ marginBottom: 8 }}>
              <View style={{ backgroundColor: "#fff", borderRadius: 20, padding: 16, ...shadow }}>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                  <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: BRAND, alignItems: "center", justifyContent: "center" }}><Ionicons name="compass" size={22} color="#fff" /></View>
                  <Text style={{ color: INK, fontWeight: "800", fontSize: 17, marginLeft: 10, flex: 1 }}>{`${greeting}${firstName ? `, ${firstName}` : ""}! I'm Malloya, your Soweto guide.`}</Text>
                </View>
                <Text style={{ color: "#5E7088", fontSize: 14, lineHeight: 20 }}>
                  Ask me about places to visit, restaurants, stays, events and culture. I answer from XploreSoweto's own listings, and I'll say so when something isn't confirmed.
                </Text>
              </View>
              <Text style={{ color: MUTED, fontWeight: "700", fontSize: 12, marginTop: 16, marginBottom: 8 }}>TRY ASKING</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                {SUGGESTIONS.map((s) => <Chip key={s} text={s} disabled={busy || !verified.allowed} onPress={() => onSend(s)} />)}
              </View>
              <Text style={{ color: MUTED, fontSize: 11.5, lineHeight: 16, marginTop: 10 }}>{retention}</Text>
            </View>
          ) : null}

          {items.map((m) => m.role === "user"
            ? <UserBubble key={m.id} text={m.text} />
            : <AssistantBubble key={m.id} m={m} busy={busy || !verified.allowed} onFollowUp={(f) => onSend(f)} onOpenCard={openCard} />)}

          {busy ? (
            <View style={{ alignSelf: "flex-start", backgroundColor: "#fff", borderRadius: 18, borderTopLeftRadius: 6, paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row", alignItems: "center", ...shadow }}>
              <ActivityIndicator size="small" color={TEAL} /><Text style={{ color: MUTED, marginLeft: 8, fontSize: 13 }}>Malloya is looking…</Text>
            </View>
          ) : null}

          {locAsk ? (
            <View style={{ backgroundColor: "#E7F1F4", borderRadius: 16, padding: 12, marginTop: 6 }}>
              <Text style={{ color: INK, fontWeight: "800", fontSize: 14 }}>Share your location for nearby results?</Text>
              <Text style={{ color: "#3D5663", fontSize: 12.5, lineHeight: 18, marginTop: 4 }}>
                Sharing is optional. Your position is sent with this one message only to work out approximate distances. It isn't saved or logged.
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 10 }}>
                <TouchableOpacity onPress={shareLocationThenSend} style={{ backgroundColor: TEAL, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9, marginRight: 8, marginBottom: 6 }}><Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>Share once</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => submit(locAsk, null)} style={{ borderWidth: 1, borderColor: TEAL, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, marginRight: 8, marginBottom: 6 }}><Text style={{ color: TEAL, fontWeight: "700", fontSize: 13 }}>Not now</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => { setLocOptOut(true); submit(locAsk, null) }} style={{ paddingHorizontal: 8, paddingVertical: 9, marginBottom: 6 }}><Text style={{ color: MUTED, fontSize: 12.5 }}>Don't ask again</Text></TouchableOpacity>
              </View>
            </View>
          ) : null}

          {error && error.kind !== "verify" ? (
            <View style={{ backgroundColor: "#FDECEC", borderRadius: 16, padding: 12, marginTop: 6 }}>
              <Text style={{ color: "#B42318", fontWeight: "800", fontSize: 14 }}>{error.title}</Text>
              <Text style={{ color: "#7A271A", fontSize: 13, lineHeight: 18, marginTop: 3 }}>{error.text}</Text>
              {error.retry ? (
                <TouchableOpacity onPress={retry} disabled={busy} style={{ alignSelf: "flex-start", marginTop: 8, backgroundColor: "#B42318", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 }}>
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>Try again</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          {!verified.allowed ? (
            <View style={{ backgroundColor: "#FFF4E0", borderRadius: 16, padding: 14, marginTop: 8 }}>
              <Text style={{ color: "#7A4A00", fontWeight: "800", fontSize: 15 }}>{verified.reason === "auth" ? "Please sign in" : "Verify your email to chat"}</Text>
              <Text style={{ color: "#7A4A00", fontSize: 13, lineHeight: 19, marginTop: 4 }}>
                {verified.reason === "auth" ? "Sign in to use the assistant." : "The assistant is available once your email address is verified. We sent a link when you signed up; check your inbox and spam folder."}
              </Text>
              {verified.reason === "verify" ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 10 }}>
                  <TouchableOpacity onPress={resend} style={{ borderWidth: 1, borderColor: BRAND, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, marginRight: 8, marginBottom: 6 }}><Text style={{ color: BRAND, fontWeight: "800", fontSize: 13 }}>Resend email</Text></TouchableOpacity>
                  <TouchableOpacity onPress={recheck} style={{ backgroundColor: BRAND, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9, marginBottom: 6 }}><Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>I've verified</Text></TouchableOpacity>
                </View>
              ) : null}
              {verifyMsg ? <Text style={{ color: "#7A4A00", fontSize: 12.5, marginTop: 4 }}>{verifyMsg}</Text> : null}
            </View>
          ) : null}
        </ScrollView>

        {lowUsage && usage.remainingToday > 0 ? <Text style={{ textAlign: "center", color: "#9A6200", fontSize: 11.5, paddingBottom: 2 }}>{usage.remainingToday} message{usage.remainingToday === 1 ? "" : "s"} left today</Text> : null}
        <View style={{ flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 12, paddingTop: 8, paddingBottom: insets.bottom + 8, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5EAEE" }}>
          <TextInput
            value={text} onChangeText={setText} editable={!busy && verified.allowed}
            placeholder={verified.allowed ? "Ask Malloya about Soweto…" : "Verify your email to chat"} placeholderTextColor={MUTED}
            multiline maxLength={1000} returnKeyType="default"
            style={{ flex: 1, maxHeight: 110, minHeight: 42, backgroundColor: "#F1F4F7", borderRadius: 21, paddingHorizontal: 16, paddingTop: Platform.OS === "ios" ? 11 : 8, paddingBottom: Platform.OS === "ios" ? 11 : 8, fontSize: 15, color: INK }}
          />
          <TouchableOpacity onPress={() => onSend()} disabled={busy || !text.trim() || !verified.allowed} accessibilityLabel="Send message"
            style={{ marginLeft: 8, width: 42, height: 42, borderRadius: 21, backgroundColor: BRAND, alignItems: "center", justifyContent: "center", opacity: busy || !text.trim() || !verified.allowed ? 0.45 : 1 }}>
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={historyOpen} animationType="slide" onRequestClose={() => setHistoryOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "#F5F7FA", paddingTop: insets.top + 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingBottom: 10 }}>
            <Text style={{ flex: 1, color: INK, fontWeight: "800", fontSize: 18 }}>Your conversations</Text>
            <TouchableOpacity onPress={() => setHistoryOpen(false)} accessibilityLabel="Close"><Ionicons name="close" size={26} color={INK} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 24 }}>
            {history.loading ? <ActivityIndicator color={TEAL} style={{ marginTop: 20 }} /> : null}
            {history.error ? <Text style={{ color: "#B42318", marginBottom: 10 }}>{history.error}</Text> : null}
            {!history.loading && !history.error && history.rows.length === 0 ? <Text style={{ color: MUTED }}>No saved conversations yet.</Text> : null}
            {history.rows.map((r) => (
              <View key={r.conversationId} style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 14, marginBottom: 8, ...shadow }}>
                <TouchableOpacity style={{ flex: 1, padding: 12 }} onPress={() => openConversation(r.conversationId)}>
                  <Text numberOfLines={1} style={{ color: INK, fontWeight: "700", fontSize: 14 }}>{r.title || "Conversation"}</Text>
                  <Text style={{ color: MUTED, fontSize: 11.5, marginTop: 2 }}>{new Date(r.updatedAt).toLocaleString()} · {r.messageCount} messages</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteConversation(r.conversationId)} accessibilityLabel="Delete conversation" style={{ padding: 12 }}><Ionicons name="trash-outline" size={19} color="#B42318" /></TouchableOpacity>
              </View>
            ))}
            <Text style={{ color: MUTED, fontSize: 12, lineHeight: 17, marginTop: 12 }}>{retention} Your exact location is never saved with a chat.</Text>
            <TouchableOpacity onPress={deleteAll} style={{ marginTop: 14, borderWidth: 1, borderColor: "#B42318", borderRadius: 12, paddingVertical: 11, alignItems: "center" }}>
              <Text style={{ color: "#B42318", fontWeight: "800" }}>Delete all my assistant data</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  )
}
