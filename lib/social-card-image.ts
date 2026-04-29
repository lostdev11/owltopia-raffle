/**
 * Social crawlers (X/Twitter, Discord, etc.) reject some URL types for link-preview images.
 * SVG in particular is not reliably rendered for twitter:summary_large_image.
 */
export function isUnsupportedSocialCardImageUrl(url: string | null | undefined): boolean {
  if (url == null || !String(url).trim()) return true
  const raw = String(url).trim()
  const lower = raw.toLowerCase()
  if (lower.startsWith('data:')) return true
  try {
    const u = new URL(raw)
    const path = u.pathname.toLowerCase()
    if (path.endsWith('.svg')) return true
    if (lower.includes('format=svg')) return true
    return false
  } catch {
    return true
  }
}
