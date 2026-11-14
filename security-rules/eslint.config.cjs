// Parses the rules files with Firebase's own grammar (syntax errors + recommended semantic checks). Offline; no emulator needed.
const mod = require("@firebase/eslint-plugin-security-rules")
module.exports = [mod.flatRecommended || mod.default.configs["flat/recommended"]]
