// Collections for the offline-aware hook come from globalThis.__OFFLINE[name] (array of plain documents, each with an id).
export function useOfflineData(name) {
  return { data: globalThis.__OFFLINE?.[name], loading: false, error: null, isOffline: false, lastUpdated: null, refresh: async () => {} }
}
