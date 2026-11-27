// Township results in the Home search open the EXISTING township detail sheet for that exact Firestore document.
// Pure and total: any input (null, wrong types, missing id, deleted or inactive records) gives a result, never an exception.

/**
 * @param item       a search result: { id, collection: "homescreen", name, type: "township", isActive, … }
 * @param townships  the loaded, active townships from useTownships: [{ doc, info, index }]
 * @returns { kind: "loaded", index, doc }  the record is among the loaded active townships (preferred)
 *        | { kind: "result", doc }         not loaded yet, but the search document itself is a usable active township
 *        | { kind: "unavailable" }         missing id, deleted, inactive or incomplete
 */
export const resolveTownshipResult = (item, townships) => {
  try {
    const id = item && typeof item.id === "string" ? item.id.trim() : ""
    if (!id) return { kind: "unavailable" }
    const list = Array.isArray(townships) ? townships : []
    const index = list.findIndex((t) => t && t.doc && t.doc.id === id)
    if (index >= 0) return { kind: "loaded", index, doc: list[index].doc }
    const usable = typeof item.name === "string" && item.name.trim() && item.isActive !== false && item.type === "township"
    if (usable) {
      // eslint-disable-next-line no-unused-vars
      const { label, icon, screen, collection, ...doc } = item // strip the search-result decorations; keep the Firestore fields
      return { kind: "result", doc }
    }
  } catch { /* fall through */ }
  return { kind: "unavailable" }
}
