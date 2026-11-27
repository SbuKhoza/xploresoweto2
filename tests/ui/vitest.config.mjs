import { fileURLToPath } from "node:url"
import path from "node:path"
import { defineConfig } from "vitest/config"

// Component rendering tests for the Xplore listing screens, WITHOUT a device or the React Native toolchain:
//   * `react-native` is replaced by react-native-web (real View/Text/Modal/FlatList/… rendered into jsdom),
//   * native-only / Firebase / navigation modules are replaced by small stubs in ./stubs (Firestore data comes from globalThis.__FS).
// This proves the screens render and react to taps with awkward documents. It does NOT prove anything about a physical Android device,
// native layout, gestures, NativeWind styling or the Hermes engine: see docs/staging/LISTING_STABILITY.md for the manual checklist.
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "../..")
const stub = (f) => path.join(here, "stubs", f)
const nm = (m) => path.join(here, "node_modules", m)

export default defineConfig({
  root,
  plugins: [{
    name: "rn-asset-require",
    enforce: "pre",
    // the app uses require("../x.png") for artwork (Metro); turn those into plain strings for Vite
    transform(code, id) { return /\.(js|jsx)$/.test(id) && !id.includes("node_modules") ? code.replace(/require\((["'][^"']+\.(?:png|jpe?g|webp)["'])\)/g, "$1") : null },
  }],
  oxc: {
    include: /\.(js|jsx)$/,
    exclude: /node_modules/,
    lang: "jsx",
    jsx: { runtime: "automatic" },
  },
  resolve: {
    alias: [
      // the app sources live outside tests/ui, so React and react-native-web must be resolved from here (one copy of React)
      { find: /^react-native$/, replacement: nm("react-native-web") },
      { find: /^react-native-web$/, replacement: nm("react-native-web") },
      { find: /^(react|react-dom)(\/.*)?$/, replacement: `${path.join(here, "node_modules")}/$1$2` },
      { find: /^@expo\/vector-icons$/, replacement: stub("icons.jsx") },
      { find: /^expo-linear-gradient$/, replacement: stub("gradient.jsx") },
      { find: /^@react-navigation\/native$/, replacement: stub("navigation.js") },
      { find: /^react-native-safe-area-context$/, replacement: stub("safearea.jsx") },
      { find: /^@react-native-community\/datetimepicker$/, replacement: stub("datetimepicker.jsx") },
      { find: /^@react-native-async-storage\/async-storage$/, replacement: stub("asyncstorage.js") },
      { find: /^firebase\/firestore$/, replacement: stub("firestore.js") },
      { find: /^firebase\/auth$/, replacement: stub("auth.js") },
      { find: /^.*\/Firebase\/config$/, replacement: stub("fbconfig.js") },
      { find: /^.*\/BottomNav$/, replacement: stub("bottomnav.jsx") },
      { find: /^.*\/OfflineIndicator$/, replacement: stub("null.jsx") },
      { find: /^(?:.*\/utils\/|\.\/)callable$/, replacement: stub("callable.js") },
      { find: /^(?:.*\/hooks\/|\.\/)useOfflineData$/, replacement: stub("useOfflineData.js") },
    ],
  },
  test: { environment: "jsdom", include: ["tests/ui/**/*.test.jsx"], setupFiles: [path.join(here, "setup.js")], css: false, server: { deps: { inline: [/react-native-web/] } } },
})
