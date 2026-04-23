import { getRaffleDisplayImageUrl } from '@/lib/raffle-display-image-url'

/**
 * ImageResponse / Satori need an absolute https URL. Maps proxy/draft paths to the deployed origin.
 */
export function absolutizeForOg(src: string | null | undefined, siteBase: string): string | null {
  if (!src?.trim()) return null
  const base = siteBase.replace(/\/$/, '')
  const disp = getRaffleDisplayImageUrl(src) ?? src.trim()
  if (disp.startsWith('http://') || disp.startsWith('https://')) return disp
  if (disp.startsWith('/')) return `${base}${disp}`
  return `${base}/${disp}`
}
