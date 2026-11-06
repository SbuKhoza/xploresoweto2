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
          light: "#C9E8F3",
        },
        brand: {
          DEFAULT: "#E8600A", // primary CTA / highlight orange
          light: "#FFD9BD",
          dark: "#C74E06",
        },
        bg: "#F5F7FA",        // glossy white page background
        surface: "#FFFFFF",
        muted: "#5E7088",
        line: "#DDE2EA",
        success: { DEFAULT: "#22C55E", light: "#C4F3D6" },
        warning: { DEFAULT: "#F59E0B", light: "#FCE39A" },
        danger:  { DEFAULT: "#EF4444", light: "#FFD2D2" },
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