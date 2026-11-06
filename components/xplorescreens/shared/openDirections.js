import { Linking, Alert, ActionSheetIOS, Platform } from "react-native"

// One shared "open in maps" helper (previously copy-pasted in every screen).
export const openDirections = async (coordinates, name) => {
  if (!coordinates?.latitude || !coordinates?.longitude) {
    Alert.alert("Error", "Location coordinates not available.")
    return
  }
  const lat = parseFloat(coordinates.latitude)
  const lng = parseFloat(coordinates.longitude)
  const opts = [
    { name: "Apple Maps",          url: `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`, available: Platform.OS === "ios" },
    { name: "Google Maps",         url: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, available: true },
    { name: "Waze",                url: `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`, checkUrl: "waze://", available: false },
    { name: "Petal Maps (Huawei)", url: `petalmaps://route?daddr=${lat},${lng}`, checkUrl: "petalmaps://", available: false },
  ]
  const avail = []
  for (const o of opts) {
    if (o.available) avail.push(o)
    else if (o.checkUrl) { try { if (await Linking.canOpenURL(o.checkUrl)) avail.push(o) } catch {} }
  }
  const native = Platform.OS === "ios"
    ? { name: "Maps (Default)", url: `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d` }
    : { name: "Maps (Default)", url: `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(name)})` }
  const final = [native, ...avail]
  const names = [...final.map(o => o.name), "Cancel"]
  const open = (url) => Linking.openURL(url).catch(() => Alert.alert("Error", "Could not open maps"))
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: names, cancelButtonIndex: names.length - 1, title: `Get directions to ${name}` },
      i => { if (i < final.length) open(final[i].url) }
    )
  } else {
    Alert.alert("Choose Maps App", `Get directions to ${name}`, [
      ...final.map(o => ({ text: o.name, onPress: () => open(o.url) })),
      { text: "Cancel", style: "cancel" },
    ], { cancelable: true })
  }
}
