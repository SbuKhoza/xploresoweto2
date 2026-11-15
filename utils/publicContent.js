import { collection, query, where } from "firebase/firestore"
import { db } from "../Firebase/config"

// Public tourism collections. The security rules only let the app read documents with isActive == true, and Firestore
// rules are not filters: a query must itself ask for isActive == true or it is rejected. Every public read goes through here.
export const PUBLIC_CONTENT_COLLECTIONS = Object.freeze([
  "accommodations", "attractions", "business", "restaurants", "recreation", "events", "news", "announcements",
  "transport", "healthcare", "emergency", "publicservice", "homescreen", "xplore-menu", "loadshedding",
])
export const isPublicContent = (name) => PUBLIC_CONTENT_COLLECTIONS.includes(name)

// A reference/query for a collection: active-only for public content, untouched for anything else.
export const publicCollectionRef = (name) =>
  isPublicContent(name) ? query(collection(db, name), where("isActive", "==", true)) : collection(db, name)

// Ordering/limiting is done in the app for public content so no composite Firestore index is needed.
export const sortAndLimit = (rows, orderByField, limitCount) => {
  let out = rows
  if (orderByField) {
    out = [...rows].sort((a, b) => {
      const x = a?.[orderByField], y = b?.[orderByField]
      if (x === y) return 0
      if (x === undefined || x === null) return 1
      if (y === undefined || y === null) return -1
      return typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))
    })
  }
  return limitCount ? out.slice(0, limitCount) : out
}
