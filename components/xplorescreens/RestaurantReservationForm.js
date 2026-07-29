"use client"

import { useState, useEffect } from "react"
import {
  Text, View, ScrollView, TouchableOpacity, Modal, TextInput, Alert, FlatList,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import DateTimePicker from "@react-native-community/datetimepicker"

const RestaurantReservationForm = ({ visible, onClose, restaurant }) => {
  const [reservationDate, setReservationDate] = useState(new Date())
  const [reservationTimeString, setReservationTimeString] = useState("19:00")
  const [guests, setGuests] = useState(2)
  const [selectedTable, setSelectedTable] = useState(null)
  const [guestName, setGuestName] = useState("")
  const [guestEmail, setGuestEmail] = useState("")
  const [guestPhone, setGuestPhone] = useState("")
  const [specialRequests, setSpecialRequests] = useState("")
  const [occasion, setOccasion] = useState("none")
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showTimeDropdown, setShowTimeDropdown] = useState(false)

  const occasionOptions = [
    { value: "none", label: "No Special Occasion" },
    { value: "birthday", label: "Birthday" },
    { value: "anniversary", label: "Anniversary" },
    { value: "business", label: "Business Meal" },
    { value: "other", label: "Other" },
  ]

  const generateTimeOptions = () => {
    const times = []
    const now = new Date()
    const currentHour = now.getHours()
    const currentMinute = now.getMinutes()
    const openingHour = 11
    const closingHour = 22

    for (let hour = openingHour; hour < closingHour; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const isToday = reservationDate.toDateString() === now.toDateString()
        if (isToday && (hour < currentHour || (hour === currentHour && minute <= currentMinute))) continue
        times.push(`${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`)
      }
    }
    return times
  }

  useEffect(() => {
    const now = new Date()
    const isToday = reservationDate.toDateString() === now.toDateString()

    if (isToday) {
      const currentHour = now.getHours()
      const currentMinute = now.getMinutes()
      if (currentHour < 19) {
        setReservationTimeString("19:00")
      } else {
        const roundedMinute = currentMinute <= 30 ? 30 : 0
        const adjustedHour = currentMinute > 30 ? currentHour + 1 : currentHour
        if (adjustedHour < 22) {
          setReservationTimeString(`${adjustedHour.toString().padStart(2, "0")}:${roundedMinute.toString().padStart(2, "0")}`)
        } else {
          setReservationTimeString("11:00")
          const tomorrow = new Date(now)
          tomorrow.setDate(tomorrow.getDate() + 1)
          setReservationDate(tomorrow)
        }
      }
    } else {
      setReservationTimeString("19:00")
    }
  }, [reservationDate])

  const formatDate = (date) =>
    date.toLocaleDateString("en-ZA", { weekday: "short", year: "numeric", month: "short", day: "numeric" })

  const handleSubmitReservation = () => {
    if (!guestName.trim() || !guestEmail.trim() || !guestPhone.trim() || !selectedTable) {
      Alert.alert("Missing info", "Please fill in all required fields and select a table")
      return
    }

    const selectedOccasion = occasionOptions.find((o) => o.value === occasion)
    const reservationData = {
      restaurant: restaurant?.name,
      date: formatDate(reservationDate), time: reservationTimeString,
      guests, table: selectedTable, guestName, guestEmail, guestPhone,
      occasion: selectedOccasion.label, specialRequests,
    }

    Alert.alert(
      "Reservation Submitted",
      `Thank you ${guestName}! Your reservation at ${restaurant?.name} for ${formatDate(reservationDate)} at ${reservationTimeString} has been submitted. You will receive a confirmation email shortly.`,
      [{ text: "OK", onPress: () => {
        onClose()
        setGuestName(""); setGuestEmail(""); setGuestPhone(""); setSpecialRequests("")
        setGuests(2); setOccasion("none"); setSelectedTable(null)
      }}],
    )
  }

  const onDateChange = (event, selectedDate) => {
    setShowDatePicker(false)
    if (selectedDate) setReservationDate(selectedDate)
  }

  // ── Bottom-sheet time picker ──
  const renderTimeDropdown = () => {
    const timeOptions = generateTimeOptions()
    if (!showTimeDropdown) return null

    return (
      <Modal transparent visible={showTimeDropdown} animationType="fade" onRequestClose={() => setShowTimeDropdown(false)}>
        <TouchableOpacity className="flex-1 bg-black/40 justify-end" activeOpacity={1} onPress={() => setShowTimeDropdown(false)}>
          <View className="bg-surface rounded-t-3xl max-h-[65%]" onStartShouldSetResponder={() => true}>
            <View className="flex-row justify-between items-center px-5 py-4 border-b border-line">
              <Text className="text-[15px] font-extrabold text-ink">Select Time</Text>
              <TouchableOpacity onPress={() => setShowTimeDropdown(false)} className="w-8 h-8 rounded-full bg-bg justify-center items-center">
                <Ionicons name="close" size={17} color="#7A8A8F" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={timeOptions}
              keyExtractor={(item) => item}
              style={{ maxHeight: 320 }}
              renderItem={({ item }) => {
                const isSelected = reservationTimeString === item
                return (
                  <TouchableOpacity
                    className={`flex-row justify-between items-center px-5 py-3 border-b border-line ${isSelected ? "bg-teal-light" : ""}`}
                    onPress={() => { setReservationTimeString(item); setShowTimeDropdown(false) }}
                  >
                    <Text className={`text-[14px] ${isSelected ? "text-teal font-bold" : "text-ink"}`}>{item}</Text>
                    {isSelected && <Ionicons name="checkmark" size={18} color="#1B4D5C" />}
                  </TouchableOpacity>
                )
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    )
  }

  if (!restaurant) return null

  return (
    <Modal animationType="slide" transparent={false} visible={visible} onRequestClose={onClose}>
      <View className="flex-1 bg-bg">
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 pt-14 pb-3 bg-surface border-b border-line">
          <TouchableOpacity className="w-9 h-9 rounded-full bg-bg justify-center items-center" onPress={onClose}>
            <Ionicons name="close" size={18} color="#1A1A1A" />
          </TouchableOpacity>
          <Text className="flex-1 text-center text-[16px] font-extrabold text-ink" numberOfLines={1}>Reserve at {restaurant.name}</Text>
          <View className="w-9" />
        </View>

        <ScrollView className="flex-1 px-4 pt-4" showsVerticalScrollIndicator={false}>
          {/* Summary */}
          <View className="bg-surface rounded-2xl p-4 border border-line mb-4">
            <Text className="text-lg font-extrabold text-ink mb-0.5">{restaurant.name}</Text>
            <Text className="text-sm text-muted mb-2">{restaurant.location}</Text>
            <Text className="text-[15px] font-semibold text-teal">{restaurant.cuisine} · {restaurant.price}</Text>
          </View>

          {/* Date & Time */}
          <View className="bg-surface rounded-2xl p-4 border border-line mb-4">
            <Text className="text-[15px] font-extrabold text-ink mb-3">Date & Time</Text>
            <View className="flex-row gap-2.5">
              <View className="flex-1">
                <Text className="text-xs font-semibold text-muted mb-1.5">Date</Text>
                <TouchableOpacity className="flex-row items-center gap-2 bg-bg rounded-xl px-3 py-2.5 border border-line" onPress={() => setShowDatePicker(true)}>
                  <Ionicons name="calendar-outline" size={16} color="#1B4D5C" />
                  <Text className="text-[13px] text-ink flex-1" numberOfLines={1}>{formatDate(reservationDate)}</Text>
                </TouchableOpacity>
              </View>
              <View className="flex-1">
                <Text className="text-xs font-semibold text-muted mb-1.5">Time</Text>
                <TouchableOpacity className="flex-row items-center gap-2 bg-bg rounded-xl px-3 py-2.5 border border-line" onPress={() => setShowTimeDropdown(true)}>
                  <Ionicons name="time-outline" size={16} color="#1B4D5C" />
                  <Text className="text-[13px] text-ink flex-1">{reservationTimeString}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Party size & table */}
          <View className="bg-surface rounded-2xl p-4 border border-line mb-4">
            <Text className="text-[15px] font-extrabold text-ink mb-3">Party Size & Table</Text>

            <Text className="text-xs font-semibold text-muted mb-1.5">Number of Guests</Text>
            <View className="flex-row items-center justify-center mb-4">
              <TouchableOpacity
                className={`w-9 h-9 rounded-full justify-center items-center border ${guests <= 1 ? "bg-bg border-line" : "bg-teal-light border-teal"}`}
                onPress={() => guests > 1 && setGuests(guests - 1)}
                disabled={guests <= 1}
              >
                <Ionicons name="remove" size={17} color={guests <= 1 ? "#C0C4D6" : "#1B4D5C"} />
              </TouchableOpacity>
              <Text className="text-lg font-extrabold text-ink mx-6 min-w-[24px] text-center">{guests}</Text>
              <TouchableOpacity
                className={`w-9 h-9 rounded-full justify-center items-center border ${guests >= 10 ? "bg-bg border-line" : "bg-teal-light border-teal"}`}
                onPress={() => guests < 10 && setGuests(guests + 1)}
                disabled={guests >= 10}
              >
                <Ionicons name="add" size={17} color={guests >= 10 ? "#C0C4D6" : "#1B4D5C"} />
              </TouchableOpacity>
            </View>

            <Text className="text-xs font-semibold text-muted mb-2">Select Table</Text>
            <View className="flex-row flex-wrap gap-2">
              {(restaurant.tableOptions || []).map((size) => {
                const isDisabled = guests > size
                const isSelected = selectedTable === size
                return (
                  <TouchableOpacity
                    key={size}
                    className={`flex-row items-center gap-1.5 px-3 py-2.5 rounded-xl border ${
                      isDisabled ? "bg-bg border-line opacity-40" : isSelected ? "bg-teal border-teal" : "bg-bg border-line"
                    }`}
                    onPress={() => !isDisabled && setSelectedTable(size)}
                    disabled={isDisabled}
                  >
                    <Ionicons name="people-outline" size={14} color={isSelected ? "#FFFFFF" : "#7A8A8F"} />
                    <Text className={`text-[13px] font-semibold ${isSelected ? "text-surface" : "text-ink"}`}>{size} seats</Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>

          {/* Occasion */}
          <View className="bg-surface rounded-2xl p-4 border border-line mb-4">
            <Text className="text-[15px] font-extrabold text-ink mb-3">Special Occasion</Text>
            {occasionOptions.map((option) => {
              const isSelected = occasion === option.value
              return (
                <TouchableOpacity
                  key={option.value}
                  className={`flex-row items-center justify-between p-3 rounded-xl border mb-2 ${isSelected ? "border-teal bg-teal-light" : "border-line bg-bg"}`}
                  onPress={() => setOccasion(option.value)}
                >
                  <Text className={`text-[14px] font-semibold ${isSelected ? "text-teal" : "text-ink"}`}>{option.label}</Text>
                  <View className={`w-5 h-5 rounded-full border-2 justify-center items-center ${isSelected ? "border-teal" : "border-line"}`}>
                    {isSelected && <View className="w-2.5 h-2.5 rounded-full bg-teal" />}
                  </View>
                </TouchableOpacity>
              )
            })}
          </View>

          {/* Guest info */}
          <View className="bg-surface rounded-2xl p-4 border border-line mb-4">
            <Text className="text-[15px] font-extrabold text-ink mb-3">Guest Information</Text>

            <View className="mb-3.5">
              <Text className="text-xs font-semibold text-muted mb-1.5">Full Name *</Text>
              <TextInput
                className="border border-line rounded-xl px-3.5 py-2.5 text-sm text-ink bg-bg"
                value={guestName} onChangeText={setGuestName}
                placeholder="Enter your full name" placeholderTextColor="#AAAAAA"
              />
            </View>

            <View className="mb-3.5">
              <Text className="text-xs font-semibold text-muted mb-1.5">Email Address *</Text>
              <TextInput
                className="border border-line rounded-xl px-3.5 py-2.5 text-sm text-ink bg-bg"
                value={guestEmail} onChangeText={setGuestEmail}
                placeholder="Enter your email" placeholderTextColor="#AAAAAA"
                keyboardType="email-address" autoCapitalize="none"
              />
            </View>

            <View className="mb-3.5">
              <Text className="text-xs font-semibold text-muted mb-1.5">Phone Number *</Text>
              <TextInput
                className="border border-line rounded-xl px-3.5 py-2.5 text-sm text-ink bg-bg"
                value={guestPhone} onChangeText={setGuestPhone}
                placeholder="Enter your phone number" placeholderTextColor="#AAAAAA"
                keyboardType="phone-pad"
              />
            </View>

            <View>
              <Text className="text-xs font-semibold text-muted mb-1.5">Special Requests (Optional)</Text>
              <TextInput
                className="border border-line rounded-xl px-3.5 py-2.5 text-sm text-ink bg-bg h-20"
                value={specialRequests} onChangeText={setSpecialRequests}
                placeholder="Any special requests or requirements…" placeholderTextColor="#AAAAAA"
                multiline numberOfLines={3} textAlignVertical="top"
              />
            </View>
          </View>

          {/* Submit — deliberately modest size, not a giant CTA */}
          <TouchableOpacity className="bg-teal py-3 rounded-2xl items-center mb-8" onPress={handleSubmitReservation} activeOpacity={0.88}>
            <Text className="text-surface text-[15px] font-bold">Confirm Reservation</Text>
          </TouchableOpacity>
        </ScrollView>

        {showDatePicker && (
          <DateTimePicker value={reservationDate} mode="date" display="default" minimumDate={new Date()} onChange={onDateChange} />
        )}

        {renderTimeDropdown()}
      </View>
    </Modal>
  )
}

export default RestaurantReservationForm