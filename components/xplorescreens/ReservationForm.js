"use client"

import { useState, useEffect } from "react"
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  Dimensions,
  FlatList,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import DateTimePicker from "@react-native-community/datetimepicker"

const { width } = Dimensions.get("window")

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
        // For check-in time, only show times from current time onwards if it's today
        const isToday = checkInDate.toDateString() === now.toDateString()
        if (isToday && (hour < currentHour || (hour === currentHour && minute <= currentMinute))) {
          continue
        }

        const timeString = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`
        times.push(timeString)
      }
    }
    return times
  }

  const getAllTimeOptions = () => {
    const times = []
    for (let hour = 0; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const timeString = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`
        times.push(timeString)
      }
    }
    return times
  }

  useEffect(() => {
    // Set minimum check-in time to current time if today
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

  const formatDate = (date) => {
    return date.toLocaleDateString("en-ZA", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  const calculateNights = () => {
    const diffTime = Math.abs(checkOutDate - checkInDate)
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
  }

  const handleSubmitReservation = () => {
    if (!guestName.trim() || !guestEmail.trim() || !guestPhone.trim()) {
      Alert.alert("Error", "Please fill in all required fields")
      return
    }

    if (checkInDate >= checkOutDate) {
      Alert.alert("Error", "Check-out date must be after check-in date")
      return
    }

    const selectedBreakfast = breakfastOptions.find((option) => option.value === breakfastOption)

    const reservationData = {
      accommodation: accommodation?.name,
      checkInDate: formatDate(checkInDate),
      checkInTime: checkInTimeString,
      checkOutDate: formatDate(checkOutDate),
      checkOutTime: checkOutTimeString,
      guests,
      guestName,
      guestEmail,
      guestPhone,
      breakfast: selectedBreakfast.label,
      specialRequests,
      nights: calculateNights(),
    }

    Alert.alert(
      "Reservation Submitted",
      `Thank you ${guestName}! Your reservation for ${accommodation?.name} has been submitted. You will receive a confirmation email shortly.`,
      [
        {
          text: "OK",
          onPress: () => {
            onClose()
            // Reset form
            setGuestName("")
            setGuestEmail("")
            setGuestPhone("")
            setSpecialRequests("")
            setGuests(1)
            setBreakfastOption("none")
          },
        },
      ],
    )
  }

  const onCheckInDateChange = (event, selectedDate) => {
    setShowCheckInDatePicker(false)
    if (selectedDate) {
      setCheckInDate(selectedDate)
      // Automatically set check-out date to next day if it's before or same as check-in
      if (checkOutDate <= selectedDate) {
        const nextDay = new Date(selectedDate)
        nextDay.setDate(nextDay.getDate() + 1)
        setCheckOutDate(nextDay)
      }
    }
  }

  const onCheckOutDateChange = (event, selectedDate) => {
    setShowCheckOutDatePicker(false)
    if (selectedDate) {
      setCheckOutDate(selectedDate)
    }
  }

  const renderTimeDropdown = (isCheckIn) => {
    const timeOptions = isCheckIn ? generateTimeOptions() : getAllTimeOptions()
    const currentTime = isCheckIn ? checkInTimeString : checkOutTimeString
    const setTime = isCheckIn ? setCheckInTimeString : setCheckOutTimeString
    const showDropdown = isCheckIn ? showCheckInTimeDropdown : showCheckOutTimeDropdown
    const setShowDropdown = isCheckIn ? setShowCheckInTimeDropdown : setShowCheckOutTimeDropdown

    if (!showDropdown) return null

    return (
      <Modal transparent={true} visible={showDropdown} onRequestClose={() => setShowDropdown(false)}>
        <TouchableOpacity style={styles.timeDropdownOverlay} onPress={() => setShowDropdown(false)}>
          <View style={styles.timeDropdownContainer}>
            <View style={styles.timeDropdownHeader}>
              <Text style={styles.timeDropdownTitle}>Select {isCheckIn ? "Check-in" : "Check-out"} Time</Text>
              <TouchableOpacity onPress={() => setShowDropdown(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={timeOptions}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.timeOption, currentTime === item && styles.selectedTimeOption]}
                  onPress={() => {
                    setTime(item)
                    setShowDropdown(false)
                  }}
                >
                  <Text style={[styles.timeOptionText, currentTime === item && styles.selectedTimeOptionText]}>
                    {item}
                  </Text>
                  {currentTime === item && <Ionicons name="checkmark" size={20} color="#87CEEB" />}
                </TouchableOpacity>
              )}
              style={styles.timeOptionsList}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    )
  }

  if (!accommodation) return null

  return (
    <Modal animationType="slide" transparent={false} visible={visible} onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Ionicons name="close" size={24} color="#000" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Reserve {accommodation.name}</Text>
          <View style={styles.placeholder} />
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Accommodation Summary */}
          <View style={styles.summaryCard}>
            <Text style={styles.accommodationName}>{accommodation.name}</Text>
            <Text style={styles.accommodationLocation}>{accommodation.location}</Text>
            <Text style={styles.priceText}>R{accommodation.price} per night</Text>
          </View>

          {/* Date Selection */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Check-in & Check-out</Text>

            <View style={styles.dateTimeRow}>
              <View style={styles.dateTimeItem}>
                <Text style={styles.label}>Check-in Date</Text>
                <TouchableOpacity style={styles.dateTimeButton} onPress={() => setShowCheckInDatePicker(true)}>
                  <Ionicons name="calendar-outline" size={20} color="#666" />
                  <Text style={styles.dateTimeText}>{formatDate(checkInDate)}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.dateTimeItem}>
                <Text style={styles.label}>Check-in Time</Text>
                <TouchableOpacity style={styles.dateTimeButton} onPress={() => setShowCheckInTimeDropdown(true)}>
                  <Ionicons name="time-outline" size={20} color="#666" />
                  <Text style={styles.dateTimeText}>{checkInTimeString}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.dateTimeRow}>
              <View style={styles.dateTimeItem}>
                <Text style={styles.label}>Check-out Date</Text>
                <TouchableOpacity style={styles.dateTimeButton} onPress={() => setShowCheckOutDatePicker(true)}>
                  <Ionicons name="calendar-outline" size={20} color="#666" />
                  <Text style={styles.dateTimeText}>{formatDate(checkOutDate)}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.dateTimeItem}>
                <Text style={styles.label}>Check-out Time</Text>
                <TouchableOpacity style={styles.dateTimeButton} onPress={() => setShowCheckOutTimeDropdown(true)}>
                  <Ionicons name="time-outline" size={20} color="#666" />
                  <Text style={styles.dateTimeText}>{checkOutTimeString}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Guest Count */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Number of Guests</Text>
            <View style={styles.guestCounter}>
              <TouchableOpacity
                style={[styles.counterButton, guests <= 1 && styles.counterButtonDisabled]}
                onPress={() => guests > 1 && setGuests(guests - 1)}
                disabled={guests <= 1}
              >
                <Ionicons name="remove" size={20} color={guests <= 1 ? "#ccc" : "#666"} />
              </TouchableOpacity>
              <Text style={styles.guestCount}>{guests}</Text>
              <TouchableOpacity
                style={[styles.counterButton, guests >= accommodation.maxGuests && styles.counterButtonDisabled]}
                onPress={() => guests < accommodation.maxGuests && setGuests(guests + 1)}
                disabled={guests >= accommodation.maxGuests}
              >
                <Ionicons name="add" size={20} color={guests >= accommodation.maxGuests ? "#ccc" : "#666"} />
              </TouchableOpacity>
            </View>
            <Text style={styles.maxGuestsText}>Maximum {accommodation.maxGuests} guests</Text>
          </View>

          {/* Breakfast Options */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Breakfast Options</Text>
            {breakfastOptions.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[styles.breakfastOption, breakfastOption === option.value && styles.selectedBreakfastOption]}
                onPress={() => setBreakfastOption(option.value)}
              >
                <View style={styles.breakfastOptionContent}>
                  <View style={styles.breakfastOptionInfo}>
                    <Text
                      style={[
                        styles.breakfastOptionLabel,
                        breakfastOption === option.value && styles.selectedBreakfastOptionLabel,
                      ]}
                    >
                      {option.label}
                    </Text>
                    <Text style={styles.breakfastOptionPrice}>
                      {option.price === 0 ? "Free" : `R${option.price} per person`}
                    </Text>
                  </View>
                  <View style={[styles.radioButton, breakfastOption === option.value && styles.selectedRadioButton]}>
                    {breakfastOption === option.value && <View style={styles.radioButtonInner} />}
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          {/* Guest Information */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Guest Information</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Full Name *</Text>
              <TextInput
                style={styles.textInput}
                value={guestName}
                onChangeText={setGuestName}
                placeholder="Enter your full name"
                placeholderTextColor="#999"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Email Address *</Text>
              <TextInput
                style={styles.textInput}
                value={guestEmail}
                onChangeText={setGuestEmail}
                placeholder="Enter your email"
                placeholderTextColor="#999"
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Phone Number *</Text>
              <TextInput
                style={styles.textInput}
                value={guestPhone}
                onChangeText={setGuestPhone}
                placeholder="Enter your phone number"
                placeholderTextColor="#999"
                keyboardType="phone-pad"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Special Requests (Optional)</Text>
              <TextInput
                style={[styles.textInput, styles.textArea]}
                value={specialRequests}
                onChangeText={setSpecialRequests}
                placeholder="Any special requests or requirements..."
                placeholderTextColor="#999"
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>
          </View>

          {/* Submit Button */}
          <TouchableOpacity style={styles.submitButton} onPress={handleSubmitReservation}>
            <Text style={styles.submitButtonText}>Confirm Reservation</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Date Pickers */}
        {showCheckInDatePicker && (
          <DateTimePicker
            value={checkInDate}
            mode="date"
            display="default"
            minimumDate={new Date()}
            onChange={onCheckInDateChange}
          />
        )}

        {showCheckOutDatePicker && (
          <DateTimePicker
            value={checkOutDate}
            mode="date"
            display="default"
            minimumDate={new Date(checkInDate.getTime() + 24 * 60 * 60 * 1000)}
            onChange={onCheckOutDateChange}
          />
        )}

        {/* Time Dropdowns */}
        {renderTimeDropdown(true)}
        {renderTimeDropdown(false)}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F9FA",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#FFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
    paddingTop: 50,
  },
  closeButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    flex: 1,
    textAlign: "center",
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  summaryCard: {
    backgroundColor: "#FFF",
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  accommodationName: {
    fontSize: 20,
    fontWeight: "700",
    color: "#333",
    marginBottom: 4,
  },
  accommodationLocation: {
    fontSize: 16,
    color: "#666",
    marginBottom: 8,
  },
  priceText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#87CEEB",
  },
  section: {
    backgroundColor: "#FFF",
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 16,
  },
  dateTimeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  dateTimeItem: {
    flex: 1,
    marginHorizontal: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    color: "#666",
    marginBottom: 8,
  },
  dateTimeButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    backgroundColor: "#F8F9FA",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  dateTimeText: {
    fontSize: 14,
    color: "#333",
    marginLeft: 8,
    flex: 1,
  },
  guestCounter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  counterButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F8F9FA",
    borderWidth: 1,
    borderColor: "#E0E0E0",
    justifyContent: "center",
    alignItems: "center",
  },
  counterButtonDisabled: {
    backgroundColor: "#F0F0F0",
    borderColor: "#D0D0D0",
  },
  guestCount: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginHorizontal: 20,
    minWidth: 30,
    textAlign: "center",
  },
  maxGuestsText: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
  breakfastOption: {
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    marginBottom: 12,
    backgroundColor: "#F8F9FA",
  },
  selectedBreakfastOption: {
    borderColor: "#87CEEB",
    backgroundColor: "#F0F8FF",
  },
  breakfastOptionContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  breakfastOptionInfo: {
    flex: 1,
  },
  breakfastOptionLabel: {
    fontSize: 16,
    fontWeight: "500",
    color: "#333",
    marginBottom: 4,
  },
  selectedBreakfastOptionLabel: {
    color: "#87CEEB",
  },
  breakfastOptionPrice: {
    fontSize: 14,
    color: "#666",
  },
  radioButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#E0E0E0",
    justifyContent: "center",
    alignItems: "center",
  },
  selectedRadioButton: {
    borderColor: "#87CEEB",
  },
  radioButtonInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#87CEEB",
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: "#333",
    marginBottom: 8,
  },
  textInput: {
    borderWidth: 1,
    borderColor: "#E0E0E0",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: "#333",
    backgroundColor: "#FFF",
  },
  textArea: {
    height: 80,
    textAlignVertical: "top",
  },
  submitButton: {
    backgroundColor: "#87CEEB",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 20,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  submitButtonText: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "600",
  },
  timeDropdownOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  timeDropdownContainer: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    width: width * 0.8,
    maxHeight: 400,
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  timeDropdownHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  timeDropdownTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  timeOptionsList: {
    maxHeight: 300,
  },
  timeOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
  },
  selectedTimeOption: {
    backgroundColor: "#F0F8FF",
  },
  timeOptionText: {
    fontSize: 16,
    color: "#333",
  },
  selectedTimeOptionText: {
    color: "#87CEEB",
    fontWeight: "500",
  },
})

export default ReservationForm
