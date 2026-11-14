import { initializeApp, getApp, getApps } from "firebase/app"
import { initializeAuth, getAuth, getReactNativePersistence } from "firebase/auth"
import { getFirestore } from "firebase/firestore"
import { getStorage } from "firebase/storage"
import { getFunctions } from "firebase/functions"
import AsyncStorage from "@react-native-async-storage/async-storage"

// Firebase project: xploresoweto (the only project this app talks to).
// A Firebase web API key identifies the project; it is NOT a server secret. Access control is enforced by
// Security Rules and Cloud Functions. Never put service-account keys or other server secrets in the app.
const firebaseConfig = {
  apiKey: "AIzaSyCwRLeFV0lxbez-G3YONR-WIcdgF3xSUpg",
  authDomain: "xploresoweto.firebaseapp.com",
  projectId: "xploresoweto",
  storageBucket: "xploresoweto.firebasestorage.app",
  messagingSenderId: "549315620435",
  appId: "1:549315620435:web:49b7fa6887d89a94c560a6",
}

// Cloud Functions are deployed to africa-south1 (Johannesburg). Keep in sync with functions/src/lib/constants.js
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
