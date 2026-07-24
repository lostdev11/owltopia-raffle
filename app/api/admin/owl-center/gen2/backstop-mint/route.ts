import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import {
  getOwlCenterLaunchBySlugAdmin,
  updateOwlCenterLaunchAdmin,
} from '@/lib/db/owl-center-launch'
import { gen2PublicMintPoolRemaining } from '@/lib/owl-center/gen2-phase-advance'
import { mergeFreezeProgress } from '@/lib/owl-center/gen2-freeze-thaw'
import {
  ensureGen2TeamBackstopAutoEnabled,
  resolveGen2TeamBackstopWallets,
} from '@/lib/owl-center/gen2-backstop-ops'
import {
  disableGen2TeamBackstopGuards,
  gen2TeamGuardPresent,
} from '@/lib/owl-center/gen2-team-backstop-guards'
import { sumOwlCenterPhaseMinted } from '@/lib/owl-center/presale-mint-pool'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { getGen2CandyMachineId, isDevnetMintEnabled } from '@/lib/solana/network'
import { fetchCandyMachineOnChainSupply } from '@/lib/solana/candy-machine-supply'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function publicPoolRemainingForLaunch(
  launchId: string,
  launch: Awaited<ReturnType<typeof getOwlCenterLaunchBySlugAdmin>>
): Promise<number> {
  if (!launch) return 0
  const network = isDevnetMintEnabled() ? 'devnet' : 'mainnet'
  const [publicMinted, wlMinted] = await Promise.all([
    sumOwlCenterPhaseMinted(launchId, 'PUBLIC', network),
    sumOwlCenterPhaseMinted(launchId, 'WHITELIST', network),
  ])
  return gen2PublicMintPoolRemaining({
    launch,
    publicMinted,
    wlMinted,
  })
}

/**
 * POST /api/admin/owl-center/gen2/backstop-mint
 * body: { action: 'enable' | 'disable' | 'status' }
 *
 * Team mint also auto-enables when the public pool hits 0 (confirm-mint + phase-advance cron).
 */
export async function POST(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`admin-owl-gen2-backstop:${ip}`, 20, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: { action?: string }
  try {
    body = (await request.json()) as { action?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = (body.action ?? 'status').trim().toLowerCase()
  const launch = await getOwlCenterLaunchBySlugAdmin('gen2')
  if (!launch) return NextResponse.json({ error: 'Launch not found' }, { status: 404 })

  const remaining = Math.max(0, launch.total_supply - launch.minted_count)
  const publicPoolRemaining = await publicPoolRemainingForLaunch(launch.id, launch)
  const enabled = Boolean(launch.freeze_progress.backstop_mint_enabled)
  const teamWallets =
    launch.freeze_progress.backstop_team_wallets ??
    (await resolveGen2TeamBackstopWallets(session.wallet))

  if (action === 'status') {
    let onChainTeam = false
    let on_chain_remaining: number | null = null
    try {
      onChainTeam = await gen2TeamGuardPresent(getGen2CandyMachineId(launch) || undefined)
    } catch {
      onChainTeam = false
    }
    try {
      const supply = await fetchCandyMachineOnChainSupply(
        getGen2CandyMachineId(launch) || '',
        isDevnetMintEnabled() ? 'devnet' : 'mainnet'
      )
      if (supply.ok) on_chain_remaining = supply.remaining
    } catch {
      on_chain_remaining = null
    }
    return NextResponse.json({
      ok: true,
      enabled,
      on_chain_team_group: onChainTeam,
      team_wallets: teamWallets,
      public_pool_remaining: publicPoolRemaining,
      collection_remaining: remaining,
      on_chain_remaining,
      minted_count: launch.minted_count,
      total_supply: launch.total_supply,
      auto_enable: true,
      ledger_lag:
        on_chain_remaining != null && remaining > on_chain_remaining
          ? remaining - on_chain_remaining
          : 0,
    })
  }

  if (action === 'enable') {
    const supply = await fetchCandyMachineOnChainSupply(
      getGen2CandyMachineId(launch) || '',
      isDevnetMintEnabled() ? 'devnet' : 'mainnet'
    )
    if (supply.ok && supply.remaining <= 0) {
      return NextResponse.json(
        {
          error:
            'Candy Machine is sold out on-chain (0 left). DB remaining is ledger lag — nothing to team-mint. Refresh / wait for reconcile.',
        },
        { status: 400 }
      )
    }
    const res = await ensureGen2TeamBackstopAutoEnabled({
      launch,
      extraWallet: session.wallet,
    })
    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: 400 })
    }
    if (!res.enabled) {
      return NextResponse.json(
        {
          error:
            res.reason === 'collection_sold_out'
              ? 'Collection already minted out'
              : res.reason.startsWith('public_pool_remaining')
                ? `Public pool still has spots — wait until public is sold out (${res.reason}).`
                : res.reason,
        },
        { status: 400 }
      )
    }
    const refreshed = await getOwlCenterLaunchBySlugAdmin('gen2')
    return NextResponse.json({
      ok: true,
      enabled: true,
      already: res.already,
      signature: res.signature,
      team_wallets: res.wallets,
      public_pool_remaining: publicPoolRemaining,
      collection_remaining: remaining,
      freeze_progress: refreshed?.freeze_progress,
    })
  }

  if (action === 'disable') {
    try {
      const res = await disableGen2TeamBackstopGuards({
        candyMachineId: getGen2CandyMachineId(launch) || undefined,
      })
      const now = new Date().toISOString()
      const progress = mergeFreezeProgress(launch.freeze_progress, {
        backstop_mint_enabled: false,
        updated_at: now,
        error: undefined,
      })
      await updateOwlCenterLaunchAdmin('gen2', { freeze_progress: progress })
      return NextResponse.json({
        ok: true,
        enabled: false,
        signature: res.signature || null,
        removed: res.removed,
        public_pool_remaining: publicPoolRemaining,
        collection_remaining: remaining,
      })
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({ error: 'Invalid action — use enable, disable, or status' }, { status: 400 })
}
