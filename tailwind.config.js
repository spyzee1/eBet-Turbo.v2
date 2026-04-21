/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        'dark-bg': '#0f1117',
        'dark-card': '#1a1d2e',
        'dark-card-hover': '#222640',
        'dark-border': '#2a2e45',
        'accent': '#6366f1',
        'accent-light': '#818cf8',
        'green': '#10b981',
        'green-light': '#34d399',
        'red': '#ef4444',
        'red-light': '#f87171',
        'yellow': '#f59e0b',
        'yellow-light': '#fbbf24',
        'purple': '#a855f7',
      },
    },
  },
  plugins: [],
}
