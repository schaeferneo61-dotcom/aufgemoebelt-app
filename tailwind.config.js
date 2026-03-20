/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        raleway: ['Raleway', 'sans-serif'],
        opensans: ['"Open Sans"', 'sans-serif'],
      },
      colors: {
        border: '#97999b',
        surface: '#111111',
        muted: '#97999b',
      },
    },
  },
  plugins: [],
}
