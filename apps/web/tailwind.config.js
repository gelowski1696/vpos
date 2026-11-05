/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brandPrimary: 'var(--brand-primary)',
        brandSecondary: 'var(--brand-secondary)',
        adminCanvas: 'var(--admin-canvas)',
        adminSidebar: 'var(--admin-sidebar)',
        adminSurface: 'var(--admin-surface)',
        adminMuted: 'var(--admin-surface-muted)',
        adminBorder: 'var(--admin-border)',
        adminText: 'var(--admin-text)',
        adminTextMuted: 'var(--admin-text-muted)',
        adminAccent: 'var(--admin-accent)',
        adminAccentSoft: 'var(--admin-accent-soft)'
      }
    }
  },
  plugins: []
};
