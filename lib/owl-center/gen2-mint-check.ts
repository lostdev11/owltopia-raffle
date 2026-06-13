import { getPresaleOverageAllocation } from '@/lib/db/gen2-presale-overage'
import { getOwlCenterLaunchBySlug } from '@/lib/db/owl-center-launch'
import { isWalletOnGen2Whitelist } from '@/lib/db/gen2-whitelist'
import { getGen2ClusterPresaleSummary } from '@/lib/gen2-presale/cluster-balance'
import { getBalanceByWallet } from '@/lib/gen2-presale/db'
import {
  gen2PresalePhaseCreditsAvailable,
  gen2PresaleOveragePhaseCreditsAvailable,
  gen2PresalePurchasedCreditsAvailable,
  isGen2PresaleCreditHolder,
  isGen2PresalePaidParticipant,
  overageReservedGiftedMints,
} from '@/lib/gen2-presale/presale-participation'
import { canPurchaseGen2PresaleSpots } from '@/lib/gen2-presale/purchase-availability'
import { buildGen2PresalePublicStats } from '@/lib/gen2-presale/public-stats'
import { buildGen2Eligibility } from '@/lib/owl-center/gen2-eligibility'
import { getLaunchPriceLamportsQuotes } from '@/lib/owl-center/launch-price-quotes'
import {
  formatGen1LinkedWalletHint,
  formatWlLinkedWalletHint,
  getGen1ClusterSummary,
  getWlClusterSummary,
} from '@/lib/owl-center/gen2-mint-check-cluster'
import { getOwltopiaGen1Snapshot } from '@/lib/owl-center/owltopia-gen1'
import { isOwlCenterMintOperational } from '@/lib/owl-center/mint-policy'
import { owlCenterPhaseLabel } from '@/lib/owl-center/phase-display'
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
import type { Gen2MintCheckPhasePreview, Gen2MintCheckResponse, OwlCenterPhase } from '@/lib/owl-center/types'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
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

function applyPhaseScheduleGate(
  isActive: boolean,
  scheduleOpen: boolean,
  isEligible: boolean,
  reason: string | null
): { is_eligible: boolean; reason: string | null } {
  if (isActive && !scheduleOpen) return { is_eligible: false, reason: 'phase_not_started' }
  return { is_eligible: isEligible, reason }
}

function phaseInactiveNote(
  phase: OwlCenterPhase,
  activePhase: OwlCenterPhase,
  isPaused: boolean,
  mintOperational: boolean
): string | null {
  if (isPaused) return 'Minting is paused by admin'
  const labels: Record<OwlCenterPhase, string> = {
    AIRDROP: 'GEN1',
    PRESALE: 'Presale',
    PRESALE_OVERAGE: 'Presale+13',
    WHITELIST: 'WL',
    PUBLIC: 'Public',
    SOLD_OUT: 'Sold out',
    TRADING_ACTIVE: 'Trading',
  }
  if (activePhase === phase && !mintOperational) {
    return `${labels[phase]} phase is not live yet — your allocation below is reserved for when admin opens mint`
  }
  if (activePhase === phase) return null
  return `${labels[phase]} phase is not live yet — your allocation below is reserved for when admin opens this phase`
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

export async function buildGen2MintCheck(walletRaw: string | null): Promise<Gen2MintCheckResponse | null> {
  const launch = await getOwlCenterLaunchBySlug('gen2')
  if (!launch) return null

  const network = isDevnetMintEnabled() ? 'devnet' : 'mainnet'
  const w = walletRaw ? normalizeSolanaWalletAddress(walletRaw.trim()) ?? walletRaw.trim() : null
  const overageSupply = launch.presale_overage_supply ?? 13

  const [pool, presaleStats, current, wallet_cluster, priceLamports] = await Promise.all([
    getPresaleMintPoolSnapshot(launch.id, launch.presale_supply, overageSupply, network),
    buildGen2PresalePublicStats().catch(() => null),
    buildGen2Eligibility(w),
    w ? getGen2ClusterPresaleSummary(w, w) : Promise.resolve(null),
    getLaunchPriceLamportsQuotes(launch),
  ])

  const unitLamportsForPhase = (phase: OwlCenterPhase): string | null => {
    if (phase === 'WHITELIST') return priceLamports.whitelist
    if (phase === 'PUBLIC') return priceLamports.public
    return null
  }

  if (!current) return null

  const presale_purchases_closed = presaleStats ? !canPurchaseGen2PresaleSpots(presaleStats) : true
  const presale_sold_out = presaleStats?.presale_sold_out === true
  const mint_operational = isOwlCenterMintOperational(launch)
  const airdrop_minted_global = await sumOwlCenterPhaseMinted(launch.id, 'AIRDROP', network)
  const airdrop_phase_complete = airdrop_minted_global >= launch.airdrop_supply

  const phaseOrder: OwlCenterPhase[] = ['AIRDROP', 'PRESALE', 'PRESALE_OVERAGE', 'WHITELIST', 'PUBLIC']
  const phases: Gen2MintCheckPhasePreview[] = []
  // GEN1 holder mint is optional — the admin phase flip alone opens presale/overage;
  // unminted airdrop supply just rolls into the remaining total supply.
  const isPhaseMintLive = (p: OwlCenterPhase) => launch.active_phase === p && mint_operational

  for (const phase of phaseOrder) {
    const label = owlCenterPhaseLabel(phase)
    const phase_starts_at = getPhaseStartsAt(launch, phase)
    const scheduleOpen = isPhaseOpenBySchedule(launch, phase)
    const phase_supply =
      phase === 'AIRDROP'
        ? launch.airdrop_supply
        : phase === 'PRESALE'
          ? launch.presale_supply
          : phase === 'PRESALE_OVERAGE'
            ? overageSupply
            : phase === 'WHITELIST'
              ? launch.wl_supply
              : launch.public_supply

    const price_usdc =
      phase === 'WHITELIST'
        ? launch.wl_price_usdc ?? 30
        : phase === 'PUBLIC'
          ? launch.public_price_usdc ?? 40
          : 0

    if (!w) {
      phases.push({
        phase,
        label,
        price_usdc: price_usdc > 0 ? price_usdc : null,
        unit_lamports_estimate: unitLamportsForPhase(phase),
        phase_supply,
        phase_starts_at,
        is_active: isPhaseMintLive(phase),
        is_eligible: false,
        max_mintable: 0,
        reserved_mints: 0,
        phase_note: null,
        reason: 'wallet_required',
      })
      continue
    }

    if (phase === 'AIRDROP') {
      const [gen1, gen1Cluster] = await Promise.all([getOwltopiaGen1Snapshot(w), getGen1ClusterSummary(w)])
      const minted_in_phase = await sumPhaseMintedForWallet(launch.id, w, 'AIRDROP', network)
      const airdropMintedGlobal = await sumOwlCenterPhaseMinted(launch.id, 'AIRDROP', network)
      const airdropRemaining = Math.max(0, launch.airdrop_supply - airdropMintedGlobal)
      const supplyRemaining = Math.max(0, launch.total_supply - launch.minted_count)
      const gen1Remaining = Math.max(0, gen1.gen1_nft_count - minted_in_phase)
      const gen1OnLinked =
        gen1Cluster.cluster_gen1_nft_count > gen1Cluster.connected_gen1_nft_count &&
        gen1Cluster.connected_gen1_nft_count === 0
      const maxFromGen1 = gen1.is_holder
        ? gen1AirdropMaxMintable({
            gen1NftCount: gen1.gen1_nft_count,
            mintedInPhase: minted_in_phase,
            airdropRemainingGlobal: airdropRemaining,
            supplyRemaining,
          })
        : 0
      const reserved_mints = gen1Remaining
      const isActive = isPhaseMintLive(phase)
      const gen1Reason = !gen1.collection_configured
        ? 'gen1_collection_not_configured'
        : gen1OnLinked
          ? 'gen1_on_linked_wallet'
          : !gen1.is_holder
            ? 'not_gen1_holder'
            : reserved_mints <= 0
              ? minted_in_phase >= gen1.gen1_nft_count
                ? 'gen1_mint_limit'
                : airdropRemaining <= 0
                  ? 'gen1_pool_exhausted'
                  : 'gen1_mint_limit'
              : null
      const gen1Gate = applyPhaseScheduleGate(
        isActive,
        scheduleOpen,
        maxFromGen1 > 0 && isActive && !launch.is_paused,
        gen1Reason
      )
      phases.push({
        phase,
        label,
        price_usdc: null,
        unit_lamports_estimate: null,
        phase_supply,
        phase_starts_at,
        is_active: isActive,
        is_eligible: gen1Gate.is_eligible,
        max_mintable: isActive ? maxFromGen1 : reserved_mints,
        reserved_mints,
        phase_note:
          reserved_mints > 0 && (!isActive || launch.is_paused)
            ? phaseInactiveNote(phase, launch.active_phase, launch.is_paused, mint_operational)
            : null,
        reason: gen1Gate.reason,
        gen1: {
          ...gen1,
          minted_in_phase,
          cluster_gen1_nft_count: gen1Cluster.cluster_gen1_nft_count,
          gen1_on_linked_wallet: gen1OnLinked,
        },
      })
      continue
    }

    if (phase === 'PRESALE') {
      const overage = await getPresaleOverageAllocation(w)
      const bal = await getBalanceByWallet(w)
      const allowance = buildPresaleWalletAllowance({ balance: bal, pool })
      const presaleCredits = gen2PresalePhaseCreditsAvailable(bal, overage)
      const max = presaleRedemptionMaxMintable({
        presaleCreditsAvailable: presaleCredits,
        presalePoolRemaining: pool.presale_mints_remaining,
        supplyRemaining: Math.max(0, launch.total_supply - launch.minted_count),
      })
      const isActive = isPhaseMintLive(phase)
      const reserved_mints = presaleCredits
      const overageReserved = overageReservedGiftedMints(bal, overage)
      const presaleReason = !bal || !isGen2PresaleCreditHolder(bal)
        ? 'not_presale_participant'
        : presaleCredits <= 0
          ? overageReserved > 0
            ? 'presale_credits_in_overage_phase'
            : 'no_presale_credits'
          : max <= 0 && isActive
            ? 'presale_pool_exhausted'
            : null
      const presaleGate = applyPhaseScheduleGate(
        isActive,
        scheduleOpen,
        max > 0 && isActive && !launch.is_paused,
        presaleReason
      )
      phases.push({
        phase,
        label,
        price_usdc: null,
        unit_lamports_estimate: null,
        phase_supply,
        phase_starts_at,
        is_active: isActive,
        is_eligible: presaleGate.is_eligible,
        max_mintable: isActive ? max : reserved_mints,
        reserved_mints,
        phase_note:
          reserved_mints > 0 && (!isActive || launch.is_paused)
            ? phaseInactiveNote(phase, launch.active_phase, launch.is_paused, mint_operational)
            : null,
        reason: presaleGate.reason,
        presale: {
          purchased_mints: allowance.purchased_mints,
          gifted_mints: allowance.gifted_mints,
          used_mints: allowance.used_mints,
          available_mints: allowance.available_mints,
          purchased_available_mints: gen2PresalePurchasedCreditsAvailable(bal),
          is_paid_participant: isGen2PresalePaidParticipant(bal),
          mint_cap: pool.mint_cap,
          credits_issued: pool.credits_issued,
          credits_overshoot: pool.credits_overshoot,
        },
      })
      continue
    }

    if (phase === 'PRESALE_OVERAGE') {
      const overage = await getPresaleOverageAllocation(w)
      const bal = await getBalanceByWallet(w)
      const availOverage = overage ? Math.max(0, overage.allowed_mints - overage.used_mints) : 0
      const overageCredits = gen2PresaleOveragePhaseCreditsAvailable(bal, overage)
      const max = presaleOverageMaxMintable({
        overageAllocationRemaining: availOverage,
        overagePhaseCreditsAvailable: overageCredits,
        overagePoolRemaining: pool.overage_mints_remaining,
        supplyRemaining: Math.max(0, launch.total_supply - launch.minted_count),
      })
      const isActive = isPhaseMintLive(phase)
      const reserved_mints = availOverage
      const overageReason =
        !bal || overageCredits <= 0
          ? 'no_presale_credits'
          : !overage || availOverage <= 0
            ? 'not_on_overage_list'
            : max <= 0 && isActive
              ? 'overage_pool_exhausted'
              : null
      const overageGate = applyPhaseScheduleGate(
        isActive,
        scheduleOpen,
        max > 0 && isActive && !launch.is_paused,
        overageReason
      )
      phases.push({
        phase,
        label,
        price_usdc: null,
        unit_lamports_estimate: null,
        phase_supply,
        phase_starts_at,
        is_active: isActive,
        is_eligible: overageGate.is_eligible,
        max_mintable: isActive ? max : reserved_mints,
        reserved_mints,
        phase_note:
          reserved_mints > 0 && (!isActive || launch.is_paused)
            ? phaseInactiveNote(phase, launch.active_phase, launch.is_paused, mint_operational)
            : null,
        reason: overageGate.reason,
        presale: bal
          ? {
              purchased_mints: bal.purchased_mints,
              gifted_mints: bal.gifted_mints,
              used_mints: bal.used_mints,
              available_mints: bal.available_mints,
              purchased_available_mints: gen2PresalePurchasedCreditsAvailable(bal),
              is_paid_participant: isGen2PresalePaidParticipant(bal),
              mint_cap: pool.mint_cap,
              credits_issued: pool.credits_issued,
              credits_overshoot: pool.credits_overshoot,
            }
          : undefined,
      })
      continue
    }

    if (phase === 'WHITELIST') {
      const [wlCluster, discord_whitelist] = await Promise.all([
        getWlClusterSummary(w),
        isWalletOnGen2Whitelist(w),
      ])
      const allowed = wlCluster.connected_allowed
      const used = wlCluster.wallets.find((row) => row.is_connected_wallet)?.used_mints ?? 0
      const availWl = wlCluster.connected_available
      const wlOnLinked =
        wlCluster.cluster_available > wlCluster.connected_available && wlCluster.connected_available === 0
      const wlMintedGlobal = await sumOwlCenterPhaseMinted(launch.id, 'WHITELIST', network)
      const wlPoolRemaining = Math.max(0, launch.wl_supply - wlMintedGlobal)
      const supplyRemaining = Math.max(0, launch.total_supply - launch.minted_count)
      const max = whitelistMaxMintable({
        allocationRemaining: availWl,
        wlPoolRemaining,
        supplyRemaining,
      })
      const connectedRow = wlCluster.wallets.find((row) => row.is_connected_wallet)
      const isActive = isPhaseMintLive(phase)
      const reserved_mints = availWl
      const admin_allocated = allowed > 0
      const wlReason = wlOnLinked
        ? 'wl_on_linked_wallet'
        : availWl <= 0
          ? discord_whitelist && !admin_allocated
            ? 'wl_pending_allocation'
            : 'not_whitelisted'
          : max <= 0 && isActive
            ? wlPoolRemaining <= 0
              ? 'wl_pool_exhausted'
              : null
            : null
      const wlGate = applyPhaseScheduleGate(
        isActive,
        scheduleOpen,
        max > 0 && isActive && !launch.is_paused,
        wlReason
      )
      phases.push({
        phase,
        label,
        price_usdc,
        unit_lamports_estimate: unitLamportsForPhase(phase),
        phase_supply,
        phase_starts_at,
        is_active: isActive,
        is_eligible: wlGate.is_eligible,
        max_mintable: isActive ? max : reserved_mints,
        reserved_mints,
        phase_note:
          reserved_mints > 0 && (!isActive || launch.is_paused)
            ? phaseInactiveNote(phase, launch.active_phase, launch.is_paused, mint_operational)
            : null,
        reason: wlGate.reason,
        wl: {
          allowed_mints: allowed,
          used_mints: used,
          available_mints: availWl,
          community: connectedRow?.community ?? null,
          discord_whitelist,
          admin_allocated,
          cluster_available_mints: wlCluster.cluster_available,
          wl_on_linked_wallet: wlOnLinked,
        },
      })
      continue
    }

    const mintedPublic = await sumPhaseMintedForWallet(launch.id, w, 'PUBLIC', network)
    const cap = Math.max(0, launch.wallet_mint_limit - mintedPublic)
    const max = Math.min(cap, Math.max(0, launch.total_supply - launch.minted_count))
    const isActive = isPhaseMintLive(phase)
    const reserved_mints = cap
    const publicReason = reserved_mints <= 0 ? 'wallet_mint_limit' : null
    const publicGate = applyPhaseScheduleGate(
      isActive,
      scheduleOpen,
      max > 0 && isActive && !launch.is_paused,
      publicReason
    )
    phases.push({
      phase,
      label,
      price_usdc,
      unit_lamports_estimate: unitLamportsForPhase(phase),
      phase_supply,
      phase_starts_at,
      is_active: isActive,
      is_eligible: publicGate.is_eligible,
      max_mintable: isActive ? max : reserved_mints,
      reserved_mints,
      phase_note:
        reserved_mints > 0 && (!isActive || launch.is_paused)
          ? phaseInactiveNote(phase, launch.active_phase, launch.is_paused, mint_operational)
          : null,
      reason: publicGate.reason,
    })
  }

  return {
    wallet: w,
    active_phase: launch.active_phase,
    status: launch.status,
    is_paused: launch.is_paused,
    mint_operational,
    airdrop_phase_complete,
    presale_purchases_closed,
    presale_sold_out,
    presale_pool: pool,
    wallet_cluster: wallet_cluster ?? undefined,
    phases,
    current,
  }
}
