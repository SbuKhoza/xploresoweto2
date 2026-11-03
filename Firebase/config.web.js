import { initializeApp, getApp, getApps } from "firebase/app"
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth"
import { getFirestore } from "firebase/firestore"
import { getStorage } from "firebase/storage"

const firebaseConfig = {
  apiKey: "AIzaSyBn2qVzwq2MAsvo552yRVufZoiq9ka0jcA",
  authDomain: "the-steady-hotel.firebaseapp.com",
  projectId: "the-steady-hotel",
  storageBucket: "the-steady-hotel.appspot.com",
  messagingSenderId: "289244799504",
  appId: "1:289244799504:web:0663b34ee6afde815d2095",
  measurementId: "G-DSBYCXC322",
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const authPersistence = setPersistence(auth, browserLocalPersistence)

export const db = getFirestore(app)
export const storage = getStorage(app)

export default app
