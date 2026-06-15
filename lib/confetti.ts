const GREEN_OPTS = {
  particleCount: 100,
  spread: 80,
  origin: { y: 0.6 } as const,
  zIndex: 99999,
  colors: ['#22c55e', '#16a34a', '#15803d', '#166534', '#14532d', '#4ade80', '#86efac'],
}

const MINT_OPTS = {
  particleCount: 120,
  spread: 90,
  origin: { y: 0.55 } as const,
  zIndex: 99999,
  colors: ['#00FF9C', '#00C97A', '#7DFFB8', '#00E58B', '#E8FDF4', '#4ade80'],
}

type ConfettiFn = typeof import('canvas-confetti')
let confettiPromise: Promise<ConfettiFn | null> | null = null

function getConfetti() {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (!confettiPromise) {
    confettiPromise = import('canvas-confetti').then((m) => {
      const fn =
        (m as { default?: ConfettiFn }).default ?? (m as unknown as ConfettiFn)
      return fn
    })
  }
  return confettiPromise
}

/**
 * Preload the confetti module (e.g. when the purchase dialog opens).
 * Call this so the first fireGreenConfetti() is instant after purchase.
 */
export function preloadConfetti(): void {
  getConfetti().catch(() => {})
}

/**
 * Client-only green confetti for successful ticket purchase.
 * Safe to call from SSR; no-op if window is undefined.
 * Uses high z-index so it appears above dialogs/modals.
 */
function fireConfettiBursts(opts: typeof GREEN_OPTS): void {
  if (typeof window === 'undefined') return
  getConfetti()
    .then((confetti) => {
      if (!confetti) return
      confetti(opts)
      setTimeout(() => {
        confetti({ ...opts, particleCount: 60, origin: { x: 0.3, y: 0.6 } })
      }, 150)
      setTimeout(() => {
        confetti({ ...opts, particleCount: 60, origin: { x: 0.7, y: 0.6 } })
      }, 300)
    })
    .catch((err) => {
      if (process.env.NODE_ENV === 'development') {
        console.warn('Confetti failed to load:', err)
      }
    })
}

export function fireGreenConfetti(): void {
  fireConfettiBursts(GREEN_OPTS)
}

/** Owl Center mint success — full-screen burst above the reveal overlay. */
export function fireMintConfetti(): void {
  fireConfettiBursts(MINT_OPTS)
}
