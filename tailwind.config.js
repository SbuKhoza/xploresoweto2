/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./App.js",
    "./index.js",
    "./screens/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Unified brand palette — replaces the per-screen ACCENT/HIGHLIGHT
        // constants that had drifted (teal+orange on Home, navy+pink elsewhere).
        ink: {
          DEFAULT: "#14213D", // primary text / dark surfaces
          soft: "#3A4A63",
        },
        teal: {
          DEFAULT: "#1B4D5C",
          light: "#E8F4F7",
        },
        brand: {
          DEFAULT: "#E8600A", // primary CTA / highlight orange
          light: "#FFF1E8",
          dark: "#C74E06",
        },
        bg: "#FAF7F2",        // warm off-white app background
        surface: "#FFFFFF",
        muted: "#7A8A8F",
        line: "#ECE6DD",
        success: { DEFAULT: "#22C55E", light: "#EAFBF1" },
        warning: { DEFAULT: "#F59E0B", light: "#FEF3C7" },
        danger:  { DEFAULT: "#EF4444", light: "#FFF0F0" },
      },
      fontFamily: {
        display: ["System"],
      },
      borderRadius: {
        xl2: "20px",
      },
    },
  },
  plugins: [],
}
