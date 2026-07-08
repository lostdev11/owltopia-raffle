/** Canvas-safe font stack for promo / winner PNG generators. */
const PROMO_PNG_FONT_FALLBACK = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

/**
 * Resolve the loaded site sans family (Next.js `--font-plus-jakarta-sans`).
 * Hard-coding "Plus Jakarta Sans" breaks canvas text on many mobile wallets.
 */
export function getPromoPngFontFamily(): string {
  if (typeof document === 'undefined') return PROMO_PNG_FONT_FALLBACK
  const root = getComputedStyle(document.documentElement)
  const fromVar = root.getPropertyValue('--font-plus-jakarta-sans').trim()
  if (fromVar) return fromVar
  const bodyFamily = getComputedStyle(document.body).fontFamily?.trim()
  if (bodyFamily) return bodyFamily
  return PROMO_PNG_FONT_FALLBACK
}

/** Wait for weights used on promo / winner PNG canvases (mobile wallet browsers are strict). */
export async function ensurePromoPngFontsReady(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return
  const family = getPromoPngFontFamily()
  const specs = [
    '600 20px',
    '600 24px',
    '600 26px',
    '600 30px',
    '700 22px',
    '700 24px',
    '700 28px',
    '700 32px',
    '700 36px',
    '800 62px',
  ]
  await Promise.all(
    specs.map((spec) => document.fonts.load(`${spec} ${family}`).catch(() => undefined))
  )
  try {
    await document.fonts.ready
  } catch {
    /* keep going with fallbacks */
  }
}
