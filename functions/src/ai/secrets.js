"use strict"
// Secret Manager binding. The VALUE is only readable inside functions that list this secret in their `secrets` option
// (only aiChat does). It is never logged, never returned, never written to Firestore. Set it with:
//   firebase functions:secrets:set ANTHROPIC_API_KEY --project xploresoweto      (production; you run this)
//   functions/.secret.local  ->  ANTHROPIC_API_KEY=...                           (emulator only; git-ignored)
const { defineSecret } = require("firebase-functions/params")
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY")
module.exports = { ANTHROPIC_API_KEY }
