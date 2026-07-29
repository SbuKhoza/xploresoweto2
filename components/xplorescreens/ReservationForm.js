"use client"

import { useState, useEffect } from "react"
import {
  Text, View, ScrollView, TouchableOpacity, Modal, TextInput, Alert, FlatList,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import DateTimePicker from "@react-native-community/datetimepicker"

const ReservationForm = ({ visible, onClose, accommodation }) => {
  const [checkInDate, setCheckInDate] = useState(new Date())
  const [checkOutDate, setCheckOutDate] = useState(new Date(Date.now() + 24 * 60 * 60 * 1000))
  const [checkInTimeString, setCheckInTimeString] = useState("14:00")
  const [checkOutTimeString, setCheckOutTimeString] = useState("11:00")
  const [guests, setGuests] = useState(1)
  const [guestName, setGuestName] = useState("")
  const [guestEmail, setGuestEmail] = useState("")
  const [guestPhone, setGuestPhone] = useState("")
  const [specialRequests, setSpecialRequests] = useState("")
  const [breakfastOption, setBreakfastOption] = useState("none")
  const [showCheckInDatePicker, setShowCheckInDatePicker] = useState(false)
  const [showCheckOutDatePicker, setShowCheckOutDatePicker] = useState(false)
  const [showCheckInTimeDropdown, setShowCheckInTimeDropdown] = useState(false)
  const [showCheckOutTimeDropdown, setShowCheckOutTimeDropdown] = useState(false)

  const breakfastOptions = [
    { value: "none", label: "No Breakfast", price: 0 },
    { value: "continental", label: "Continental Breakfast", price: 0 },
    { value: "full", label: "Full English Breakfast", price: 150 },
  ]

  const generateTimeOptions = () => {
    const times = []
    const now = new Date()
    const currentHour = now.getHours()
    const currentMinute = now.getMinutes()

    for (let hour = 0; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const isToday = checkInDate.toDateString() === now.toDateString()
        if (isToday && (hour < currentHour || (hour === currentHour && minute <= currentMinute))) continue
        times.push(`${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`)
      }
    }
    return times
  }

  const getAllTimeOptions = () => {
    const times = []
    for (let hour = 0; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        times.push(`${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`)
      }
    }
    return times
  }

  useEffect(() => {
    const now = new Date()
    const isToday = checkInDate.toDateString() === now.toDateString()
    if (isToday) {
      const currentHour = now.getHours()
      const currentMinute = now.getMinutes()
      const roundedMinute = currentMinute <= 30 ? 30 : 0
      const adjustedHour = currentMinute > 30 ? currentHour + 1 : currentHour
      if (adjustedHour < 24) {
        setCheckInTimeString(`${adjustedHour.toString().padStart(2, "0")}:${roundedMinute.toString().padStart(2, "0")}`)
      }
    }
  }, [checkInDate])

  const formatDate = (date) =>
    date.toLocaleDateString("en-ZA", { weekday: "short", year: "numeric", month: "short", day: "numeric" })

  const calculateNights = () => Math.ceil(Math.abs(checkOutDate - checkInDate) / (1000 * 60 * 60 * 24))

  const handleSubmitReservation = () => {
    if (!guestName.trim() || !guestEmail.trim() || !guestPhone.trim()) {
      Alert.alert("Missing info", "Please fill in all required fields")
      return
    }
    if (checkInDate >= checkOutDate) {
      Alert.alert("Invalid dates", "Check-out date must be after check-in date")
      return
    }

    const selectedBreakfast = breakfastOptions.find((o) => o.value === breakfastOption)
    const reservationData = {
      accommodation: accommodation?.name,
      checkInDate: formatDate(checkInDate), checkInTime: checkInTimeString,
      checkOutDate: formatDate(checkOutDate), checkOutTime: checkOutTimeString,
      guests, guestName, guestEmail, guestPhone,
      breakfast: selectedBreakfast.label, specialRequests, nights: calculateNights(),
    }

    Alert.alert(
      "Reservation Submitted",
      `Thank you ${guestName}! Your reservation for ${accommodation?.name} has been submitted. You will receive a confirmation email shortly.`,
      [{ text: "OK", onPress: () => {
        onClose()
        setGuestName(""); setGuestEmail(""); setGuestPhone(""); setSpecialRequests("")
        setGuests(1); setBreakfastOption("none")
      }}],
    )
  }

  const onCheckInDateChange = (event, selectedDate) => {
    setShowCheckInDatePicker(false)
    if (selectedDate) {
      setCheckInDate(selectedDate)
      if (checkOutDate <= selectedDate) {
        const nextDay = new Date(selectedDate)
        nextDay.setDate(nextDay.getDate() + 1)
        setCheckOutDate(nextDay)
      }
    }
  }

  const onCheckOutDateChange = (event, selectedDate) => {
    setShowCheckOutDatePicker(false)
    if (selectedDate) setCheckOutDate(selectedDate)
  }

  // ── Bottom-sheet time picker ──
  const renderTimeDropdown = (isCheckIn) => {
    const timeOptions = isCheckIn ? generateTimeOptions() : getAllTimeOptions()
    const currentTime = isCheckIn ? checkInTimeString : checkOutTimeString
    const setTime = isCheckIn ? setCheckInTimeString : setCheckOutTimeString
    const showDropdown = isCheckIn ? showCheckInTimeDropdown : showCheckOutTimeDropdown
    const setShowDropdown = isCheckIn ? setShowCheckInTimeDropdown : setShowCheckOutTimeDropdown

    if (!showDropdown) return null

    return (
      <Modal transparent visible={showDropdown} animationType="fade" onRequestClose={() => setShowDropdown(false)}>
        <TouchableOpacity className="flex-1 bg-black/40 justify-end" activeOpacity={1} onPress={() => setShowDropdown(false)}>
          <View className="bg-surface rounded-t-3xl max-h-[65%]" onStartShouldSetResponder={() => true}>
            <View className="flex-row justify-between items-center px-5 py-4 border-b border-line">
              <Text className="text-[15px] font-extrabold text-ink">Select {isCheckIn ? "Check-in" : "Check-out"} Time</Text>
              <TouchableOpacity onPress={() => setShowDropdown(false)} className="w-8 h-8 rounded-full bg-bg justify-center items-center">
                <Ionicons name="close" size={17} color="#7A8A8F" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={timeOptions}
              keyExtractor={(item) => item}
              style={{ maxHeight: 320 }}
              renderItem={({ item }) => {
                const isSelected = currentTime === item
                return (
                  <TouchableOpacity
                    className={`flex-row justify-between items-center px-5 py-3 border-b border-line ${isSelected ? "bg-teal-light" : ""}`}
                    onPress={() => { setTime(item); setShowDropdown(false) }}
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

  if (!accommodation) return null

  return (
    <Modal animationType="slide" transparent={false} visible={visible} onRequestClose={onClose}>
      <View className="flex-1 bg-bg">
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 pt-14 pb-3 bg-surface border-b border-line">
          <TouchableOpacity className="w-9 h-9 rounded-full bg-bg justify-center items-center" onPress={onClose}>
            <Ionicons name="close" size={18} color="#1A1A1A" />
          </TouchableOpacity>
          <Text className="flex-1 text-center text-[16px] font-extrabold text-ink" numberOfLines={1}>Reserve {accommodation.name}</Text>
          <View className="w-9" />
        </View>

        <ScrollView className="flex-1 px-4 pt-4" showsVerticalScrollIndicator={false}>
          {/* Summary */}
          <View className="bg-surface rounded-2xl p-4 border border-line mb-4">
            <Text className="text-lg font-extrabold text-ink mb-0.5">{accommodation.name}</Text>
            <Text className="text-sm text-muted mb-2">{accommodation.location}</Text>
            <Text className="text-base font-bold text-teal">R{accommodation.price} per night</Text>
          </View>

          {/* Dates */}
          <View className="bg-surface rounded-2xl p-4 border border-line mb-4">
            <Text className="text-[15px] font-extrabold text-ink mb-3">Check-in & Check-out</Text>

            <View className="flex-row gap-2.5 mb-3">
              <View className="flex-1">
                <Text className="text-xs font-semibold text-muted mb-1.5">Check-in Date</Text>
                <TouchableOpacity className="flex-row items-center gap-2 bg-bg rounded-xl px-3 py-2.5 border border-line" onPress={() => setShowCheckInDatePicker(true)}>
                  <Ionicons name="calendar-outline" size={16} color="#1B4D5C" />
                  <Text className="text-[13px] text-ink flex-1" numberOfLines={1}>{formatDate(checkInDate)}</Text>
                </TouchableOpacity>
              </View>
              <View className="flex-1">
                <Text className="text-xs font-semibold text-muted mb-1.5">Check-in Time</Text>
                <TouchableOpacity className="flex-row items-center gap-2 bg-bg rounded-xl px-3 py-2.5 border border-line" onPress={() => setShowCheckInTimeDropdown(true)}>
                  <Ionicons name="time-outline" size={16} color="#1B4D5C" />
                  <Text className="text-[13px] text-ink flex-1">{checkInTimeString}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View className="flex-row gap-2.5">
              <View className="flex-1">
                <Text className="text-xs font-semibold text-muted mb-1.5">Check-out Date</Text>
                <TouchableOpacity className="flex-row items-center gap-2 bg-bg rounded-xl px-3 py-2.5 border border-line" onPress={() => setShowCheckOutDatePicker(true)}>
                  <Ionicons name="calendar-outline" size={16} color="#1B4D5C" />
                  <Text className="text-[13px] text-ink flex-1" numberOfLines={1}>{formatDate(checkOutDate)}</Text>
                </TouchableOpacity>
              </View>
              <View className="flex-1">
                <Text className="text-xs font-semibold text-muted mb-1.5">Check-out Time</Text>
                <TouchableOpacity className="flex-row items-center gap-2 bg-bg rounded-xl px-3 py-2.5 border border-line" onPress={() => setShowCheckOutTimeDropdown(true)}>
                  <Ionicons name="time-outline" size={16} color="#1B4D5C" />
                  <Text className="text-[13px] text-ink flex-1">{checkOutTimeString}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Guests */}
          <View className="bg-surface rounded-2xl p-4 border border-line mb-4">
            <Text className="text-[15px] font-extrabold text-ink mb-3">Number of Guests</Text>
            <View className="flex-row items-center justify-center mb-2">
              <TouchableOpacity
                className={`w-9 h-9 rounded-full justify-center items-center border ${guests <= 1 ? "bg-bg border-line" : "bg-teal-light border-teal"}`}
                onPress={() => guests > 1 && setGuests(guests - 1)}
                disabled={guests <= 1}
              >
                <Ionicons name="remove" size={17} color={guests <= 1 ? "#C0C4D6" : "#1B4D5C"} />
              </TouchableOpacity>
              <Text className="text-lg font-extrabold text-ink mx-6 min-w-[24px] text-center">{guests}</Text>
              <TouchableOpacity
                className={`w-9 h-9 rounded-full justify-center items-center border ${guests >= accommodation.maxGuests ? "bg-bg border-line" : "bg-teal-light border-teal"}`}
                onPress={() => guests < accommodation.maxGuests && setGuests(guests + 1)}
                disabled={guests >= accommodation.maxGuests}
              >
                <Ionicons name="add" size={17} color={guests >= accommodation.maxGuests ? "#C0C4D6" : "#1B4D5C"} />
              </TouchableOpacity>
            </View>
            <Text className="text-xs text-muted text-center">Maximum {accommodation.maxGuests} guests</Text>
          </View>

          {/* Breakfast */}
          <View className="bg-surface rounded-2xl p-4 border border-line mb-4">
            <Text className="text-[15px] font-extrabold text-ink mb-3">Breakfast Options</Text>
            {breakfastOptions.map((option) => {
              const isSelected = breakfastOption === option.value
              return (
                <TouchableOpacity
                  key={option.value}
                  className={`flex-row items-center justify-between p-3 rounded-xl border mb-2 ${isSelected ? "border-teal bg-teal-light" : "border-line bg-bg"}`}
                  onPress={() => setBreakfastOption(option.value)}
                >
                  <View className="flex-1">
                    <Text className={`text-[14px] font-semibold ${isSelected ? "text-teal" : "text-ink"}`}>{option.label}</Text>
                    <Text className="text-xs text-muted mt-0.5">{option.price === 0 ? "Free" : `R${option.price} per person`}</Text>
                  </View>
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

        {showCheckInDatePicker && (
          <DateTimePicker value={checkInDate} mode="date" display="default" minimumDate={new Date()} onChange={onCheckInDateChange} />
        )}
        {showCheckOutDatePicker && (
          <DateTimePicker value={checkOutDate} mode="date" display="default" minimumDate={new Date(checkInDate.getTime() + 24 * 60 * 60 * 1000)} onChange={onCheckOutDateChange} />
        )}

        {renderTimeDropdown(true)}
        {renderTimeDropdown(false)}
      </View>
    </Modal>
  )
}

export default ReservationForm