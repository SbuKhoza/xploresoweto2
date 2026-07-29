import { StyleSheet, Text, View, Image, TouchableOpacity, StatusBar, useWindowDimensions } from 'react-native';
import React, { useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { auth } from '../Firebase/config';

const Splash = ({ navigation }) => {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= 768;

  useEffect(() => {
    const checkAuthStatus = () => {
      const unsubscribe = auth.onAuthStateChanged((user) => {
        if (user) {
          setTimeout(() => {
            navigation.reset({
              index: 0,
              routes: [{ name: 'MainApp' }],
            });
          }, 1500);
        }
      });
      return unsubscribe;
    };

    const unsubscribe = checkAuthStatus();
    return () => unsubscribe();
  }, [navigation]);

  const handleGetStarted = () => {
    navigation.navigate('Authentication');
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F6F6F6" />

      {/* Logo/Brand Section */}
      <View style={[styles.logoSection, isTablet && styles.tabletLogoSection]}>
        <View style={styles.logoContainer}>
          <Ionicons name="compass-outline" size={36} color="#BC5C2E" />
        </View>
        <Text style={styles.appName}>XPLORE SOWETO</Text>
        <Text style={styles.tagline}>Discover the Heart of South Africa</Text>
        <View style={styles.decorativeLine} />
      </View>

      {/* Featured Image */}
      <View
        style={[
          styles.imageContainer,
          isTablet && { 
            height: Math.round(height * 0.45), 
            marginBottom: 12,
            marginHorizontal: 32 
          },
        ]}
      >
        <Image
          source={require('../assets/Sowetotrip.png')}
          style={[
            styles.featuredImage,
            isTablet ? styles.tabletImage : styles.mobileImage,
          ]}
          resizeMode={isTablet ? 'contain' : 'cover'}
        />

        <LinearGradient
          colors={['transparent', '#fff']}
          style={[
            styles.gradient,
            isTablet ? { height: 120 } : { height: 80 },
          ]}
        />

        <View style={styles.imageOverlay}>
          <View style={styles.overlayContent}>
            <Text style={styles.overlayTitle}>The Ultimate Guide to Soweto</Text>
            <Text style={styles.overlaySubtitle}>
              Explore townships, culture, and hidden gems
            </Text>
          </View>
        </View>
      </View>

      {/* Bottom Section */}
      <View style={[styles.bottomSection, isTablet && styles.tabletBottomSection]}>
        <View
          style={[
            styles.contentWrapper,
            isTablet && styles.tabletContentWrapper,
          ]}
        >
          <View style={[styles.textButtonContainer, isTablet && styles.tabletTextButtonContainer]}>
            <Text style={[styles.welcomeText, isTablet && styles.tabletWelcomeText]}>
              Welcome to Soweto
            </Text>

            <TouchableOpacity
              style={[styles.getStartedButton, isTablet && styles.tabletGetStartedButton]}
              onPress={handleGetStarted}
              activeOpacity={0.9}
            >
              <Text style={[styles.getStartedText, isTablet && styles.tabletGetStartedText]}>
                Get Started
              </Text>
              <Ionicons name="arrow-forward" size={18} color="white" style={styles.buttonIcon} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.footerText, isTablet && styles.tabletFooterText]}>
            Your adventure begins here
          </Text>
        </View>
      </View>
    </View>
  );
};

export default Splash;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F6F6F6',
  },
  logoSection: {
    alignItems: 'center',
    paddingTop: 40,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  tabletLogoSection: {
    paddingTop: 50,
    paddingBottom: 25,
  },
  logoContainer: {
    width: 70,
    height: 70,
    borderRadius: 18,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#BC5C2E',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  appName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#BC5C2E',
    marginBottom: 4,
    letterSpacing: 1.2,
    textAlign: 'center',
  },
  tagline: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    fontWeight: '500',
    marginBottom: 12,
  },
  decorativeLine: {
    width: 50,
    height: 2,
    backgroundColor: '#BC5C2E',
    borderRadius: 1,
  },

  imageContainer: {
    marginHorizontal: 20,
    height: '50%',
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 8,
    backgroundColor: '#fff',
  },
  featuredImage: {
    width: '100%',
    height: '100%',
  },
  mobileImage: {
    // keep compact on phones
  },
  tabletImage: {
    alignSelf: 'center',
  },

  gradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },

  imageOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  overlayContent: {
    alignItems: 'flex-start',
  },
  overlayTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 3,
    lineHeight: 20,
  },
  overlaySubtitle: {
    fontSize: 12,
    color: '#ECCCAF',
    lineHeight: 16,
  },

  bottomSection: {
    flex: 1,
    backgroundColor: 'white',
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    paddingTop: 10,
    paddingBottom: 10,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -2,
    },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 10,
  },
  tabletBottomSection: {
    // Reduce flex on tablet to prevent excessive white space
    flex: 0,
    minHeight: 180,
    paddingTop: 20,
    paddingBottom: 25,
  },

  contentWrapper: {
    paddingHorizontal: 10,
    alignItems: 'center',
    flex: 1,
    justifyContent: 'space-between',
  },
  tabletContentWrapper: {
    flex: 0,
    justifyContent: 'flex-start',
    paddingHorizontal: 32,
  },

  // New container to group text and button
  textButtonContainer: {
    alignItems: 'center',
    width: '100%',
  },
  tabletTextButtonContainer: {
    marginBottom: 20,
  },

  welcomeText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginTop: 30,
    marginBottom: 0,
    lineHeight: 26,
  },
  tabletWelcomeText: {
    marginTop: 0,
    marginBottom: 25,
    fontSize: 24,
  },

  getStartedButton: {
    backgroundColor: '#BC5C2E',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#BC5C2E',
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
    minWidth: 180,
  },
  tabletGetStartedButton: {
    minWidth: 240,
    paddingVertical: 16,
    paddingHorizontal: 40,
    marginBottom: 0,
  },
  getStartedText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
    marginRight: 6,
  },
  tabletGetStartedText: {
    fontSize: 18,
  },
  buttonIcon: {
    marginLeft: 3,
  },
  footerText: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  tabletFooterText: {
    fontSize: 13,
    marginTop: 0,
  },
});