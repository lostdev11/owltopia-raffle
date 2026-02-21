import { ImageResponse } from 'next/og'

// Edge runtime recommended for OG image generation on Vercel
export const runtime = 'edge'

const WIDTH = 1200
const HEIGHT = 630

export async function GET() {
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
            fontSize: 72,
            fontWeight: 800,
            color: 'white',
            letterSpacing: '-0.02em',
            marginBottom: 16,
          }}
        >
          Owl Raffle
        </div>
        <div
          style={{
            fontSize: 28,
            color: 'rgba(255,255,255,0.85)',
            maxWidth: 640,
            textAlign: 'center',
            lineHeight: 1.4,
          }}
        >
          Trusted raffles with full transparency. Every entry verified on-chain.
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
    },
  )
}
