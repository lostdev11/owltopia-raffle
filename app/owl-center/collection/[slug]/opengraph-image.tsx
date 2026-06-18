import { ImageResponse } from 'next/og'

import { getOwlCenterLaunchBySlug } from '@/lib/db/owl-center-launch'
import { fetchImageDataUrlForOg } from '@/lib/og/fetch-image-data-url-for-og'
import { getOwltopiaOgResponseOptions } from '@/lib/og/og-image-fonts'
import { OWLTOPIA_OG_SIZE } from '@/lib/og/og-constants'
import { owltopiaLinkPreviewOg } from '@/lib/og/owltopia-link-preview'
import { PLATFORM_NAME } from '@/lib/site-config'

export const runtime = 'nodejs'
export const revalidate = 300
export const alt = `Mint on Owl Center | ${PLATFORM_NAME}`
export const size = OWLTOPIA_OG_SIZE
export const contentType = 'image/png'

function priceLine(launch: {
  creator_mint_price: number | null
  creator_mint_currency: string | null
  public_price_usdc: number | null
}): string {
  const currency = (launch.creator_mint_currency ?? 'SOL').toUpperCase()
  const price = currency === 'USDC' ? launch.public_price_usdc : launch.creator_mint_price
  if (price == null || price <= 0) return 'Free mint'
  return `${price} ${currency} mint`
}

function supplyLine(launch: { minted_count: number; total_supply: number }): string {
  const total = launch.total_supply > 0 ? launch.total_supply.toLocaleString() : '—'
  return `${launch.minted_count.toLocaleString()} / ${total} minted`
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const launch = slug && slug !== 'gen2' ? await getOwlCenterLaunchBySlug(slug) : null
  const ogOpts = await getOwltopiaOgResponseOptions()

  const title = launch?.name ?? 'Owl Center Collection'
  const line1 = launch ? priceLine(launch) : 'Mint on Owl Center'
  const line2 = launch ? supplyLine(launch) : PLATFORM_NAME

  // Prefer the collection PFP (the art being minted), never the platform raffle fallback.
  let imageUrl: string | null = null
  if (launch?.image_url) {
    try {
      imageUrl = await fetchImageDataUrlForOg(launch.image_url)
    } catch {
      imageUrl = null
    }
  }

  return new ImageResponse(
    owltopiaLinkPreviewOg({
      title,
      kindLabel: 'Owl Center // Mint',
      line1,
      line2,
      imageUrl,
    }),
    { ...ogOpts }
  )
}
