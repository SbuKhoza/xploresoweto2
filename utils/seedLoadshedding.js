import { collection, getDocs, setDoc, doc } from "firebase/firestore"
import { db } from "../Firebase/config"
import scheduleData from "../assets/data/loadshedding_schedules.json" // Adjust path as needed

export const seedFirestoreIfNeeded = async () => {
  const colRef = collection(db, "loadshedding")
  const snapshot = await getDocs(colRef)

  if (snapshot.empty) {
    console.log("📦 Seeding loadshedding collection...")
    for (const item of scheduleData) {
      await setDoc(doc(colRef, item.suburb.toLowerCase()), item)
    }
    console.log("✅ Seeding complete.")
  } else {
    console.log("✅ loadshedding collection already exists. Skipping seed.")
  }
}
