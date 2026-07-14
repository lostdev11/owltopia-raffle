import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cache } from 'react'

/**
 * Real PNG brand art under `public/og-assets/` for `next/og`.
 *
 * Gen2 carousel files under `/images/gen2-carousel/*.png` are actually WebP bytes
 * with a `.png` extension + `Content-Type: image/png`. Satori cannot decode WebP, so
 * embedding those bytes (trusting the lied Content-Type) made ImageResponse fall back
 * to an empty green art box on X Share Mint / WL check cards.
 *
 * These assets are true PNGs (magic `89 50 4E 47`), co-located with OG fonts so
 * Vercel file tracing ships them with the serverless function — no HTTP self-fetch.
 */
const LOCAL_OG_BRAND_ART = {
  'golden-owl': 'golden-owl.png',
  'nest-punk-owl': 'nest-punk-owl.png',
} as const

export type LocalOgBrandArtKey = keyof typeof LOCAL_OG_BRAND_ART

function isPng(buf: Buffer): boolean {
  return buf.byteLength >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
}

/**
 * Loads a known local brand asset as a `data:` URL for Satori `<img/>`.
 * Filenames are static so NFT includes them in the OG function bundle.
 */
export const loadLocalOgBrandArtDataUrl = cache(async function loadLocalOgBrandArtDataUrl(
  key: LocalOgBrandArtKey
): Promise<string | null> {
  try {
    const file =
      key === 'golden-owl' ? 'golden-owl.png' : 'nest-punk-owl.png'
    const filePath = join(process.cwd(), 'public', 'og-assets', file)
    const buf = await readFile(filePath)
    if (!isPng(buf)) return null
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    return null
  }
})

/** Public path for docs / debugging. */
export function localOgBrandArtPublicPath(key: LocalOgBrandArtKey): string {
  return `/og-assets/${LOCAL_OG_BRAND_ART[key]}`
}
