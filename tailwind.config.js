/** @type {import('tailwindcss').Config} */
const colors = require('tailwindcss/colors')

module.exports = {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        // Dynamic theme colors via CSS variables with opacity support
        bg: {
          DEFAULT: 'rgb(var(--color-bg-rgb, 13 17 23) / <alpha-value>)',
          secondary: 'rgb(var(--color-bg-secondary-rgb, 22 27 34) / <alpha-value>)',
          tertiary: 'rgb(var(--color-bg-tertiary-rgb, 33 38 45) / <alpha-value>)',
          elevated: 'rgb(var(--color-bg-elevated-rgb, 48 54 61) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--color-border-rgb, 48 54 61) / <alpha-value>)',
          muted: 'rgb(var(--color-border-muted-rgb, 33 38 45) / <alpha-value>)',
          focus: 'rgb(var(--color-accent-rgb, 88 166 255) / <alpha-value>)',
        },
        text: {
          DEFAULT: 'rgb(var(--color-text-rgb, 230 237 243) / <alpha-value>)',
          secondary: 'rgb(var(--color-text-secondary-rgb, 139 148 158) / <alpha-value>)',
          muted: 'rgb(var(--color-text-muted-rgb, 110 118 129) / <alpha-value>)',
          faint: 'rgb(var(--color-text-faint-rgb, 72 79 88) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--color-accent-rgb, 88 166 255) / <alpha-value>)',
          hover: 'rgb(var(--color-accent-hover-rgb, 121 184 255) / <alpha-value>)',
          muted: 'rgb(var(--color-accent-muted-rgb, 56 139 253) / <alpha-value>)',
        },
        // SVN Status Colors
        svn: {
          normal: 'rgb(var(--color-svn-normal-rgb, 63 185 80) / <alpha-value>)',
          added: 'rgb(var(--color-svn-added-rgb, 88 166 255) / <alpha-value>)',
          modified: 'rgb(var(--color-svn-modified-rgb, 210 153 34) / <alpha-value>)',
          deleted: 'rgb(var(--color-svn-deleted-rgb, 248 81 73) / <alpha-value>)',
          conflict: 'rgb(var(--color-svn-conflict-rgb, 248 81 73) / <alpha-value>)',
          unversioned: 'rgb(var(--color-svn-unversioned-rgb, 110 118 129) / <alpha-value>)',
          missing: 'rgb(var(--color-svn-missing-rgb, 248 81 73) / <alpha-value>)',
          replaced: 'rgb(var(--color-svn-replaced-rgb, 163 113 247) / <alpha-value>)',
          external: 'rgb(var(--color-svn-external-rgb, 57 197 207) / <alpha-value>)',
          ignored: 'rgb(var(--color-svn-ignored-rgb, 72 79 88) / <alpha-value>)',
          obstructed: 'rgb(var(--color-svn-obstructed-rgb, 240 136 62) / <alpha-value>)',
        },
        // UI States
        success: 'rgb(var(--color-success-rgb, 63 185 80) / <alpha-value>)',
        warning: 'rgb(var(--color-warning-rgb, 210 153 34) / <alpha-value>)',
        error: 'rgb(var(--color-error-rgb, 248 81 73) / <alpha-value>)',
        info: 'rgb(var(--color-info-rgb, 88 166 255) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['IBM Plex Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'Monaco', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      boxShadow: {
        'glow-accent': '0 0 12px var(--color-accent-glow, rgba(88, 166, 255, 0.4))',
        'glow-success': '0 0 12px var(--color-success-glow, rgba(63, 185, 80, 0.4))',
        'glow-warning': '0 0 12px var(--color-warning-glow, rgba(210, 153, 34, 0.4))',
        'glow-error': '0 0 12px var(--color-error-glow, rgba(248, 81, 73, 0.4))',
        'dropdown': '0 8px 24px rgba(1, 4, 9, 0.85), 0 0 1px rgba(48, 54, 61, 1)',
        'card': '0 1px 3px rgba(1, 4, 9, 0.5), 0 0 1px rgba(48, 54, 61, 1)',
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
  plugins: []
}
