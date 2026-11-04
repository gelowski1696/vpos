/**
 * VPOS Desktop — Tailwind config
 * Maps utility classes onto CSS tokens defined in src/styles/theme.css
 * Breakpoints align with the desktop shell:
 *   md  >= 1024 — persistent rail starts here (collapsed)
 *   lg  >= 1280 — rail expanded
 *   xl  >= 1536 — content max-width applied
 *   2xl >= 1800 — wide desktop gutters
 *   3xl >= 2200 — 4K+
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    screens: {
      xs: '480px',
      sm: '768px',
      md: '1024px',
      lg: '1280px',
      xl: '1536px',
      '2xl': '1800px',
      '3xl': '2200px'
    },
    extend: {
      colors: {
        bg: 'var(--bg)',
        'bg-strong': 'var(--bg-strong)',
        surface: 'var(--surface)',
        'surface-strong': 'var(--surface-strong)',
        'surface-muted': 'var(--surface-muted)',
        'border-soft': 'var(--border-soft)',
        text: 'var(--text)',
        'text-strong': 'var(--text-strong)',
        muted: 'var(--muted)',
        'muted-strong': 'var(--muted-strong)',
        placeholder: 'var(--placeholder)',
        accent: 'var(--accent)',
        'accent-strong': 'var(--accent-strong)',
        'accent-soft': 'var(--accent-soft)',
        'accent-soft-strong': 'var(--accent-soft-strong)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
        'danger-soft': 'var(--danger-soft)'
      },
      spacing: {
        'gutter-x': 'var(--content-gutter-x)',
        'gutter-y': 'var(--content-gutter-y)',
        'rail-collapsed': 'var(--rail-width-collapsed)',
        'rail-expanded': 'var(--rail-width-expanded)',
        topbar: 'var(--topbar-height)',
        'topbar-compact': 'var(--topbar-height-compact)',
        bottomdock: 'var(--bottomdock-height)'
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
        pill: 'var(--radius-pill)'
      },
      fontSize: {
        xs: ['var(--text-xs)', { lineHeight: 'var(--leading-xs)' }],
        sm: ['var(--text-sm)', { lineHeight: 'var(--leading-sm)' }],
        base: ['var(--text-base)', { lineHeight: 'var(--leading-base)' }],
        lg: ['var(--text-lg)', { lineHeight: 'var(--leading-lg)' }],
        xl: ['var(--text-xl)', { lineHeight: 'var(--leading-xl)' }],
        '2xl': ['var(--text-2xl)', { lineHeight: 'var(--leading-2xl)' }],
        '3xl': ['var(--text-3xl)', { lineHeight: 'var(--leading-3xl)' }],
        display: ['var(--text-display)', { lineHeight: 'var(--leading-display)' }]
      },
      fontWeight: {
        regular: 'var(--weight-regular)',
        medium: 'var(--weight-medium)',
        semibold: 'var(--weight-semibold)',
        bold: 'var(--weight-bold)',
        extrabold: 'var(--weight-extrabold)'
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)'
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow)',
        strong: 'var(--shadow-strong)',
        xl: 'var(--shadow-xl)'
      },
      maxWidth: {
        container: 'var(--container-max)',
        'container-wide': 'var(--container-max-wide)'
      },
      transitionDuration: {
        fast: 'var(--motion-fast)',
        normal: 'var(--motion-normal)',
        slow: 'var(--motion-slow)'
      },
      transitionTimingFunction: {
        standard: 'var(--ease-standard)',
        emphasized: 'var(--ease-emphasized)'
      },
      zIndex: {
        rail: '40',
        topbar: '55',
        topbarPopover: '59',
        drawer: '60',
        modal: '80',
        toast: '120',
        loading: '130'
      }
    }
  },
  plugins: []
};
