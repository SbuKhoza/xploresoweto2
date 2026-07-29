import { StyleSheet, Text, View, TouchableOpacity, Animated, TextInput } from 'react-native';
import React, { useState, useRef } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

const Header = ({ title }) => {
  const navigation = useNavigation();
  const route = useRoute();
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const slideAnimation = useRef(new Animated.Value(0)).current;

  const toggleSearch = () => {
    const toValue = isSearchVisible ? 0 : 1;

    Animated.timing(slideAnimation, {
      toValue,
      duration: 300,
      useNativeDriver: false,
    }).start();

    setIsSearchVisible(!isSearchVisible);
  };

  const searchBarHeight = slideAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 50],
  });

  // ✅ Helper: make route.name readable if no custom title
  const formatRouteName = (name) => {
    if (!name) return "";
    return name.replace(/([A-Z])/g, " $1").trim(); // turns "PoIst" → "Po Ist"
  };

  const headerTitle = typeof title === "string" ? title : formatRouteName(route.name);

  return (
    <>
      <View style={styles.headerContainer}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>

        {/* ✅ Always safe text */}
        <Text style={styles.headerTitle}>{headerTitle}</Text>

        <View style={styles.rightIcons}>
          <TouchableOpacity 
            style={styles.iconButton} 
            onPress={toggleSearch}
          >
            <Ionicons name="search" size={24} color="#000" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.iconButton}>
            <Ionicons name="notifications" size={24} color="#000" />
          </TouchableOpacity>
        </View>
      </View>

      <Animated.View style={[styles.searchBarContainer, { height: searchBarHeight }]}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search..."
          autoCapitalize="none"
          autoCorrect={false}
        />
      </Animated.View>
    </>
  );
};

export default Header;

const styles = StyleSheet.create({
  headerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 60,
    marginBottom: 10,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    flex: 1,
    textAlign: 'center',
  },
  rightIcons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    padding: 8,
    marginLeft: 8,
  },
  searchBarContainer: {
    width: '100%',
    backgroundColor: '#f5f5f5',
    overflow: 'hidden',
  },
  searchInput: {
    flex: 1,
    padding: 10,
    backgroundColor: '#fff',
    borderRadius: 8,
    marginHorizontal: 16,
    marginVertical: 8,
  },
});
