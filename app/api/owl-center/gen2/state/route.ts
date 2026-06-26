import { NextRequest, NextResponse } from 'next/server'

import { getOwlCenterLaunchBySlug } from '@/lib/db/owl-center-launch'
import type { MintTerminalLine } from '@/lib/owl-center/types'
import { collectMintedNftMintsForLaunch } from '@/lib/owl-center/hash-list'
import { getPresaleMintPoolSnapshot, sumOwlCenterPhaseMinted } from '@/lib/owl-center/presale-mint-pool'
import { gen2PhasePoolCap } from '@/lib/owl-center/gen2-phase-advance'
import { OWL_CENTER_MINTABLE_PHASES } from '@/lib/owl-center/phase-schedule'
import { reconcileLaunchMintedCount } from '@/lib/owl-center/reconcile-gen2-minted-count'
import { isGen2PresaleSoldOut } from '@/lib/gen2-presale/purchase-availability'
import { buildGen2PresalePublicStats } from '@/lib/gen2-presale/public-stats'
import { listGen2PresaleParticipants } from '@/lib/gen2-presale/db'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getLaunchPriceLamportsQuotes } from '@/lib/owl-center/launch-price-quotes'
import { buildOwlCenterMintControls } from '@/lib/owl-center/mint-policy'
import { isDevnetMintEnabled } from '@/lib/solana/network'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const ip = getClientIp(request)
  const rl = rateLimit(`owl-gen2-state:${ip}`, 120, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const launch = await getOwlCenterLaunchBySlug('gen2')
  if (!launch) {
    return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
  }

  const db = getSupabaseAdmin()
  const [mintRows, logRows, minted_mints] = await Promise.all([
    db
      .from('owl_center_mint_events')
      .select('id,wallet_address,quantity,phase,tx_signature,network,created_at')
      .eq('launch_id', launch.id)
      .order('created_at', { ascending: false })
      .limit(40),
    db
      .from('owl_center_activity_logs')
      .select('id,message,event_type,created_at')
      .eq('launch_id', launch.id)
      .order('created_at', { ascending: false })
      .limit(25),
    collectMintedNftMintsForLaunch(launch.id),
  ])

  const mintLines: MintTerminalLine[] = (mintRows.data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    const w = String(row.wallet_address ?? '')
    const short = w.length > 8 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w
    const net = String(row.network ?? 'mainnet')
    return {
      id: String(row.id),
      kind: 'mint' as const,
      message: `MINT [${net}] ${row.phase} qty=${row.quantity} ${short} sig=${String(row.tx_signature ?? '').slice(0, 12)}…`,
      created_at: String(row.created_at ?? ''),
    }
  })

  const sysLines: MintTerminalLine[] = (logRows.data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    return {
      id: String(row.id),
      kind: 'system' as const,
      message: String(row.message ?? ''),
      created_at: String(row.created_at ?? ''),
    }
  })

  const terminal = [...mintLines, ...sysLines]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 50)

  const network = isDevnetMintEnabled() ? 'devnet' : 'mainnet'
  // Source of truth = recorded mint events. Self-heals the stored counter if it has
  // drifted (e.g. emergency override or devnet test mints) so the supply always matches.
  const minted = await reconcileLaunchMintedCount(launch.id, network)
  launch.minted_count = minted
  const remaining = Math.max(0, launch.total_supply - minted)
  const pct = launch.total_supply > 0 ? (minted / launch.total_supply) * 100 : 0

  const { data: mpRow } = await db
    .from('owl_center_marketplace_readiness')
    .select('trading_links_active,magic_eden_url,tensor_url')
    .eq('launch_id', launch.id)
    .maybeSingle()

  const mp = mpRow as { trading_links_active?: boolean; magic_eden_url?: string | null; tensor_url?: string | null } | null
  const [presale_pool, presale_participants, presaleStats, prices_lamports] = await Promise.all([
    getPresaleMintPoolSnapshot(launch.id, launch.presale_supply, launch.presale_overage_supply ?? 13, network, {
      slug: 'gen2',
    }),
    listGen2PresaleParticipants(500),
    buildGen2PresalePublicStats().catch(() => null),
    getLaunchPriceLamportsQuotes(launch),
  ])
  const presale_sold_out = isGen2PresaleSoldOut(presaleStats)

  // Per-phase mint progress (minted vs the phase's supply pool cap) so the admin
  // console can show how many spots remain in each phase, not just total supply.
  const phase_breakdown = await Promise.all(
    OWL_CENTER_MINTABLE_PHASES.map(async (phase) => {
      const phaseMinted = await sumOwlCenterPhaseMinted(launch.id, phase, network)
      const cap = gen2PhasePoolCap(launch, phase)
      return {
        phase,
        minted: phaseMinted,
        cap,
        remaining: Math.max(0, cap - phaseMinted),
      }
    })
  )

  const mint_controls = buildOwlCenterMintControls(launch.is_paused)

  return NextResponse.json({
    launch,
    mint_controls,
    marketplace: {
      trading_links_active: Boolean(mp?.trading_links_active),
      magic_eden_url: mp?.magic_eden_url?.trim() || null,
      tensor_url: mp?.tensor_url?.trim() || null,
    },
    supply: {
      total: launch.total_supply,
      minted,
      remaining,
      percent_minted: pct,
    },
    phases: {
      airdrop: launch.airdrop_supply,
      presale: launch.presale_supply,
      whitelist: launch.wl_supply,
      public: launch.public_supply,
    },
    phase_breakdown,
    prices_usdc: {
      presale: null,
      whitelist: launch.wl_price_usdc,
      public: launch.public_price_usdc,
    },
    prices_lamports,
    presale_pool,
    presale_sold_out,
    presale_participant_count: presale_participants.length,
    minted_mints,
    mint_network: network,
    terminal,
  })
}
