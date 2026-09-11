/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111111",
        paper: "#f9f9f9",
        accent: "#c23b22", // red outline/underline accent seen throughout the Figma prototype
      },
      fontFamily: {
        // Logo, tagline, footer nav accents. Was Kalam (a handwritten-style
        // font, matching the original Claude Design system look) -- swapped
        // to Nunito Sans after pulling it from lizsteel.com's typography,
        // for a cleaner, less "handwriting font" feel on these accents.
        hand: ["'Nunito Sans'", "sans-serif"],
        // Page headers (h1/h2/h3).
        heading: ["'Roboto'", "system-ui", "sans-serif"],
        // Body text.
        sans: ["'Inter'", "system-ui", "sans-serif"],
      },
      // Small, reusable motion vocabulary for the capture wizard / AI prompt
      // flow (CapturePage, SketchFlowPage, AIPromptModal, ColorPalettePicker).
      // Entrance-only by design -- these elements are conditionally mounted
      // by their parent (no exit-animation state machine needed to get a
      // transition when they first appear), and remounting AIPromptModal
      // per prompt (via a `key`) replays fadeInUp for each new question.
      keyframes: {
        fadeInUp: {
          '0%': { opacity: 0, transform: 'translateY(12px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        fadeInScale: {
          '0%': { opacity: 0, transform: 'scale(0.97)' },
          '100%': { opacity: 1, transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.25s ease-out',
        'fade-in-scale': 'fadeInScale 0.2s ease-out',
      },
    },
  },
  plugins: [],
}
