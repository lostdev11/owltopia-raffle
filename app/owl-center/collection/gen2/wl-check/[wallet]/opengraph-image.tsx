import { ImageResponse } from 'next/og'

import { buildGen2WlCheckShareSnapshot } from '@/lib/owl-center/gen2-wl-check-share'
import { fetchImageDataUrlForOg } from '@/lib/og/fetch-image-data-url-for-og'
import { getOwltopiaOgResponseOptions } from '@/lib/og/og-image-fonts'
import { OWLTOPIA_OG_SIZE } from '@/lib/og/og-constants'
import { owltopiaLinkPreviewOg } from '@/lib/og/owltopia-link-preview'
import { PLATFORM_NAME, getSiteBaseUrl } from '@/lib/site-config'

export const runtime = 'nodejs'
export const revalidate = 300
export const alt = `Gen2 WL | ${PLATFORM_NAME}`
export const size = OWLTOPIA_OG_SIZE
export const contentType = 'image/png'

export default async function Image({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet: walletParam } = await params
  const walletRaw = typeof walletParam === 'string' ? decodeURIComponent(walletParam.trim()) : ''
  const snapshot = await buildGen2WlCheckShareSnapshot(walletRaw)
  const site = getSiteBaseUrl().replace(/\/$/, '')
  const ogOpts = await getOwltopiaOgResponseOptions()

  const artUrl = `${site}/images/gen2-carousel/golden-owl.png`
  let imageUrl: string | null = null
  try {
    imageUrl = await fetchImageDataUrlForOg(artUrl)
  } catch {
    imageUrl = null
  }

  const { title, kindLabel, line1, line2 } = snapshot.og

  try {
    return new ImageResponse(
      owltopiaLinkPreviewOg({
        title,
        kindLabel,
        line1,
        line2,
        imageUrl,
        insetBrandArt: true,
      }),
      { ...ogOpts }
    )
  } catch {
    return new ImageResponse(
      owltopiaLinkPreviewOg({
        title,
        kindLabel,
        line1,
        line2,
        imageUrl: null,
        insetBrandArt: true,
      }),
      { ...ogOpts }
    )
  }
}
