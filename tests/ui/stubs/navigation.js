import { useEffect } from "react"
export const useNavigation = () => ({ navigate: () => {}, goBack: () => {}, canGoBack: () => true })
export const useRoute = () => ({ params: {} })
export const useFocusEffect = (cb) => { useEffect(cb, []) }
export const NavigationContainer = ({ children }) => children
