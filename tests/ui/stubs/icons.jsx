import React from "react"
import { Text } from "react-native"
const make = (set) => ({ name, size, color, style }) => <Text accessibilityLabel={`${set}:${name}`} style={style} testID={`${set}:${name}`} />
export const Ionicons = make("Ionicons")
export const MaterialCommunityIcons = make("MCI")
export const MaterialIcons = make("MI")
export const FontAwesome = make("FA")
