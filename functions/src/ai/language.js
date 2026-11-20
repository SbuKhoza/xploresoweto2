"use strict"
// Lightweight language detection for the two launch languages. It only DECIDES which language to ask the model to answer in;
// it never claims quality. isiZulu stays flagged "unverified" in config until it passes human-reviewed quality tests.
const ZU = new Set(["sawubona", "sanibonani", "ngiyabonga", "ngicela", "ngifuna", "ngiyafuna", "ngithanda", "ngingathanda", "ngikhona", "yebo", "cha", "yini", "kuphi", "kanjani", "kunjani", "ngubani", "ngezindawo", "indawo", "izindawo", "zokudla", "ukudla", "ukuthi", "futhi", "kakhulu", "nami", "wena", "ubani", "nini", "malini", "ngemali", "eSoweto", "esoweto", "hlela", "uhlelo", "izinsuku", "usuku", "ngitshele", "ungitshele", "ngisize", "ungisize", "angikwazi", "ngingaya", "ngingakwenza", "lapha", "khona", "kodwa", "noma", "ngoba", "emcimbini", "imicimbi", "ukulala", "indawo yokulala", "ihhotela", "ingozi", "usizo", "ngiyaphila", "ngiyakwamukela", "siyakwamukela", "ubusuku", "ekuseni", "ntambama"].map((w) => w.toLowerCase()))
function detectLanguage(text) {
  const words = String(text || "").toLowerCase().normalize("NFC").split(/[^a-zA-ZÀ-ɏ']+/).filter(Boolean)
  if (!words.length) return "en"
  const hits = words.filter((w) => ZU.has(w)).length
  return hits >= 2 || (hits >= 1 && hits / words.length >= 0.25) ? "zu" : "en"
}
module.exports = { detectLanguage }
