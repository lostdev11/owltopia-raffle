import { NextRequest, NextResponse } from 'next/server'

import { buildGen2MintCheck } from '@/lib/owl-center/gen2-mint-check'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

function walletFromRequest(request: NextRequest): string | null {
  const q = request.nextUrl.searchParams.get('wallet')?.trim()
  if (q) return normalizeSolanaWalletAddress(q) ?? q
  return null
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request)
  const rl = rateLimit(`owl-gen2-mint-check:${ip}`, 60, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const wallet = walletFromRequest(request)
  const payload = await buildGen2MintCheck(wallet)
  if (!payload) {
    return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
  }
  return NextResponse.json(payload)
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request)
  const rl = rateLimit(`owl-gen2-mint-check:${ip}`, 60, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let wallet: string | null = null
  try {
    const body = (await request.json()) as { wallet?: string }
    const w = body.wallet?.trim()
    wallet = w ? normalizeSolanaWalletAddress(w) ?? w : null
  } catch {
    wallet = null
  }

  const payload = await buildGen2MintCheck(wallet)
  if (!payload) {
    return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
  }
  return NextResponse.json(payload)
}
