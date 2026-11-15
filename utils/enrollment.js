import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { doc, getDoc, updateDoc } from "firebase/firestore"
import { db } from "../Firebase/config"
import { ensureProfileWithRetry } from "./profileBootstrap"

// ═════════════════════════════════════════════════════════════════════════════
// Enrollment — the one-time setup every new user completes after creating an
// account: a greeting and their kasi (the display name is collected at sign-up).
//
// The profile users/{uid} is created by the ensureUserProfile Cloud Function (idempotent, safe to retry). This provider
// makes sure it exists before enrollment and exposes a "profile-failed" state with a retry.
// Saved on the user's Firestore document  users/{uid}:
//   greeting, kasi, enrolled: true, enrolledAt
// and cached on the device so the app also opens offline.
// ═════════════════════════════════════════════════════════════════════════════

// The greetings a user can pick from (edit the list to add more)
export const GREETINGS = [
  { key: "Aweh",  emoji: "🤙", colors: ["#E8600A", "#B8430A"] },
  { key: "Fede",  emoji: "🔥", colors: ["#0A86B4", "#12407E"] },
  { key: "Eita",  emoji: "👋", colors: ["#1FA463", "#0B6B45"] },
  { key: "Hello", emoji: "😊", colors: ["#7A4FE0", "#43299E"] },
]
export const DEFAULT_GREETING = "Aweh"

const cacheKey = (uid) => `enrollment:${uid}`

const Ctx = createContext({
  status: "loading",   // "loading" | "needed" | "done" | "profile-failed"
  user: null,
  existing: null,      // the user's Firestore document, if any
  enrollment: null,    // { displayName, greeting, kasi } once enrolled
  complete: async () => {},
  retryProfile: () => {},
  updateEnrollment: () => {},
})

export const useEnrollment = () => useContext(Ctx)

export const EnrollmentProvider = ({ user, children }) => {
  const uid = user?.uid
  const [status, setStatus] = useState("loading")
  const [existing, setExisting] = useState(null)
  const [enrollment, setEnrollment] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const retryProfile = useCallback(() => setAttempt((a) => a + 1), [])

  useEffect(() => {
    if (!uid) { setStatus("loading"); setEnrollment(null); setExisting(null); return }
    let alive = true
    setStatus("loading")

    ;(async () => {
      // 1) Device cache — instant, and works offline
      let cached = null
      try { const raw = await AsyncStorage.getItem(cacheKey(uid)); cached = raw ? JSON.parse(raw) : null } catch {}
      if (alive && cached?.enrolled) { setEnrollment(cached); setStatus("done") }

      // 2) Firestore — the source of truth
      try {
        let snap = await getDoc(doc(db, "users", uid))
        if (!snap.exists()) {
          // Auth account exists but its profile does not (sign-up was interrupted, or the first attempt failed):
          // ask the server to create it. Idempotent, so retrying never duplicates or overwrites anything.
          const input = user?.displayName ? { displayName: user.displayName } : {}
          let r = await ensureProfileWithRetry(input)
          if (!r.ok && r.error?.code === "invalid-argument") r = await ensureProfileWithRetry({})
          if (!alive) return
          if (!r.ok) { if (!cached?.enrolled) setStatus("profile-failed"); return }
          snap = await getDoc(doc(db, "users", uid))
        }
        const data = snap.exists() ? snap.data() : {}
        if (!alive) return
        setExisting(data)
        if (data.enrolled) {
          const e = { enrolled: true, displayName: data.displayName || null, greeting: data.greeting || DEFAULT_GREETING, kasi: data.kasi || null }
          setEnrollment(e); setStatus("done")
          AsyncStorage.setItem(cacheKey(uid), JSON.stringify(e)).catch(() => {})
        } else if (!cached?.enrolled) {
          setStatus("needed")
        }
      } catch {
        if (alive && !cached?.enrolled) setStatus("needed")
      }
    })()

    return () => { alive = false }
  }, [uid, attempt])

  // Save the answers. Throws a readable Error if something goes wrong.
  const complete = useCallback(async ({ greeting, kasi }) => {
    if (!uid) throw new Error("You need to be signed in.")
    // Make sure the profile exists (it normally already does). Never overwrites an existing profile.
    if (!existing?.uid) {
      const r = await ensureProfileWithRetry(user?.displayName ? { displayName: user.displayName } : {})
      if (!r.ok) throw new Error("Couldn't set up your profile. Check your connection and try again.")
    }
    // Only fields the security rules allow a user to change
    const payload = { greeting, kasi, enrolled: true, enrolledAt: new Date(), updatedAt: new Date() }
    try {
      await updateDoc(doc(db, "users", uid), payload)
    } catch {
      throw new Error("Couldn't save your details. Check your connection and try again.")
    }

    const e = { enrolled: true, displayName: existing?.displayName || user?.displayName || null, greeting, kasi }
    AsyncStorage.setItem(cacheKey(uid), JSON.stringify(e)).catch(() => {})
    setExisting((prev) => ({ ...(prev || {}), ...payload }))
    setEnrollment(e)
    setStatus("done")
  }, [uid, user, existing])

  // Keep the in-memory + cached enrollment in step with edits made elsewhere (e.g. Profile)
  const updateEnrollment = useCallback((patch) => {
    setEnrollment((prev) => {
      const next = { ...(prev || { enrolled: true }), ...patch }
      if (uid) AsyncStorage.setItem(cacheKey(uid), JSON.stringify(next)).catch(() => {})
      return next
    })
  }, [uid])

  const value = useMemo(() => ({ status, user, existing, enrollment, complete, updateEnrollment, retryProfile }), [status, user, existing, enrollment, complete, updateEnrollment, retryProfile])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}