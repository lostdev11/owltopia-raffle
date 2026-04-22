import { ImageResponse } from 'next/og'
import { getNftGiveawayById } from '@/lib/db/nft-giveaways'
import { PLATFORM_NAME } from '@/lib/site-config'

/** Node matches `app/opengraph-image.tsx` so `getNftGiveawayById` (Supabase) and @vercel/og run consistently for X/Discord crawlers. */
export const runtime = 'nodejs'
export const alt = PLATFORM_NAME
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const trimmed = typeof id === 'string' ? id.trim() : ''

  const generic = (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ fontSize: 52, fontWeight: 800, color: 'white', marginBottom: 16 }}>{PLATFORM_NAME}</div>
      <div style={{ fontSize: 30, color: 'rgba(255,255,255,0.88)' }}>NFT giveaway</div>
      <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.68)', marginTop: 20 }}>Connect your wallet on the giveaway page</div>
    </div>
  )

  if (!trimmed) {
    return new ImageResponse(generic, { ...size })
  }

  let g: Awaited<ReturnType<typeof getNftGiveawayById>> = null
  try {
    g = await getNftGiveawayById(trimmed)
  } catch {
    return new ImageResponse(generic, { ...size })
  }

  if (!g) {
    return new ImageResponse(generic, { ...size })
  }

  const rawTitle = g.title?.trim() || 'NFT giveaway'
  const title = rawTitle.length > 56 ? rawTitle.slice(0, 53) + '...' : rawTitle
  const stateLabel = g.claimed_at ? 'Claimed' : g.prize_deposited_at ? 'Ready to claim' : 'NFT giveaway'

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
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 22,
            color: 'rgba(255,255,255,0.75)',
            marginBottom: 12,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          {stateLabel}
        </div>
        <div
          style={{
            fontSize: 54,
            fontWeight: 800,
            color: 'white',
            letterSpacing: '-0.02em',
            marginBottom: 20,
            textAlign: 'center',
            maxWidth: 1040,
            lineHeight: 1.15,
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.65)', marginTop: 12 }}>{PLATFORM_NAME}</div>
      </div>
    ),
    { ...size }
  )
}
