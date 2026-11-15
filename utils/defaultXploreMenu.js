// Built-in Xplore categories, used ONLY while the `xplore-menu` collection has no active documents (for example a brand-new,
// empty database). They are navigation shortcuts to screens that already exist in the app, not content: no businesses,
// listings or sample data. Once the CMS publishes xplore-menu documents they take over completely.
export const DEFAULT_XPLORE_MENU = Object.freeze([
  { id: "default-accommodation", title: "Accommodation", description: "Places to stay in Soweto", screen: "Accommodation", icon: "hotel", iconType: "MaterialIcons", order: 1 },
  { id: "default-restaurants", title: "Restaurants", description: "Where to eat and drink", screen: "Restaurants", icon: "restaurant", iconType: "MaterialIcons", order: 2 },
  { id: "default-attractions", title: "Attractions", description: "Sights and landmarks", screen: "Attraction", icon: "place", iconType: "MaterialIcons", order: 3 },
  { id: "default-recreation", title: "Recreation", description: "Sport and things to do", screen: "Recreation", icon: "sports-soccer", iconType: "MaterialIcons", order: 4 },
  { id: "default-business", title: "Businesses", description: "Local businesses and services", screen: "Business", icon: "store", iconType: "MaterialIcons", order: 5 },
  { id: "default-transport", title: "Transport", description: "Getting around", screen: "Transport", icon: "directions-bus", iconType: "MaterialIcons", order: 6 },
  { id: "default-healthcare", title: "Healthcare", description: "Clinics and hospitals", screen: "Healthcare", icon: "local-hospital", iconType: "MaterialIcons", order: 7 },
  { id: "default-emergency", title: "Emergency", description: "Emergency contacts", screen: "Emergency", icon: "warning", iconType: "MaterialIcons", order: 8 },
  { id: "default-publicservice", title: "Public Services", description: "Government and municipal services", screen: "PublicService", icon: "account-balance", iconType: "MaterialIcons", order: 9 },
  { id: "default-townships", title: "Soweto Townships", description: "Explore the townships", screen: "SowetoTownships", icon: "map", iconType: "MaterialIcons", order: 10 },
])
