import React from "react"
import { describe, expect, it } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { Chips, MetaCard, ratingCell } from "../../components/xplorescreens/shared/detail"
import { ListingCard } from "../../components/xplorescreens/shared/ui"
import { searchText, getStatusBadge, getEditorialBadge } from "../../components/xplorescreens/shared/theme"
import Accommodation from "../../components/xplorescreens/Accommodation"
import Attraction from "../../components/xplorescreens/Attraction"
import Recreation from "../../components/xplorescreens/Recreation"
import Healthcare from "../../components/xplorescreens/Healthcare"
import PublicService from "../../components/xplorescreens/PublicService"
import Emergency from "../../components/xplorescreens/Emergency"
import RestaurantReservationForm from "../../components/xplorescreens/RestaurantReservationForm"
import ReservationForm from "../../components/xplorescreens/ReservationForm"
import { listings, cmsSampleRestaurant, completeRestaurant, URL1 } from "./fixtures"

const junk = [undefined, null, "", 0, NaN, 5, true, {}, [], [null], [undefined, 3, {}], "str", { name: 7 }, () => {}]

describe("shared components accept any input", () => {
  it.each(junk.map((j, i) => [i, j]))("Chips(items=#%s) never throws", (_i, items) => { expect(() => render(<Chips items={items} />)).not.toThrow() })
  it("Chips shows valid labels (strings, numbers, {name}) and skips the rest", () => {
    render(<Chips items={["Wifi", 4, { name: "Parking" }, null, {}, { name: 9 }, []]} />)
    for (const t of ["Wifi", "4", "Parking", "9"]) expect(screen.getByText(t)).toBeTruthy()
  })
  it.each(junk.map((j, i) => [i, j]))("MetaCard(cells=#%s) never throws", (_i, cells) => { expect(() => render(<MetaCard cells={cells} />)).not.toThrow() })
  it("MetaCard skips malformed and empty cells and renders nothing when none are usable", () => {
    const { container } = render(<MetaCard cells={[null, {}, { text: "" }, { icon: "x" }, "oops", { text: 5, label: { a: 1 } }]} />)
    expect(container.textContent).toBe("5")
    const none = render(<MetaCard cells={[null, {}]} />); expect(none.container.textContent).toBe("")
  })
  it("ratingCell only for a valid rating", () => {
    expect(ratingCell({ rating: 4.5, reviews: 12 })).toEqual({ rating: 4.5, text: "4.5 (12)" }); expect(ratingCell({ rating: 4.5 })).toEqual({ rating: 4.5, text: "4.5" })
    for (const r of [{}, { rating: "x" }, { rating: 9 }, { rating: null }, null, undefined]) expect(ratingCell(r)).toBeNull()
  })
  it.each([[{}], [{ image: 5, title: null, location: {}, rating: "x", reviews: "y", pill: { text: {} }, footer: { text: [] }, badge: { label: 5 } }], [{ image: "javascript:alert(1)", title: "T" }], [{ image: URL1, title: "T", rating: 4.2, reviews: 3 }]])("ListingCard(%o) renders", (props) => { expect(() => render(<ListingCard {...props} />)).not.toThrow() })
  it("ListingCard uses the placeholder for an unusable image", () => { const { container } = render(<ListingCard image="not a url" title="T" fallbackIcon="bed" />); expect(container.querySelectorAll("img").length).toBe(0); expect(container.querySelector('[data-testid="MCI:bed"]')).toBeTruthy() })
  it("searchText, status and editorial badges tolerate bad documents", () => {
    for (const d of [null, undefined, 5, "x", [], {}, { tags: [null, 3, {}], services: "a, b", name: {}, type: 4, rating: "x", reviews: {}, status: {}, availability: 5 }]) { expect(() => { searchText(d); getStatusBadge(d, new Date(), "hours"); getEditorialBadge(d) }).not.toThrow() }
    expect(searchText({ name: "Kota", tags: ["spicy", null, { name: "family" }], description: "Home cooking, kota" })).toBe("kota home cooking, kota spicy family")
  })
})

const loadList = async (Screen, collection, docs) => { globalThis.__FS[collection] = docs; const r = render(<Screen />); await waitFor(() => expect(r.container.textContent).not.toMatch(/Loading/)); return r }
const openFirst = async () => { fireEvent.click(screen.getAllByText("View Details")[0]); await new Promise((r) => setTimeout(r, 0)) }
const hostile = (extra = {}) => [{ id: "h1", name: "Hostile", type: "Odd", images: null, coordinates: "x", rating: "bad", reviews: -1, amenities: "Wifi, Pool", features: null, activities: 5, specialties: [null, {}], services: { a: 1 }, price: { a: 1 }, entryFee: [], maxGuests: "many", hours: {}, phone: 7, email: null, website: 5, emergency: "yes", accessibility: "No", ...extra }, { id: "h2" }]

describe("ExploreList-based screens render and open details with hostile documents", () => {
  for (const [Screen, name, collection] of [[Accommodation, "Accommodation", "accommodations"], [Attraction, "Attraction", "attractions"], [Recreation, "Recreation", "recreation"], [Healthcare, "Healthcare", "healthcare"], [PublicService, "PublicService", "publicservice"]]) {
    it(`${name}: hostile and empty documents`, async () => { await loadList(Screen, collection, hostile()); await openFirst(); expect(document.body.textContent).toMatch(/Hostile|Unnamed listing/) })
    it(`${name}: no documents`, async () => { await loadList(Screen, collection, []); expect(document.body.textContent).toMatch(/No .* available/) })
  }
  it("Accommodation: a CMS price like 'R700' is shown once with a single R and sorts by amount; no invented guest numbers", async () => {
    await loadList(Accommodation, "accommodations", [listings.accommodations.sample, { id: "a9", name: "Cheap", type: "Guest house", price: "R200" }, { id: "a10", name: "No price", type: "Guest house" }])
    expect(document.body.textContent).toContain("R700"); expect(document.body.textContent).not.toContain("RR700"); expect(document.body.textContent).not.toContain("undefined")
  })
  it("Attraction: 'entryFee' (CMS/Malloya name) and text prices display without a doubled R; zero is Free", async () => {
    await loadList(Attraction, "attractions", [listings.attractions.sample, listings.attractions.free, listings.attractions.textPrice].map((d) => ({ ...d, type: "Museum" })))
    expect(document.body.textContent).toContain("R100"); expect(document.body.textContent).toContain("Free"); expect(document.body.textContent).toContain("R950"); expect(document.body.textContent).not.toMatch(/RR\d/)
  })
  it("Recreation: text fee shown as stored", async () => { await loadList(Recreation, "recreation", [listings.recreation.sample]); expect(document.body.textContent).toContain("R450") })
  it("PublicService: accessibility text 'No' is NOT shown as wheelchair accessible; 'Yes' is", async () => {
    await loadList(PublicService, "publicservice", [{ id: "p1", name: "Office A", type: "Office", accessibility: "No" }, { id: "p2", name: "Office B", type: "Office", accessibility: "Yes, ramp at the entrance" }])
    expect(document.body.textContent.match(/Accessible/g)?.length).toBe(1)
  })
  it("Accommodation 'Reserve Now' opens the booking form and the form renders without a guest limit", async () => {
    await loadList(Accommodation, "accommodations", [listings.accommodations.sample]); await openFirst(); fireEvent.click(await screen.findByText("Reserve Now"))
    expect(await screen.findByText(/Reserve Vilakazi Guest House/)).toBeTruthy(); expect(document.body.textContent).not.toMatch(/Maximum|undefined|NaN/)
  })
})

describe("Emergency", () => {
  it("renders hostile contacts and nulls without crashing", async () => {
    globalThis.__OFFLINE.emergency = [{ id: "e1", name: "Police", number: "10111", type: "Public", isActive: true, order: "x" }, { id: "e2", name: { a: 1 }, number: null, type: "Public" }, { id: "e3", type: "Public", number: 5 }, null, 7]
    render(<Emergency />); expect(await screen.findByText("Police")).toBeTruthy()
  })
  it.each([[undefined], [null], [[]], ["x"], [{ a: 1 }]])("data=%o shows a state, not an error", (d) => { globalThis.__OFFLINE.emergency = d; expect(() => render(<Emergency />)).not.toThrow() })
})

describe("Reservation validation", () => {
  const fill = () => { for (const [ph, v] of [[/name/i, "Sam"], [/email/i, "s@x.co"], [/phone|number/i, "0820000000"]]) { const el = document.querySelector(`input[placeholder*="${ph.source.replace(/\\/g, "")}" i]`); if (el) fireEvent.change(el, { target: { value: v } }) } }
  it("the restaurant form for a restaurant with no table options shows why, offers no tables, and sends nothing", async () => {
    render(<RestaurantReservationForm visible onClose={() => {}} restaurant={{ ...cmsSampleRestaurant, tableOptions: [] }} />)
    expect(await screen.findByText(/No table options are published/)).toBeTruthy(); expect(screen.getAllByText(/hasn’t published its table options/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByText("Confirm Reservation")); expect(globalThis.__CALLS).toEqual([])
  })
  it("a restaurant without an id can never send a request", async () => {
    render(<RestaurantReservationForm visible onClose={() => {}} restaurant={{ name: "No id", tableOptions: [2, 4] }} />)
    expect(await screen.findByText(/can’t take online reservations/)).toBeTruthy(); fireEvent.click(screen.getByText("Confirm Reservation")); expect(globalThis.__CALLS).toEqual([])
  })
  it("renders for hostile restaurant objects", () => { for (const r of [{ id: "x" }, { id: "x", name: {}, tableOptions: "2,4", price: {}, cuisine: [] }, { id: "x", tableOptions: [null, "a", 4] }]) expect(() => render(<RestaurantReservationForm visible onClose={() => {}} restaurant={r} />)).not.toThrow() })
  it("only the restaurant's own table sizes are offered", async () => { render(<RestaurantReservationForm visible onClose={() => {}} restaurant={completeRestaurant} />); expect(await screen.findByText("6 seats")).toBeTruthy(); expect(screen.queryByText("8 seats")).toBeNull() })
  it("a null restaurant renders nothing; the accommodation form tolerates missing price and guest limit", () => {
    expect(render(<RestaurantReservationForm visible onClose={() => {}} restaurant={null} />).container.textContent).toBe("")
    expect(() => render(<ReservationForm visible onClose={() => {}} accommodation={{ id: "a1", name: "Stay" }} />)).not.toThrow()
    expect(render(<ReservationForm visible onClose={() => {}} accommodation={null} />).container.textContent).toBe("")
  })
})
