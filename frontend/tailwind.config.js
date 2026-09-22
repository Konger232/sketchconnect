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
        hand: ["'Nunito Sans'", "sans-serif"],
        heading: ["'Roboto'", "system-ui", "sans-serif"],
        sans: ["'Inter'", "system-ui", "sans-serif"],
      },
      // Small, reusable motion vocabulary for the capture wizard / AI prompt
      // flow (CapturePage, SketchFlowPage, AIPromptModal, ColorPalettePicker).
      // Mostly entrance-only by design -- these elements are conditionally
      // mounted by their parent (no exit-animation state machine needed to
      // get a transition when they first appear), and remounting
      // AIPromptModal per prompt (via a `key`) replays fadeInUp for each new
      // question. bounceDot is the one exception -- a looping animation for
      // LoadingDots.jsx, used on "Looking at your scene…"-style labels while
      // an actual Gemini call is in flight, not just on mount.
      keyframes: {
        fadeInUp: {
          '0%': { opacity: 0, transform: 'translateY(12px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        fadeInScale: {
          '0%': { opacity: 0, transform: 'scale(0.97)' },
          '100%': { opacity: 1, transform: 'scale(1)' },
        },
        bounceDot: {
          '0%, 80%, 100%': { transform: 'translateY(0)', opacity: 0.4 },
          '40%': { transform: 'translateY(-3px)', opacity: 1 },
        },
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.25s ease-out',
        'fade-in-scale': 'fadeInScale 0.2s ease-out',
        'bounce-dot': 'bounceDot 1.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
