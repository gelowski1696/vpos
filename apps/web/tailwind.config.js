/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brandPrimary: 'var(--brand-primary)',
        brandSecondary: 'var(--brand-secondary)'
      }
    }
  },
  plugins: []
};
