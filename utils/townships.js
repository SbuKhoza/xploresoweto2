// ═════════════════════════════════════════════════════════════════════════════
// Township info — history, local celebrities, landmarks and fun facts.
//
// HOW IT WORKS
//  • Each entry below is bundled with the app, so it works offline.
//  • Entries are matched by name (see `match`), so "Orlando East" and
//    "Orlando West" both open the Orlando entry.
//  • If a township document in Firestore (homescreen collection, type
//    "township") has any of these fields, they are merged on top, so you can add
//    or correct things without shipping a new build:
//        description | history | established | tagline | imageUrl
//        celebrities | notablePeople | people   (strings or { name, role, note })
//        landmarks                              (strings or { name, text })
//        facts | funFacts                       (strings)
//
// TO ADD A TOWNSHIP: copy any entry, change `key`, `match` and the text.
// Every empty list (`people: []`, etc.) simply hides that section.
//
// Facts were compiled from public sources (South African History Online,
// Wikipedia, the Heritage Portal, Sowetan/Citizen/Mail & Guardian reporting).
// Please double-check anything you plan to rely on heavily.
// ═════════════════════════════════════════════════════════════════════════════

// Hero colours rotate through these (top-left → bottom-right)
export const TOWNSHIP_COLORS = [
  ["#E8600A", "#A63A06"], // orange
  ["#0A86B4", "#12407E"], // blue
  ["#1FA463", "#0B6B45"], // green
  ["#7A4FE0", "#43299E"], // purple
  ["#E0356F", "#9B1D4E"], // pink
  ["#0E8F94", "#145A6B"], // teal
]

export const TOWNSHIPS = [
  // ───────────────────────────── ORLANDO ──────────────────────────────────
  {
    key: "orlando",
    match: ["orlando", "orlando east", "orlando west"],
    name: "Orlando",
    area: "Orlando East & Orlando West",
    colors: TOWNSHIP_COLORS[0],
    tagline: "The first township of Soweto — and its beating heart.",
    established: "1931",
    namedAfter: "Edwin Orlando Leake, a Johannesburg councillor and former mayor",
    overview:
      "Orlando is one of the oldest and most famous parts of Soweto, split into Orlando East and Orlando West. It is home to Vilakazi Street, the Hector Pieterson Memorial, Orlando Stadium and the football club Orlando Pirates, and it has been the home of some of South Africa's greatest names.",
    history: [
      { year: "1931", text: "Orlando is laid out by the Johannesburg City Council as a township for African families moved out of inner-city slums. It is named after Edwin Orlando Leake." },
      { year: "1934", text: "Community leader James Sofasonke Mpanza settles in Orlando. A decade later he leads thousands of homeless residents to set up the Sofasonke squatter camp in Orlando West, a protest that helped push the council to build more housing." },
      { year: "1937", text: "The Orlando Boys Club is formed. It becomes the football club Orlando Pirates, still the pride of the township." },
      { year: "1959", text: "Orlando Stadium opens, built after pressure from Mpanza on the council." },
      { year: "1963", text: "The sprawling south-western townships are officially given the name Soweto." },
      { year: "16 June 1976", text: "Thousands of school pupils march through Orlando West to protest being taught in Afrikaans. Police open fire and 12-year-old Hector Pieterson is among those killed, sparking the Soweto Uprising." },
    ],
    landmarks: [
      { name: "Vilakazi Street", icon: "road-variant", text: "Said to be the only street in the world that was home to two Nobel Peace Prize winners, Nelson Mandela and Desmond Tutu. Packed with restaurants and street life." },
      { name: "Mandela House", icon: "home-heart", text: "The small house Mandela lived in from the 1940s, now the Mandela Family Museum." },
      { name: "Hector Pieterson Memorial & Museum", icon: "bank", text: "Marks the events of 16 June 1976 and the pupils who lost their lives." },
      { name: "Orlando Stadium", icon: "soccer-field", text: "Home ground of Orlando Pirates since 1959." },
      { name: "Orlando Towers", icon: "tower-fire", text: "The painted cooling towers of the old Orlando power station, now a colourful Soweto skyline icon and adventure spot." },
      { name: "Orlando East Public Library", icon: "library", text: "The oldest public library in Soweto, open since at least 1950." },
    ],
    people: [
      { name: "Nelson Mandela", role: "Anti-apartheid leader & first democratic president", note: "Lived on Vilakazi Street in Orlando West." },
      { name: "Desmond Tutu", role: "Archbishop & Nobel Peace Prize winner", note: "Lived a few doors up Vilakazi Street." },
      { name: "Winnie Madikizela-Mandela", role: "Struggle activist & politician", note: "Lived in the Orlando West family home on Vilakazi Street." },
      { name: "Walter Sisulu", role: "ANC leader", note: "Lived in Orlando West." },
      { name: "Seth Mazibuko", role: "1976 student-uprising leader", note: "Born in Orlando West." },
      { name: "Letta Mbulu", role: "Singer", note: "Born in Orlando East; an internationally known voice." },
      { name: "Sello Maake Ka-Ncube", role: "Actor, playwright & director", note: "Born in Orlando East." },
      { name: "James Sofasonke Mpanza", role: "Community leader", note: "Founder of the Sofasonke movement; his Orlando East home carries a heritage plaque." },
    ],
    facts: [
      "Orlando Pirates' nickname \"Ezimnyama Ngenkani\" is tied to the township's early days.",
      "Orlando is generally recognised as the first township established in what became Soweto.",
    ],
  },

  // ───────────────────────────── MEADOWLANDS ──────────────────────────────
  {
    key: "meadowlands",
    match: ["meadowlands"],
    name: "Meadowlands",
    area: "Soweto, north-west",
    colors: TOWNSHIP_COLORS[1],
    tagline: "Born from Sophiatown — a township that carries its memory.",
    established: "Early 1950s",
    namedAfter: null,
    overview:
      "Meadowlands was built so that people could be moved out of Sophiatown, the lively, mixed Johannesburg suburb that was destroyed under apartheid. Families carried Sophiatown's music, theatre and spirit with them, and Meadowlands has gone on to produce actors, musicians, a boxing champion and a president.",
    history: [
      { year: "Early 1950s", text: "Meadowlands is established for African residents who were to be removed from Sophiatown." },
      { year: "1955", text: "The forced removals from Sophiatown begin. Families are loaded onto trucks and taken to Meadowlands. Sophiatown is later flattened and rebuilt as a white suburb called Triomf." },
      { year: "Later", text: "When space ran out, the council provided more land in neighbouring Diepkloof for people removed from areas such as Martindale and Sophiatown. The two townships are sometimes called \"Diepmeadow\" together." },
    ],
    landmarks: [],
    people: [
      { name: "Kgalema Motlanthe", role: "Former President of South Africa", note: "Listed among notable Meadowlands residents." },
      { name: "Thandiswa Mazwai", role: "Singer (formerly of Bongo Maffin)", note: "Spent part of her childhood in Meadowlands." },
      { name: "Sindi Dlathu", role: "Actress", note: "Known for The River; lived in Zone 10." },
      { name: "Rapulana Seiphemo", role: "Actor", note: "Born in Meadowlands; seen in Invictus and many TV dramas." },
      { name: "Vusi Kunene", role: "Actor", note: "A familiar face on South African TV and film." },
      { name: "Jacob \"Baby Jake\" Matlala", role: "Boxer", note: "Former world champion from Meadowlands." },
      { name: "Patrick Shai", role: "Late veteran actor", note: "Born in Sophiatown and raised in Meadowlands after the removals." },
    ],
    facts: [
      "Meadowlands and Diepkloof are often joined as \"Diepmeadow\", even though Orlando lies between them.",
    ],
  },

  // ───────────────────────────── DIEPKLOOF ────────────────────────────────
  {
    key: "diepkloof",
    match: ["diepkloof", "diepkloof extension", "diepmeadow"],
    name: "Diepkloof",
    area: "Soweto, south of Orlando",
    colors: TOWNSHIP_COLORS[2],
    tagline: "A footballing powerhouse and a stage for big talent.",
    established: "1959",
    namedAfter: "The Diepkloof farm on which it was laid out",
    overview:
      "Diepkloof was developed to house people removed from Alexandra. Over the decades it grew into one of Soweto's largest sections, and its later extension became known for bigger, owner-built family homes. It is the hometown of football legends, TV actors and amapiano stars.",
    history: [
      { year: "1930s", text: "The Johannesburg City Council buys the Klipspruit and Diepkloof farms, the land on which Soweto is later laid out." },
      { year: "1959", text: "Diepkloof is established to accommodate people forcibly removed from Alexandra." },
      { year: "1980s", text: "Diepkloof Extension is developed for the relatively better-off Black middle class, with large owner-built houses." },
      { year: "Early 1990s", text: "Self Defence Units are formed in Diepkloof to protect the community during the violent years before democracy." },
    ],
    landmarks: [
      { name: "Chris Hani Baragwanath Hospital", icon: "hospital-building", text: "One of the largest hospitals in the world, on the edge of Diepkloof and serving millions." },
      { name: "Diepkloof Park & Vuyani Mabaxa Memorial", icon: "tree", text: "A community park with a memorial to a young activist of the 1980s." },
    ],
    people: [
      { name: "Lucas Radebe", role: "Football legend", note: "Born in Diepkloof. Former Bafana Bafana and Leeds United captain, nicknamed \"The Chief\"." },
      { name: "John \"Shoes\" Moshoeu", role: "Footballer", note: "Born in Diepkloof; a creative Bafana Bafana midfielder." },
      { name: "Obed Baloyi", role: "Actor & playwright", note: "From Diepkloof; won a SAFTA for Ga Re Dumele and appeared in DiepCity." },
      { name: "Lerato Kganyago", role: "Radio & TV personality", note: "Diepkloof-born broadcaster." },
      { name: "Daliwonga", role: "Amapiano artist", note: "Born and raised in Diepkloof." },
      { name: "Vincent \"Viva\" Ncabashe", role: "Performer & musical director", note: "Raised in Diepkloof; co-creator of the touring Gumboots show." },
    ],
    facts: [
      "The popular TV drama DiepCity is set in and named after Diepkloof.",
    ],
  },

  // ───────────────────────────── DOBSONVILLE ──────────────────────────────
  {
    key: "dobsonville",
    match: ["dobsonville", "dobsonville gardens"],
    name: "Dobsonville",
    area: "Soweto, west",
    colors: TOWNSHIP_COLORS[3],
    tagline: "A township with its own story, from Roodepoort roots to Soweto pride.",
    established: "1950s",
    namedAfter: "Denis Dobson, a location superintendent during the removals",
    overview:
      "Dobsonville grew from the old Roodepoort location, and for decades it fell under the Roodepoort municipality rather than Soweto. It only joined Soweto in 1994. It is home to Soweto's first shopping centre, a much-loved stadium, and one of Africa's best-known singers.",
    history: [
      { year: "Before the 1950s", text: "The old Roodepoort location (Juliwe) grows into a multi-ethnic community of workers and families over more than five decades." },
      { year: "1950s", text: "Residents are removed from the old location as a so-called \"Black Spot\" and resettled in Dobsonville, named after location superintendent Denis Dobson." },
      { year: "1957", text: "Dobsonville Stadium's grounds are set aside as a playing field as people from Roodepoort West are resettled." },
      { year: "1994", text: "Dobsonville, long under the Roodepoort municipality, is merged with Soweto." },
      { year: "Today", text: "Wits University's History Workshop has recorded more than 100 oral histories from residents to preserve the township's story." },
    ],
    landmarks: [
      { name: "Dobsonville Stadium", icon: "soccer-field", text: "Home ground of Moroka Swallows. Renovated in 2009 and used for international matches, including the African Youth Championship." },
      { name: "Dobsonville Shopping Centre", icon: "store", text: "The first shopping centre built in Soweto, an early sign of township economic growth." },
    ],
    people: [
      { name: "Yvonne Chaka Chaka", role: "Singer & humanitarian, \"Princess of Africa\"", note: "Born in Dobsonville in 1965; a goodwill ambassador for health causes." },
      { name: "Peter \"Terror\" Mathebula", role: "Boxer", note: "Dobsonville fighter widely cited as the first Black South African world boxing champion." },
      { name: "Lebo Moalusi", role: "Gospel vocalist", note: "Born and bred in Dobsonville; sings with Joyous Celebration." },
    ],
    facts: [
      "Dobsonville is next to Meadowlands, Mofolo North and Zondi.",
      "People from Dobsonville joke that they were \"not properly Soweto\" because the township fell under Roodepoort until 1994.",
    ],
  },

  // ───────────────────────────── EMNDENI ──────────────────────────────────
  {
    key: "emndeni",
    match: ["emndeni", "emdeni", "emdeni south", "emdeni north"],
    name: "Emndeni",
    area: "Soweto (also spelled Emdeni)",
    colors: TOWNSHIP_COLORS[4],
    tagline: "A proud kasi with football in its blood and rhymes on its street corners.",
    established: "Mid-20th century",
    namedAfter: null,
    overview:
      "Emndeni, also written Emdeni, is one of the Soweto townships laid out when the council grouped residents by language. Zulu and Xhosa speakers were placed here alongside Dlamini, Senaoane, Zola, Zondi, Jabulani and White City. Today it is known for its busy streets, local football clubs and a new generation of hip-hop artists.",
    history: [
      { year: "1930s–50s", text: "Johannesburg's council lays out new townships in the south-west and places residents according to language group. Emdeni is one of the sections for Zulu and Xhosa speakers." },
      { year: "1963", text: "The whole area is officially named Soweto, short for South Western Townships." },
      { year: "Today", text: "Neighbourhood football clubs such as the Emndeni Naughty Boys keep the community spirit alive." },
    ],
    landmarks: [
      { name: "Emdeni High School", icon: "school", text: "A long-standing local school remembered fondly by many past learners." },
    ],
    people: [
      { name: "Veli Ndaba", role: "Speaker", note: "Born in Emdeni; shares his journey on stages across the country." },
      { name: "ApeX CarteR", role: "Hip-hop artist", note: "Born and raised in Emndeni; rising rapper." },
      { name: "G-Buzy", role: "Rapper, singer & producer", note: "Grew up in Emndeni; founder of the DeckOutTeam collective." },
    ],
    facts: [
      "Emndeni's local team Emndeni Naughty Boys won the 2010 Clinix Soweto Cup, played during the World Cup build-up.",
    ],
  },

  // ───────────────────────────── PROTEA GLEN ──────────────────────────────
  {
    key: "protea-glen",
    match: ["protea glen", "protea north", "protea south", "protea"],
    name: "Protea Glen",
    area: "Western edge of Soweto",
    colors: TOWNSHIP_COLORS[5],
    tagline: "Soweto's modern frontier, built for a new generation.",
    established: "1990s",
    namedAfter: null,
    overview:
      "Protea Glen is one of Soweto's newest areas. Instead of being laid out under apartheid, it was developed after 1990 for the growing Black middle class, and it has become one of Gauteng's busiest residential suburbs, with schools, a mall and sports projects.",
    history: [
      { year: "1980s", text: "The first land options west of Soweto are signed, setting the scene for a new residential area." },
      { year: "1990s", text: "Protea Glen is developed as housing for middle-class families who wanted to own homes in Soweto." },
      { year: "2012", text: "Protea Glen Mall opens, the first shopping mall in the area, with 90 or more tenants." },
      { year: "Today", text: "Protea Glen is home to local schools, clinics and a community sports park supported by football legend Lucas Radebe and partners." },
    ],
    landmarks: [
      { name: "Protea Glen Mall", icon: "shopping", text: "Opened in 2012 as the area's first mall." },
      { name: "Sustainable Legacy Park", icon: "soccer", text: "A community sports park created with the Protea Glen community and sports legends." },
    ],
    people: [
      { name: "Don Mattera", role: "Poet, author & activist", note: "A Sophiatown-raised literary giant who made his home in Protea Glen." },
      { name: "Babalwa M", role: "Singer", note: "Raised in Protea Glen; made headlines at the South African Music Awards." },
      { name: "Rethabile Khumalo", role: "Afro-house & amapiano artist", note: "Born in Protea Glen." },
    ],
    facts: [
      "Protea Glen is far newer than most Soweto townships. It was planned in the 1990s rather than the apartheid era.",
    ],
  },

  // ───────────────────────────── KLIPTOWN ─────────────────────────────────
  {
    key: "kliptown",
    match: ["kliptown"],
    name: "Kliptown",
    area: "South of Soweto",
    colors: TOWNSHIP_COLORS[0],
    tagline: "Where the Freedom Charter was adopted.",
    established: "Early 1900s",
    namedAfter: null,
    overview:
      "Kliptown is one of the oldest settlements in the Soweto area and the place where, in June 1955, thousands gathered for the Congress of the People and adopted the Freedom Charter, a vision for a free and equal South Africa.",
    history: [
      { year: "1900s", text: "Kliptown grows as one of the earliest settlements for people of all backgrounds on the south-western edge of Johannesburg." },
      { year: "1955", text: "The Congress of the People meets in Kliptown and the Freedom Charter is adopted, becoming a founding document of the democratic struggle." },
      { year: "Today", text: "Walter Sisulu Square of Dedication marks the site and tells the story of the Charter." },
    ],
    landmarks: [
      { name: "Walter Sisulu Square of Dedication", icon: "monument", text: "Memorial square, museum and market on the site of the 1955 gathering." },
    ],
    people: [],
    facts: ["The Freedom Charter was adopted on 26 June 1955."],
  },

  // ───────────────────────────── ZOLA ─────────────────────────────────────
  {
    key: "zola",
    match: ["zola", "zola north", "zola south"],
    name: "Zola",
    area: "Soweto, south-west",
    colors: TOWNSHIP_COLORS[1],
    tagline: "The township that gave kwaito a star its own name.",
    established: "Mid-20th century",
    namedAfter: null,
    overview:
      "Zola is one of the Soweto townships set aside in the council's language-based layout for Zulu and Xhosa speakers. It is famous for producing kwaito star Zola 7, who took his stage name from his hometown.",
    history: [
      { year: "Mid-20th century", text: "Zola is laid out as one of the south-western Soweto townships." },
      { year: "2000s", text: "Native son Bonginkosi Dlamini rises to national fame as Zola 7, putting the township on the map through kwaito and TV." },
    ],
    landmarks: [],
    people: [
      { name: "Zola 7", role: "Kwaito musician, poet & TV presenter", note: "Born Bonginkosi Dlamini; grew up in Zola and took his name from it." },
    ],
    facts: [],
  },
]

// Shown when we don't have a bundled entry for a township name
export const SOWETO_GENERAL = {
  key: "soweto",
  match: [],
  name: "Soweto",
  area: "South-west Johannesburg",
  colors: TOWNSHIP_COLORS[1],
  tagline: "South Western Townships — South Africa's most famous township.",
  established: "1963 (name)",
  overview:
    "Soweto is a collection of townships south-west of Johannesburg. The name, an abbreviation of South Western Townships, was officially adopted in 1963. Home to Nelson Mandela and Desmond Tutu, it was the centre of the 1976 student uprising and is a birthplace of kwaito and kasi rap.",
  history: [
    { year: "1904", text: "Klipspruit, the first settlement for workers moved from Johannesburg, is established." },
    { year: "1930s", text: "Orlando is laid out as the first major township." },
    { year: "1963", text: "The name Soweto is officially adopted." },
    { year: "1976", text: "The Soweto Uprising begins on 16 June." },
  ],
  landmarks: [],
  people: [],
  facts: [],
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()

export const findTownshipInfo = (name) => {
  const n = norm(name)
  if (!n) return null
  return (
    TOWNSHIPS.find((t) => t.match.some((m) => norm(m) === n)) ||
    TOWNSHIPS.find((t) => t.match.some((m) => n.includes(norm(m)) || norm(m).includes(n))) ||
    null
  )
}

const toLines = (v) => {
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : x?.text || "")).filter(Boolean)
  if (typeof v === "string") return v.split(/\n+/).map((s) => s.trim()).filter(Boolean)
  return []
}
const toPeople = (v) =>
  (Array.isArray(v) ? v : [])
    .map((p) => (typeof p === "string" ? { name: p } : { name: p?.name, role: p?.role || p?.knownFor, note: p?.note || p?.description }))
    .filter((p) => p.name)
const toLandmarks = (v) =>
  (Array.isArray(v) ? v : [])
    .map((l) => (typeof l === "string" ? { name: l } : { name: l?.name, text: l?.text || l?.description, icon: l?.icon }))
    .filter((l) => l.name)

const unionBy = (a, b, key = "name") => {
  const seen = new Set(a.map((x) => norm(x[key])))
  return [...a, ...b.filter((x) => !seen.has(norm(x[key])))]
}

/**
 * Builds the full info object for a township. `t` is either a string (a name) or
 * a Firestore document ({ id, name, ...fields }). Always returns something usable.
 */
export const getTownshipInfo = (t, index = 0) => {
  const doc = typeof t === "string" ? { name: t } : (t || {})
  const bundled = findTownshipInfo(doc.name)
  const base = bundled || {
    ...SOWETO_GENERAL,
    key: norm(doc.name) || "township",
    name: doc.name || "Township",
    area: "Soweto",
    colors: TOWNSHIP_COLORS[index % TOWNSHIP_COLORS.length],
    tagline: `${doc.name || "This township"} is part of greater Soweto.`,
    established: null,
    history: SOWETO_GENERAL.history,
    isGeneral: true,
  }

  const fsHistory = toLines(doc.history)
  const fsOverview = doc.description || doc.about || doc.overview

  return {
    ...base,
    name: doc.name || base.name,
    tagline: doc.tagline || base.tagline,
    established: doc.established || base.established,
    overview: fsOverview || base.overview,
    imageUrl: doc.imageUrl || doc.image || null,
    history: fsHistory.length ? fsHistory.map((text) => ({ text })) : base.history,
    people: unionBy(base.people || [], toPeople(doc.celebrities || doc.notablePeople || doc.people)),
    landmarks: unionBy(base.landmarks || [], toLandmarks(doc.landmarks)),
    facts: [...(base.facts || []), ...toLines(doc.facts || doc.funFacts)],
  }
}