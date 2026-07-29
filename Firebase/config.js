import { initializeApp } from "firebase/app"
import { initializeAuth, getReactNativePersistence } from "firebase/auth"
import { getFirestore } from "firebase/firestore"
import { getStorage } from "firebase/storage"
import AsyncStorage from "@react-native-async-storage/async-storage"

const firebaseConfig = {
  apiKey: "AIzaSyBn2qVzwq2MAsvo552yRVufZoiq9ka0jcA",
  authDomain: "the-steady-hotel.firebaseapp.com",
  projectId: "the-steady-hotel",
  storageBucket: "the-steady-hotel.appspot.com",
  messagingSenderId: "289244799504",
  appId: "1:289244799504:web:0663b34ee6afde815d2095",
  measurementId: "G-DSBYCXC322",
}

// Initialize Firebase
const app = initializeApp(firebaseConfig)

export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
})

// Initialize Cloud Firestore and get a reference to the service
export const db = getFirestore(app)

// Initialize Firebase Storage and get a reference to the service
export const storage = getStorage(app)

export default app
