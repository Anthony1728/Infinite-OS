import type { Config } from 'tailwindcss';

export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bgMain: '#070709',
        bgPanel: '#0d0d11',
        bgCard: '#13131a',
        bgInput: '#16161f',
        borderSubtle: 'rgba(255, 255, 255, 0.06)',
        borderFocus: 'rgba(99, 102, 241, 0.4)',
        textMain: '#f4f4f5',
        textMuted: '#828292',
        brandPurple: '#818cf8',
        brandPink: '#ec4899',
        brandCyan: '#22d3ee',
        brandGreen: '#10b981',
        brandOrange: '#f59e0b',
        brandRed: '#ef4444',
        indigo: {
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      keyframes: {
        'subtle-glow': {
          '0%, 100%': { filter: 'drop-shadow(0 0 8px rgba(168, 85, 247, 0.3)) drop-shadow(0 0 20px rgba(236, 72, 153, 0.2))' },
          '50%': { filter: 'drop-shadow(0 0 14px rgba(168, 85, 247, 0.5)) drop-shadow(0 0 28px rgba(34, 211, 238, 0.4))' },
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-down': {
          '0%': { opacity: '0', transform: 'translateY(-16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-left': {
          '0%': { opacity: '0', transform: 'translateX(16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-right': {
          '0%': { opacity: '0', transform: 'translateX(-16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 8px rgba(99, 102, 241, 0.3)' },
          '50%': { boxShadow: '0 0 20px rgba(99, 102, 241, 0.6)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        'spin-slow': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'bounce-subtle': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-2px)' },
        },
        'ripple': {
          '0%': { transform: 'scale(0)', opacity: '0.6' },
          '100%': { transform: 'scale(4)', opacity: '0' },
        },
        'glow-border': {
          '0%, 100%': { borderColor: 'rgba(99, 102, 241, 0.3)' },
          '50%': { borderColor: 'rgba(99, 102, 241, 0.8)' },
        },
        'typing-dot': {
          '0%, 60%, 100%': { opacity: '0.3', transform: 'scale(0.8)' },
          '30%': { opacity: '1', transform: 'scale(1)' },
        },
        'gradient-shift': {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        'particle-float': {
          '0%': { opacity: '0', transform: 'translateY(10px) scale(0)' },
          '20%': { opacity: '1', transform: 'translateY(0) scale(1)' },
          '80%': { opacity: '1', transform: 'translateY(-10px) scale(1)' },
          '100%': { opacity: '0', transform: 'translateY(-20px) scale(0)' },
        },
      },
      animation: {
        'logo-glow': 'subtle-glow 4s infinite ease-in-out',
        'fade-in': 'fade-in 0.4s ease-out forwards',
        'slide-up': 'slide-up 0.5s ease-out forwards',
        'slide-down': 'slide-down 0.5s ease-out forwards',
        'slide-left': 'slide-left 0.5s ease-out forwards',
        'slide-right': 'slide-right 0.5s ease-out forwards',
        'scale-in': 'scale-in 0.3s ease-out forwards',
        'pulse-glow': 'pulse-glow 2s infinite ease-in-out',
        'shimmer': 'shimmer 2s infinite linear',
        'float': 'float 3s infinite ease-in-out',
        'spin-slow': 'spin-slow 3s linear infinite',
        'bounce-subtle': 'bounce-subtle 1s infinite ease-in-out',
        'ripple': 'ripple 0.6s ease-out',
        'glow-border': 'glow-border 2s infinite ease-in-out',
        'typing-dot': 'typing-dot 1.4s infinite ease-in-out',
        'gradient-shift': 'gradient-shift 3s ease infinite',
        'particle-float': 'particle-float 2s ease-in-out infinite',
      },
      backgroundSize: {
        '200%': '200% 200%',
      },
    },
  },
  plugins: [],
} satisfies Config;
