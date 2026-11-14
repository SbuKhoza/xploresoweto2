import { initializeApp, getApp, getApps } from "firebase/app"
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth"
import { getFirestore } from "firebase/firestore"
import { getStorage } from "firebase/storage"
import { getFunctions } from "firebase/functions"

// Firebase project: xploresoweto (the only project this app talks to). The web API key is not a server secret.
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

const app = getApps().length ? getApp() : initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const authPersistence = setPersistence(auth, browserLocalPersistence)

export const db = getFirestore(app)
export const storage = getStorage(app)
export const functions = getFunctions(app, FUNCTIONS_REGION)

export default app
