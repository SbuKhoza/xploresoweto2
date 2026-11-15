import { callFunction } from "./callable"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PERMANENT = ["invalid-argument", "unauthenticated", "permission-denied"]

// Creates users/{uid} through the ensureUserProfile Cloud Function. The function is idempotent (it never overwrites an
// existing profile), so this can be repeated freely: after a failed sign-up step, on every launch, or from a Retry button.
export const ensureUserProfile = (input = {}) => callFunction("ensureUserProfile", input)

export const ensureProfileWithRetry = async (input = {}, { attempts = 3, delays = [0, 1200, 3500] } = {}) => {
  let lastError = null
  for (let i = 0; i < attempts; i++) {
    if (delays[i]) await sleep(delays[i])
    try { return { ok: true, data: await ensureUserProfile(input) } } catch (e) {
      lastError = e
      if (PERMANENT.includes(e?.code)) break
    }
  }
  return { ok: false, error: lastError }
}
