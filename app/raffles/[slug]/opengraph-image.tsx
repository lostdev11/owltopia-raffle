import { ImageResponse } from 'next/og'
import { cookies } from 'next/headers'
import { getRaffleBySlug } from '@/lib/db/raffles'
import { PLATFORM_NAME, getSiteBaseUrl } from '@/lib/site-config'
import { getAdminRole } from '@/lib/db/admins'
import { SESSION_COOKIE_NAME, parseSessionCookieValue } from '@/lib/auth-server'
import { canViewerSeeRafflePending } from '@/lib/raffles/visibility'
import { buildRaffleImageAttemptChain } from '@/lib/raffle-display-image-url'
import { absolutizeForOg } from '@/lib/og/server-og-asset-url'
import { owltopiaLinkPreviewOg, OWLTOPIA_OG_SIZE } from '@/lib/og/owltopia-link-preview'
import { getPartnerPrizeListingImageUrl, isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'

export const runtime = 'nodejs'
export const alt = PLATFORM_NAME
export const size = OWLTOPIA_OG_SIZE
export const contentType = 'image/png'

function formatPrize(raffle: {
  prize_type: string
  prize_amount: number | null
  prize_currency: string | null
  nft_collection_name: string | null
}): string {
  if (raffle.prize_type === 'nft') {
    return raffle.nft_collection_name || 'NFT'
  }
  if (raffle.prize_amount != null && raffle.prize_currency) {
    return `${raffle.prize_amount} ${raffle.prize_currency}`
  }
  return 'Raffle'
}

function genericNotFound() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a0a',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ fontSize: 40, color: 'rgba(255,255,255,0.85)' }}>Raffle not found</div>
      </div>
    ),
    { ...OWLTOPIA_OG_SIZE }
  )
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const raffle = await getRaffleBySlug(slug)
  const site = getSiteBaseUrl()

  if (!raffle) {
    return genericNotFound()
  }

  const sessionValue = (await cookies()).get(SESSION_COOKIE_NAME)?.value
  const session = parseSessionCookieValue(sessionValue)
  const viewerWallet = session?.wallet ?? null
  const viewerIsAdmin = viewerWallet ? (await getAdminRole(viewerWallet)) !== null : false
  if (!canViewerSeeRafflePending(raffle, viewerWallet, viewerIsAdmin)) {
    return new ImageResponse(
      (
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
          <div style={{ fontSize: 40, fontWeight: 800, color: 'white' }}>{PLATFORM_NAME}</div>
          <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.7)', marginTop: 12 }}>
            Raffle preview unavailable
          </div>
        </div>
      ),
      { ...OWLTOPIA_OG_SIZE }
    )
  }

  const rawTitle = raffle.title.length > 80 ? `${raffle.title.slice(0, 77)}...` : raffle.title
  const endStr = new Date(raffle.end_time).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  const chain = buildRaffleImageAttemptChain(raffle.image_url, raffle.image_fallback_url)
  let imageUrl: string | null = null
  for (const u of chain) {
    const abs = absolutizeForOg(u, site)
    if (abs) {
      imageUrl = abs
      break
    }
  }
  if (!imageUrl && isPartnerSplPrizeRaffle(raffle)) {
    const rel = getPartnerPrizeListingImageUrl(raffle.prize_currency)
    imageUrl = absolutizeForOg(rel, site)
  }

  const line1 = `Ticket: ${raffle.ticket_price} ${raffle.currency}`
  const line2 = `Prize: ${formatPrize(raffle)} · Ends ${endStr}`

  return new ImageResponse(owltopiaLinkPreviewOg({
    title: rawTitle,
    kindLabel: 'Owltopia raffle',
    line1,
    line2,
    imageUrl,
  }), { ...OWLTOPIA_OG_SIZE })
}
