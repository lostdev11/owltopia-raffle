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
import { resolveGen1SnapshotForMint } from '@/lib/owl-center/gen2-mint-delegation'
import {
  gen1AirdropMaxMintable,
  presaleOverageMaxMintable,
  presaleRedemptionMaxMintable,
  publicMaxMintable,
  whitelistMaxMintable,
} from '@/lib/owl-center/phase-allowance'
import {
  buildPresaleWalletAllowance,
  getPresaleMintPoolSnapshot,
  sumOwlCenterPhaseMinted,
} from '@/lib/owl-center/presale-mint-pool'
import type { Gen2EligibilityResponse, OwlCenterLaunchPublic, OwlCenterPhase } from '@/lib/owl-center/types'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { isOwlCenterMintGloballyDisabled, isOwlCenterMintOperational } from '@/lib/owl-center/mint-policy'
import { getPhaseStartsAt, isGen1AirdropWindowOpen, isPhaseOpenBySchedule } from '@/lib/owl-center/phase-schedule'
import {
  OWL_CENTER_MINT_SOL_RENT_RESERVE_LAMPORTS,
  formatOwlCenterPlatformMintFeeSolLabel,
  isOwlCenterPlatformMintFeeEnabled,
  owlCenterPlatformMintFeeUsd,
} from '@/lib/owl-center/platform-mint-fee'
import { getOwlCenterPlatformTreasuryWallet } from '@/lib/owl-center/platform-treasury'
import { resolveOwlCenterPlatformMintFeeLamports } from '@/lib/solana/owl-center-platform-mint-fee'
import { getLaunchSolanaRpcUrl } from '@/lib/solana/launch-cm'
import { Connection, PublicKey } from '@solana/web3.js'
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

/**
 * GEN1 (airdrop) eligibility for a connected Gen1 holder. Always reports `active_phase: 'AIRDROP'`
 * so the caller mints against the on-chain `gen1` guard group. Called both when AIRDROP is the
 * launch's active phase AND concurrently (for the 7-day Gen1 window) once the launch has advanced
 * to a later phase — Gen1 holders keep their free claim either way.
 */
async function buildGen1AirdropEligibility(
  launch: OwlCenterLaunchPublic,
  w: string,
  network: 'mainnet' | 'devnet',
  remaining: number,
  base: Gen2EligibilityResponse
): Promise<Gen2EligibilityResponse> {
  const gen1 = await resolveGen1SnapshotForMint(w)
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
    active_phase: 'AIRDROP',
    gen1_snapshot: {
      is_holder: gen1.is_holder,
      gen1_nft_count: gen1.gen1_nft_count,
      collection_configured: gen1.collection_configured,
      holder_check_available: gen1.holder_check_available,
      delegated_from: gen1.delegated_from,
      delegated_away_to: gen1.delegated_away_to,
    },
    is_eligible: max > 0,
    max_mintable: Math.max(0, max),
    reason: !gen1.collection_configured
      ? 'gen1_collection_not_configured'
      : gen1.delegated_away_to
        ? 'gen1_delegated_away'
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

/**
 * Eligibility for the connected wallet in a single phase. By default this evaluates the launch's
 * primary `active_phase`. Pass `phaseOverride` to evaluate a SPECIFIC live phase instead — used
 * when multiple phases are live concurrently and the wallet (or a server endpoint) targets one of
 * them. The override skips the Gen1-airdrop concurrent precedence so it reports exactly the asked
 * phase.
 */
export async function buildGen2Eligibility(
  walletRaw: string | null,
  phaseOverride?: OwlCenterPhase
): Promise<Gen2EligibilityResponse | null> {
  const launch = await getOwlCenterLaunchBySlug('gen2')
  if (!launch) return null

  const network = isDevnetMintEnabled() ? 'devnet' : 'mainnet'
  const w = walletRaw ? normalizeSolanaWalletAddress(walletRaw.trim()) : null
  const phase = (phaseOverride ?? launch.active_phase) as OwlCenterPhase
  const nowMs = Date.now()
  const remaining = Math.max(0, launch.total_supply - launch.minted_count)
  const overageSupply = launch.presale_overage_supply ?? 13

  // Platform mint fee (~$1, collected as SOL to the treasury in the same tx as each mint). Surfaced
  // on every phase so the client can attach the fee transfer + pre-check the wallet's SOL balance.
  const platformFeeEnabled = isOwlCenterPlatformMintFeeEnabled()
  const platform_treasury_wallet = getOwlCenterPlatformTreasuryWallet()
  const platformFeeQuote = platformFeeEnabled ? await resolveOwlCenterPlatformMintFeeLamports() : null
  const platform_mint_fee_lamports_estimate =
    platformFeeQuote?.ok === true ? platformFeeQuote.lamports.toString() : null
  let wallet_sol_balance_lamports: string | null = null
  if (w) {
    try {
      const conn = new Connection(getLaunchSolanaRpcUrl(network), 'confirmed')
      wallet_sol_balance_lamports = String(await conn.getBalance(new PublicKey(w), 'confirmed'))
    } catch {
      wallet_sol_balance_lamports = null
    }
  }
  const mint_sol_needed_lamports =
    platformFeeEnabled && platformFeeQuote?.ok === true
      ? String(platformFeeQuote.lamports + OWL_CENTER_MINT_SOL_RENT_RESERVE_LAMPORTS)
      : null

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
    platform_mint_fee_usdc: owlCenterPlatformMintFeeUsd(),
    platform_mint_fee_lamports_estimate,
    platform_mint_fee_label: formatOwlCenterPlatformMintFeeSolLabel(
      platform_mint_fee_lamports_estimate != null ? BigInt(platform_mint_fee_lamports_estimate) : null
    ),
    wallet_sol_balance_lamports,
    mint_sol_needed_lamports,
    platform_treasury_wallet,
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

  // GEN1 holders keep their free claim for the full 7-day airdrop window, concurrently with later
  // phases. Take precedence: a connected Gen1 holder with remaining allocation always mints their
  // free Gen2 first (after exhausting it they fall through to whatever phase is currently active).
  // Skipped when an explicit phase is requested — the caller wants exactly that phase's eligibility.
  if (!phaseOverride && phase !== 'AIRDROP' && isGen1AirdropWindowOpen(launch, nowMs)) {
    const gen1Concurrent = await buildGen1AirdropEligibility(launch, w, network, remaining, base)
    if (gen1Concurrent.is_eligible && gen1Concurrent.max_mintable > 0) {
      return gen1Concurrent
    }
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
    return buildGen1AirdropEligibility(launch, w, network, remaining, base)
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
    const publicMintedGlobal = await sumOwlCenterPhaseMinted(launch.id, 'PUBLIC', network)
    const publicPoolRemaining = Math.max(0, launch.public_supply - publicMintedGlobal)
    const cap = Math.max(0, launch.wallet_mint_limit - usedSum)
    const max = publicMaxMintable({
      walletLimitRemaining: cap,
      publicPoolRemaining,
      supplyRemaining: remaining,
    })
    return {
      ...base,
      is_eligible: max > 0,
      max_mintable: max,
      reason: max <= 0 ? (publicPoolRemaining <= 0 ? 'public_pool_exhausted' : 'wallet_mint_limit') : null,
      unit_lamports_estimate: quote ? quote.unitLamports.toString() : null,
      sol_usd_price: quote?.solUsdPrice ?? null,
      price_usdc: usdc,
    }
  }

  return { ...base, reason: 'unknown_phase' }
}
