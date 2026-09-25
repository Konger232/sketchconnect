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
      fontSize: {
        '3xs':  ['var(--text-3xs)',  { lineHeight: 'var(--leading-tight)' }],
        '2xs':  ['var(--text-2xs)',  { lineHeight: 'var(--leading-tight)' }],
        xs:     ['var(--text-xs)',   { lineHeight: 'var(--leading-normal)' }],
        sm:     ['var(--text-sm)',   { lineHeight: 'var(--leading-normal)' }],
        base:   ['var(--text-base)', { lineHeight: 'var(--leading-normal)' }],
        lg:     ['var(--text-lg)',   { lineHeight: 'var(--leading-snug)' }],
        xl:     ['var(--text-xl)',   { lineHeight: 'var(--leading-snug)' }],
        '2xl':  ['var(--text-2xl)',  { lineHeight: 'var(--leading-tight)' }],
        '4xl':  ['var(--text-4xl)',  { lineHeight: 'var(--leading-tight)' }],
      },
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
