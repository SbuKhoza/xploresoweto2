"use strict"
// Social turns: greetings, thanks, farewells and acknowledgements, in English, South African English and common isiZulu/Sesotho/Setswana
// phrases. A message made ONLY of such phrases is a social turn. If it also carries a request ("Hi, where can I stay?", "thanks, and where
// can I eat?") the social part is stripped and the request is answered. Pure and deterministic.
const norm = (s) => String(s || "").toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim()
const W = "(?:malloya|there|everyone|all|guys|friend|bro|sis|boss|chief|my (?:bro|friend|china)|again)"
const PHRASES = {
  farewell: [
    "bye(?: bye)?", "goodbye", "good bye", "see (?:you|ya|u)(?: (?:later|soon|around|tomorrow))?", "(?:talk|chat|speak) (?:to you )?(?:later|soon)", "catch you later", "ciao",
    "hamba kahle", "sala kahle", "tsamaya hantle", "sharp sharp", "have a (?:good|great|nice|lovely) (?:one|day|evening|night|weekend|trip|visit)", "good night", "goodnight", "take care",
    "that'?s (?:all|it|everything)(?: for now)?", "that will be all", "i'?m (?:done|good|all set|finished)(?: for now)?", "all done", "nothing else", "no(?:thing)? more", "i'?m off", "i must go", "gotta go",
  ],
  thanks: [
    "thanks?(?: (?:a lot|so much|very much|a million|heaps|again|man|bro|sis|mate))?", "thank you(?: (?:so|very) much)?(?: (?:again|kindly))?", "thanks? you", "thx", "thnx", "ty", "tyvm", "cheers",
    "ngiyabonga(?: kakhulu)?", "siyabonga(?: kakhulu)?", "ke a leboha", "baie dankie", "dankie", "enkosi(?: kakhulu)?", "ke a leboga", "appreciate (?:it|that|the help)", "(?:much|really|greatly) appreciated", "i appreciate (?:it|that|the help)",
    "(?:that'?s|that is|this is|it'?s) (?:very |really |so )?(?:helpful|great|awesome|amazing|perfect|lovely|brilliant)(?: thanks?)?", "(?:you'?re|you are) (?:a )?(?:star|legend|lifesaver|the best|awesome|amazing)", "lekker thanks?", "good stuff",
  ],
  greeting: [
    "hi+", "hello+", "hey+", "hiya", "heya", "yo", "howzit", "how'?s it", "sawubona", "sanibonani", "molo", "molweni", "dumela", "dumelang", "heita", "hola", "greetings", "salut", "good (?:morning|afternoon|evening|day)",
    "hi there", "hello there", "hey there", "how are you(?: doing| today)?", "how are things", "how'?s it going", "what'?s up", "wassup", "sup", "ola", "good to (?:see|meet) you", "nice to (?:see|meet) you",
  ],
  acknowledge: [
    "ok(?:ay)?(?: (?:then|cool|great|thanks?))?", "o?kay", "k", "kk", "cool(?: cool| beans| thanks?)?", "great", "nice", "neat", "awesome", "perfect", "brilliant", "excellent", "sweet", "super", "wonderful", "fantastic", "alright", "all ?right", "aight",
    "got it", "i see", "i get it", "understood", "noted", "makes sense", "fair enough", "sure", "yep", "yup", "yes", "yeah", "ya", "yebo", "ja", "jaa", "sharp", "sho", "shot", "lekker", "hmm+", "mm+", "(?:yes |yeah |ok(?:ay)? )?please",
    "sounds? (?:good|great|fine|perfect|lovely|nice)", "that works", "that sounds? (?:good|great|fine|perfect|lovely|nice)", "will do", "no problem", "no worries", "all good", "good to know", "interesting", "oh nice", "oh cool", "oh ok(?:ay)?", "i'?ll (?:think|see)(?: about it)?",
  ],
}
const RANK = ["farewell", "thanks", "greeting", "acknowledge"] // when a message mixes kinds, the earlier kind wins ("ok bye thanks" is a farewell)
// one regex per phrase, the LONGEST match at a position wins ("thank you so much" beats "thank")
const COMPILED = RANK.map((k) => [k, PHRASES[k].map((p) => new RegExp(`^(?:${p})(?: ${W})?(?= |$)`))])
const longest = (res, text) => res.reduce((best, re) => { const m = re.exec(text); return m && (!best || m[0].length > best.length) ? m[0] : best }, null)

// -> { kind: farewell|thanks|greeting|acknowledge|null, rest: the message without leading/trailing social phrases ("" when only social) }
function classify(text) {
  let s = norm(text), kinds = new Set(), guard = 0
  const strip = (fromEnd) => {
    for (const [k, re] of COMPILED) {
      if (!fromEnd) { const m = longest(re, s); if (m) { s = s.slice(m.length).trim(); kinds.add(k); return true } }
      else { const words = s.split(" "); for (let n = Math.min(5, words.length); n >= 1; n--) { const tail = words.slice(words.length - n).join(" "); const m = longest(re, tail); if (m === tail) { s = words.slice(0, words.length - n).join(" "); kinds.add(k); return true } } }
    }
    return false
  }
  while (s && guard++ < 8 && strip(false)) { /* leading */ }
  while (s && guard++ < 16 && strip(true)) { /* trailing */ }
  if (s) return { kind: null, rest: s, stripped: [...kinds] }
  const kind = RANK.find((k) => kinds.has(k)) || null
  return { kind, rest: "", stripped: [...kinds] }
}
module.exports = { classify, norm }
