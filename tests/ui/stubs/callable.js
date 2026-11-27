// Records every backend call so tests can prove NO request was made for an invalid reservation.
export const callFunction = async (name, data) => { globalThis.__CALLS.push([name, data]); return { ok: true } }
export const alertCallableError = (e) => { globalThis.__CALLS.push(["alertCallableError", String(e?.message)]) }
