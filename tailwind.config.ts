import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-plus-jakarta-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-bebas-neue)', 'Impact', 'sans-serif'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        /* M3 surface hierarchy */
        surface: 'hsl(var(--surface))',
        'surface-container': 'hsl(var(--surface-container))',
        'surface-container-high': 'hsl(var(--surface-container-high))',
        outline: 'hsl(var(--outline))',
        'outline-variant': 'hsl(var(--outline-variant))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        // Theme accent colors
        'theme-prime': {
          DEFAULT: '#00ff88',
          glow: 'rgba(0, 255, 136, 0.5)',
        },
        'theme-midnight': {
          DEFAULT: '#00d4ff',
          glow: 'rgba(0, 212, 255, 0.5)',
        },
        'theme-dawn': {
          DEFAULT: '#a8ff00',
          glow: 'rgba(168, 255, 0, 0.5)',
        },
        'theme-ember': {
          DEFAULT: '#f97316',
          glow: 'rgba(249, 115, 22, 0.5)',
        },
        'theme-violet': {
          DEFAULT: '#a855f7',
          glow: 'rgba(168, 85, 247, 0.5)',
        },
        'theme-coral': {
          DEFAULT: '#f43f5e',
          glow: 'rgba(244, 63, 94, 0.5)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        /* M3 shape scale */
        'shape-sm': 'var(--shape-sm)',
        'shape-md': 'var(--shape-md)',
        'shape-lg': 'var(--shape-lg)',
        'shape-full': 'var(--shape-full)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'enter-fade-in': {
          from: { opacity: '0', transform: 'scale(0.92)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'enter-glow': {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
        'glow-pulse': {
          '0%, 100%': {
            textShadow: '0 0 16px rgba(0, 255, 136, 0.3), 0 0 32px rgba(0, 255, 136, 0.15), 0 0 48px rgba(0, 255, 136, 0.08)',
          },
          '50%': {
            textShadow: '0 0 28px rgba(0, 255, 136, 1), 0 0 56px rgba(0, 255, 136, 0.7), 0 0 84px rgba(0, 255, 136, 0.4)',
          },
        },
        'button-glow-pulse': {
          '0%, 100%': {
            boxShadow:
              '0 0 10px rgba(0, 255, 136, 0.22), 0 0 24px rgba(0, 255, 136, 0.12), 0 0 44px rgba(0, 255, 136, 0.06)',
          },
          '50%': {
            boxShadow:
              '0 0 14px rgba(0, 255, 136, 0.32), 0 0 32px rgba(0, 255, 136, 0.18), 0 0 56px rgba(0, 255, 136, 0.09)',
          },
        },
        /* Hero: gentle rise + fade for landing */
        'hero-rise': {
          from: { opacity: '0', transform: 'translateY(20px) scale(0.97)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        /* Floating orbs background */
        'hero-float-1': {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '33%': { transform: 'translate(8%, -6%) scale(1.05)' },
          '66%': { transform: 'translate(-5%, 4%) scale(0.98)' },
        },
        'hero-float-2': {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '50%': { transform: 'translate(-10%, 8%) scale(1.08)' },
        },
        'hero-float-3': {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '25%': { transform: 'translate(6%, 5%) scale(1.03)' },
          '75%': { transform: 'translate(-4%, -7%) scale(0.97)' },
        },
        'hero-float-4': {
          '0%, 100%': { transform: 'translate(0, 0)' },
          '50%': { transform: 'translate(5%, -10%)' },
        },
        /* Matrix-style falling text */
        'matrix-scroll': {
          '0%': { transform: 'translateY(0)' },
          '100%': { transform: 'translateY(-50%)' },
        },
        /* Page enter: subtle slide-up + fade */
        'page-enter': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        /* Raffle list: scroll-in on mobile when card enters viewport (opacity 1 so cards stay visible) */
        'raffle-scroll-in': {
          from: { opacity: '1', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        /* Site-wide maintenance banner (duplicate line; -50% = one loop) */
        'maintenance-marquee': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        'gen2-live-blink': {
          '0%, 100%': { opacity: '1', filter: 'brightness(1.15)' },
          '50%': { opacity: '0.88', filter: 'brightness(1.45)' },
        },
        'gen2-presale-badge-glow': {
          '0%, 100%': {
            boxShadow:
              '0 0 14px rgba(0, 255, 156, 0.28), 0 0 2px rgba(0, 255, 156, 0.45), inset 0 0 12px rgba(0, 229, 139, 0.06)',
          },
          '50%': {
            boxShadow:
              '0 0 28px rgba(0, 255, 156, 0.42), 0 0 6px rgba(0, 255, 156, 0.55), inset 0 0 16px rgba(0, 229, 139, 0.1)',
          },
        },
        'gen2-border-pulse': {
          '0%, 100%': {
            boxShadow:
              '0 0 0 1px rgba(0, 229, 139, 0.35), 0 0 24px rgba(0, 255, 156, 0.12), inset 0 0 20px rgba(0, 229, 139, 0.04)',
          },
          '50%': {
            boxShadow:
              '0 0 0 1px rgba(0, 255, 156, 0.55), 0 0 36px rgba(0, 255, 156, 0.22), inset 0 0 24px rgba(0, 229, 139, 0.08)',
          },
        },
        'gen2-shimmer': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'gen2-radar': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'gen2-floaty': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        /* Gen2 presale: shifting gradient on border ring */
        'gen2-border-flow': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        /* Outer halo blink around framed panels */
        'gen2-border-glow-ring': {
          '0%, 100%': {
            boxShadow:
              '0 0 18px rgba(0, 255, 156, 0.22), 0 0 42px rgba(0, 229, 139, 0.08), 0 0 2px rgba(0, 255, 156, 0.35)',
          },
          '50%': {
            boxShadow:
              '0 0 28px rgba(0, 255, 156, 0.48), 0 0 64px rgba(0, 255, 156, 0.14), 0 0 3px rgba(255, 215, 105, 0.45)',
          },
        },
        /* Corner LED blink */
        'gen2-corner-led': {
          '0%, 100%': { opacity: '0.35', filter: 'drop-shadow(0 0 4px rgba(0,255,156,0.5))' },
          '50%': { opacity: '1', filter: 'drop-shadow(0 0 10px rgba(0,255,156,1))' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        /* `both`: apply 0% keyframe before start (avoids relying on separate opacity-0 + forwards-only). */
        'enter-fade-in': 'enter-fade-in 0.8s ease-out both',
        'page-enter': 'page-enter 0.35s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        'hero-rise': 'hero-rise 0.9s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        'hero-float-1': 'hero-float-1 18s ease-in-out infinite',
        'hero-float-2': 'hero-float-2 22s ease-in-out infinite',
        'hero-float-3': 'hero-float-3 20s ease-in-out infinite',
        'hero-float-4': 'hero-float-4 25s ease-in-out infinite',
        'matrix-scroll': 'matrix-scroll 28s linear infinite',
        'enter-glow': 'enter-glow 2s ease-in-out infinite',
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
        'button-glow-pulse': 'button-glow-pulse 2s ease-in-out infinite',
        'raffle-scroll-in': 'raffle-scroll-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        'maintenance-marquee': 'maintenance-marquee 42s linear infinite',
        'gen2-live-blink': 'gen2-live-blink 1.6s ease-in-out infinite',
        'gen2-presale-badge-glow': 'gen2-presale-badge-glow 2.4s ease-in-out infinite',
        'gen2-border-pulse': 'gen2-border-pulse 2.4s ease-in-out infinite',
        'gen2-shimmer': 'gen2-shimmer 2.2s ease-in-out infinite',
        'gen2-radar': 'gen2-radar 22s linear infinite',
        'gen2-floaty': 'gen2-floaty 5s ease-in-out infinite',
        'gen2-border-flow': 'gen2-border-flow 5.5s ease-in-out infinite',
        'gen2-border-glow-ring': 'gen2-border-glow-ring 2.8s ease-in-out infinite',
        'gen2-corner-led': 'gen2-corner-led 1.9s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
export default config
