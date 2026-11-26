"use strict"
// The ONLY words a learning candidate or approved phrase may contain. Anything else is replaced by a placeholder before it is stored,
// so a name, a street, a company or a typo never reaches the database. Adding a word is a code change that gets reviewed.
// Sensitive words are deliberately absent, and a message containing one is refused outright (see screen.js).
const w = (s) => s.split(/\s+/).filter(Boolean)
const FUNCTION_WORDS = w(`a an the and or but if so to of in on at for from with without by near around about into out up down over under
  i me my we us our you your it its they them their he she this that these those here there where when what which who how why
  is are was were be been am do does did can could would should will shall may might must have has had get got go going come want need like love
  looking look find show give tell let know see take make plan please any some more other another else also just really very much many too not no yes
  ok okay good great nice best better cheap cheaper cheapest expensive free open closed now today tomorrow tonight weekend morning evening
  something somewhere anything anyone someone place places spot spots thing things option options one two three four five six`)
const DOMAIN_WORDS = w(`eat eating food meal meals lunch dinner breakfast braai restaurant restaurants cafe cafes coffee drink drinks bar bars pub tavern shisanyama kota
  stay sleep sleeping bed beds room rooms hotel hotels lodge lodges guesthouse guesthouses hostel hostels bnb accommodation accommodations night nights
  visit visiting see sights sight tour tours guide guides history historical heritage museum museums culture cultural music jazz art arts craft crafts market markets
  shop shops shopping mall malls park parks hike hiking walk walking cycle cycling bike biking sport sports soccer football stadium fun family kids children child couple couples friends group
  event events show shows concert concerts festival festivals party news announcement announcements transport taxi taxis bus buses train trains get getting
  price prices cost costs pay paying budget rand cheap affordable hours time times opening closing book booking reserve reservation reserve
  directions direction far distance walkable safe safety accessible wheelchair wifi parking power electricity loadshedding
  clinic clinics doctor doctors pharmacy pharmacies hospital office offices service services
  halal vegan vegetarian traditional local authentic live dance dancing nightlife quiet romantic scenic view views
  tourist tourists tourism visitor visitors township soweto johannesburg
  recommend recommendation recommendations suggest suggestion suggestions popular famous top itinerary schedule trip days day half full week
  compare difference differences versus vs between which better worth review reviews rating ratings rated
  tell about info information details more describe opening hours contact phone number address website`)
const ALLOWED = new Set([...FUNCTION_WORDS, ...DOMAIN_WORDS])
// Words that do not by themselves say what someone wants: a signature needs at least two other words.
const STOP = new Set(w(`a an the and or but if so to of in on at for from with without by about into out up down over under i me my we us our you your it its they them their he she
  this that these those here there is are was were be been am do does did can could would should will shall may might must have has had get got go going come
  like looking look let know please any some more other another else also just really very much many too not no yes ok okay one two three four five six`))
const PLACEHOLDERS = new Set(["<x>", "<n>", "<place>"])
// A message that mentions any of these is NEVER captured (health, identity, finance, credentials, crisis, politics, religion, sexuality, crime).
const SENSITIVE = /\b(password|passcode|pin|otp|cvv|passport|identity|id number|id no|salary|income|bank|account number|card number|credit card|iban|swift|loan|debt|diagnos\w*|hiv|aids|std|stds|pregnan\w*|medic\w*|prescription|depress\w*|anxiety|suicid\w*|self harm|kill|rape|raped|abuse\w*|assault\w*|violen\w*|domestic|religio\w*|church|mosque|pastor|politic\w*|anc|da|eff|vote|voting|election|sexual\w*|gay|lesbian|trans|race|racist|tribe|ethnic\w*|criminal|arrest\w*|prison|jail|court|lawyer|police case|emergency|ambulance|help me|danger\w*|attack\w*|robbed|robbery|stolen|gun|weapon|drugs?|dagga|my name|i am called|call me|named|surname|my address|i live|i stay at|my wife|my husband|my son|my daughter|my mother|my father|my boss|my number|my email|whatsapp)\b/i
const PII_PATTERNS = [
  /[a-z0-9._%+-]+@[a-z0-9.-]+/i, // email
  /https?:|www\.|\b[a-z0-9-]+\.(com|co\.za|org|net|gov|io|app)\b/i, // link
  /(^|\s)[@#]\w/, // handle
  /\d[\d\s().+-]{4,}\d/, // phone, id or account number (any run of 6+ digits, even spaced)
]
// The supported intents an approved phrase may be pointed at. Side-effecting or safety intents are NOT here: learning can never route to them.
const LEARNABLE_INTENTS = Object.freeze(["find_restaurants", "find_accommodation", "find_attractions", "find_activities", "find_events", "find_news", "find_businesses", "find_tours", "find_tour_guides", "plan_trip", "build_itinerary", "recommend", "discover_things", "ask_price", "ask_hours", "ask_place", "find_townships", "help"])
const CORRECTION_INTENTS = LEARNABLE_INTENTS
module.exports = { ALLOWED, STOP, PLACEHOLDERS, SENSITIVE, PII_PATTERNS, LEARNABLE_INTENTS, CORRECTION_INTENTS }
