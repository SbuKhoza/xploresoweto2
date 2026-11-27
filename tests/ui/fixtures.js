// Documents as the different writers actually produce them. IDs are included, as the app adds them.
export const URL1 = "https://example.test/a.jpg"
export const URL2 = "https://example.test/b.jpg"

// The CMS sample restaurants (and the Malloya test fixture): NO images, NO tags, NO tableOptions.
export const cmsSampleRestaurant = { id: "r1", name: "Gogo's Kitchen", description: "Home cooking, kota and pap", location: "Vilakazi Street, Orlando West", cuisine: "Traditional", price: "R80 - R150", openingHours: "08:00 - 17:00", rating: 4.6, reviews: 40, isActive: true, type: "Traditional", coordinates: { latitude: -26.2385, longitude: 27.9065 } }
export const completeRestaurant = { id: "r2", name: "Complete Grill", description: "Everything present", location: "Diepkloof", cuisine: "Braai", price: "R120", type: "Braai", openingHours: "09:00 - 22:00", rating: 4.8, reviews: 120, images: [URL1, URL2], tags: ["kota", "family"], specialDishes: ["Wors roll"], tableOptions: [2, 4, 6], coordinates: { latitude: -26.25, longitude: 27.92 }, availability: "Available", isActive: true }

// Wrong shapes for the fields that used to crash
export const badRestaurants = [
  { id: "b1", name: "Null images", type: "Cafe", images: null, tags: null, specialDishes: null, tableOptions: null, coordinates: null },
  { id: "b2", name: "Empty images", type: "Cafe", images: [], tags: [], specialDishes: [], tableOptions: [] },
  { id: "b3", name: "CMS default images", type: "Cafe", images: [""], tags: [""], specialDishes: [""], tableOptions: [] },
  { id: "b4", name: "String images", type: "Cafe", images: URL1, tags: "kota, family", specialDishes: "pap", tableOptions: "2,4" },
  { id: "b5", name: "Object images", type: "Cafe", images: { 0: URL1 }, tags: { a: 1 }, specialDishes: 5, tableOptions: { a: 1 } },
  { id: "b6", name: "Junk entries", type: "Cafe", images: [null, 7, {}, "not a url", { url: URL2 }, URL1, URL1], tags: [null, 3, { name: "ok" }, {}], specialDishes: [null, [], "Dish"], tableOptions: [0, -2, "x", 4, 4, 2.5, null, "6"] },
  { id: "b7", name: "Bad numbers", type: "Cafe", rating: "abc", reviews: -5, coordinates: { latitude: "x", longitude: null } },
  { id: "b8", name: "Bad coordinates", type: "Cafe", coordinates: "-26.2,27.9" },
  { id: "b9", name: { first: "obj" }, description: { text: "obj" }, location: 12, cuisine: ["a"], type: { a: 1 }, openingHours: { mon: "9-5" }, price: { a: 1 }, availability: 4 },
  { id: "b10" },
]

export const business = {
  complete: { id: "bz1", name: "Craft Market", type: "Market", description: "Local crafts", phone: "0110000000", email: "a@b.co", location: "Maponya", hours: "09:00 - 17:00", images: [URL1, URL2], services: [{ name: "Beadwork", icon: "x" }, "Painting"], coordinates: { latitude: -26.2, longitude: 27.9 }, gallery: { images: [URL2, "https://example.test/c.jpg"] }, rating: 4.2, reviews: 10 },
  cmsSample: { id: "bz2", name: "Soweto Craft Market", description: "Local crafts and art", type: "Market", isActive: true, location: "Maponya" },
  bad: [
    { id: "bz3", name: "Null", type: "Market", images: null, services: null, gallery: null },
    { id: "bz4", name: "Wrong", type: "Market", images: "x", services: "Haircuts, Braids", gallery: { images: "nope" } },
    { id: "bz5", name: "Junk services", type: "Market", images: [""], services: [null, 4, {}, { icon: "only" }, { name: "Real", price: "R50" }, "Plain"] },
    { id: "bz6", name: "Objects", type: "Market", description: { a: 1 }, phone: 0, email: [], location: {}, images: { a: 1 }, services: { a: 1 } },
  ],
}

export const routes = {
  complete: { id: "t1", routeName: "Orlando - CBD", mode: "bus", operator: "Metrobus", status: "On Time", origin: "A", destination: "B", frequency: "Every 15 min", fare: "R14.50", departures: ["05:00", "05:20", "05:40", "06:00", "06:20"], stops: ["A", "M", "B"], isActive: true },
  noMode: { id: "t2", routeName: "Mystery route", operator: "Someone", origin: "A", destination: "B", isActive: true },
  bad: [
    { id: "t3", routeName: "Null lists", mode: "train", departures: null, stops: null, isActive: true },
    { id: "t4", routeName: "String lists", mode: "taxi", departures: "05:00, 06:00", stops: "A, B", isActive: true },
    { id: "t5", routeName: "Junk lists", mode: "bus", departures: [null, 5, { time: "07:00" }, {}, "08:00"], stops: [null, { name: "S1" }, {}, "S2"], isActive: true },
    { id: "t6", routeName: "Weird mode", mode: { a: 1 }, status: { a: 1 }, operator: 7, fare: null, isActive: true },
    { id: "t7", routeName: "Mode case", mode: "  TRAIN ", isActive: true },
  ],
}

export const listings = {
  accommodations: { complete: { id: "a1", name: "Guest House", type: "Guest house", price: "R700", maxGuests: 4, rating: 4.2, reviews: 12, amenities: ["Wifi", "Parking"], images: [URL1], location: "Orlando West", coordinates: { latitude: -26.2, longitude: 27.9 } },
    sample: { id: "a2", name: "Vilakazi Guest House", type: "Guest house", price: "R700", priceNum: 700, isActive: true, location: "Orlando West", rating: 4.2, reviews: 12 } },
  attractions: { sample: { id: "at1", name: "Mandela House", type: "Museum", entryFee: "R100", openingHours: "09:00 - 17:00", rating: 4.5, reviews: 80 }, free: { id: "at2", name: "Free Walk", type: "Tour", price: 0 }, textPrice: { id: "at3", name: "Tour", type: "Tour", price: "R950" } },
  recreation: { sample: { id: "rc1", name: "Bungee", type: "Adventure", price: "R450", duration: "2 hours" } },
}
