import { useEffect } from "react"
// Navigation calls are recorded in globalThis.__CALLS as ["navigate", ...args] / ["goBack"]; route params come from globalThis.__ROUTE.
export const useNavigation = () => ({
  navigate: (...a) => { globalThis.__CALLS?.push(["navigate", ...a]) },
  goBack: () => { globalThis.__CALLS?.push(["goBack"]) },
  canGoBack: () => true,
  dispatch: (...a) => { globalThis.__CALLS?.push(["dispatch", ...a]) },
})
export const useRoute = () => ({ params: globalThis.__ROUTE || {} })
export const useFocusEffect = (cb) => { useEffect(cb, []) }
export const NavigationContainer = ({ children }) => children
export const CommonActions = { navigate: (x) => ({ type: "NAVIGATE", ...x }), reset: (x) => ({ type: "RESET", ...x }) }
