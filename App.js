import { useState, useEffect } from "react"
import { NavigationContainer } from "@react-navigation/native"
import { StyleSheet, StatusBar, Platform } from "react-native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context"
import GlossyBackground from "./components/GlossyBackground"
import GlobalLoader from "./components/loader/GlobalLoader"
import { LoadingProvider, useLoading } from "./components/context/LoadingContext"



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

const Stack           = createNativeStackNavigator()
const Tab             = createBottomTabNavigator()
const XploreStack     = createNativeStackNavigator()
const CommunityStack  = createNativeStackNavigator()

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
      <GlossyBackground />
      {children}
    </ScrollTrackingView>
  )
}

// ── Xplore Stack ──────────────────────────────────────────────────────────────
const XploreStackNavigator = () => (
  <XploreStack.Navigator screenOptions={{ headerShown: false }}>
    <XploreStack.Screen name="XploreMain"    component={XploreWithHeader}       />
    <XploreStack.Screen name="Accommodation" component={AccommodationWithoutHeader} />
    <XploreStack.Screen name="Restaurants"   component={RestaurantsWithoutHeader} />
    <XploreStack.Screen name="Emergency"     component={EmergencyWithHeader}     />
    <XploreStack.Screen name="Recreation"    component={RecreationWithoutHeader}    />
    <XploreStack.Screen name="Attraction"    component={AttractionWithoutHeader}    />
    <XploreStack.Screen name="Transport"     component={TransportWithHeader}     />
    <XploreStack.Screen name="Business"      component={BusinessWithoutHeader}      />
    <XploreStack.Screen name="Healthcare"    component={HealthcareWithoutHeader}    />
    <XploreStack.Screen name="PublicService" component={PublicServiceWithoutHeader} />
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

const AccommodationWithoutHeader = () => (
  <SafeScreen style={{ paddingTop: 0 }}>
    <Accommodation />
  </SafeScreen>
)

// Restaurants, Accommodation, Recreation, Attraction, Business, Healthcare and
// PublicService draw their own hero (back / bell buttons) edge-to-edge under the
// status bar, so they get no Header component and no SafeScreen top padding.
const RestaurantsWithoutHeader = () => (
  <SafeScreen style={{ paddingTop: 0 }}>
    <Restaurants />
  </SafeScreen>
)

const EmergencyWithHeader = () => (
  <SafeScreen>
    <Header title="Emergency" />
    <Emergency />
  </SafeScreen>
)

const RecreationWithoutHeader = () => (
  <SafeScreen style={{ paddingTop: 0 }}>
    <Recreation />
  </SafeScreen>
)

const AttractionWithoutHeader = () => (
  <SafeScreen style={{ paddingTop: 0 }}>
    <Attraction />
  </SafeScreen>
)

const TransportWithHeader = () => (
  <SafeScreen>
    <Header title="Transport" />
    <Transport />
  </SafeScreen>
)

const BusinessWithoutHeader = () => (
  <SafeScreen style={{ paddingTop: 0 }}>
    <Business />
  </SafeScreen>
)

const HealthcareWithoutHeader = () => (
  <SafeScreen style={{ paddingTop: 0 }}>
    <Healthcare />
  </SafeScreen>
)

const PublicServiceWithoutHeader = () => (
  <SafeScreen style={{ paddingTop: 0 }}>
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
    backgroundColor: "#F5F7FA",
  },
  screenContainer: {
    flex: 1,
    backgroundColor: "#F5F7FA",
  },
})