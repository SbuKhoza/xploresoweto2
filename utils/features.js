// Feature switches for Stage 1. Flipping one on later re-exposes the feature WITHOUT code changes elsewhere.
export const FEATURES = Object.freeze({
  // Hidden until the Google OAuth client IDs are configured (the IDs in Authentication.js are placeholders).
  googleSignIn: false,
  // Excluded from the public launch until privacy, safeguarding, authorisation and moderation are designed.
  // Off means: no route, no Community card, no Firestore read, no Storage upload. The component code is kept untouched.
  personOfInterest: false,
  // "The ultimate guide to Soweto" assistant (Home card + SowetoAI route). OFF by default so nothing is exposed before the AI
  // functions are deployed and enabled. To try it locally: EXPO_PUBLIC_AI_ASSISTANT=true npx expo start
  // (or change this to true). Off means: no Home card, no route, no callable is ever invoked. The implementation is kept.
  aiAssistant: process.env.EXPO_PUBLIC_AI_ASSISTANT === "true",
})
