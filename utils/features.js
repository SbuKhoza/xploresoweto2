// Feature switches for Stage 1. Flipping one on later re-exposes the feature WITHOUT code changes elsewhere.
export const FEATURES = Object.freeze({
  // Hidden until the Google OAuth client IDs are configured (the IDs in Authentication.js are placeholders).
  googleSignIn: false,
  // Excluded from the public launch until privacy, safeguarding, authorisation and moderation are designed.
  // Off means: no route, no Community card, no Firestore read, no Storage upload. The component code is kept untouched.
  personOfInterest: false,
})
