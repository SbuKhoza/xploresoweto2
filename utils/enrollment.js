import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { doc, getDoc, setDoc, query, where, collection, getDocs } from "firebase/firestore"
import { db } from "../Firebase/config"

// ═════════════════════════════════════════════════════════════════════════════
// Enrollment — the one-time setup every new user completes after creating an
// account: username (if they skipped it at sign-up), a greeting and their kasi.
//
// Saved on the user's Firestore document  users/{uid}:
//   username, greeting, kasi, enrolled: true, enrolledAt
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

// 3–20 characters: letters, numbers, dot and underscore
export const validateUsername = (value) => {
  const v = String(value || "").trim()
  if (v.length < 3) return { ok: false, message: "At least 3 characters" }
  if (v.length > 20) return { ok: false, message: "No more than 20 characters" }
  if (!/^[A-Za-z0-9._]+$/.test(v)) return { ok: false, message: "Letters, numbers, . and _ only" }
  return { ok: true, message: "" }
}

// True if somebody else already uses this username
export const isUsernameTaken = async (username, uid) => {
  const snap = await getDocs(query(collection(db, "users"), where("username", "==", username)))
  return snap.docs.some((d) => d.id !== uid)
}

const cacheKey = (uid) => `enrollment:${uid}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const Ctx = createContext({
  status: "loading",   // "loading" | "needed" | "done"
  user: null,
  existing: null,      // the user's Firestore document, if any
  enrollment: null,    // { username, greeting, kasi } once enrolled
  complete: async () => {},
  updateEnrollment: () => {},
})

export const useEnrollment = () => useContext(Ctx)

export const EnrollmentProvider = ({ user, children }) => {
  const uid = user?.uid
  const [status, setStatus] = useState("loading")
  const [existing, setExisting] = useState(null)
  const [enrollment, setEnrollment] = useState(null)

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
        // A brand-new sign-up can reach us a moment before its profile is written
        if (!snap.exists()) { await sleep(1500); snap = await getDoc(doc(db, "users", uid)) }
        const data = snap.exists() ? snap.data() : {}
        if (!alive) return
        setExisting(data)
        if (data.enrolled) {
          const e = { enrolled: true, username: data.username || null, greeting: data.greeting || DEFAULT_GREETING, kasi: data.kasi || null }
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
  }, [uid])

  // Save the answers. Throws a readable Error if something goes wrong.
  const complete = useCallback(async ({ username, greeting, kasi }) => {
    if (!uid) throw new Error("You need to be signed in.")
    const name = (username || existing?.username || "").trim()
    if (!name) throw new Error("Please choose a username.")
    if (!existing?.username) {
      if (await isUsernameTaken(name, uid)) throw new Error("That username is taken. Please pick another.")
    }

    const payload = {
      uid,
      email: user?.email || existing?.email || null,
      username: name,
      greeting,
      kasi,
      enrolled: true,
      enrolledAt: new Date(),
    }
    if (!existing?.name && user?.displayName) payload.name = user.displayName

    try {
      await setDoc(doc(db, "users", uid), payload, { merge: true })
    } catch {
      throw new Error("Couldn't save your details. Check your connection and try again.")
    }

    const e = { enrolled: true, username: name, greeting, kasi }
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

  const value = useMemo(() => ({ status, user, existing, enrollment, complete, updateEnrollment }), [status, user, existing, enrollment, complete, updateEnrollment])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}