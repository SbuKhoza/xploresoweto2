"use strict"
// SINGLE SOURCE OF TRUTH for the two Firebase environments. Public identifiers only: a Firebase web API key and app id identify a
// project, they are NOT server secrets (access is enforced by Security Rules and Cloud Functions). No secret, service-account key or
// provider key may ever appear in this file.
//
// Used by: the app (Firebase/envConfig.*), scripts/verify-env.js, functions/scripts/*, scripts/staging/*.ps1 and their tests.
// (functions/src/lib/environment.js repeats the two project ids because the functions folder is deployed on its own;
//  functions/test/environment.test.js fails if the two ever disagree.)
//
// A value of null means "not known yet". The app and every script FAIL CLOSED on a null: they refuse to start or to run until the real
// identifier (from the Firebase console, after the staging project has been created) is committed here AND supplied by the build profile.
const REGION = "africa-south1"

const production = Object.freeze({
  name: "production",
  projectId: "xploresoweto",
  region: REGION,
  androidApplicationId: "com.sbudamalloya.xploresoweto",
  webHosts: Object.freeze(["xploresoweto.web.app", "xploresoweto.firebaseapp.com", "localhost", "127.0.0.1"]),
  firebase: Object.freeze({
    apiKey: "AIzaSyCwRLeFV0lxbez-G3YONR-WIcdgF3xSUpg",
    authDomain: "xploresoweto.firebaseapp.com",
    projectId: "xploresoweto",
    storageBucket: "xploresoweto.firebasestorage.app",
    messagingSenderId: "549315620435",
    appId: "1:549315620435:web:49b7fa6887d89a94c560a6",
  }),
})

const staging = Object.freeze({
  name: "staging",
  projectId: "xploresoweto-staging",
  region: REGION,
  androidApplicationId: "com.sbudamalloya.xploresoweto.staging",
  webHosts: Object.freeze(["xploresoweto-staging.web.app", "xploresoweto-staging.firebaseapp.com", "localhost", "127.0.0.1"]),
  firebase: Object.freeze({
    apiKey: "AIzaSyAFJbkp89UhcPKXLe1VQKwODfMP-3WyU3c",
    authDomain: "xploresoweto-staging.firebaseapp.com",
    projectId: "xploresoweto-staging",
    storageBucket: "xploresoweto-staging.firebasestorage.app", // [verify] the actual default bucket name in the console
    messagingSenderId: "343560971631",
    appId: "1:343560971631:web:e66f8410b2052db899749a",
  }),
})

const ENVIRONMENTS = Object.freeze({ production, staging })
// (The retired project id is deliberately NOT named here: a repository guard forbids that string anywhere in app code.
//  functions/src/lib/environment.js holds it for the server-side scripts.)
module.exports = { ENVIRONMENTS, REGION }
