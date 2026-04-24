import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cache } from 'react'
import { OWLTOPIA_OG_SIZE } from '@/lib/og/og-constants'

export type OgFont = {
  name: string
  data: ArrayBuffer
  style: 'normal' | 'italic'
  weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900
}

/**
 * Pinned jsdelivr; matches `next/font` Plus Jakarta Sans.
 * Satori (next/og) does not support WOFF2 — only ttf/otf/woff.
 */
const PLUS_JAKARTA_500 =
  'https://cdn.jsdelivr.net/npm/@fontsource/plus-jakarta-sans@5.2.5/files/plus-jakarta-sans-latin-500-normal.woff'
const PLUS_JAKARTA_700 =
  'https://cdn.jsdelivr.net/npm/@fontsource/plus-jakarta-sans@5.2.5/files/plus-jakarta-sans-latin-700-normal.woff'

/** Shipped in `public/og-assets/` so OG routes never need outbound fetches in production. */
const LOCAL_WOFF_500 = 'plus-jakarta-sans-latin-500-normal.woff'
const LOCAL_WOFF_700 = 'plus-jakarta-sans-latin-700-normal.woff'

export const OG_FONT_SANS = 'Plus Jakarta Sans' as const

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  // Copy so we return a true ArrayBuffer (not SharedArrayBuffer) for Satori.
  return new Uint8Array(buf).buffer
}

const load = cache(async function loadPlusJakartaBuffers() {
  const dir = join(process.cwd(), 'public', 'og-assets')
  try {
    const [b500, b700] = await Promise.all([readFile(join(dir, LOCAL_WOFF_500)), readFile(join(dir, LOCAL_WOFF_700))])
    if (b500.byteLength >= 24 && b700.byteLength >= 24) {
      return { a: bufferToArrayBuffer(b500), b: bufferToArrayBuffer(b700) } as const
    }
  } catch {
    /* fall through to CDN */
  }
  const [a, b] = await Promise.all([
    fetch(PLUS_JAKARTA_500).then((r) => {
      if (!r.ok) throw new Error('Plus Jakarta 500')
      return r.arrayBuffer()
    }),
    fetch(PLUS_JAKARTA_700).then((r) => {
      if (!r.ok) throw new Error('Plus Jakarta 700')
      return r.arrayBuffer()
    }),
  ])
  return { a, b } as const
})

const loadPlusJakartaForOg = cache(async (): Promise<OgFont[] | undefined> => {
  try {
    const { a, b } = await load()
    return [
      { name: OG_FONT_SANS, data: a, style: 'normal' as const, weight: 500 as const },
      { name: OG_FONT_SANS, data: b, style: 'normal' as const, weight: 700 as const },
    ]
  } catch {
    return undefined
  }
})

export type OwltopiaOgResponseInit = { width: number; height: number; fonts?: OgFont[] }

/** For `new ImageResponse(…, options)` to match the promo PNG typography. */
export const getOwltopiaOgResponseOptions = cache(async function getOwltopiaOgResponseOptions(): Promise<OwltopiaOgResponseInit> {
  try {
    const fonts = await loadPlusJakartaForOg()
    if (!fonts) {
      return { ...OWLTOPIA_OG_SIZE }
    }
    return { ...OWLTOPIA_OG_SIZE, fonts }
  } catch {
    return { ...OWLTOPIA_OG_SIZE }
  }
})
