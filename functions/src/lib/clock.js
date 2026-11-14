"use strict"
let nowFn = () => new Date()
module.exports = {
  now: () => nowFn(),
  setClockForTests: (fn) => { nowFn = fn || (() => new Date()) },
  // Today's date (YYYY-MM-DD) in South Africa
  todaySAST: () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(nowFn()),
}
