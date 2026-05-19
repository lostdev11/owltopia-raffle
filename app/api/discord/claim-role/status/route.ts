import { NextRequest, NextResponse } from 'next/server'

import { requireSession } from '@/lib/auth-server'
import { getDiscordRoleClaimsForWallet } from '@/lib/db/discord-role-claims'
import { getWalletProfileForDashboard } from '@/lib/db/wallet-profiles'
import { getGen2DiscordEligibility } from '@/lib/gen2-presale/discord-qualification'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

/**
 * GET /api/discord/claim-role/status
 * Returns Discord link status, Gen2 eligibility, and prior claims for the signed-in wallet.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`discord-claim-status:${ip}`, 60, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const wallet = normalizeSolanaWalletAddress(session.wallet)
    if (!wallet) {
      return NextResponse.json({ error: 'Invalid session wallet' }, { status: 401 })
    }

    const [profile, eligibility, claims] = await Promise.all([
      getWalletProfileForDashboard(wallet),
      getGen2DiscordEligibility(wallet),
      getDiscordRoleClaimsForWallet(wallet),
    ])

    const claimsByType = {
      gen2_presale: claims.find((c) => c.role_type === 'gen2_presale' && c.status === 'granted') ?? null,
      gen2_whitelist: claims.find((c) => c.role_type === 'gen2_whitelist' && c.status === 'granted') ?? null,
    }

    return NextResponse.json({
      wallet,
      discord: profile.discord,
      eligibility,
      claims: claimsByType,
    })
  } catch (e) {
    console.error('[discord/claim-role/status]', e)
    return NextResponse.json({ error: 'Failed to load claim status' }, { status: 500 })
  }
}
