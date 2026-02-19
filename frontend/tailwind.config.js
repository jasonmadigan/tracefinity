/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        base: '#0a0a0b',
        surface: '#111113',
        elevated: '#191a1d',
        inset: '#0d0d0f',
        border: {
          DEFAULT: '#27272a',
          subtle: '#3f3f46',
        },
        text: {
          primary: '#f4f4f5',
          secondary: '#a1a1aa',
          muted: '#71717a',
        },
        accent: {
          DEFAULT: '#1f6fbd',
          hover: '#1860a8',
          muted: '#0e2d4f',
        },
      },
    },
  },
  plugins: [],
}
