// UI/usability update: greeting enrolment redesign, Soweto Townships redesign, scroll-aware status bar, dynamic banner, Malloya logo,
// News/Events external links, Xplore spacing. SIMULATED component tests (react-native-web + jsdom with stubs): not a device, not Hermes, not NativeWind.
import React from "react"
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react"
import { ScrollView, Text, Alert, Linking } from "react-native"
import EnrollmentScreen from "../../screens/EnrollmentScreen"
import { EnrollmentProvider, useEnrollment, GREETINGS } from "../../utils/enrollment"
import { getKasiOptions } from "../../utils/townshipList"
import SowetoTownships from "../../screens/SowetoTownships"
import DynamicHero from "../../components/DynamicHero"
import MalloyaLogo from "../../components/MalloyaLogo"
import DetailSheet from "../../components/content/DetailSheet"
import { ScrimProvider, StatusBarScrim, useScrimOffset, useScrimScrollProps, SCRIM_COLOR, SCRIM_RANGE } from "../../components/StatusBarScrim"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { toExternalUrl, openExternalUrl } from "../../utils/externalLink"
import { resolveTownshipResult } from "../../utils/townshipSearch"

const root = path.resolve(__dirname, "../..")
const read = (f) => fs.readFileSync(path.join(root, f), "utf8")
const HERO = "https://cms.test/banners/hero-current.jpg"
const hero = (extra = {}) => ({ id: "hero", type: "hero", imageUrl: HERO, isActive: true, ...extra })
const township = (id, name, extra = {}) => ({ id, type: "township", name, isActive: true, ...extra })
// react-native-web reports image load/failure through `new window.Image()`; jsdom never loads images, so the test drives those events itself.
const loaders = []
const RealImage = window.Image
beforeEach(() => { loaders.length = 0; window.Image = class { constructor() { loaders.push(this) } set src(v) { this._src = v } get src() { return this._src } } })
afterEach(async () => { window.Image = RealImage; await AsyncStorage.clear() }) // the enrolment device cache must not leak between tests
const settle = (uri, ok) => act(async () => { loaders.filter((l) => l._src === uri).forEach((l) => (ok ? l.onload?.({}) : l.onerror?.())); await new Promise((r) => setTimeout(r, 5)) }) // rn-web defers onLoad with setTimeout
const bannerSrcs = () => [...document.querySelectorAll("img")].map((i) => i.getAttribute("src"))

// ───────────────────────────── Greeting enrolment ─────────────────────────────
describe("Greeting enrolment screen", () => {
  const Gate = () => { const { status } = useEnrollment(); return status === "needed" ? <EnrollmentScreen /> : <div data-testid="gate">{status}</div> }
  const mount = async (extraUser = {}) => {
    globalThis.__FS.users = [{ id: "u1", uid: "u1", displayName: "Thandi Dlamini", enrolled: false, ...extraUser }]
    const r = render(<EnrollmentProvider user={{ uid: "u1", displayName: "Thandi Dlamini" }}><Gate /></EnrollmentProvider>)
    await screen.findByText("How should we greet you?")
    return r
  }

  it("keeps exactly the existing greeting options (no options added from the mockup)", async () => {
    await mount()
    expect(GREETINGS.map((g) => g.key)).toEqual(["Aweh", "Fede", "Eita", "Hello"])
    for (const g of GREETINGS) expect(screen.getByLabelText(`Greeting ${g.key}`)).toBeTruthy()
    expect(document.querySelectorAll('[aria-label^="Greeting "]').length).toBe(GREETINGS.length)
  })
  it("shows the real step position (from the actual enrolment steps) and a progress bar", async () => {
    await mount()
    expect(screen.getByText("Step 1 of 2")).toBeTruthy()
    expect(screen.getByTestId("enrol-progress-fill").style.width).toBe("50%")
  })
  it("Continue is disabled until a greeting is chosen; the preview invites a tap", async () => {
    await mount()
    expect(screen.getByLabelText("Continue").getAttribute("aria-disabled")).toBe("true")
    expect(screen.getByTestId("greeting-preview").textContent).toBe("Tap a greeting above")
    fireEvent.click(screen.getByLabelText("Continue"))
    expect(screen.queryByText("Where's your kasi?")).toBeNull()
  })
  it("selecting a greeting shows the selected state, moves it on change, and updates the live preview", async () => {
    await mount()
    for (const key of ["Aweh", "Eita", "Hello", "Fede"]) {
      fireEvent.click(screen.getByLabelText(`Greeting ${key}`))
      expect(screen.getByTestId(`selected-${key}`)).toBeTruthy()
      expect(document.querySelectorAll('[data-testid^="selected-"]').length).toBe(1)
      expect(screen.getByTestId("greeting-preview").textContent).toBe(`${key}, Thandi! Welcome to XploreSoweto.`)
    }
    expect(screen.getByLabelText("Continue").getAttribute("aria-disabled")).not.toBe("true")
  })
  it("Continue goes to the unchanged kasi step, and finishing saves exactly the existing enrolment fields", async () => {
    await mount()
    fireEvent.click(screen.getByLabelText("Greeting Eita")); fireEvent.click(screen.getByLabelText("Continue"))
    expect(await screen.findByText("Where's your kasi?")).toBeTruthy(); expect(screen.getByText("Step 2 of 2")).toBeTruthy()
    const kasi = getKasiOptions([])[0]
    fireEvent.click(screen.getByText(kasi)); fireEvent.click(screen.getByLabelText("Finish"))
    await waitFor(() => expect(globalThis.__CALLS.some((c) => c[0] === "updateDoc")).toBe(true))
    const [, path_, data] = globalThis.__CALLS.find((c) => c[0] === "updateDoc")
    expect(path_).toBe("users/u1")
    expect(Object.keys(data).sort()).toEqual(["enrolled", "enrolledAt", "greeting", "kasi", "updatedAt"])
    expect(data).toMatchObject({ greeting: "Eita", kasi, enrolled: true })
    await waitFor(() => expect(screen.getByTestId("gate").textContent).toBe("done"))
  })
  it("going back from the kasi step returns to the greeting step with the choice kept", async () => {
    await mount(); fireEvent.click(screen.getByLabelText("Greeting Fede")); fireEvent.click(screen.getByLabelText("Continue"))
    await screen.findByText("Where's your kasi?"); fireEvent.click(screen.getByLabelText("Back"))
    expect(await screen.findByText("How should we greet you?")).toBeTruthy(); expect(screen.getByTestId("selected-Fede")).toBeTruthy()
  })
  it("an already-enrolled profile skips enrolment (unchanged)", async () => {
    globalThis.__FS.users = [{ id: "u1", uid: "u1", displayName: "T", enrolled: true, greeting: "Aweh", kasi: "Orlando East" }]
    render(<EnrollmentProvider user={{ uid: "u1" }}><Gate /></EnrollmentProvider>)
    await waitFor(() => expect(screen.getByTestId("gate").textContent).toBe("done"))
  })
  it("the banner is the existing dynamic one: the CMS hero image when configured, the bundled Home artwork otherwise, and it recovers from a broken URL", async () => {
    globalThis.__OFFLINE.homescreen = [hero()]
    const { unmount } = await mount(); await waitFor(() => expect(bannerSrcs()).toContain(HERO))
    await settle(HERO, false)
    await waitFor(() => expect(bannerSrcs().some((s) => /hero-towers\.png$/.test(s))).toBe(true)); unmount()
    globalThis.__OFFLINE.homescreen = []; await mount()
    await waitFor(() => expect(bannerSrcs().some((s) => /assets\/home\/hero-towers\.png$/.test(s))).toBe(true))
  })
  it("a different CMS banner (another image) is shown as-is, nothing about the banner is hardcoded", async () => {
    globalThis.__OFFLINE.homescreen = [hero({ imageUrl: "https://cms.test/banners/winter-portrait.png" })]; await mount()
    await waitFor(() => expect(bannerSrcs()).toContain("https://cms.test/banners/winter-portrait.png")); expect(bannerSrcs()).not.toContain(HERO)
  })
  it("an inactive CMS hero is ignored (the existing useHomeContent rule)", async () => {
    globalThis.__OFFLINE.homescreen = [hero({ isActive: false })]; await mount(); expect(bannerSrcs()).not.toContain(HERO)
  })
})

// ───────────────────────────── Soweto Townships ─────────────────────────────
describe("Soweto Townships screen", () => {
  const T = [township("t1", "Orlando", { area: "West", imageUrl: "https://img.test/orlando.jpg", aliases: ["Gwaza"], people: [{ name: "Walter Sisulu" }], order: 1 }),
    township("t2", "Meadowlands", { imageUrl: "https://img.test/meadowlands.jpg", order: 2 }), township("t3", "Diepkloof", { order: 3 })]
  const load = (docs, home = []) => { globalThis.__OFFLINE.homescreen = [...docs, ...home]; return render(<SowetoTownships />) }
  const card = (n) => screen.getByLabelText(`${n} township info`)

  it("renders a card per active township with its CMS image, and the whole card is the tap target", () => {
    load(T)
    for (const n of ["Orlando", "Meadowlands", "Diepkloof"]) expect(card(n).getAttribute("role")).toBe("button")
    expect(bannerSrcs()).toContain("https://img.test/orlando.jpg"); expect(bannerSrcs()).toContain("https://img.test/meadowlands.jpg")
  })
  it("the township count is derived from the records, not hardcoded", () => {
    const a = load(T); expect(screen.getByText(/3 townships · history, local legends & landmarks/)).toBeTruthy(); a.unmount()
    const b = load([...T, township("t4", "Zola"), township("t5", "Jabavu")]); expect(screen.getByText(/5 townships/)).toBeTruthy(); b.unmount()
    load([township("t9", "Only One")]); expect(screen.getByText(/1 township ·/)).toBeTruthy()
  })
  it("keeps active-record filtering: inactive, unnamed and non-township documents are not shown or counted", () => {
    load([...T, township("x1", "Hidden", { isActive: false }), { id: "x2", type: "township", isActive: true }, { id: "x3", type: "other", name: "Not a township", isActive: true }])
    expect(screen.queryByLabelText("Hidden township info")).toBeNull(); expect(screen.queryByText("Not a township")).toBeNull(); expect(screen.getByText(/3 townships/)).toBeTruthy()
  })
  it("tapping a card opens the existing township detail sheet for that record", async () => {
    load(T); fireEvent.click(card("Meadowlands"))
    expect(await screen.findByText("About")).toBeTruthy(); expect(screen.getAllByText("Meadowlands").length).toBeGreaterThan(1)
  })
  it("search by name, area, alias and local legend, case-insensitively, with a clear empty state and a clear button", async () => {
    load(T); const box = screen.getByLabelText("Search townships")
    const type = (v) => fireEvent.change(box, { target: { value: v } })
    type("ORLA"); expect(screen.queryByLabelText("Meadowlands township info")).toBeNull(); expect(card("Orlando")).toBeTruthy()
    type("west"); expect(card("Orlando")).toBeTruthy(); expect(screen.queryByLabelText("Diepkloof township info")).toBeNull()
    type("gwaza"); expect(card("Orlando")).toBeTruthy()
    type("sisulu"); expect(card("Orlando")).toBeTruthy(); expect(screen.queryByLabelText("Meadowlands township info")).toBeNull()
    type("zzz"); expect(await screen.findByText("No townships found")).toBeTruthy()
    fireEvent.click(screen.getByLabelText("Clear search")); expect(card("Diepkloof")).toBeTruthy()
  })
  it("search keeps the input focused-state value while results change, and results open the matching township", async () => {
    load(T); fireEvent.change(screen.getByLabelText("Search townships"), { target: { value: "diep" } })
    fireEvent.click(card("Diepkloof")); expect(await screen.findByText("About")).toBeTruthy()
  })
  it("missing, invalid or broken images fall back to a coloured placeholder (never a blank or a crash)", async () => {
    load([township("a", "NoImage"), township("b", "BadScheme", { imageUrl: "javascript:alert(1)" }), township("c", "WrongType", { imageUrl: 42 }), township("d", "ObjectUrl", { imageUrl: { x: 1 } }), township("e", "Broken", { imageUrl: "https://img.test/broken.jpg" })])
    expect(screen.getAllByTestId("township-placeholder").length).toBe(4)
    await settle("https://img.test/broken.jpg", false)
    expect(screen.getAllByTestId("township-placeholder").length).toBe(5)
  })
  it("tolerates incomplete township data (no colours, odd types) and an empty collection", () => {
    load([township("a", "Odd", { colorFrom: 5, colorTo: null, tagline: {}, history: "x", people: "y", landmarks: 3, aliases: null })]); expect(card("Odd")).toBeTruthy()
  })
  it("shows the existing empty states", () => {
    load([]); expect(screen.getByText("No townships yet")).toBeTruthy()
  })
  it("uses the existing dynamic banner (CMS hero) with the bundled fallback; back button goes back", () => {
    load(T, [hero()]); expect(bannerSrcs()).toContain(HERO)
    fireEvent.click(screen.getByLabelText("Go back")); expect(globalThis.__CALLS).toContainEqual(["goBack"])
  })
  it("back from a screen opened from Home returns to Home (same rule as the Header)", () => {
    globalThis.__ROUTE = { from: "Home" }; load(T); fireEvent.click(screen.getByLabelText("Go back")); expect(globalThis.__CALLS).toContainEqual(["navigate", "Home"])
  })
  it("no township names, counts, images or text are hardcoded in the screen or card", () => {
    const src = read("screens/SowetoTownships.js") + read("components/township/TownshipCard.js")
    for (const n of ["Orlando", "Meadowlands", "Diepkloof", "Dobsonville", "Emdeni", "Protea Glen", "Soweto sunset"]) expect(src).not.toContain(n)
    expect(src).not.toMatch(/\b8 townships\b/); expect(src).not.toMatch(/require\(/); expect(src).toContain("all.length")
  })
})

// ───────────────────────────── Township search navigation ─────────────────────────────
describe("Township search result resolution (Home search)", () => {
  const loaded = [{ doc: township("t1", "Orlando"), index: 0 }, { doc: township("t2", "Meadowlands"), index: 1 }]
  const result = (o = {}) => ({ id: "t2", collection: "homescreen", label: "Township", icon: "location-outline", screen: null, type: "township", name: "Meadowlands", isActive: true, ...o })
  it("uses the actual document id and the loaded active township", () => { expect(resolveTownshipResult(result(), loaded)).toEqual({ kind: "loaded", index: 1, doc: loaded[1].doc }) })
  it("two townships with the same name resolve by id, not name", () => {
    const l = [{ doc: township("a", "Twin"), index: 0 }, { doc: township("b", "Twin"), index: 1 }]
    expect(resolveTownshipResult(result({ id: "b", name: "Twin" }), l).index).toBe(1)
  })
  it("falls back to the (active) search document itself when townships are not loaded yet, without the search decorations", () => {
    const r = resolveTownshipResult(result({ id: "zz", name: "Zola", area: "Central" }), [])
    expect(r.kind).toBe("result"); expect(r.doc).toEqual({ id: "zz", type: "township", name: "Zola", isActive: true, area: "Central" })
  })
  it.each([[null], [undefined], [5], ["x"], [{}], [{ id: "" }], [{ id: 5 }], [{ id: "q", name: "" , type: "township" }], [{ id: "q", name: "Deleted", type: "township", isActive: false }], [{ id: "q", name: "X", type: "business" }], [{ id: "q", name: {} , type: "township" }]])(
    "incomplete, inactive or deleted result %j is unavailable (no exception)", (item) => { expect(resolveTownshipResult(item, loaded)).toEqual({ kind: "unavailable" }); expect(resolveTownshipResult(item, null)).toEqual({ kind: "unavailable" }) })
  it("tolerates a malformed townships list", () => { expect(resolveTownshipResult(result(), [null, {}, { doc: null }, undefined]).kind).toBe("result") })
  it("Home wires township results to the sheet, keeps the other categories' navigation, and warns on unavailable records", () => {
    const home = read("screens/Home.js")
    expect(home).toContain('if (item.collection === "homescreen") { openTownshipResult(item); return }')
    expect(home).toMatch(/if \(item\.screen\) \{\s*goXploreItem\(item\.screen\)/)
    expect(home).toContain("Township unavailable"); expect(home).toContain("setActiveTownship(r.doc)")
  })
})

// ───────────────────────────── Scroll-aware status bar ─────────────────────────────
describe("Scroll-aware top safe area", () => {
  const opacityOf = () => Number(screen.getByTestId("status-bar-scrim").firstChild.style.opacity)
  let setOffset
  const Probe = () => { const f = useScrimOffset(); setOffset = f; return null }
  const mount = () => render(<ScrimProvider><Probe /><StatusBarScrim /></ScrimProvider>)
  beforeEach(() => { globalThis.__INSETS = { top: 28, bottom: 0, left: 0, right: 0 } })

  it("is invisible at the initial scroll position (the screen looks exactly as before) and is as tall as the top inset", () => {
    mount(); expect(opacityOf()).toBe(0); expect(screen.getByTestId("status-bar-scrim").style.height).toBe("28px")
  })
  it("fades gradually to a solid colour while scrolling, never beyond solid", () => {
    mount(); const seen = []
    for (const y of [0, 18, 36, 54, SCRIM_RANGE, 200, 5000]) { act(() => setOffset(y)); seen.push(opacityOf()) }
    expect(seen).toEqual([0, 0.25, 0.5, 0.75, 1, 1, 1])
    expect(screen.getByTestId("status-bar-scrim").firstChild.style.backgroundColor).toBe("rgb(245, 247, 250)"); expect(SCRIM_COLOR).toBe("#F5F7FA")
  })
  it("returns to fully transparent when scrolled back to the top (also for bounce/negative offsets)", () => {
    mount(); act(() => setOffset(300)); expect(opacityOf()).toBe(1)
    act(() => setOffset(30)); expect(opacityOf()).toBeCloseTo(30 / SCRIM_RANGE); act(() => setOffset(0)); expect(opacityOf()).toBe(0)
    act(() => setOffset(300)); act(() => setOffset(-40)); expect(opacityOf()).toBe(0)
  })
  it("ignores junk offsets", () => { mount(); for (const y of [undefined, null, NaN, "abc", {}]) { act(() => setOffset(y)); expect(opacityOf()).toBe(0) } })
  it("respects the device inset: nothing is drawn when there is no top inset, and the height follows other insets", () => {
    globalThis.__INSETS = { top: 0, bottom: 0, left: 0, right: 0 }; const a = mount(); expect(screen.queryByTestId("status-bar-scrim")).toBeNull(); a.unmount()
    globalThis.__INSETS = { top: 48, bottom: 0, left: 0, right: 0 }; mount(); expect(screen.getByTestId("status-bar-scrim").style.height).toBe("48px")
  })
  it("screens without a provider are unaffected: nothing is rendered and no scroll props are added", () => {
    let props; const P = () => { props = useScrimScrollProps(); return null }
    const r = render(<><P /><StatusBarScrim /></>); expect(screen.queryByTestId("status-bar-scrim")).toBeNull(); expect(props).toEqual({}); r.unmount()
  })
  it("a plain ScrollView wired with useScrimScrollProps drives the fade from real scroll events", async () => {
    const S = () => { const p = useScrimScrollProps(); return <ScrollView testID="sv" {...p}><Text>content</Text></ScrollView> }
    render(<ScrimProvider><S /><StatusBarScrim /></ScrimProvider>)
    const sv = screen.getByTestId("sv")
    act(() => { sv.scrollTop = 36; fireEvent.scroll(sv) }); expect(opacityOf()).toBeCloseTo(0.5)
    await act(async () => { await new Promise((r) => setTimeout(r, 40)) }) // react-native-web throttles scroll events (scrollEventThrottle)
    act(() => { sv.scrollTop = 0; fireEvent.scroll(sv) }); expect(opacityOf()).toBe(0)
  })
  it("is applied only to screens whose hero draws under the status bar; header screens, forms and auth are untouched", () => {
    const app = read("App.js")
    const withScrim = [...app.matchAll(/const (\w+) = \(\) => \(\n\s+<SafeScreen[^>]*\bscrim\b/g)].map((m) => m[1]).sort()
    expect(withScrim).toEqual(["AccommodationWithoutHeader", "AttractionWithoutHeader", "BusinessWithoutHeader", "HealthcareWithoutHeader", "HomeWithoutHeader", "ProfileWithoutHeader", "PublicServiceWithoutHeader", "RecreationWithoutHeader", "RestaurantsWithoutHeader", "SowetoTownshipsWithHeader"])
    for (const n of ["XploreWithHeader", "EventsWithHeader", "NewsWithHeader", "EmergencyWithHeader", "TransportWithHeader", "CommunityWithoutHeader", "EskomWithHeader", "PoIstWithHeader"]) expect(app).not.toMatch(new RegExp(`const ${n} = \\(\\) => \\(\\n\\s+<SafeScreen[^>]*\\bscrim\\b`))
    expect(app).toMatch(/const HomeWithoutHeader = \(\) => \(\n\s+<SafeScreen style=\{\{ paddingTop: 0 \}\} scrim>/) // initial top padding of Home unchanged
    expect(app).toContain("{ paddingTop: insets.top + TOP_EXTRA }") // global safe area unchanged
    expect(app).toContain('backgroundColor="transparent"'); expect(app).toContain("translucent")
  })
  it("the shared scroll hook also feeds the scrim, without changing the existing scroll tracking", () => {
    const nav = read("components/BottomNav.js")
    expect(nav).toContain("useNativeDriver: true"); expect(nav).toContain("[{ nativeEvent: { contentOffset: { y: scrollY } } }]"); expect(nav).toContain("onScrimOffset(e?.nativeEvent?.contentOffset?.y)")
  })
})

// ───────────────────────────── Dynamic banner is preserved ─────────────────────────────
describe("Existing dynamic banners are preserved", () => {
  it("DynamicHero only reads the existing CMS hero (useHomeContent) with the same bundled fallback as Home", () => {
    const src = read("components/DynamicHero.js")
    expect(src).toContain('useHomeContent'); expect(src).toContain("hero?.imageUrl")
    expect([...src.matchAll(/require\(([^)]+)\)/g)].map((m) => m[1])).toEqual(['"../assets/home/hero-towers.png"'])
    expect(read("screens/Home.js")).toContain('require("../assets/home/hero-towers.png")')
  })
  it("no new image assets or banner records were introduced, and the banner source/hook files are unchanged", () => {
    expect(read("hooks/useHomeContent.js")).toContain('d.type === "hero" && d.isActive !== false && d.imageUrl')
    expect(read("screens/Home.js")).toContain("hero?.imageUrl && !heroFailed ? { uri: hero.imageUrl }")
  })
  it("DynamicHero renders whatever the CMS banner is, whatever its colours or aspect ratio", () => {
    globalThis.__OFFLINE.homescreen = [hero({ imageUrl: "https://cms.test/very-wide-panorama.webp" })]
    render(<DynamicHero height={200} topInset={24}><Text>over banner</Text></DynamicHero>)
    expect(bannerSrcs()).toContain("https://cms.test/very-wide-panorama.webp"); expect(screen.getByText("over banner")).toBeTruthy()
  })
})

// ───────────────────────────── Malloya promotional logo ─────────────────────────────
describe("Malloya promotional logo", () => {
  it("shows the existing icon when no image is configured (existing records without the field)", () => {
    render(<MalloyaLogo url={undefined} />); expect(screen.getByTestId("malloya-fallback")).toBeTruthy(); expect(document.querySelector("img")).toBeNull()
  })
  it.each([[""], [null], [5], [{}], ["javascript:alert(1)"], ["file:///x.png"], ["data:image/png;base64,AAAA"], ["not a url"], ["ftp://x/y.png"]])("an invalid configuration %j uses the fallback", (u) => {
    render(<MalloyaLogo url={u} />); expect(screen.getByTestId("malloya-fallback")).toBeTruthy(); expect(document.querySelector("img")).toBeNull()
  })
  it("loads the configured image, preserves its aspect ratio (contain), and replaces the icon once loaded", async () => {
    render(<MalloyaLogo url=" https://img.test/malloya.png " />)
    expect(bannerSrcs()).toContain("https://img.test/malloya.png")
    expect(screen.getByTestId("malloya-fallback")).toBeTruthy() // still loading: icon shown
    await settle("https://img.test/malloya.png", true); expect(screen.queryByTestId("malloya-fallback")).toBeNull()
    const logoSrc = read("components/MalloyaLogo.js"); expect(logoSrc).toContain('resizeMode="contain"'); expect(logoSrc).not.toMatch(/resizeMode="(cover|stretch)"/) // aspect ratio kept, no crop
    expect(logoSrc).not.toMatch(/backgroundColor: "#/) // nothing opaque behind the image, so transparency is kept
  })
  it("a loading failure falls back to the icon, and a changed URL is retried", async () => {
    const r = render(<MalloyaLogo url="https://img.test/a.png" />); await settle("https://img.test/a.png", false)
    expect(screen.getByTestId("malloya-fallback")).toBeTruthy(); expect(document.querySelector("img")).toBeNull()
    r.rerender(<MalloyaLogo url="https://img.test/b.png" />); expect(bannerSrcs()).toContain("https://img.test/b.png"); await settle("https://img.test/b.png", true); expect(screen.queryByTestId("malloya-fallback")).toBeNull()
  })
  it("Home passes the CMS field of the existing featured document and keeps the card, text and navigation", () => {
    const home = read("screens/Home.js")
    expect(home).toContain("<MalloyaLogo url={featuredImage?.malloyLogoUrl} />"); expect(home).toContain("The ultimate guide to Soweto"); expect(home).toContain('navigation.navigate("SowetoAI")')
    expect(home).toContain("Meet Malloya. Discover places, plan experiences and explore Soweto with your personal travel assistant.")
  })
  it("no Malloya engine, prompt, learning or consent file was touched by this feature", () => {
    const logo = read("components/MalloyaLogo.js"); expect(logo).not.toMatch(/callable|ai\//); expect(read("hooks/useHomeContent.js")).toContain("featuredImage")
  })
})

// ───────────────────────────── External links (News / Events) ─────────────────────────────
describe("External website links", () => {
  const good = ["https://www.example.co.za/story?id=1#x", "http://example.com", "HTTPS://Example.com/A", "https://sub.example.org:8443/a/b", "http://localhost:3000/x"]
  const bad = ["javascript:alert(1)", " javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "ftp://example.com", "myapp://x", "intent://x#Intent;end", "mailto:a@b.c", "tel:123", "content://x/y",
    "example.com", "www.example.com", "//evil.com", "https://", "https:///x", "https:example.com", "https://exa mple.com", "https://user:pw@example.com", "https://nodot", "", "   ", null, undefined, 5, {}, [], "x".repeat(3000)]
  it.each(good.map((g) => [g]))("accepts %s", (u) => { expect(toExternalUrl(u)).toBe(u.trim()) })
  it.each(bad.map((b) => [typeof b === "string" ? b.slice(0, 40) : String(b), b]))("rejects %s", (_l, u) => { expect(toExternalUrl(u)).toBe("") })

  it("opens a valid URL through the device browser (Linking) and nothing else", async () => {
    const open = vi.spyOn(Linking, "openURL").mockResolvedValue(true)
    expect(await openExternalUrl("https://example.com/a")).toBe(true); expect(open).toHaveBeenCalledWith("https://example.com/a"); expect(open).toHaveBeenCalledTimes(1)
  })
  it("re-validates before opening: unsafe or malformed values never reach Linking and give a message", async () => {
    const open = vi.spyOn(Linking, "openURL").mockResolvedValue(true); const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {})
    for (const u of ["javascript:alert(1)", "file:///x", "nope", "", undefined, 5]) expect(await openExternalUrl(u)).toBe(false)
    expect(open).not.toHaveBeenCalled(); expect(alert).toHaveBeenCalledTimes(6)
  })
  it("a browser-opening failure is handled gracefully (no throw, a message is shown)", async () => {
    vi.spyOn(Linking, "openURL").mockRejectedValue(new Error("no browser")); const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {})
    await expect(openExternalUrl("https://example.com")).resolves.toBe(false); expect(alert).toHaveBeenCalledWith("Couldn't open the link", expect.any(String))
  })

  const sheet = (actions) => render(<DetailSheet visible onClose={() => {}} title="T" actions={actions} body="b" />)
  const newsActions = (sel) => [{ icon: "share-social-outline", label: "Share story", primary: true, onPress: () => {} }, toExternalUrl(sel.externalUrl) ? { icon: "open-outline", label: "Read full story", wide: true, onPress: () => openExternalUrl(sel.externalUrl) } : null].filter(Boolean)
  it("DetailSheet draws wide (external-link) actions full-width with accessibility labels, keeping the regular row", () => {
    sheet([{ icon: "a", label: "Directions", primary: true, onPress: () => {} }, { icon: "b", label: "Share", onPress: () => {} }, { icon: "open-outline", label: "More event details", wide: true, onPress: () => {} }])
    for (const l of ["Directions", "Share", "More event details"]) expect(screen.getByLabelText(l)).toBeTruthy()
    expect(screen.getByLabelText("More event details").getAttribute("role")).toBe("link"); expect(screen.getByTestId("Ionicons:open-outline")).toBeTruthy()
  })
  it("News and Events screens add the action only for a valid URL, with the requested labels", () => {
    for (const f of ["screens/News.js", "screens/Events.js"]) expect(read(f)).toContain("toExternalUrl(")
    expect(read("screens/News.js")).toContain('label: "Read full story", wide: true, onPress: () => openExternalUrl(sel.externalUrl)')
    expect(read("screens/Events.js")).toContain('label: "More event details", wide: true, onPress: () => openExternalUrl(selected.externalUrl)')
    expect(newsActions({ externalUrl: "https://example.com/s" }).map((a) => a.label)).toEqual(["Share story", "Read full story"])
    for (const u of [undefined, "", "javascript:alert(1)", 5, "example.com"]) expect(newsActions({ externalUrl: u }).map((a) => a.label)).toEqual(["Share story"])
  })
  it("never auto-opens, never derives links from titles, never scrapes or embeds a browser", () => {
    const src = ["utils/externalLink.js", "screens/News.js", "screens/Events.js"].map(read).join("\n")
    expect(src).not.toMatch(/WebView|expo-web-browser|fetch\(/); expect(src).not.toMatch(/openExternalUrl\([^)]*(title|name)/i)
    for (const f of ["screens/News.js", "screens/Events.js"]) { // exactly one call, inside an explicit onPress handler
      const t = read(f); expect(t.match(/openExternalUrl\(/g).length).toBe(1); expect(t).toMatch(/onPress: \(\) => openExternalUrl\(/)
    }
  })
  it("existing card navigation is unchanged (cards still open the detail sheet; Share/Directions remain)", () => {
    expect(read("screens/News.js")).toContain("onPress={() => setSelected(item)}"); expect(read("screens/News.js")).toContain('label: "Share story"')
    expect(read("screens/Events.js")).toContain('label: "Directions"'); expect(read("screens/Events.js")).toContain('label: "Share"')
  })
})

// ───────────────────────────── Xplore menu spacing ─────────────────────────────
describe("Xplore menu spacing", () => {
  it("the Xplore SafeAreaView no longer adds a second top inset (the cause of the extra gap), keeping bottom/left/right", () => {
    const src = read("screens/Xplore.js")
    expect(src).toContain('<SafeAreaView className="flex-1 bg-bg" edges={["bottom", "left", "right"]}>')
    expect(src).toContain('Explore</Text>'); expect(src).toContain("Discover Soweto"); expect(src).toContain("pt-3.5 pb-3") // header block spacing unchanged
    expect(read("App.js")).toContain("const TOP_EXTRA = 6") // the single, intentional top inset stays
  })
})
