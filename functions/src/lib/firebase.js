"use strict"
// Lazy Admin SDK accessor. Tests inject an in-memory fake with setAdminForTests().
let impl = null
function admin() {
  if (!impl) {
    impl = require("firebase-admin")
    if (!impl.apps.length) impl.initializeApp()
  }
  return impl
}
module.exports = {
  setAdminForTests: (a) => { impl = a },
  db: () => admin().firestore(),
  auth: () => admin().auth(),
  FieldValue: () => admin().firestore.FieldValue,
  Timestamp: () => admin().firestore.Timestamp,
  bucket: () => admin().storage().bucket(),
}
