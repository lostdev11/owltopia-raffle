import { getPresaleOverageAllocation } from '@/lib/db/gen2-presale-overage'
import { getOwlCenterLaunchBySlug } from '@/lib/db/owl-center-launch'
import { getBalanceByWallet } from '@/lib/gen2-presale/db'
import {
  gen2PresalePhaseCreditsAvailable,
  gen2PresaleOveragePhaseCreditsAvailable,
  gen2PresalePurchasedCreditsAvailable,
  isGen2PresaleCreditHolder,
  isGen2PresalePaidParticipant,
  overageReservedGiftedMints,
} from '@/lib/gen2-presale/presale-participation'
import { getOptionalLamportsQuoteForUsdc } from '@/lib/gen2-presale/pricing'
import { getOwltopiaGen1Snapshot } from '@/lib/owl-center/owltopia-gen1'
import {
  gen1AirdropMaxMintable,
  presaleOverageMaxMintable,
  presaleRedemptionMaxMintable,
  whitelistMaxMintable,
} from '@/lib/owl-center/phase-allowance'
import {
  buildPresaleWalletAllowance,
  getPresaleMintPoolSnapshot,
  sumOwlCenterPhaseMinted,
} from '@/lib/owl-center/presale-mint-pool'
import type { Gen2EligibilityResponse, OwlCenterPhase } from '@/lib/owl-center/types'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { isOwlCenterMintGloballyDisabled, isOwlCenterMintOperational } from '@/lib/owl-center/mint-policy'
import { getPhaseStartsAt, isPhaseOpenBySchedule } from '@/lib/owl-center/phase-schedule'
import { isDevnetMintEnabled } from '@/lib/solana/network'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

type WlRow = { wallet: string; allowed_mints: number; used_mints: number; community?: string | null }

async function getWlRow(wallet: string): Promise<WlRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('owl_center_wl_allocations').select('*').eq('wallet', wallet).maybeSingle()
  if (error || !data) return null
  const r = data as Record<string, unknown>
  return {
    wallet: String(r.wallet),
    allowed_mints: Number(r.allowed_mints ?? 0),
    used_mints: Number(r.used_mints ?? 0),
    community: r.community != null ? String(r.community) : null,
  }
}

async function sumPhaseMintedForWallet(
  launchId: string,
  wallet: string,
  phase: OwlCenterPhase,
  network: 'mainnet' | 'devnet'
): Promise<number> {
  const db = getSupabaseAdmin()
  const { data } = await db
    .from('owl_center_mint_events')
    .select('quantity')
    .eq('launch_id', launchId)
    .eq('wallet_address', wallet)
    .eq('phase', phase)
    .eq('network', network)
  return (data ?? []).reduce((s, r) => s + Number((r as { quantity?: number }).quantity ?? 0), 0)
}

export async function buildGen2Eligibility(walletRaw: string | null): Promise<Gen2EligibilityResponse | null> {
  const launch = await getOwlCenterLaunchBySlug('gen2')
  if (!launch) return null

  const network = isDevnetMintEnabled() ? 'devnet' : 'mainnet'
  const w = walletRaw ? normalizeSolanaWalletAddress(walletRaw.trim()) : null
  const phase = launch.active_phase as OwlCenterPhase
  const remaining = Math.max(0, launch.total_supply - launch.minted_count)
  const overageSupply = launch.presale_overage_supply ?? 13

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

  if (isOwlCenterMintGloballyDisabled(launch.is_paused)) {
    return {
      ...base,
      is_eligible: false,
      max_mintable: 0,
      reason: launch.is_paused ? 'mint_paused' : 'mint_kill_switch',
    }
  }

  if (!isOwlCenterMintOperational(launch)) {
    return {
      ...base,
      is_eligible: false,
      max_mintable: 0,
      reason: 'mint_not_open',
    }
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

  if (!isPhaseOpenBySchedule(launch, phase)) {
    return {
      ...base,
      is_eligible: false,
      max_mintable: 0,
      reason: 'phase_not_started',
      phase_starts_at: getPhaseStartsAt(launch, phase),
    }
  }

  if (phase === 'AIRDROP') {
    const gen1 = await getOwltopiaGen1Snapshot(w)
    const minted_in_phase = await sumPhaseMintedForWallet(launch.id, w, 'AIRDROP', network)
    const airdropMintedGlobal = await sumOwlCenterPhaseMinted(launch.id, 'AIRDROP', network)
    const airdropRemaining = Math.max(0, launch.airdrop_supply - airdropMintedGlobal)
    const max = gen1.is_holder
      ? gen1AirdropMaxMintable({
          gen1NftCount: gen1.gen1_nft_count,
          mintedInPhase: minted_in_phase,
          airdropRemainingGlobal: airdropRemaining,
          supplyRemaining: remaining,
        })
      : 0
    const gen1Remaining = Math.max(0, gen1.gen1_nft_count - minted_in_phase)
    return {
      ...base,
      gen1_snapshot: {
        is_holder: gen1.is_holder,
        gen1_nft_count: gen1.gen1_nft_count,
        collection_configured: gen1.collection_configured,
        holder_check_available: gen1.holder_check_available,
      },
      is_eligible: max > 0,
      max_mintable: Math.max(0, max),
      reason: !gen1.collection_configured
        ? 'gen1_collection_not_configured'
        : !gen1.is_holder
          ? 'not_gen1_holder'
          : gen1Remaining <= 0
            ? 'gen1_mint_limit'
            : airdropRemaining <= 0
              ? 'gen1_pool_exhausted'
              : max <= 0
                ? 'gen1_mint_limit'
                : null,
      price_usdc: 0,
    }
  }

  // GEN1 holder mint is optional — presale/overage open when admin flips the phase, regardless
  // of how much of the airdrop supply was actually minted. Unminted GEN1 supply simply stays
  // in the remaining total supply for later phases.
  if (phase === 'PRESALE') {
    const pool = await getPresaleMintPoolSnapshot(launch.id, launch.presale_supply, overageSupply, network, {
      slug: launch.slug,
    })
    const overage = await getPresaleOverageAllocation(w)
    const bal = await getBalanceByWallet(w)
    const allowance = buildPresaleWalletAllowance({ balance: bal, pool })
    const presaleCredits = gen2PresalePhaseCreditsAvailable(bal, overage)
    const max = presaleRedemptionMaxMintable({
      presaleCreditsAvailable: presaleCredits,
      presalePoolRemaining: pool.presale_mints_remaining,
      supplyRemaining: remaining,
    })
    const overageReserved = overageReservedGiftedMints(bal, overage)
    return {
      ...base,
      presale_balance: {
        purchased_mints: allowance.purchased_mints,
        gifted_mints: allowance.gifted_mints,
        used_mints: allowance.used_mints,
        available_mints: allowance.available_mints,
        purchased_available_mints: gen2PresalePurchasedCreditsAvailable(bal),
        is_paid_participant: isGen2PresalePaidParticipant(bal),
      },
      is_eligible: max > 0,
      max_mintable: Math.max(0, max),
      reason: !bal || !isGen2PresaleCreditHolder(bal)
        ? 'not_presale_participant'
        : presaleCredits <= 0
          ? overageReserved > 0
            ? 'presale_credits_in_overage_phase'
            : 'no_presale_credits'
          : max <= 0
            ? 'presale_pool_exhausted'
            : null,
      price_usdc: 0,
    }
  }

  if (phase === 'PRESALE_OVERAGE') {
    const pool = await getPresaleMintPoolSnapshot(launch.id, launch.presale_supply, overageSupply, network, {
      slug: launch.slug,
    })
    const overage = await getPresaleOverageAllocation(w)
    const bal = await getBalanceByWallet(w)
    const availOverage = overage ? Math.max(0, overage.allowed_mints - overage.used_mints) : 0
    const overageCredits = gen2PresaleOveragePhaseCreditsAvailable(bal, overage)
    const max = presaleOverageMaxMintable({
      overageAllocationRemaining: availOverage,
      overagePhaseCreditsAvailable: overageCredits,
      overagePoolRemaining: pool.overage_mints_remaining,
      supplyRemaining: remaining,
    })
    return {
      ...base,
      presale_balance: bal
        ? {
            purchased_mints: bal.purchased_mints,
            gifted_mints: bal.gifted_mints,
            used_mints: bal.used_mints,
            available_mints: bal.available_mints,
            purchased_available_mints: gen2PresalePurchasedCreditsAvailable(bal),
            is_paid_participant: isGen2PresalePaidParticipant(bal),
          }
        : undefined,
      is_eligible: max > 0,
      max_mintable: Math.max(0, max),
      reason:
        !bal || overageCredits <= 0
          ? 'no_presale_credits'
          : !overage || availOverage <= 0
            ? 'not_on_overage_list'
            : max <= 0
              ? 'overage_pool_exhausted'
              : null,
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
    const wlMintedGlobal = await sumOwlCenterPhaseMinted(launch.id, 'WHITELIST', network)
    const wlPoolRemaining = Math.max(0, launch.wl_supply - wlMintedGlobal)
    const max = whitelistMaxMintable({
      allocationRemaining: availWl,
      wlPoolRemaining,
      supplyRemaining: remaining,
    })
    return {
      ...base,
      wl_allocation: {
        allowed_mints: allowed,
        used_mints: used,
        available_mints: availWl,
        community: row?.community ?? null,
      },
      is_eligible: max > 0,
      max_mintable: Math.max(0, max),
      reason:
        availWl <= 0 ? 'not_whitelisted' : max <= 0 ? (wlPoolRemaining <= 0 ? 'wl_pool_exhausted' : 'sold_out') : null,
      unit_lamports_estimate: quote ? quote.unitLamports.toString() : null,
      sol_usd_price: quote?.solUsdPrice ?? null,
      price_usdc: usdc,
    }
  }

  if (phase === 'PUBLIC') {
    const usdc = launch.public_price_usdc ?? 40
    const quote = await getOptionalLamportsQuoteForUsdc(usdc)
    const usedSum = await sumPhaseMintedForWallet(launch.id, w, 'PUBLIC', network)
    const cap = Math.max(0, launch.wallet_mint_limit - usedSum)
    const max = Math.min(cap, remaining)
    return {
      ...base,
      is_eligible: max > 0,
      max_mintable: max,
      reason: max <= 0 ? 'wallet_mint_limit' : null,
      unit_lamports_estimate: quote ? quote.unitLamports.toString() : null,
      sol_usd_price: quote?.solUsdPrice ?? null,
      price_usdc: usdc,
    }
  }

  return { ...base, reason: 'unknown_phase' }
}
