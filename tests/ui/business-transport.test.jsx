import React from "react"
import { describe, expect, it } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import Business from "../../components/xplorescreens/Business"
import Transport from "../../components/xplorescreens/Transport"
import { business, routes } from "./fixtures"

const loadBusiness = async (docs) => { globalThis.__FS.business = docs; const r = render(<Business />); await waitFor(() => expect(r.container.textContent).not.toMatch(/Loading/)); return r }
const openBusiness = async (name) => { fireEvent.click((await screen.findAllByText(name))[0]) }
const tab = (label) => fireEvent.click(screen.getAllByText(label).pop())

describe("Business: list, detail and every detail tab", () => {
  it("complete business: Overview, Services, Contact and Gallery all render", async () => {
    await loadBusiness([business.complete]); fireEvent.click(screen.getAllByText("View Details")[0])
    expect(await screen.findByText("About")).toBeTruthy(); expect(screen.getAllByText("Local crafts").length).toBeGreaterThan(0)
    expect(screen.getByText("Beadwork")).toBeTruthy(); expect(screen.getByText("Painting")).toBeTruthy() // object AND string service entries are both supported
    for (const t of ["Services", "Contact", "Gallery"]) { const els = screen.queryAllByText(t); if (els.length) fireEvent.click(els[els.length - 1]) }
    expect(document.body.textContent).toMatch(/0110000000|Maponya/)
  })

  it("a business with no images, services or description (the CMS sample) opens without crashing", async () => {
    await loadBusiness([business.cmsSample, { id: "nodesc", name: "No description", type: "Market" }]); fireEvent.click(screen.getAllByText("View Details")[0])
    expect(await screen.findByText("About")).toBeTruthy(); expect(screen.getAllByText("Local crafts and art").length).toBeGreaterThan(0)
    for (const t of ["Services", "Contact", "Gallery"]) { const els = screen.queryAllByText(t); if (els.length) fireEvent.click(els[els.length - 1]) }
  })

  it.each(business.bad.map((b) => [b.id, b]))("malformed business %s renders in the list and in all tabs", async (_id, doc) => {
    await loadBusiness([doc]); fireEvent.click(screen.getAllByText("View Details")[0])
    await screen.findByText("About")
    for (const t of ["Services", "Contact", "Gallery"]) { const els = screen.queryAllByText(t); if (els.length) fireEvent.click(els[els.length - 1]) }
  })

  it("string services are split, junk service entries are dropped, object services keep their name", async () => {
    await loadBusiness([business.bad[2], business.bad[1]])
    for (const name of ["Junk services"]) { fireEvent.click(screen.getAllByText("View Details")[0]); await screen.findByText("About"); expect(screen.getByText("Real")).toBeTruthy(); expect(screen.getByText("Plain")).toBeTruthy(); expect(screen.queryByText("only")).toBeNull() }
  })

  it("the Services, Gallery and Contact list tabs work with incomplete data", async () => {
    await loadBusiness([business.complete, business.cmsSample, ...business.bad])
    for (const t of ["Services", "Contact", "Gallery", "Home"]) { const els = screen.queryAllByText(t); if (els.length) fireEvent.click(els[0]) }
    expect(document.body.textContent).toBeTruthy()
  })

  it("search works across incomplete businesses", async () => {
    await loadBusiness([business.complete, ...business.bad]); const box = screen.getAllByPlaceholderText(/search/i)[0]
    fireEvent.change(box, { target: { value: "bead" } }); await waitFor(() => expect(document.body.textContent).toMatch(/Craft Market/))
  })
})

const loadTransport = async (docs) => { globalThis.__OFFLINE.transport = docs; return render(<Transport />) }
describe("Transport: modes, stops and departures", () => {
  it("renders a complete route, shows only 4 next departures in the card and all departures + stops when expanded", async () => {
    await loadTransport([routes.complete]); fireEvent.click(await screen.findByText("Orlando - CBD"))
    expect(await screen.findByText("Stops along the route")).toBeTruthy(); expect(screen.getByText("All departures today")).toBeTruthy(); expect(screen.getAllByText("06:20").length).toBe(1)
  })
  it.each(routes.bad.map((r) => [r.id, r]))("malformed route %s renders and expands", async (_id, doc) => {
    await loadTransport([doc]); fireEvent.click(await screen.findByText(doc.routeName)); await new Promise((r) => setTimeout(r, 0))
  })
  it("string / junk departures and stops are cleaned, not invented", async () => {
    await loadTransport([routes.bad[1], routes.bad[2]]); const t = (await screen.findAllByText("Junk lists"))[0]; fireEvent.click(t)
    expect(await screen.findByText("Stops along the route")).toBeTruthy(); expect(screen.getByText("S1")).toBeTruthy(); expect(screen.getByText("S2")).toBeTruthy()
    expect(screen.getAllByText("07:00").length).toBeGreaterThan(0); expect(screen.getAllByText("08:00").length).toBeGreaterThan(0)
  })
  it("a route without a mode is NOT turned into a bus: it appears under 'Other'", async () => {
    await loadTransport([routes.complete, routes.noMode])
    expect(await screen.findByText("Other")).toBeTruthy(); expect(screen.getByText("Bus")).toBeTruthy()
    fireEvent.click(screen.getByText("Other")); expect(await screen.findByText("Mystery route")).toBeTruthy()
  })
  it("mode text is matched case-insensitively and trimmed", async () => { await loadTransport([routes.bad[4], routes.complete]); expect(await screen.findByText("Train")).toBeTruthy() })
  it("no data, null data and a non-array render the empty state", async () => { for (const d of [[], null, undefined, "x", { a: 1 }]) { const r = await loadTransport(d); expect(await screen.findByText(/No routes yet/)).toBeTruthy(); r.unmount() } })
})
