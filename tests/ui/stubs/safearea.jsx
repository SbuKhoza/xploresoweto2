// Insets can be set per test with globalThis.__INSETS (default: none).
export const useSafeAreaInsets = () => globalThis.__INSETS || { top: 0, bottom: 0, left: 0, right: 0 }
export const SafeAreaProvider = ({ children }) => children
export const SafeAreaView = ({ children, edges, style }) => <div data-testid="safe-area-view" data-edges={(edges || []).join(",")} style={style}>{children}</div>
