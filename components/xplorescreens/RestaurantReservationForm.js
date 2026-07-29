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

    // Restaurant hours (assuming 11:00 - 22:00)
    const openingHour = 11
    const closingHour = 22

    for (let hour = openingHour; hour < closingHour; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        // For today, only show times from current time onwards
        const isToday = reservationDate.toDateString() === now.toDateString()
        if (isToday && (hour < currentHour || (hour === currentHour && minute <= currentMinute))) {
          continue
        }

        const timeString = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`
        times.push(timeString)
      }
    }
    return times
  }

  useEffect(() => {
    // Set default time to 19:00 or next available time slot if today
    const now = new Date()
    const isToday = reservationDate.toDateString() === now.toDateString()

    if (isToday) {
      const currentHour = now.getHours()
      const currentMinute = now.getMinutes()

      // If current time is before 19:00, set default to 19:00
      if (currentHour < 19) {
        setReservationTimeString("19:00")
      } else {
        // Set to next available 30-minute slot
        const roundedMinute = currentMinute <= 30 ? 30 : 0
        const adjustedHour = currentMinute > 30 ? currentHour + 1 : currentHour

        if (adjustedHour < 22) {
          // Assuming restaurant closes at 22:00
          setReservationTimeString(
            `${adjustedHour.toString().padStart(2, "0")}:${roundedMinute.toString().padStart(2, "0")}`,
          )
        } else {
          // If after closing time, set to first slot next day
          setReservationTimeString("11:00")
          const tomorrow = new Date(now)
          tomorrow.setDate(tomorrow.getDate() + 1)
          setReservationDate(tomorrow)
        }
      }
    } else {
      // For future dates, default to 19:00
      setReservationTimeString("19:00")
    }
  }, [reservationDate])

  const formatDate = (date) => {
    return date.toLocaleDateString("en-ZA", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  const handleSubmitReservation = () => {
    if (!guestName.trim() || !guestEmail.trim() || !guestPhone.trim() || !selectedTable) {
      Alert.alert("Error", "Please fill in all required fields and select a table")
      return
    }

    const selectedOccasion = occasionOptions.find((option) => option.value === occasion)

    const reservationData = {
      restaurant: restaurant?.name,
      date: formatDate(reservationDate),
      time: reservationTimeString,
      guests,
      table: selectedTable,
      guestName,
      guestEmail,
      guestPhone,
      occasion: selectedOccasion.label,
      specialRequests,
    }

    Alert.alert(
      "Reservation Submitted",
      `Thank you ${guestName}! Your reservation at ${restaurant?.name} for ${formatDate(reservationDate)} at ${reservationTimeString} has been submitted. You will receive a confirmation email shortly.`,
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
            setGuests(2)
            setOccasion("none")
            setSelectedTable(null)
          },
        },
      ],
    )
  }

  const onDateChange = (event, selectedDate) => {
    setShowDatePicker(false)
    if (selectedDate) {
      setReservationDate(selectedDate)
    }
  }

  const renderTimeDropdown = () => {
    const timeOptions = generateTimeOptions()

    if (!showTimeDropdown) return null

    return (
      <Modal transparent={true} visible={showTimeDropdown} onRequestClose={() => setShowTimeDropdown(false)}>
        <TouchableOpacity style={styles.timeDropdownOverlay} onPress={() => setShowTimeDropdown(false)}>
          <View style={styles.timeDropdownContainer}>
            <View style={styles.timeDropdownHeader}>
              <Text style={styles.timeDropdownTitle}>Select Time</Text>
              <TouchableOpacity onPress={() => setShowTimeDropdown(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={timeOptions}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.timeOption, reservationTimeString === item && styles.selectedTimeOption]}
                  onPress={() => {
                    setReservationTimeString(item)
                    setShowTimeDropdown(false)
                  }}
                >
                  <Text
                    style={[styles.timeOptionText, reservationTimeString === item && styles.selectedTimeOptionText]}
                  >
                    {item}
                  </Text>
                  {reservationTimeString === item && <Ionicons name="checkmark" size={20} color="#FF6B6B" />}
                </TouchableOpacity>
              )}
              style={styles.timeOptionsList}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    )
  }

  if (!restaurant) return null

  return (
    <Modal animationType="slide" transparent={false} visible={visible} onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Ionicons name="close" size={24} color="#000" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Reserve at {restaurant.name}</Text>
          <View style={styles.placeholder} />
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Restaurant Summary */}
          <View style={styles.summaryCard}>
            <Text style={styles.restaurantName}>{restaurant.name}</Text>
            <Text style={styles.restaurantLocation}>{restaurant.location}</Text>
            <Text style={styles.cuisineText}>
              {restaurant.cuisine} • {restaurant.price}
            </Text>
          </View>

          {/* Date & Time Selection */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Date & Time</Text>

            <View style={styles.dateTimeRow}>
              <View style={styles.dateTimeItem}>
                <Text style={styles.label}>Date</Text>
                <TouchableOpacity style={styles.dateTimeButton} onPress={() => setShowDatePicker(true)}>
                  <Ionicons name="calendar-outline" size={20} color="#666" />
                  <Text style={styles.dateTimeText}>{formatDate(reservationDate)}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.dateTimeItem}>
                <Text style={styles.label}>Time</Text>
                <TouchableOpacity style={styles.dateTimeButton} onPress={() => setShowTimeDropdown(true)}>
                  <Ionicons name="time-outline" size={20} color="#666" />
                  <Text style={styles.dateTimeText}>{reservationTimeString}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Party Size & Table Selection */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Party Size & Table</Text>

            <Text style={styles.label}>Number of Guests</Text>
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
                style={[styles.counterButton, guests >= 10 && styles.counterButtonDisabled]}
                onPress={() => guests < 10 && setGuests(guests + 1)}
                disabled={guests >= 10}
              >
                <Ionicons name="add" size={20} color={guests >= 10 ? "#ccc" : "#666"} />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Select Table</Text>
            <View style={styles.tableOptions}>
              {restaurant.tableOptions.map((size) => (
                <TouchableOpacity
                  key={size}
                  style={[
                    styles.tableOption,
                    selectedTable === size && styles.selectedTableOption,
                    guests > size && styles.disabledTableOption,
                  ]}
                  onPress={() => guests <= size && setSelectedTable(size)}
                  disabled={guests > size}
                >
                  <Ionicons
                    name="people"
                    size={20}
                    color={guests > size ? "#ccc" : selectedTable === size ? "#FFF" : "#666"}
                  />
                  <Text
                    style={[
                      styles.tableOptionText,
                      guests > size && styles.disabledTableOptionText,
                      selectedTable === size && styles.selectedTableOptionText,
                    ]}
                  >
                    Table for {size}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Occasion Selection */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Occasion</Text>
            <View style={styles.occasionOptions}>
              {occasionOptions.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.occasionOption, occasion === option.value && styles.selectedOccasionOption]}
                  onPress={() => setOccasion(option.value)}
                >
                  <View style={styles.occasionOptionContent}>
                    <Text
                      style={[
                        styles.occasionOptionLabel,
                        occasion === option.value && styles.selectedOccasionOptionLabel,
                      ]}
                    >
                      {option.label}
                    </Text>
                    <View style={[styles.radioButton, occasion === option.value && styles.selectedRadioButton]}>
                      {occasion === option.value && <View style={styles.radioButtonInner} />}
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
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
                placeholder="Dietary restrictions, allergies, special occasions..."
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

        {/* Date Picker */}
        {showDatePicker && (
          <DateTimePicker
            value={reservationDate}
            mode="date"
            display="default"
            minimumDate={new Date()}
            onChange={onDateChange}
          />
        )}

        {/* Time Dropdown */}
        {renderTimeDropdown()}
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
  restaurantName: {
    fontSize: 20,
    fontWeight: "700",
    color: "#333",
    marginBottom: 4,
  },
  restaurantLocation: {
    fontSize: 16,
    color: "#666",
    marginBottom: 8,
  },
  cuisineText: {
    fontSize: 16,
    color: "#FF6B6B",
    fontWeight: "500",
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
    marginBottom: 16,
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
  tableOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 8,
  },
  tableOption: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    backgroundColor: "#F8F9FA",
    marginRight: 8,
    marginBottom: 8,
  },
  selectedTableOption: {
    backgroundColor: "#FF6B6B",
    borderColor: "#FF6B6B",
  },
  disabledTableOption: {
    backgroundColor: "#F0F0F0",
    borderColor: "#D0D0D0",
  },
  tableOptionText: {
    fontSize: 14,
    color: "#333",
    marginLeft: 8,
  },
  selectedTableOptionText: {
    color: "#FFF",
    fontWeight: "500",
  },
  disabledTableOptionText: {
    color: "#999",
  },
  occasionOptions: {
    marginBottom: 8,
  },
  occasionOption: {
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    marginBottom: 12,
    backgroundColor: "#F8F9FA",
  },
  selectedOccasionOption: {
    borderColor: "#FF6B6B",
    backgroundColor: "#FFF0F0",
  },
  occasionOptionContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  occasionOptionLabel: {
    fontSize: 16,
    fontWeight: "500",
    color: "#333",
  },
  selectedOccasionOptionLabel: {
    color: "#FF6B6B",
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
    borderColor: "#FF6B6B",
  },
  radioButtonInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#FF6B6B",
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
    backgroundColor: "#FF6B6B",
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
    backgroundColor: "#FFF0F0",
  },
  timeOptionText: {
    fontSize: 16,
    color: "#333",
  },
  selectedTimeOptionText: {
    color: "#FF6B6B",
    fontWeight: "500",
  },
})

export default RestaurantReservationForm
