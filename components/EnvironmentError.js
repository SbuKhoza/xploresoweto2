import { View, Text, ScrollView, StyleSheet } from "react-native"

// Shown INSTEAD of the app when the environment check fails. Nothing in the app (and so no Firebase code) has been loaded.
export default function EnvironmentError({ problems = [] }) {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>This build is not configured correctly</Text>
      <Text style={styles.body}>For your safety the app did not start and has not contacted any server. Please install an official build.</Text>
      <ScrollView style={styles.list}>{problems.map((p, i) => <Text key={i} style={styles.item}>• {p}</Text>)}</ScrollView>
    </View>
  )
}
const styles = StyleSheet.create({
  root: { flex: 1, padding: 24, paddingTop: 72, backgroundColor: "#fff" },
  title: { fontSize: 20, fontWeight: "800", color: "#B00020", marginBottom: 12 },
  body: { fontSize: 15, color: "#222", marginBottom: 16 },
  list: { flex: 1 },
  item: { fontSize: 12, color: "#444", marginBottom: 6 },
})
