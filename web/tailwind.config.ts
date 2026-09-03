import type { Config } from 'tailwindcss';

// Design system ported from the AGS KPI App (Performance Hub) so the two tools
// look like one product. Values are copied deliberately rather than
// approximated -- notes below record the reasoning that came with them, so a
// future edit here does not quietly undo an accessibility decision made there.
const config: Config = {
  // Light-only, matching the KPI app; no dark-mode strategy is configured.
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    screens: {
      xs: '480px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        ground:       '#EDF0F4',
        navy:         '#1A2332',
        'app-text':   '#1E2330',
        amber:        '#E8900A',
        // For use as *text* (badges, warnings, stat tiles): ~5.9:1 on white,
        // ~5.1:1 on `ground`. Plain `amber` above is ~2.5:1 and FAILS AA as
        // text -- keep it for fills and dots only. Our "sync is stale" warning
        // is a text case, so it uses this.
        'amber-dark': '#96540A',
        'app-blue':   '#2155CD',
        'nte-red':    '#C8320A',
        'safe-green': '#1A7A4A',
        muted:        '#4A5A70',
        border:       '#CDD4DC',
        'row-alt':    '#F6F8FA',
        'row-hover':  '#EBF0FA',
        'row-active': '#E4ECFA',
        'row-border': '#EEF1F4',
      },
      // `base` is deliberately left at Tailwind's default 16px: inputs rely on
      // `text-base md:text-md` to stop iOS Safari zooming in on focus, so it
      // must stay untouched.
      fontSize: {
        '3xs': '9.5px',
        '2xs': '10.5px',
        xs: '11.5px',
        sm: '12.5px',
        md: '14px',
        lg: '18px',
        xl: '20px',
        '2xl': '22px',
      },
      borderRadius: {
        xs: '3px',
        md: '5px',
        lg: '6px',
        xl: '8px',
      },
      letterSpacing: {
        'mono-compact': '0.08em',
        'mono-label': '0.09em',
        'mono-wide': '0.12em',
        'mono-widest': '0.16em',
      },
      fontFamily: {
        // Resolve to the next/font CSS variables set in app/layout.tsx, with
        // system-stack fallbacks so text renders before the web font loads.
        sans: [
          'var(--font-sans)',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: ["var(--font-mono)", "'JetBrains Mono'", "'Fira Code'", 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
