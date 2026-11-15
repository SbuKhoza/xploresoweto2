// Client-generated idempotency key for backend requests. Reuse the SAME id when retrying one deliberate action (the server
// then returns the existing record instead of creating a duplicate); create a new id for each new deliberate action.
export const newRequestId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`

// Local calendar date as YYYY-MM-DD (not UTC), as the backend expects
export const toYMD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
