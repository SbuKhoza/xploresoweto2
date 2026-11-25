// Explicit, literal Expo public-variable references (Expo inlines `process.env.EXPO_PUBLIC_*` at bundle time ONLY when written like this:
// no destructuring, no dynamic keys). There is no default for any of them. These are public identifiers, never secrets.
export const readPublicEnv = () => ({
  appEnv: process.env.EXPO_PUBLIC_APP_ENV,
  values: {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  },
})
