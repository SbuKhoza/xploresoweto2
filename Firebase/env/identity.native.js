import { Platform } from "react-native"
import DeviceInfo from "react-native-device-info"
// The Android applicationId is fixed by the Gradle flavor, outside JavaScript. Any other native platform is refused.
export const getIdentity = () => {
  if (Platform.OS !== "android") return { kind: "unsupported" }
  try { return { kind: "android", applicationId: DeviceInfo.getBundleId() } } catch (e) { return { kind: "unreadable" } }
}
