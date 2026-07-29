import { StyleSheet, Text, View, ScrollView } from 'react-native';
import React from 'react';

const Home = () => {
  return (
    <ScrollView style={styles.homeContainer} contentContainerStyle={styles.scrollContent}>
      <View style={styles.greeting}>
        <View style={styles.greetingText}>
          <Text style={styles.title}>Hello, User!</Text>
        </View>

        <View style={styles.notification}></View>
      </View>

      <View style={styles.quickLinks}></View>

      <View style={styles.searchBar}></View>

      <View style={styles.description}>
        <Text style={styles.subtitle}>The Ultimate Guide to Soweto</Text>
      </View>

      <View style={styles.events}></View>

      <View style={styles.homeContent}>
        <View style={styles.news}></View>
        <
        <View style={styles.alerts}></View>
        <View style={styles.community}>

        </View>
      </View>
    </ScrollView>
  );
};

export default Home;

const styles = StyleSheet.create({
  homeContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  greeting: {
    alignItems: 'center',
    marginBottom: 20,
  },
  greetingText: {
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 18,
    textAlign: 'center',
  },
  notification: {
    marginTop: 10,
  },
  quickLinks: {
    marginTop: 10,
  },
  searchBar: {
    marginTop: 10,
    width: '90%',
    height: 40,
    backgroundColor: '#f0f0f0',
  },
  description: {
    marginTop: 10,
    paddingHorizontal: 20,
  },
  events: {
    marginTop: 10,
    width: '90%',
    height: 160,
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
  },
  homeContent: {
    display: 'flex',
    flexDirection: 'row',
    alignContent: 'center',
    marginTop: 10,
    width: '90%',
    heigt: 400,
  },
  news: {
    marginTop: 10,
    width: '45%',
    height: 208,
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
  },
  alerts: {
    marginTop: 10,
    marginLeft:10,
    width: 190,
    height: 100,
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
  },
  community: {
    marginTop: 10,
    width: 190,
    height: 100,
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
  },
});
