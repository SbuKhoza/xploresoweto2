# xploresoweto — update notes

## 1. Setup (do this first)

```bash
npm install
npx expo start -c        # -c clears the Metro cache so NativeWind picks up global.css
```

New/changed config files that make Tailwind work in React Native (via **NativeWind v4**):
- `babel.config.js` — added (didn't exist before); wires up NativeWind's JSX transform
- `metro.config.js` — added; runs the Tailwind build through Metro
- `tailwind.config.js` — added; defines the app's color tokens
- `global.css` — added; the `@tailwind` entry point
- `nativewind-env.d.ts` — added; editor typing support
- `index.js` — now imports `./global.css`
- `package.json` — added `nativewind` and `tailwindcss` (devDependency)

## 2. Design system

Previously ACCENT/HIGHLIGHT colors were redefined per-screen and drifted (teal+orange
on Home/BottomNav vs. navy+pink everywhere else). `tailwind.config.js` now defines one
palette used going forward:

| token       | hex        | use                          |
|-------------|------------|------------------------------|
| `ink`       | `#14213D`  | primary text / dark surfaces |
| `teal`      | `#1B4D5C`  | secondary accent             |
| `brand`     | `#E8600A`  | primary CTA / highlights     |
| `bg`        | `#FAF7F2`  | app background               |
| `surface`   | `#FFFFFF`  | cards                        |
| `muted`     | `#7A8A8F`  | secondary text               |
| `line`      | `#ECE6DD`  | borders                      |
| `success/warning/danger` | — | status colors  |

Screens not yet migrated (Emergency, Accommodation, Restaurants, Attraction, Business,
Healthcare, PublicService, Recreation, Xplore, Profile, Authentication, Splash, Eskom,
PoIst) still use their original `StyleSheet` objects and old color constants — they
were intentionally left alone this round to keep the change reviewable. They're good
candidates for the same NativeWind treatment next.

## 3. Screens rebuilt/added this round

### `screens/Home.js` — redesigned in NativeWind
Same logic (search, quick links, featured guide, townships) rewritten with Tailwind
classes. Search now also indexes `transport` and `news`.

### `components/xplorescreens/Transport.js` — was a stub, now full feature
Bus/Train tab switcher, expandable route cards (status chip, next departures, full
stop list, full daily schedule), pull-to-refresh, offline caching via the existing
`useOfflineData` hook, and demo fallback data so the screen isn't empty before you
seed Firestore.

**Firestore collection: `transport`**
```json
{
  "mode": "bus | train",
  "routeName": "Soweto — Johannesburg CBD",
  "operator": "Metrobus 615",
  "origin": "Baragwanath",
  "destination": "Park Station",
  "frequency": "Every 15 min",
  "fare": "R14.50",
  "status": "On Time | Delayed | Suspended",
  "departures": ["05:00", "05:20", "..."],
  "stops": ["Baragwanath", "Chris Hani Rd", "..."],
  "isActive": true
}
```

### `screens/News.js` — new
Featured headline card + category filter (All/Community/Safety/Events/Municipal) +
expandable article cards. Offline caching + fallback data, same pattern as Transport.

**Firestore collection: `news`**
```json
{
  "title": "...",
  "summary": "one-line teaser",
  "body": "full article text",
  "category": "Community | Safety | Events | Municipal",
  "imageUrl": "https://...",
  "source": "Soweto Times",
  "publishedAt": "2026-07-28T09:00:00.000Z",
  "isFeatured": true,
  "isActive": true
}
```

### `screens/Community.js` — new, replaces `screens/More.js`
All-in-one directory hub: Emergency Contacts, Lost & Found / Missing Persons (PoIst),
Public Services, Healthcare, Points of Interest, Accommodation, Restaurants,
Recreation, Transport, News, Load Shedding, Business — plus a live "Community Pulse"
strip showing the latest news headline. `More.js` was deleted (nothing else referenced
it — confirmed via grep).

## 4. Navigation changes (`App.js`, `components/BottomNav.js`)

- Bottom tab **"More" → "Community"** (icon `menu` → `grid`)
- New `CommunityStack` replaces `MoreStack`, now containing `CommunityMain`, `News`,
  `Eskom`, `PoIst`
- `Transport` in the Xplore stack now points at the real screen instead of the stub

## 5. Not done yet (flagging honestly)

- **Local Alerts** and a dedicated **Lost & Found** flow beyond the existing PoIst
  module were explicitly deprioritized this round per your last answer — PoIst
  currently covers missing/wanted persons but not general lost-and-found items or
  push-style alerts. Happy to build those next.
- Remaining screens still need the NativeWind conversion pass.
- Booking flows for Accommodation/Restaurants already exist (`ReservationForm.js`,
  `RestaurantReservationForm.js`) and weren't touched — let me know if those should be
  redesigned too.

---

## 6. Townships & Transport are now fully dynamic

**Townships** — nothing is bundled in the app any more.
- `utils/townships.js` is now only a normaliser (Firestore doc → what the screens render). The hard-coded Orlando/Meadowlands/… content was moved into the CMS as seed data.
- New `hooks/useTownships.js`: reads `homescreen` docs with `type: "township"` through `useOfflineData` (cached for offline), hides `isActive === false`, sorts by `order` then A–Z.
- `Home.js`, `SowetoTownships.js` and `TownshipSheet.js` use the hook. Pull-to-refresh added to the directory. Empty/offline states replace the old fallbacks. History/Legends/Places tabs only show when the township has that content.
- Search also matches township `aliases`.

Township document (`homescreen/{slug}`):
```json
{
  "type": "township", "name": "Orlando", "area": "Orlando East & West", "tagline": "…",
  "established": "1931", "namedAfter": "…", "overview": "…",
  "colorFrom": "#E8600A", "colorTo": "#A63A06", "imageUrl": "https://…",
  "order": 1, "isActive": true, "aliases": ["orlando east", "orlando west"],
  "history":   [{ "year": "1931", "text": "…" }],
  "people":    [{ "name": "…", "role": "…", "note": "…" }],
  "landmarks": [{ "name": "…", "icon": "bank", "text": "…" }],
  "facts":     ["…"]
}
```
**First-time setup:** CMS → Soweto → Townships → *Import built-in townships* (one click, skips existing).

**Transport** — `Transport.js` no longer has demo routes.
- Mode tabs are built from the modes present in Firestore (bus / train / taxi / anything new); the tab bar hides if there's only one.
- Only `isActive !== false` routes, ordered by `order`.
- New optional fields: `notice` (amber service alert on the card), `days` (e.g. "Mon–Fri"), `order`.
- Proper empty / offline states.

**First-time setup:** CMS → Transport → *Load sample routes* (only offered when the collection is empty).

> Until those two one-click imports are done, the app will show "No townships yet" / "No routes yet".

**Enrollment kasi lists** — `components/KasiPicker.js` and `screens/EnrollmentScreen.js` no longer fetch `homescreen` themselves; they use `useTownships()` (cached offline, hides inactive townships) on top of the built-in `utils/townshipList.js` baseline.
