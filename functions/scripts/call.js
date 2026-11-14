#!/usr/bin/env node
"use strict"
// Calls a deployed callable function as a signed-in user (e.g. a Super Admin running seedLoadshedding) using only fetch.
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/call.js seedLoadshedding '{"schedules":[...]}'
// Credentials come from the environment, never from files. Uses the app's PUBLIC web API key to sign in via the Auth REST API.
const API_KEY = "AIzaSyCwRLeFV0lxbez-G3YONR-WIcdgF3xSUpg"
const PROJECT = "xploresoweto", REGION = "africa-south1"
;(async () => {
  const [name, json] = process.argv.slice(2)
  if (!name || !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) { console.error("Usage: ADMIN_EMAIL=.. ADMIN_PASSWORD=.. node scripts/call.js <function> '<json data>'"); process.exit(1) }
  const login = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, returnSecureToken: true }) }).then((r) => r.json())
  if (!login.idToken) { console.error("Sign-in failed:", login.error?.message); process.exit(1) }
  const res = await fetch(`https://${REGION}-${PROJECT}.cloudfunctions.net/${name}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.idToken}` }, body: JSON.stringify({ data: json ? JSON.parse(json) : {} }) })
  console.log(res.status, JSON.stringify(await res.json(), null, 2))
})().catch((e) => { console.error(e.message); process.exit(1) })
