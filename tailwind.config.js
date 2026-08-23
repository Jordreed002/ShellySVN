/** @type {import('tailwindcss').Config} */
const colors = require('tailwindcss/colors');

module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dynamic theme colors via CSS variables with opacity support
        bg: {
          DEFAULT: 'rgb(var(--color-bg-rgb, 13 17 23) / <alpha-value>)',
          // alias of DEFAULT — the app canvas, referenced as `bg-bg-primary`
          primary: 'rgb(var(--color-bg-rgb, 13 17 23) / <alpha-value>)',
          // recessed surface: inputs, wells, tracks
          sunk: 'rgb(var(--color-bg-sunk-rgb, 10 14 20) / <alpha-value>)',
          secondary: 'rgb(var(--color-bg-secondary-rgb, 22 27 34) / <alpha-value>)',
          tertiary: 'rgb(var(--color-bg-tertiary-rgb, 33 38 45) / <alpha-value>)',
          elevated: 'rgb(var(--color-bg-elevated-rgb, 48 54 61) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--color-border-rgb, 37 45 56) / <alpha-value>)',
          muted: 'rgb(var(--color-border-muted-rgb, 28 35 44) / <alpha-value>)',
          strong: 'rgb(var(--color-border-strong-rgb, 58 68 83) / <alpha-value>)',
          focus: 'rgb(var(--color-accent-rgb, 88 166 255) / <alpha-value>)',
        },
        text: {
          DEFAULT: 'rgb(var(--color-text-rgb, 230 237 243) / <alpha-value>)',
          secondary: 'rgb(var(--color-text-secondary-rgb, 154 164 176) / <alpha-value>)',
          muted: 'rgb(var(--color-text-muted-rgb, 114 125 138) / <alpha-value>)',
          faint: 'rgb(var(--color-text-faint-rgb, 77 88 102) / <alpha-value>)',
        },
        /*
         * Accent shades hang off a single --color-accent-rgb triplet so a
         * custom accent (settings → Appearance) restyles everything, and
         * alpha utilities (bg-accent/10, border-accent/40, …) compose on top.
         * `soft` is identical to DEFAULT in both themes, so it reads the base
         * variable directly. `hover`/`muted` need per-theme lightening /
         * darkening that one alpha can't express — useVisualSettings computes
         * those triplets whenever the accent changes.
         */
        accent: {
          DEFAULT: 'rgb(var(--color-accent-rgb, 88 166 255) / <alpha-value>)',
          hover: 'rgb(var(--color-accent-hover-rgb, 132 192 255) / <alpha-value>)',
          muted: 'rgb(var(--color-accent-muted-rgb, 56 139 253) / <alpha-value>)',
          soft: 'rgb(var(--color-accent-rgb, 88 166 255) / <alpha-value>)',
        },
        // SVN Status Colors
        svn: {
          normal: 'rgb(var(--color-svn-normal-rgb, 63 185 80) / <alpha-value>)',
          added: 'rgb(var(--color-svn-added-rgb, 70 185 90) / <alpha-value>)',
          modified: 'rgb(var(--color-svn-modified-rgb, 217 161 41) / <alpha-value>)',
          deleted: 'rgb(var(--color-svn-deleted-rgb, 242 102 106) / <alpha-value>)',
          conflict: 'rgb(var(--color-svn-conflict-rgb, 242 102 106) / <alpha-value>)',
          unversioned: 'rgb(var(--color-svn-unversioned-rgb, 114 125 138) / <alpha-value>)',
          missing: 'rgb(var(--color-svn-missing-rgb, 242 102 106) / <alpha-value>)',
          replaced: 'rgb(var(--color-svn-replaced-rgb, 163 113 247) / <alpha-value>)',
          external: 'rgb(var(--color-svn-external-rgb, 57 197 207) / <alpha-value>)',
          ignored: 'rgb(var(--color-svn-ignored-rgb, 77 88 102) / <alpha-value>)',
          obstructed: 'rgb(var(--color-svn-obstructed-rgb, 240 136 62) / <alpha-value>)',
        },
        // UI States
        success: 'rgb(var(--color-success-rgb, 70 185 90) / <alpha-value>)',
        warning: 'rgb(var(--color-warning-rgb, 217 161 41) / <alpha-value>)',
        error: 'rgb(var(--color-error-rgb, 242 102 106) / <alpha-value>)',
        info: 'rgb(var(--color-info-rgb, 88 166 255) / <alpha-value>)',
      },
      fontFamily: {
        // Archivo + JetBrains Mono are self-hosted in styles/global.css (latin subset).
        // 'Archivo Variable' is the family name @fontsource-variable/archivo uses, kept
        // in the stack so importing the package CSS directly would also resolve.
        sans: [
          'Archivo',
          'Archivo Variable',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'JetBrains Mono Variable',
          'ui-monospace',
          'SFMono-Regular',
          'Fira Code',
          'Consolas',
          'Monaco',
          'monospace',
        ],
      },
      /*
       * Type scale ported from prototypes/12-browser.html.
       *
       * The prototype's base is 13.5px / 1.5 and its working ramp is much tighter
       * than Tailwind's default: 12.5 / 11.5 / 11 / 10.5 / 10 / 9.5 carry almost the
       * whole UI. Keys are the literal pixel value so a prototype rule
       * (`font-size:11.5px`) ports straight across as `text-11.5`, and components can
       * drop their `text-[11.5px]` arbitrary values.
       *
       * Tailwind's own `xs`/`sm`/`base`/... keys are untouched.
       */
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }], // legacy alias of text-10
        9.5: ['9.5px', { lineHeight: '1.35' }], // mono counts, badges, caps micro-labels
        10: ['10px', { lineHeight: '1.4' }], // eyebrow, column headers, mono meta
        10.5: ['10.5px', { lineHeight: '1.4' }], // pills, status bar, kbd, hunk headers
        11: ['11px', { lineHeight: '1.45' }], // flags, crumbs, mono revision numbers
        11.5: ['11.5px', { lineHeight: '1.5' }], // small buttons, tabs, diff/blame body
        12: ['12px', { lineHeight: '1.5' }], // dense prose, field labels
        12.5: ['12.5px', { lineHeight: '1.5' }], // default control + list text
        13: ['13px', { lineHeight: '1.45' }], // file names, primary row titles
        13.5: ['13.5px', { lineHeight: '1.5' }], // app base
        14: ['14px', { lineHeight: '1.4' }],
        14.5: ['14.5px', { lineHeight: '1.25' }], // wordmark
        15: ['15px', { lineHeight: '1.3' }], // large mono counters
        18: ['18px', { lineHeight: '1.2' }], // modal / section headings
      },
      letterSpacing: {
        eyebrow: '0.13em', // .eyebrow, context-menu group labels
        caps: '0.08em', // column headers, quieter uppercase labels
      },
      /*
       * Radius scale ported from the prototype: 4–11px in 1px steps, plus a 14px
       * overlay radius and a 99px pill. Tailwind's sm/DEFAULT/md/lg/xl keys are left
       * alone; use the numeric keys when matching the prototype exactly.
       */
      borderRadius: {
        4: '4px', // twisties, checkboxes
        5: '5px', // kbd, micro toggles
        6: '6px', // crumbs, tree nodes, focus ring
        7: '7px', // small buttons, menu items
        8: '8px', // buttons, inputs, icon buttons
        9: '9px', // pills, search fields, jumper rows
        10: '10px', // cards, problem rows, submenus
        11: '11px', // context menus
        14: '14px', // modals, command palette
        pill: '99px', // fully rounded chips/badges
      },
      /*
       * Control heights from the prototype. Prefixed keys so Tailwind's numeric
       * spacing scale (`h-8`, `p-6`, …) is untouched. The row keys read the
       * density variables (settings → Appearance → Density), so `h-row` /
       * `h-row-tree` follow compact/comfortable automatically.
       */
      spacing: {
        'control-xs': '24px', // inline crumbs, revision button, tree "show more"
        'control-sm': '26px', // .btn.sm, selects, status bar
        'control-md': '30px', // icon-only buttons, pane headers, list footer
        control: '32px', // default button / input / rail item
        'control-lg': '34px', // omnibar, modal inputs
        row: 'var(--row-height, 38px)', // directory listing row
        'row-tree': 'var(--row-height-tree, 27px)', // tree node row
      },
      boxShadow: {
        'glow-accent': '0 0 18px var(--color-accent-glow, rgba(88, 166, 255, 0.4))',
        'glow-success': '0 0 18px var(--color-success-glow, rgba(70, 185, 90, 0.4))',
        'glow-warning': '0 0 18px var(--color-warning-glow, rgba(217, 161, 41, 0.4))',
        'glow-error': '0 0 18px var(--color-error-glow, rgba(242, 102, 106, 0.4))',
        card: 'var(--shadow-card, 0 1px 2px rgba(0, 0, 0, 0.4))',
        panel: 'var(--shadow-panel, 0 4px 14px -4px rgba(0, 0, 0, 0.6))',
        overlay: 'var(--shadow-overlay, 0 26px 60px -18px rgba(0, 0, 0, 0.8))',
        dropdown: 'var(--shadow-overlay, 0 8px 24px rgba(0, 0, 0, 0.85))',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
        'slide-down': 'slideDown 0.2s ease-out',
        'scale-in': 'scaleIn 0.15s ease-out',
        'spin-slow': 'spin 2s linear infinite',
        'pulse-subtle': 'pulseSubtle 2s ease-in-out infinite',
        'indeterminate-progress': 'indeterminateProgress 1.5s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        indeterminateProgress: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
      },
      transitionTimingFunction: {
        'out-quart': 'cubic-bezier(0.25, 1, 0.5, 1)',
      },
    },
  },
  plugins: [],
};
