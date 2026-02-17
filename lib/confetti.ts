const GREEN_OPTS = {
  particleCount: 100,
  spread: 80,
  origin: { y: 0.6 } as const,
  zIndex: 99999,
  colors: ['#22c55e', '#16a34a', '#15803d', '#166534', '#14532d', '#4ade80', '#86efac'],
}

type ConfettiFn = typeof import('canvas-confetti')
let confettiPromise: Promise<ConfettiFn | null> | null = null

function getConfetti() {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (!confettiPromise) {
    confettiPromise = import('canvas-confetti').then((m) => {
      const fn = (m as { default?: ConfettiFn }).default ?? (m as ConfettiFn)
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
export function fireGreenConfetti(): void {
  if (typeof window === 'undefined') return
  getConfetti()
    .then((confetti) => {
      if (!confetti) return
      confetti(GREEN_OPTS)
      setTimeout(() => {
        confetti({ ...GREEN_OPTS, particleCount: 60, origin: { x: 0.3, y: 0.6 } })
      }, 150)
      setTimeout(() => {
        confetti({ ...GREEN_OPTS, particleCount: 60, origin: { x: 0.7, y: 0.6 } })
      }, 300)
    })
    .catch((err) => {
      if (process.env.NODE_ENV === 'development') {
        console.warn('Confetti failed to load:', err)
      }
    })
}
