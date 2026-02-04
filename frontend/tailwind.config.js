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
        base: '#0a0f1a',
        surface: '#111827',
        elevated: '#1e293b',
        inset: '#0f172a',
        border: {
          DEFAULT: '#1e293b',
          subtle: '#334155',
        },
        text: {
          primary: '#f1f5f9',
          secondary: '#94a3b8',
          muted: '#64748b',
        },
        accent: {
          DEFAULT: '#2475c6',
          hover: '#1d6bb5',
          muted: '#1e3a5f',
        },
      },
    },
  },
  plugins: [],
}
