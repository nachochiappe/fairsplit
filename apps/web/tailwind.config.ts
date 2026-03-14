import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          strong: 'var(--ink-strong)',
          base: 'var(--ink-base)',
          muted: 'var(--ink-muted)',
          soft: 'var(--ink-soft)',
          inverse: 'var(--ink-inverse)',
        },
        surface: {
          DEFAULT: 'var(--surface)',
          soft: 'var(--surface-soft)',
          muted: 'var(--surface-muted)',
        },
        stroke: 'var(--stroke)',
        brand: {
          50: 'var(--brand-50)',
          100: 'var(--brand-100)',
          500: 'var(--brand-500)',
          600: 'var(--brand-600)',
          700: 'var(--brand-700)',
        },
      },
    },
  },
  plugins: [],
};

export default config;
