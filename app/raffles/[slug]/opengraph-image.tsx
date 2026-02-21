import { ImageResponse } from 'next/og'
import { getRaffleBySlug } from '@/lib/db/raffles'

export const alt = 'Owl Raffle'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

function formatPrize(raffle: { prize_type: string; prize_amount: number | null; prize_currency: string | null; nft_collection_name: string | null }): string {
  if (raffle.prize_type === 'nft') {
    return raffle.nft_collection_name || 'NFT'
  }
  if (raffle.prize_amount != null && raffle.prize_currency) {
    return `${raffle.prize_amount} ${raffle.prize_currency}`
  }
  return 'Raffle'
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const raffle = await getRaffleBySlug(slug)

  if (!raffle) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div style={{ fontSize: 48, color: 'rgba(255,255,255,0.9)' }}>Raffle not found</div>
        </div>
      ),
      { ...size }
    )
  }

  const prizeText = formatPrize(raffle)
  const title = raffle.title.length > 60 ? raffle.title.slice(0, 57) + '...' : raffle.title

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
            fontSize: 56,
            fontWeight: 800,
            color: 'white',
            letterSpacing: '-0.02em',
            marginBottom: 12,
            textAlign: 'center',
            maxWidth: 1000,
            lineHeight: 1.2,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 24,
            color: 'rgba(255,255,255,0.85)',
            marginBottom: 24,
          }}
        >
          Prize: {prizeText}
        </div>
        <div
          style={{
            fontSize: 22,
            color: 'rgba(255,255,255,0.7)',
          }}
        >
          Owl Raffle · Trusted raffles, verified on-chain
        </div>
      </div>
    ),
    { ...size }
  )
}
