import { Component } from "react"
import { Text, View, TouchableOpacity } from "react-native"
import { safeErrorSummary } from "../utils/listingData"

/**
 * Scoped error boundary for the Xplore listing screens. It is a safety net, NOT a substitute for fixing defects: the screens
 * normalise their data first (utils/listingData.js). If something unexpected still throws while rendering, the person gets a
 * friendly message with "Try again" and the back button keeps working instead of the whole app closing.
 *
 * Diagnostics: only the screen name and a trimmed error type/message are logged. Documents, props and component stacks are never logged.
 */
export default class ListingErrorBoundary extends Component {
  state = { failed: false, attempt: 0 }

  static getDerivedStateFromError() { return { failed: true } }

  componentDidCatch(error) {
    const { name, message } = safeErrorSummary(error)
    // eslint-disable-next-line no-console
    console.warn(`[listing] ${this.props.screen || "screen"} failed to render: ${name}: ${message}`)
  }

  retry = () => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))

  render() {
    if (!this.state.failed) return <View key={this.state.attempt} style={{ flex: 1 }}>{this.props.children}</View>
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: "#FAF7F2" }} accessibilityRole="alert">
        <Text style={{ fontSize: 16, fontWeight: "800", color: "#14213D", textAlign: "center" }}>Something went wrong showing this list</Text>
        <Text style={{ fontSize: 13, color: "#7A8A8F", textAlign: "center", marginTop: 8 }}>
          Your data is safe. Please try again, or go back and open it again later.
        </Text>
        <TouchableOpacity
          onPress={this.retry}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={{ marginTop: 18, backgroundColor: "#E8600A", paddingHorizontal: 22, paddingVertical: 11, borderRadius: 14 }}
        >
          <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 14 }}>Try again</Text>
        </TouchableOpacity>
      </View>
    )
  }
}
