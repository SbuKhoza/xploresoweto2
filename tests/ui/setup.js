import { afterEach, vi } from "vitest"
import { cleanup } from "@testing-library/react"
afterEach(() => { cleanup(); globalThis.__FS = {}; globalThis.__OFFLINE = {}; globalThis.__CALLS = []; globalThis.__INSETS = undefined; globalThis.__ROUTE = undefined })
globalThis.__FS = {}; globalThis.__OFFLINE = {}; globalThis.__CALLS = []
globalThis.IS_REACT_ACT_ENVIRONMENT = true
// jsdom has no layout; react-native-web only needs these to exist
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
vi.spyOn(console, "warn").mockImplementation(() => {})
