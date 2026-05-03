import { NextRequest, NextResponse } from 'next/server'

import { getOwlCenterLaunchBySlug } from '@/lib/db/owl-center-launch'
import type { MintTerminalLine } from '@/lib/owl-center/types'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
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
  const [mintRows, logRows] = await Promise.all([
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

  const remaining = Math.max(0, launch.total_supply - launch.minted_count)
  const pct = launch.total_supply > 0 ? (launch.minted_count / launch.total_supply) * 100 : 0

  const { data: mpRow } = await db
    .from('owl_center_marketplace_readiness')
    .select('trading_links_active,magic_eden_url,tensor_url')
    .eq('launch_id', launch.id)
    .maybeSingle()

  const mp = mpRow as { trading_links_active?: boolean; magic_eden_url?: string | null; tensor_url?: string | null } | null

  return NextResponse.json({
    launch,
    marketplace: {
      trading_links_active: Boolean(mp?.trading_links_active),
      magic_eden_url: mp?.magic_eden_url?.trim() || null,
      tensor_url: mp?.tensor_url?.trim() || null,
    },
    supply: {
      total: launch.total_supply,
      minted: launch.minted_count,
      remaining,
      percent_minted: pct,
    },
    phases: {
      airdrop: launch.airdrop_supply,
      presale: launch.presale_supply,
      whitelist: launch.wl_supply,
      public: launch.public_supply,
    },
    prices_usdc: {
      presale: launch.presale_price_usdc,
      whitelist: launch.wl_price_usdc,
      public: launch.public_price_usdc,
    },
    terminal,
  })
}
