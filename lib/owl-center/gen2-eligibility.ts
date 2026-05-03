import { getOwlCenterLaunchBySlug } from '@/lib/db/owl-center-launch'
import { getBalanceByWallet } from '@/lib/gen2-presale/db'
import { getOptionalLamportsQuoteForUsdc } from '@/lib/gen2-presale/pricing'
import type { Gen2EligibilityResponse, OwlCenterPhase } from '@/lib/owl-center/types'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { isDevnetMintEnabled } from '@/lib/solana/network'

type WlRow = { wallet: string; allowed_mints: number; used_mints: number }

async function getWlRow(wallet: string): Promise<WlRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('owl_center_wl_allocations').select('*').eq('wallet', wallet).maybeSingle()
  if (error || !data) return null
  const r = data as Record<string, unknown>
  return {
    wallet: String(r.wallet),
    allowed_mints: Number(r.allowed_mints ?? 0),
    used_mints: Number(r.used_mints ?? 0),
  }
}

export async function buildGen2Eligibility(walletRaw: string | null): Promise<Gen2EligibilityResponse | null> {
  const launch = await getOwlCenterLaunchBySlug('gen2')
  if (!launch) return null

  const w = walletRaw ? normalizeSolanaWalletAddress(walletRaw.trim()) : null
  const phase = launch.active_phase as OwlCenterPhase
  const remaining = Math.max(0, launch.total_supply - launch.minted_count)

  const base: Gen2EligibilityResponse = {
    active_phase: phase,
    status: launch.status,
    is_paused: launch.is_paused,
    is_eligible: false,
    max_mintable: 0,
    reason: null,
    unit_lamports_estimate: null,
    sol_usd_price: null,
    price_usdc: null,
  }

  if (launch.is_paused) {
    return { ...base, is_eligible: false, max_mintable: 0, reason: 'mint_paused' }
  }

  if (phase === 'SOLD_OUT' || phase === 'TRADING_ACTIVE') {
    return {
      ...base,
      is_eligible: false,
      max_mintable: 0,
      reason: phase === 'TRADING_ACTIVE' ? 'trading_active' : 'sold_out',
    }
  }

  if (remaining <= 0) {
    return { ...base, is_eligible: false, max_mintable: 0, reason: 'sold_out' }
  }

  if (!w) {
    return { ...base, is_eligible: false, max_mintable: 0, reason: 'wallet_required' }
  }

  if (phase === 'PRESALE') {
    const bal = await getBalanceByWallet(w)
    const avail = bal?.available_mints ?? 0
    const max = Math.min(avail, remaining)
    return {
      ...base,
      presale_balance: bal
        ? {
            purchased_mints: bal.purchased_mints,
            gifted_mints: bal.gifted_mints,
            used_mints: bal.used_mints,
            available_mints: bal.available_mints,
          }
        : {
            purchased_mints: 0,
            gifted_mints: 0,
            used_mints: 0,
            available_mints: 0,
          },
      is_eligible: avail > 0,
      max_mintable: Math.max(0, max),
      reason: avail <= 0 ? 'no_presale_allocation' : null,
      price_usdc: 0,
    }
  }

  if (phase === 'WHITELIST') {
    const usdc = launch.wl_price_usdc ?? 30
    const quote = await getOptionalLamportsQuoteForUsdc(usdc)
    const row = await getWlRow(w)
    const allowed = row?.allowed_mints ?? 0
    const used = row?.used_mints ?? 0
    const availWl = Math.max(0, allowed - used)
    const max = Math.min(availWl, remaining, launch.wallet_mint_limit)
    return {
      ...base,
      wl_allocation: { allowed_mints: allowed, used_mints: used, available_mints: availWl },
      is_eligible: availWl > 0,
      max_mintable: Math.max(0, max),
      reason: availWl <= 0 ? 'not_whitelisted' : null,
      unit_lamports_estimate: quote ? quote.unitLamports.toString() : null,
      sol_usd_price: quote?.solUsdPrice ?? null,
      price_usdc: usdc,
    }
  }

  if (phase === 'PUBLIC' || phase === 'AIRDROP') {
    const usdc = phase === 'PUBLIC' ? launch.public_price_usdc ?? 40 : 0
    const quote = usdc > 0 ? await getOptionalLamportsQuoteForUsdc(usdc) : null
    const db = getSupabaseAdmin()
    const mintNetwork = isDevnetMintEnabled() ? 'devnet' : 'mainnet'
    const { data: usedRows } = await db
      .from('owl_center_mint_events')
      .select('quantity')
      .eq('launch_id', launch.id)
      .eq('wallet_address', w)
      .eq('phase', phase)
      .eq('network', mintNetwork)
    const usedSum = (usedRows ?? []).reduce((s, r) => s + Number((r as { quantity?: number }).quantity ?? 0), 0)
    const cap = Math.max(0, launch.wallet_mint_limit - usedSum)
    const max = Math.min(cap, remaining)
    return {
      ...base,
      is_eligible: max > 0,
      max_mintable: max,
      reason: max <= 0 ? 'wallet_mint_limit' : null,
      unit_lamports_estimate: quote ? quote.unitLamports.toString() : null,
      sol_usd_price: quote?.solUsdPrice ?? null,
      price_usdc: usdc > 0 ? usdc : null,
    }
  }

  return { ...base, reason: 'unknown_phase' }
}
