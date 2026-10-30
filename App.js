"use client"

import { useState, useEffect } from "react"
import { StyleSheet, StatusBar, Platform, LogBox } from "react-native"
import { NavigationContainer } from "@react-navigation/native"
import { createStackNavigator } from "@react-navigation/stack"
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context"
import GlobalLoader from "./components/loader/GlobalLoader"
import { LoadingProvider, useLoading } from "./components/context/LoadingContext"

// @react-navigation/stack's Card still calls InteractionManager internally,
// which React Native now flags as deprecated. It is a library-internal call
// (not app code), so hide the warning until the library drops it.
LogBox.ignoreLogs(["InteractionManager has been deprecated"])

// Import screens
import Splash from "./screens/Splash"
import Authentication from "./screens/Authentication"
import Home from "./screens/Home"
import Xplore from "./screens/Xplore"
import Profile from "./screens/Profile"
import Community from "./screens/Community"
import News from "./screens/News"

// Import components
import BottomNav, { ScrollProvider, ScrollTrackingView } from "./components/BottomNav"
import Header from "./components/Header"
import OfflineIndicator from "./components/OfflineIndicator"
import Eskom from "./components/eskom/Eskom"
import PoIst from "./components/personofinterest/PoIst"

// Import Xplore sub-screens
import Accommodation from "./components/xplorescreens/Accommodation"
import Restaurants from "./components/xplorescreens/Restaurants"
import Emergency from "./components/xplorescreens/Emergency"
import Recreation from "./components/xplorescreens/Recreation"
import Attraction from "./components/xplorescreens/Attraction"
import Transport from "./components/xplorescreens/Transport"
import Business from "./components/xplorescreens/Business"
import Healthcare from "./components/xplorescreens/Healthcare"
import PublicService from "./components/xplorescreens/PublicService"

// Import auth and network utilities
import { initializeAuth } from "./utils/persistAuth"
import { setupNetworkListener } from "./utils/networkManager"

const Stack           = createStackNavigator()
const Tab             = createBottomTabNavigator()
const XploreStack     = createStackNavigator()
const CommunityStack  = createStackNavigator()

// ─────────────────────────────────────────────────────────────────────────────
// SafeScreen — wraps every screen and injects the correct top inset so content
// is never hidden under the status bar or notch on any device.
//
// TOP_EXTRA adds breathing room between the safe-area edge and the first
// piece of content. Increase it if you want more space, decrease for less.
// ─────────────────────────────────────────────────────────────────────────────
const TOP_EXTRA = 6   /* ← adjust this value (px) to change the top breathing room */

const SafeScreen = ({ children, style }) => {
  const insets = useSafeAreaInsets()
  return (
    <ScrollTrackingView
      style={[
        styles.screenContainer,
        // Always respect the device's top inset (notch / status bar) plus
        // our extra breathing-room constant defined above.
        { paddingTop: insets.top + TOP_EXTRA },
        style,
      ]}
    >
      {children}
    </ScrollTrackingView>
  )
}

// ── Xplore Stack ──────────────────────────────────────────────────────────────
const XploreStackNavigator = () => (
  <XploreStack.Navigator screenOptions={{ headerShown: false }}>
    <XploreStack.Screen name="XploreMain"    component={XploreWithHeader}       />
    <XploreStack.Screen name="Accommodation" component={AccommodationWithHeader} />
    <XploreStack.Screen name="Restaurants"   component={RestaurantsWithHeader}   />
    <XploreStack.Screen name="Emergency"     component={EmergencyWithHeader}     />
    <XploreStack.Screen name="Recreation"    component={RecreationWithHeader}    />
    <XploreStack.Screen name="Attraction"    component={AttractionWithHeader}    />
    <XploreStack.Screen name="Transport"     component={TransportWithHeader}     />
    <XploreStack.Screen name="Business"      component={BusinessWithHeader}      />
    <XploreStack.Screen name="Healthcare"    component={HealthcareWithHeader}    />
    <XploreStack.Screen name="PublicService" component={PublicServiceWithHeader} />
  </XploreStack.Navigator>
)

// ── Community Stack ─────────────────────────────────────────────────────────────
const CommunityStackNavigator = () => (
  <CommunityStack.Navigator screenOptions={{ headerShown: false }}>
    <CommunityStack.Screen name="CommunityMain" component={CommunityWithoutHeader} />
    <CommunityStack.Screen name="News"          component={NewsWithHeader}         />
    <CommunityStack.Screen name="Eskom"         component={EskomWithHeader}        />
    <CommunityStack.Screen name="PoIst"         component={PoIstWithHeader}        />
  </CommunityStack.Navigator>
)

// ── Screen wrappers ───────────────────────────────────────────────────────────
// Home has its own hero that draws edge-to-edge under the status bar — no Header
// component and no SafeScreen top padding; Home applies the top inset itself.
const HomeWithoutHeader = () => (
  <SafeScreen style={{ paddingTop: 0 }}>
    <Home />
  </SafeScreen>
)

const XploreWithHeader = () => (
  <SafeScreen>
    <Header title="Xplore" />
    <Xplore />
  </SafeScreen>
)

// Profile draws its own gradient hero edge-to-edge, so no Header / top padding.
const ProfileWithoutHeader = () => (
  <SafeScreen style={{ paddingTop: 0 }}>
    <Profile />
  </SafeScreen>
)

const CommunityWithoutHeader = () => (
  <SafeScreen>
    <Community />
  </SafeScreen>
)

const NewsWithHeader = () => (
  <SafeScreen>
    <Header title="News" />
    <News />
  </SafeScreen>
)

const EskomWithHeader = () => (
  <SafeScreen>
    <Header title="Eskom" />
    <Eskom />
  </SafeScreen>
)

const PoIstWithHeader = () => (
  <SafeScreen>
    <Header title="Person of Interest" />
    <PoIst />
  </SafeScreen>
)

const AccommodationWithHeader = () => (
  <SafeScreen>
    <Header title="Accommodation" />
    <Accommodation />
  </SafeScreen>
)

const RestaurantsWithHeader = () => (
  <SafeScreen>
    <Header title="Restaurants" />
    <Restaurants />
  </SafeScreen>
)

const EmergencyWithHeader = () => (
  <SafeScreen>
    <Header title="Emergency" />
    <Emergency />
  </SafeScreen>
)

const RecreationWithHeader = () => (
  <SafeScreen>
    <Header title="Recreation" />
    <Recreation />
  </SafeScreen>
)

const AttractionWithHeader = () => (
  <SafeScreen>
    <Header title="Attraction" />
    <Attraction />
  </SafeScreen>
)

const TransportWithHeader = () => (
  <SafeScreen>
    <Header title="Transport" />
    <Transport />
  </SafeScreen>
)

const BusinessWithHeader = () => (
  <SafeScreen>
    <Header title="Business" />
    <Business />
  </SafeScreen>
)

const HealthcareWithHeader = () => (
  <SafeScreen>
    <Header title="Healthcare" />
    <Healthcare />
  </SafeScreen>
)

const PublicServiceWithHeader = () => (
  <SafeScreen>
    <Header title="Public Service" />
    <PublicService />
  </SafeScreen>
)

// ── Main Tab Navigator ────────────────────────────────────────────────────────
const MainTabNavigator = () => (
  <Tab.Navigator tabBar={(props) => <BottomNav {...props} />} screenOptions={{ headerShown: false }}>
    <Tab.Screen name="Home"      component={HomeWithoutHeader}       />
    <Tab.Screen name="Xplore"    component={XploreStackNavigator}    />
    <Tab.Screen name="Profile"   component={ProfileWithoutHeader}    />
    <Tab.Screen name="Community" component={CommunityStackNavigator} />
  </Tab.Navigator>
)

// ── App content ───────────────────────────────────────────────────────────────
const AppContent = () => {
  const [isLoading, setIsLoading]     = useState(true)
  const [user, setUser]               = useState(null)
  const [isConnected, setIsConnected] = useState(true)
  const { isLoading: globalLoading, loadingMessage } = useLoading()

  useEffect(() => {
    const unsubscribeAuth    = initializeAuth(setUser, setIsLoading)
    const unsubscribeNetwork = setupNetworkListener(setIsConnected)
    return () => {
      unsubscribeAuth?.()
      unsubscribeNetwork?.()
    }
  }, [])

  if (isLoading) return null

  return (
    <SafeAreaProvider style={styles.safeAreaProvider}>
      <StatusBar
        barStyle="dark-content"
        backgroundColor="transparent"
        translucent
      />
      <ScrollProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Splash"          component={Splash}           />
            {!user && <Stack.Screen name="Authentication" component={Authentication} />}
            {user  && <Stack.Screen name="MainApp"        component={MainTabNavigator} />}
          </Stack.Navigator>
        </NavigationContainer>
        {!isConnected && <OfflineIndicator />}
        <GlobalLoader visible={globalLoading} message={loadingMessage} />
      </ScrollProvider>
    </SafeAreaProvider>
  )
}

export default function App() {
  return (
    <LoadingProvider>
      <AppContent />
    </LoadingProvider>
  )
}

const styles = StyleSheet.create({
  safeAreaProvider: {
    flex: 1,
    backgroundColor: "#F4F6FB",
  },
  screenContainer: {
    flex: 1,
    backgroundColor: "#F4F6FB",
  },
})