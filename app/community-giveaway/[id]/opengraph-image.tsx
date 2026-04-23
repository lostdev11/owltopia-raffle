import { ImageResponse } from 'next/og'
import { countEntriesByGiveawayId, getCommunityGiveawayById } from '@/lib/db/community-giveaways'
import { PLATFORM_NAME, getSiteBaseUrl } from '@/lib/site-config'
import { fetchNftImageUriFromHelius } from '@/lib/nft-helius-image'
import { absolutizeForOg } from '@/lib/og/server-og-asset-url'
import { owltopiaLinkPreviewOg, OWLTOPIA_OG_SIZE } from '@/lib/og/owltopia-link-preview'
import { getOwltopiaOgResponseOptions } from '@/lib/og/og-image-fonts'
import { fetchImageDataUrlForOg } from '@/lib/og/fetch-image-data-url-for-og'

export const runtime = 'nodejs'
export const revalidate = 300
export const alt = PLATFORM_NAME
export const size = OWLTOPIA_OG_SIZE
export const contentType = 'image/png'

const generic = (
  <div
    style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0a0a0a',
      fontFamily: 'system-ui, sans-serif',
    }}
  >
    <div style={{ fontSize: 44, fontWeight: 800, color: 'white', marginBottom: 12 }}>{PLATFORM_NAME}</div>
    <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.78)' }}>Community giveaway</div>
  </div>
)

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const trimmed = typeof id === 'string' ? id.trim() : ''
  const site = getSiteBaseUrl()
  const ogOpts = await getOwltopiaOgResponseOptions()

  if (!trimmed) {
    return new ImageResponse(generic, { ...ogOpts })
  }

  let g: Awaited<ReturnType<typeof getCommunityGiveawayById>> = null
  try {
    g = await getCommunityGiveawayById(trimmed)
  } catch {
    return new ImageResponse(generic, { ...ogOpts })
  }

  if (!g || g.status === 'draft') {
    return new ImageResponse(generic, { ...ogOpts })
  }

  const rawTitle = g.title?.trim() || 'Community giveaway'
  const title = rawTitle.length > 88 ? `${rawTitle.slice(0, 85)}...` : rawTitle
  const gateLabel = g.access_gate === 'holder_only' ? 'Owl NFT holders' : 'Everyone'

  const starts = g.starts_at
    ? new Date(g.starts_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null
  const ends = g.ends_at
    ? new Date(g.ends_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  let imageUrl: string | null = null
  if (g.nft_mint_address?.trim()) {
    const raw = await fetchNftImageUriFromHelius(g.nft_mint_address)
    if (raw) imageUrl = absolutizeForOg(raw, site)
  }

  const artData = imageUrl ? await fetchImageDataUrlForOg(imageUrl) : null

  let entryCount = 0
  try {
    entryCount = await countEntriesByGiveawayId(g.id)
  } catch {
    /* optional */
  }
  const line1 = `Entries: ${entryCount} · ${gateLabel}`
  const line2 = [starts ? `Starts ${starts}` : null, ends ? `Closes ${ends}` : null].filter(Boolean).join(' · ') || 'Join on owltopia'

  try {
    return new ImageResponse(
      owltopiaLinkPreviewOg({
        title,
        kindLabel: 'Community giveaway',
        line1,
        line2: line2.length > 0 ? line2 : undefined,
        imageUrl: artData,
      }),
      { ...ogOpts }
    )
  } catch {
    return new ImageResponse(
      owltopiaLinkPreviewOg({
        title,
        kindLabel: 'Community giveaway',
        line1,
        line2: line2.length > 0 ? line2 : undefined,
        imageUrl: null,
      }),
      { ...ogOpts }
    )
  }
}
