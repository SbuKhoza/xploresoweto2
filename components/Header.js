import { Text, View, TouchableOpacity, Animated, TextInput, BackHandler, Keyboard, Easing } from 'react-native';
import React, { useState, useRef, useCallback } from 'react';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

const TEAL = '#1B4D5C';
const MUTED = '#7A8A8F';
const SEARCH_PANEL_HEIGHT = 54;

// Soft shadow shared by the round buttons and the search pill
const softShadow = {
  shadowColor: TEAL,
  shadowOffset: { width: 0, height: 3 },
  shadowOpacity: 0.1,
  shadowRadius: 8,
  elevation: 2,
};

// Round white icon button used on both sides of the header
const IconButton = ({ icon, onPress, label, active = false }) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={0.7}
    accessibilityRole="button"
    accessibilityLabel={label}
    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
    className={`w-[38px] h-[38px] rounded-full justify-center items-center ${active ? 'bg-teal-light' : 'bg-surface'}`}
    style={softShadow}
  >
    <Ionicons name={icon} size={19} color={TEAL} />
  </TouchableOpacity>
);

/**
 * Props
 *  - title:           screen title (falls back to a readable version of the route name)
 *  - subtitle:        optional small line under the title
 *  - onSearchChange:  optional (text) => void, called as the user types in the search panel
 */
const Header = ({ title, subtitle, onSearchChange }) => {
  const navigation = useNavigation();
  const route = useRoute();
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [query, setQuery] = useState('');
  const slideAnimation = useRef(new Animated.Value(0)).current;
  const inputRef = useRef(null);

  const toggleSearch = () => {
    const opening = !isSearchVisible;
    setIsSearchVisible(opening);

    if (!opening) {
      Keyboard.dismiss();
      setQuery('');
      onSearchChange?.('');
    }

    Animated.timing(slideAnimation, {
      toValue: opening ? 1 : 0,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // animating height
    }).start(() => {
      if (opening) inputRef.current?.focus();
    });
  };

  const handleQueryChange = (text) => {
    setQuery(text);
    onSearchChange?.(text);
  };

  const searchPanelHeight = slideAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SEARCH_PANEL_HEIGHT],
  });

  // Make route.name readable if no custom title was passed
  const formatRouteName = (name) => {
    if (!name) return '';
    return name.replace(/([A-Z])/g, ' $1').trim(); // "PoIst" -> "Po Ist"
  };

  const headerTitle = typeof title === 'string' ? title : formatRouteName(route.name);

  // Screens opened from the Home screen (quick access, search, shortcuts) are
  // tagged with `from: "Home"`. Back always returns there, no matter what else
  // is still sitting in this tab's stack from earlier visits. Everything else
  // keeps the normal back behaviour.
  const handleBack = () => {
    if (route.params?.from === 'Home') {
      navigation.navigate('Home');
    } else if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('Home');
    }
  };

  // Same rule for the Android hardware / gesture back button.
  const openedFromHome = route.params?.from === 'Home';
  useFocusEffect(
    useCallback(() => {
      if (!openedFromHome) return undefined;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        navigation.navigate('Home');
        return true;
      });
      return () => subscription.remove();
    }, [navigation, openedFromHome])
  );

  return (
    <View className="pb-1">
      {/* ── Bar ── */}
      <View className="flex-row items-center justify-between px-4 py-2">
        <IconButton icon="arrow-back" label="Go back" onPress={handleBack} />

        {/* Title is centred on the screen, independent of the buttons' widths */}
        <View pointerEvents="none" className="absolute left-0 right-0 items-center px-[76px]">
          <Text className="text-[17px] font-extrabold text-ink -tracking-[0.3px]" numberOfLines={1}>
            {headerTitle}
          </Text>
          {subtitle ? (
            <Text className="text-[11px] text-muted mt-px" numberOfLines={1}>{subtitle}</Text>
          ) : null}
        </View>

        <View className="flex-row items-center gap-2">
          <IconButton
            icon={isSearchVisible ? 'close' : 'search'}
            label={isSearchVisible ? 'Close search' : 'Search'}
            active={isSearchVisible}
            onPress={toggleSearch}
          />
          <IconButton icon="notifications-outline" label="Notifications" />
        </View>
      </View>

      {/* ── Expanding search panel ── */}
      <Animated.View style={{ height: searchPanelHeight, opacity: slideAnimation, overflow: 'hidden' }}>
        <View className="px-4 pb-2 pt-0.5">
          <View
            className="flex-row items-center h-[42px] rounded-full bg-surface px-3.5 border border-line"
            style={softShadow}
          >
            <Ionicons name="search" size={17} color={MUTED} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={handleQueryChange}
              placeholder={`Search ${headerTitle ? headerTitle.toLowerCase() : ''}…`}
              placeholderTextColor="#9AA9AE"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              className="flex-1 ml-2.5 text-[14px] text-ink"
              style={{ paddingVertical: 0 }}
            />
            {query.length > 0 && (
              <TouchableOpacity
                onPress={() => handleQueryChange('')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={18} color="#B5BDBF" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Animated.View>
    </View>
  );
};

export default Header;