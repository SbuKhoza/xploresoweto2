import { initializeApp, getApp, getApps } from "firebase/app"
import { initializeAuth, getAuth, getReactNativePersistence } from "firebase/auth"
import { getFirestore } from "firebase/firestore"
import { getStorage } from "firebase/storage"
import { getFunctions } from "firebase/functions"
import { requireValidEnvironment } from "./env/gate"
import AsyncStorage from "@react-native-async-storage/async-storage"

// Environment: the Firebase configuration is chosen by the build (EXPO_PUBLIC_APP_ENV + EXPO_PUBLIC_FIREBASE_*) and must equal, field by
// field, the allow-listed configuration for the SAME environment AND match the native identity (Android applicationId / web host).
// Nothing is defaulted: a missing or mismatched value throws HERE, before initializeApp. Public identifiers only, never secrets.
// See Firebase/env/validate.js and config/environments.js.
const { config: firebaseConfig, env: ENV } = requireValidEnvironment()
export const APP_ENV = ENV.name

// Cloud Functions are deployed to africa-south1 (Johannesburg) in BOTH environments. Keep in sync with functions/src/lib/constants.js
// (functions/test/app_rules_consistency.test.js pins this and config/environments.js to the same value)
export const FUNCTIONS_REGION = "africa-south1"

// Exactly one Firebase app (reused on Fast Refresh / repeated module evaluation)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig)

// initializeAuth may only run once per app; on a second evaluation reuse the existing instance
let authInstance
try {
  authInstance = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) })
} catch (error) {
  if (error?.code === "auth/already-initialized") authInstance = getAuth(app)
  else throw error
}
export const auth = authInstance

export const db = getFirestore(app)
export const storage = getStorage(app)
export const functions = getFunctions(app, FUNCTIONS_REGION)

export default app
