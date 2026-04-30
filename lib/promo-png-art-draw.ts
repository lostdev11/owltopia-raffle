/**
 * Shared layout for raffle promo PNG canvases (`RafflePromoPngButton`, flex card) and
 * OG previews: the SOL brand SVG reads huge when scaled with “cover”; inset with contain.
 */

/** Same inset in promo PNG canvas and `next/og` link preview tile. */
export const PROMO_SOLANA_MARK_INSET_SIDE_FRAC = 0.72

/** True when `imageUrl` is the site Solana mark asset (paths or absolute URLs). */
export function isSolanaMarkPromoArtUrl(imageUrl: string | null | undefined): boolean {
  if (!imageUrl?.trim()) return false
  const bare = imageUrl.trim().split(/[?#]/)[0] ?? ''
  try {
    const pathname = bare.includes('://') ? new URL(bare).pathname : bare
    return /(^|\/)solana-mark\.svg$/i.test(pathname)
  } catch {
    return /(^|\/)solana-mark\.svg$/i.test(bare)
  }
}

/** Any candidate URL chain includes the Solana mark (OG prefetch list). */
export function urlChainIncludesSolanaMark(urls: string[]): boolean {
  return urls.some((u) => isSolanaMarkPromoArtUrl(u))
}

export function computePromoPngArtDrawRect(
  loaded: Pick<HTMLImageElement, 'width' | 'height'>,
  imageBox: { x: number; y: number; w: number; h: number },
  imageUrl: string | null | undefined
): { drawX: number; drawY: number; drawW: number; drawH: number } {
  const iw = loaded.width
  const ih = loaded.height
  if (iw <= 0 || ih <= 0) {
    return { drawX: imageBox.x, drawY: imageBox.y, drawW: imageBox.w, drawH: imageBox.h }
  }
  if (isSolanaMarkPromoArtUrl(imageUrl)) {
    const maxSide = Math.min(imageBox.w, imageBox.h) * PROMO_SOLANA_MARK_INSET_SIDE_FRAC
    const scale = Math.min(maxSide / iw, maxSide / ih)
    const drawW = iw * scale
    const drawH = ih * scale
    const drawX = imageBox.x + (imageBox.w - drawW) / 2
    const drawY = imageBox.y + (imageBox.h - drawH) / 2
    return { drawX, drawY, drawW, drawH }
  }
  const scale = Math.max(imageBox.w / iw, imageBox.h / ih)
  const drawW = iw * scale
  const drawH = ih * scale
  const drawX = imageBox.x - (drawW - imageBox.w) / 2
  const drawY = imageBox.y - (drawH - imageBox.h) / 2
  return { drawX, drawY, drawW, drawH }
}
