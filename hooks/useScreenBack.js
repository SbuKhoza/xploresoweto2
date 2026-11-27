import { useCallback } from "react"
import { BackHandler } from "react-native"
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native"

/**
 * Same back behaviour as components/Header.js for screens that draw their own hero instead of the Header:
 * screens opened from Home (route.params.from === "Home") always return to Home (button and Android back); otherwise normal back.
 */
export const useScreenBack = () => {
  const navigation = useNavigation()
  const route = useRoute()
  const openedFromHome = route?.params?.from === "Home"

  const goBack = useCallback(() => {
    if (openedFromHome) navigation.navigate("Home")
    else if (navigation.canGoBack()) navigation.goBack()
    else navigation.navigate("Home")
  }, [navigation, openedFromHome])

  useFocusEffect(
    useCallback(() => {
      if (!openedFromHome) return undefined
      const sub = BackHandler.addEventListener("hardwareBackPress", () => { navigation.navigate("Home"); return true })
      return () => sub.remove()
    }, [navigation, openedFromHome])
  )
  return goBack
}
