/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        // Deep dark base (GitHub-inspired)
        bg: {
          DEFAULT: '#0d1117',
          secondary: '#161b22',
          tertiary: '#21262d',
          elevated: '#30363d',
        },
        border: {
          DEFAULT: '#30363d',
          muted: '#21262d',
          focus: '#58a6ff',
        },
        text: {
          DEFAULT: '#e6edf3',
          secondary: '#8b949e',
          muted: '#6e7681',
          faint: '#484f58',
        },
        accent: {
          DEFAULT: '#58a6ff',
          hover: '#79b8ff',
          muted: '#388bfd',
        },
        // SVN Status Colors
        svn: {
          normal: '#3fb950',
          added: '#58a6ff',
          modified: '#d29922',
          deleted: '#f85149',
          conflict: '#f85149',
          unversioned: '#6e7681',
          missing: '#f85149',
          replaced: '#a371f7',
          external: '#39c5cf',
          ignored: '#484f58',
          obstructed: '#f0883e',
        },
        // UI States
        success: '#3fb950',
        warning: '#d29922',
        error: '#f85149',
        info: '#58a6ff',
      },
      fontFamily: {
        sans: ['IBM Plex Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'Monaco', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      boxShadow: {
        'glow-accent': '0 0 12px rgba(88, 166, 255, 0.4)',
        'glow-success': '0 0 12px rgba(63, 185, 80, 0.4)',
        'glow-warning': '0 0 12px rgba(210, 153, 34, 0.4)',
        'glow-error': '0 0 12px rgba(248, 81, 73, 0.4)',
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
