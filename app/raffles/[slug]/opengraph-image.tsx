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
import { getOwltopiaOgResponseOptions } from '@/lib/og/og-image-fonts'
import { fetchImageDataUrlForOg } from '@/lib/og/fetch-image-data-url-for-og'
import { getPartnerPrizeListingImageUrl, isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'
import { urlChainIncludesSolanaMark } from '@/lib/promo-png-art-draw'

export const runtime = 'nodejs'
/** Allow slow `/api/proxy-image` IPFS gateway races while prefetching art for Satori. */
export const maxDuration = 60
/** Edge cache: faster repeat crawls (X may retry); generation still uses quick art pre-fetch. */
export const revalidate = 300
export const alt = PLATFORM_NAME
export const size = OWLTOPIA_OG_SIZE
export const contentType = 'image/png'

async function genericNotFound() {
  let init: Awaited<ReturnType<typeof getOwltopiaOgResponseOptions>> = { ...OWLTOPIA_OG_SIZE }
  try {
    init = await getOwltopiaOgResponseOptions()
  } catch {
    // Size-only (system fonts) if options fail
  }
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
    { ...init }
  )
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  let slug: string
  try {
    ;({ slug } = await params)
  } catch {
    return await genericNotFound()
  }

  let raffle: Awaited<ReturnType<typeof getRaffleBySlug>>
  try {
    raffle = await getRaffleBySlug(slug)
  } catch {
    return await genericNotFound()
  }

  const site = getSiteBaseUrl()

  if (!raffle) {
    return await genericNotFound()
  }

  let sessionValue: string | undefined
  try {
    sessionValue = (await cookies()).get(SESSION_COOKIE_NAME)?.value
  } catch {
    sessionValue = undefined
  }
  const session = parseSessionCookieValue(sessionValue)
  const viewerWallet = session?.wallet ?? null
  let viewerIsAdmin = false
  if (viewerWallet) {
    try {
      viewerIsAdmin = (await getAdminRole(viewerWallet)) !== null
    } catch {
      viewerIsAdmin = false
    }
  }
  if (!canViewerSeeRafflePending(raffle, viewerWallet, viewerIsAdmin)) {
    try {
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
        { ...(await getOwltopiaOgResponseOptions()) }
      )
    } catch {
      return await genericNotFound()
    }
  }

  try {
    const rawTitle = raffle.title.length > 80 ? `${raffle.title.slice(0, 77)}...` : raffle.title
    const endStr = new Date(raffle.end_time).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })

    const absolutized: string[] = []
    for (const u of buildRaffleImageAttemptChain(raffle.image_url, raffle.image_fallback_url)) {
      const abs = absolutizeForOg(u, site)
      if (abs && (absolutized.length === 0 || absolutized[absolutized.length - 1] !== abs)) {
        absolutized.push(abs)
      }
    }
    if (absolutized.length === 0 && isPartnerSplPrizeRaffle(raffle)) {
      const rel = getPartnerPrizeListingImageUrl(raffle.prize_currency)
      const abs = absolutizeForOg(rel, site)
      if (abs) absolutized.push(abs)
    }

    const line1 = `Ticket: ${raffle.ticket_price} ${raffle.currency}`
    const line2 = `Ends ${endStr}`
    const insetBrandArt = urlChainIncludesSolanaMark(absolutized)

    let artData: string | null = null
    for (const abs of absolutized) {
      artData = await fetchImageDataUrlForOg(abs)
      if (artData) break
    }
    const ogOpts = await getOwltopiaOgResponseOptions()

    try {
      return new ImageResponse(
        owltopiaLinkPreviewOg({
          title: rawTitle,
          kindLabel: null,
          line1,
          line2,
          imageUrl: artData,
          insetBrandArt,
        }),
        { ...ogOpts }
      )
    } catch {
      return new ImageResponse(
        owltopiaLinkPreviewOg({
          title: rawTitle,
          kindLabel: null,
          line1,
          line2,
          imageUrl: null,
          insetBrandArt,
        }),
        { ...ogOpts }
      )
    }
  } catch {
    return await genericNotFound()
  }
}
