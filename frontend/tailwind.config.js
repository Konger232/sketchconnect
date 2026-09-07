/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111111",
        paper: "#fdfdfb",
        accent: "#c23b22", // red outline/underline accent seen throughout the Figma prototype
      },
      fontFamily: {
        // Logo, tagline, footer nav — handwritten accents (Claude Design system).
        hand: ["'Kalam'", "cursive"],
        // Page headers (h1/h2/h3).
        heading: ["'Roboto'", "system-ui", "sans-serif"],
        // Body text.
        sans: ["'Inter'", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
}
