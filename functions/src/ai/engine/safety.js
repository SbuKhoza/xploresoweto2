"use strict"
// Free text that comes from the database (descriptions, notices) is provider-written and can go stale or overclaim.
// Before ANY of it is quoted, sentences that assert things the platform cannot know are removed:
// live availability, booking confirmations, and travel times. (Ported from the Stage 2A grounding rules; the English wording is
// the limitation: other languages would need their own patterns.)
const RE = {
  availability: /\b(?:is|are|still|currently|now)\s+(?:available|vacant|open for booking)\b|\b(?:has|have|with)\s+(?:rooms?|tables?|space|vacanc\w+|availability)\s*(?:available|free|left)?\b|\b(?:fully|completely)\s+booked\b|\bbooked\s+out\b|\bsold\s+out\b|\bno\s+vacanc\w+\b|\bavailable\s+(?:tonight|today|tomorrow|this\s+(?:weekend|week)|on\s+\w+day|24\/7|all\s+year)\b|\bwalk-?ins?\s+(?:are\s+)?(?:welcome|accepted|available)\b/i,
  booking: /\b(?:i(?:'ve|\s+have|'ll|\s+will)?\s+(?:booked|reserved|confirmed|secured)|(?:your|the)\s+(?:booking|reservation|table|room|spot|request)\s+(?:is|has\s+been|was|got)\s+(?:now\s+)?(?:confirmed|booked|made|reserved|secured|accepted|approved)|booking\s+(?:is\s+)?(?:now\s+)?confirmed|you(?:'re|\s+are)\s+(?:all\s+)?(?:booked|set|confirmed)|instant(?:ly)?\s+(?:book|confirm)\w*|guaranteed\s+(?:booking|spot|table))\b/i,
  travelTime: /\b\d+(?:[.,]\d+)?\s*(?:-\s*\d+\s*)?(?:min(?:ute)?s?|hours?|hrs?)\s*(?:\w+\s+){0,2}(?:drive|driving|walk|walking|ride|away|by\s+(?:car|taxi|bus|train|foot|uber|bolt)|travel|trip|journey)\b|\b(?:drive|walk|ride|trip|journey|travel)\s+(?:time\s+)?(?:of|is|takes?|about|around)\s+(?:about\s+|around\s+)?\d+\s*(?:min|hour|hr)/i,
}
const sentences = (t) => String(t).split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean)
const unverifiable = (s) => RE.availability.test(s) || RE.booking.test(s) || RE.travelTime.test(s)
function cleanQuoted(text, max = 200) {
  const kept = sentences(text).filter((s) => !unverifiable(s))
  const out = kept.join(" ")
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out
}
module.exports = { cleanQuoted, unverifiable, RE }
