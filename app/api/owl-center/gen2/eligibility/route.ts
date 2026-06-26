import { NextRequest, NextResponse } from 'next/server'

import { buildGen2Eligibility } from '@/lib/owl-center/gen2-eligibility'
import type { OwlCenterPhase } from '@/lib/owl-center/types'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

const MINTABLE_PHASES: OwlCenterPhase[] = ['AIRDROP', 'PRESALE', 'PRESALE_OVERAGE', 'WHITELIST', 'PUBLIC']

/** Optional explicit phase — when multiple phases are live, eligibility is computed for this one. */
function parsePhase(raw: string | null | undefined): OwlCenterPhase | undefined {
  const p = raw?.trim().toUpperCase()
  return p && MINTABLE_PHASES.includes(p as OwlCenterPhase) ? (p as OwlCenterPhase) : undefined
}

function walletFromRequest(request: NextRequest): string | null {
  const q = request.nextUrl.searchParams.get('wallet')?.trim()
  if (q) return normalizeSolanaWalletAddress(q) ?? q
  return null
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request)
  const rl = rateLimit(`owl-gen2-elig:${ip}`, 90, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const wallet = walletFromRequest(request)
  const phase = parsePhase(request.nextUrl.searchParams.get('phase'))
  const payload = await buildGen2Eligibility(wallet, phase)
  if (!payload) {
    return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
  }
  return NextResponse.json(payload)
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request)
  const rl = rateLimit(`owl-gen2-elig:${ip}`, 90, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let wallet: string | null = null
  let phase: OwlCenterPhase | undefined
  try {
    const body = (await request.json()) as { wallet?: string; phase?: string }
    const w = body.wallet?.trim()
    wallet = w ? normalizeSolanaWalletAddress(w) ?? w : null
    phase = parsePhase(body.phase)
  } catch {
    wallet = null
  }

  const payload = await buildGen2Eligibility(wallet, phase)
  if (!payload) {
    return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
  }
  return NextResponse.json(payload)
}
