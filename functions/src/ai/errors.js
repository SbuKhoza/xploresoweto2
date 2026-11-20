"use strict"
const { HttpsError } = require("firebase-functions/v2/https")
// Controlled, non-leaky errors for clients: the message is a stable code, details carry only safe numbers.
const aiError = (code, appCode, details) => new HttpsError(code, appCode, details)
module.exports = { aiError }
