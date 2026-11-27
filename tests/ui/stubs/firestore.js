// In-memory Firestore for screen tests. Data: globalThis.__FS[collection] = [{ id, ...fields }]. Only reads are supported.
// A document may contain ANY shape (that is the point of these tests); it is handed to the app exactly as stored.
const snap = (rows) => ({ docs: rows.map((r) => ({ id: r.id, data: () => { const { id, ...rest } = r; return rest } })), forEach(fn) { this.docs.forEach(fn) }, size: rows.length })
export const collection = (_db, name) => ({ __col: name })
export const query = (q) => q
export const where = () => ({})
export const doc = (_db, c, id) => ({ __col: c, __id: id })
export const getDocs = async (q) => snap(globalThis.__FS?.[q.__col] || [])
export const getDoc = async (ref) => { const r = (globalThis.__FS?.[ref.__col] || []).find((x) => x.id === ref.__id); return { exists: () => !!r, data: () => r } }
export const addDoc = async () => ({ id: "x" })
export const updateDoc = async (ref, data) => { globalThis.__CALLS?.push(["updateDoc", `${ref.__col}/${ref.__id}`, data]) }
