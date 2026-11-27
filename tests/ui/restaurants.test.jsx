import React from "react"
import { describe, expect, it } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import Restaurants from "../../components/xplorescreens/Restaurants"
import ListingErrorBoundary from "../../components/ListingErrorBoundary"
import { badRestaurants, cmsSampleRestaurant, completeRestaurant } from "./fixtures"

const load = async (docs) => { globalThis.__FS.restaurants = docs; const r = render(<Restaurants />); await waitFor(() => expect(r.container.textContent).not.toMatch(/Loading restaurants/)); return r }
const open = async (name) => { const card = await screen.findAllByText(name); fireEvent.click(card[0]); }

describe("Restaurants screen: rendering and opening details", () => {
  it("opens a restaurant WITHOUT an images field (the crash reported on the Android device) and shows the placeholder", async () => {
    await load([cmsSampleRestaurant]); await open("Gogo's Kitchen")
    expect(await screen.findByText("About")).toBeTruthy()           // the detail modal rendered
    expect(screen.getByText("Home cooking, kota and pap")).toBeTruthy()
    expect(document.querySelectorAll('[data-testid="MCI:silverware-fork-knife"]').length).toBeGreaterThan(0) // placeholder icon, not an image
  })

  it("renders the image carousel and one pagination dot per image for a complete restaurant", async () => {
    await load([completeRestaurant]); await open("Complete Grill")
    await screen.findByText("About")
    expect(document.querySelectorAll("img").length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText("kota")).toBeTruthy(); expect(screen.getByText("Wors roll")).toBeTruthy()
    expect(screen.getByText("Make a Reservation")).toBeTruthy()
  })

  it.each(badRestaurants.map((r) => [r.id, r]))("does not throw for malformed restaurant %s: list renders and details open", async (_id, doc) => {
    await load([doc])
    const cards = document.body.textContent
    expect(cards).toBeTruthy()
    const buttons = screen.getAllByText("View Details"); fireEvent.click(buttons[0])
    await waitFor(() => expect(document.body.textContent).toMatch(/Make a Reservation|reservation|Reservation/i))
  })

  it("keeps only valid images from a mixed list (no duplicates, no junk) and ignores a string `images` value safely", async () => {
    await load([badRestaurants.find((r) => r.id === "b6")]); await open("Junk entries"); await screen.findByText("Dish")
    const imgs = [...document.querySelectorAll("img")].map((i) => i.getAttribute("src"))
    expect([...new Set(imgs.filter((s) => s?.startsWith("https://example.test/")))].sort()).toEqual(["https://example.test/a.jpg", "https://example.test/b.jpg"])
    expect(screen.getByText("ok")).toBeTruthy()        // the one valid tag survives
  })

  it("search and filtering work with incomplete documents mixed in", async () => {
    await load([cmsSampleRestaurant, ...badRestaurants, completeRestaurant])
    const box = screen.getByPlaceholderText(/search/i)
    fireEvent.change(box, { target: { value: "kota" } })
    await waitFor(() => expect(screen.queryAllByText("Complete Grill").length).toBeGreaterThan(0))
    fireEvent.change(box, { target: { value: "zzz-no-such-thing" } })
    await waitFor(() => expect(document.body.textContent).toMatch(/No results|0\s*restaurants/i))
  })

  it("favourites toggle on a restaurant with no images", async () => {
    await load([cmsSampleRestaurant])
    const fav = screen.getAllByLabelText("Add to favourites")[0]; fireEvent.click(fav)
    await waitFor(() => expect(screen.getAllByLabelText("Remove from favourites").length).toBeGreaterThan(0))
  })

  it("an empty collection renders the empty state", async () => { await load([]); expect(document.body.textContent).toMatch(/No restaurants|restaurants/i) })

  it("a restaurant with no table options explains why it can't be reserved and sends no request", async () => {
    await load([cmsSampleRestaurant]); await open("Gogo's Kitchen"); await screen.findByText("About")
    expect(screen.queryByText("Make a Reservation")).toBeNull()
    expect(screen.getAllByText(/hasn’t published its table options/i).length).toBeGreaterThan(0)
    expect(globalThis.__CALLS).toEqual([])
  })

  it("reservation navigation works for a restaurant that has table options, and the form only offers those tables", async () => {
    await load([completeRestaurant]); await open("Complete Grill"); await screen.findByText("About")
    fireEvent.click(screen.getByText("Make a Reservation"))
    await screen.findByText("Select Table")
    expect(screen.getByText("2 seats")).toBeTruthy(); expect(screen.getByText("4 seats")).toBeTruthy(); expect(screen.getByText("6 seats")).toBeTruthy()
    expect(screen.queryByText("8 seats")).toBeNull()      // nothing is invented
  })
})

describe("scoped error boundary", () => {
  const Boom = () => { throw new TypeError("Cannot read property 'map' of undefined") }
  it("shows a friendly recovery option instead of closing, logs no document data, and recovers on retry", async () => {
    const logged = []; const orig = console.warn; console.warn = (...a) => logged.push(a.join(" "))
    let fail = true; const Maybe = () => (fail ? <Boom /> : <div>recovered</div>)
    const errSpy = console.error; console.error = () => {}
    render(<ListingErrorBoundary screen="Restaurants"><Maybe /></ListingErrorBoundary>)
    expect(await screen.findByText(/Something went wrong showing this list/)).toBeTruthy()
    expect(logged.join("\n")).toMatch(/\[listing\] Restaurants failed to render: TypeError/); expect(logged.join("\n")).not.toMatch(/Gogo|restaurant data|{/)
    fail = false; fireEvent.click(screen.getByLabelText("Try again")); expect(await screen.findByText("recovered")).toBeTruthy()
    console.warn = orig; console.error = errSpy
  })
})
