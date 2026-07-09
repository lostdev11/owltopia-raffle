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
import { resolveGen1SnapshotForMint } from '@/lib/owl-center/gen2-mint-delegation'
import { resolvePresaleBalanceForMint } from '@/lib/owl-center/gen2-presale-delegation'
import { reconcileGen2WalletMints } from '@/lib/owl-center/reconcile-gen2-wallet-mints'
import { isOwlCenterMintOperational } from '@/lib/owl-center/mint-policy'
import { owlCenterPhaseLabel } from '@/lib/owl-center/phase-display'
import {
  gen2PhaseWindowMs,
  gen2PublicMintPoolRemaining,
  gen2PublicPhaseSupplyDisplay,
  gen2PublicPoolCap,
  gen2PublicWalletLimitRemaining,
  isGen2WhitelistClosed,
} from '@/lib/owl-center/gen2-phase-advance'
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
import { getLivePhases, getPhaseStartsAt, isGen1AirdropWindowOpen, isPhaseOpenBySchedule } from '@/lib/owl-center/phase-schedule'
import { isDevnetMintEnabled } from '@/lib/solana/network'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

type WlRow = { wallet: string; allowed_mints: number; used_mints: number; community?: string | null }

function shortWallet(w: string): string {
  return w.length > 12 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w
}

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

// Per-wallet on-chain → DB reconcile is best-effort and self-throttled so the allocation panel can
// poll freely without RPC-storming: at most once per wallet per window, hard-capped in time, and
// never allowed to fail the read. The cheap drift gate inside the reconcile skips the signature
// scan entirely when the DB already matches the chain.
const RECONCILE_THROTTLE_MS = 60_000
const RECONCILE_TIME_BUDGET_MS = 6_000
const lastWalletReconcileAt = new Map<string, number>()

async function maybeReconcileGen2WalletMints(
  launch: { id: string; slug: string } & Record<string, unknown>,
  wallet: string,
  network: 'mainnet' | 'devnet'
): Promise<void> {
  const key = `${launch.id}:${network}:${wallet}`
  const now = Date.now()
  if (now - (lastWalletReconcileAt.get(key) ?? 0) < RECONCILE_THROTTLE_MS) return
  lastWalletReconcileAt.set(key, now)
  try {
    await Promise.race([
      reconcileGen2WalletMints({
        launch: launch as unknown as Parameters<typeof reconcileGen2WalletMints>[0]['launch'],
        wallet,
        network,
      }),
      new Promise<void>((resolve) => setTimeout(resolve, RECONCILE_TIME_BUDGET_MS)),
    ])
  } catch {
    // best-effort — never block or fail the allocation read
  }
}

export async function buildGen2MintCheck(walletRaw: string | null): Promise<Gen2MintCheckResponse | null> {
  const launch = await getOwlCenterLaunchBySlug('gen2')
  if (!launch) return null

  const network = isDevnetMintEnabled() ? 'devnet' : 'mainnet'
  const w = walletRaw ? normalizeSolanaWalletAddress(walletRaw.trim()) ?? walletRaw.trim() : null
  const overageSupply = launch.presale_overage_supply ?? 13

  // Self-heal this wallet's ledger from chain BEFORE reading counts, so the allocation panel reflects
  // mints whose client-side confirm was cut short (mobile backgrounding / large batches).
  if (w) await maybeReconcileGen2WalletMints(launch, w, network)

  const [pool, presaleStats, current, wallet_cluster, priceLamports] = await Promise.all([
    getPresaleMintPoolSnapshot(launch.id, launch.presale_supply, overageSupply, network, { slug: launch.slug }),
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

  // Global minted-per-phase counts power the per-phase supply progress bars in the UI.
  const [
    airdropMintedGlobal,
    presaleMintedGlobal,
    overageMintedGlobal,
    wlMintedGlobal,
    publicMintedGlobal,
  ] = await Promise.all([
    sumOwlCenterPhaseMinted(launch.id, 'AIRDROP', network),
    sumOwlCenterPhaseMinted(launch.id, 'PRESALE', network),
    sumOwlCenterPhaseMinted(launch.id, 'PRESALE_OVERAGE', network),
    sumOwlCenterPhaseMinted(launch.id, 'WHITELIST', network),
    sumOwlCenterPhaseMinted(launch.id, 'PUBLIC', network),
  ])
  const phaseMintedGlobal: Record<OwlCenterPhase, number> = {
    AIRDROP: airdropMintedGlobal,
    PRESALE: presaleMintedGlobal,
    PRESALE_OVERAGE: overageMintedGlobal,
    WHITELIST: wlMintedGlobal,
    PUBLIC: publicMintedGlobal,
    SOLD_OUT: 0,
    TRADING_ACTIVE: 0,
  }

  const airdrop_minted_global = airdropMintedGlobal
  const airdrop_phase_complete = airdrop_minted_global >= launch.airdrop_supply

  const phaseOrder: OwlCenterPhase[] = ['AIRDROP', 'PRESALE', 'PRESALE_OVERAGE', 'WHITELIST', 'PUBLIC']
  const phases: Gen2MintCheckPhasePreview[] = []
  // GEN1 holder mint is optional — the admin phase flip alone opens presale/overage;
  // unminted airdrop supply just rolls into the remaining total supply.
  // A phase is "live" when it is in the launch's live set (primary active_phase, any admin-toggled
  // concurrent phase, or the Gen1 7-day window) AND the mint is operational.
  const livePhases = getLivePhases(launch)
  const isPhaseMintLive = (p: OwlCenterPhase) => livePhases.has(p) && mint_operational

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
              : gen2PublicPoolCap(launch, wlMintedGlobal)

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
        phase_minted: phaseMintedGlobal[phase],
        phase_starts_at,
        is_active: isPhaseMintLive(phase),
        is_eligible: false,
        max_mintable: 0,
        reserved_mints: 0,
        phase_note: null,
        reason: 'wallet_required',
        minted_in_phase: 0,
      })
      continue
    }

    if (phase === 'AIRDROP') {
      const [gen1, gen1Cluster] = await Promise.all([resolveGen1SnapshotForMint(w), getGen1ClusterSummary(w)])
      const minted_in_phase = await sumPhaseMintedForWallet(launch.id, w, 'AIRDROP', network)
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
      // GEN1 stays mintable for its full 7-day window, concurrently with later phases — so it is
      // "active" whenever the launch is operational and the Gen1 window is still open, even if
      // active_phase has already advanced to PRESALE/WHITELIST/PUBLIC.
      const isActive = isPhaseMintLive(phase) || (mint_operational && isGen1AirdropWindowOpen(launch))
      const gen1Reason = !gen1.collection_configured
        ? 'gen1_collection_not_configured'
        : gen1.delegated_away_to
          ? 'gen1_delegated_away'
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
      const delegationNote = gen1.delegated_from
        ? `Minting on behalf of ${shortWallet(gen1.delegated_from)} via admin wallet switch`
        : gen1.delegated_away_to
          ? `Gen1 mint delegated to ${shortWallet(gen1.delegated_away_to)} — connect that wallet to mint`
          : null
      phases.push({
        phase,
        label,
        price_usdc: null,
        unit_lamports_estimate: null,
        phase_supply,
        phase_minted: phaseMintedGlobal[phase],
        phase_starts_at,
        is_active: isActive,
        is_eligible: gen1Gate.is_eligible,
        max_mintable: isActive ? maxFromGen1 : reserved_mints,
        reserved_mints,
        phase_note:
          delegationNote ??
          (reserved_mints > 0 && (!isActive || launch.is_paused)
            ? phaseInactiveNote(phase, launch.active_phase, launch.is_paused, mint_operational)
            : null),
        reason: gen1Gate.reason,
        minted_in_phase,
        gen1: {
          is_holder: gen1.is_holder,
          gen1_nft_count: gen1.gen1_nft_count,
          minted_in_phase,
          cluster_gen1_nft_count: gen1Cluster.cluster_gen1_nft_count,
          gen1_on_linked_wallet: gen1OnLinked,
          delegated_from: gen1.delegated_from,
          delegated_away_to: gen1.delegated_away_to,
        },
      })
      continue
    }

    if (phase === 'PRESALE') {
      const overage = await getPresaleOverageAllocation(w)
      const resolved = await resolvePresaleBalanceForMint(w)
      const bal = resolved.balance
      const presaleMinted = await sumPhaseMintedForWallet(launch.id, w, 'PRESALE', network)
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
      const presaleReason = resolved.delegated_away_to
        ? 'presale_delegated_away'
        : !bal || !isGen2PresaleCreditHolder(bal)
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
      const delegationNote = resolved.delegated_from
        ? `Minting presale credits on behalf of ${shortWallet(resolved.delegated_from)} via admin wallet switch`
        : resolved.delegated_away_to
          ? `Presale credits delegated to ${shortWallet(resolved.delegated_away_to)} — connect that wallet to mint`
          : null
      phases.push({
        phase,
        label,
        price_usdc: null,
        unit_lamports_estimate: null,
        phase_supply,
        phase_minted: phaseMintedGlobal[phase],
        phase_starts_at,
        is_active: isActive,
        is_eligible: presaleGate.is_eligible,
        max_mintable: isActive ? max : reserved_mints,
        reserved_mints,
        phase_note:
          delegationNote ??
          (reserved_mints > 0 && (!isActive || launch.is_paused)
            ? phaseInactiveNote(phase, launch.active_phase, launch.is_paused, mint_operational)
            : null),
        reason: presaleGate.reason,
        minted_in_phase: presaleMinted,
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
          delegated_from: resolved.delegated_from,
          delegated_away_to: resolved.delegated_away_to,
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
        phase_minted: phaseMintedGlobal[phase],
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
        minted_in_phase: Math.max(0, Math.floor(overage?.used_mints ?? 0)),
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
      const wlPoolRemaining = Math.max(0, launch.wl_supply - wlMintedGlobal)
      const supplyRemaining = Math.max(0, launch.total_supply - launch.minted_count)
      const max = whitelistMaxMintable({
        allocationRemaining: availWl,
        wlPoolRemaining,
        supplyRemaining,
      })
      const connectedRow = wlCluster.wallets.find((row) => row.is_connected_wallet)
      const isActive = isPhaseMintLive(phase)
      // WL has run its course (sold out or 48h window elapsed → launch moved to PUBLIC) and is no
      // longer live. Distinguish this from a not-yet-opened phase so the note reads "closed / rolled
      // into Public" instead of the misleading "not live yet … when admin opens this phase".
      const wlClosed = !isActive && isGen2WhitelistClosed(launch)
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
        phase_minted: phaseMintedGlobal[phase],
        phase_starts_at,
        is_active: isActive,
        is_eligible: wlGate.is_eligible,
        // Once WL is closed there is nothing left to mint here — don't advertise a mintable count.
        max_mintable: isActive ? max : wlClosed ? 0 : reserved_mints,
        reserved_mints,
        phase_note: wlClosed
          ? reserved_mints > 0
            ? 'WL has closed — your unminted WL spots rolled into the Public phase ($40) and can be minted there'
            : 'WL has closed — any unminted WL spots rolled into the Public phase'
          : reserved_mints > 0 && (!isActive || launch.is_paused)
            ? phaseInactiveNote(phase, launch.active_phase, launch.is_paused, mint_operational)
            : null,
        reason: wlGate.reason,
        minted_in_phase: used,
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
    const supplyRemaining = Math.max(0, launch.total_supply - launch.minted_count)
    const publicPoolRemaining = gen2PublicMintPoolRemaining({
      launch,
      publicMinted: publicMintedGlobal,
      wlMinted: wlMintedGlobal,
    })
    const max = gen2PublicWalletLimitRemaining({ publicPoolRemaining, supplyRemaining })
    const isActive = isPhaseMintLive(phase)
    const reserved_mints = max
    const publicReason = max <= 0 ? 'public_pool_exhausted' : null
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
      phase_minted: phaseMintedGlobal[phase],
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
      minted_in_phase: mintedPublic,
    })
  }

  // Stamp each phase's window close time (start + window) so the UI can show a countdown
  // (e.g. the WHITELIST 48h timer). Open-ended phases (PUBLIC) have an infinite window → null.
  for (const p of phases) {
    if (p.phase === 'PUBLIC') {
      const view = gen2PublicPhaseSupplyDisplay({
        launch,
        publicMinted: p.phase_minted,
        wlMinted: wlMintedGlobal,
      })
      p.phase_supply = view.cap
      p.phase_minted = view.minted
      p.phase_remaining = view.remaining
    }
    const startMs = p.phase_starts_at ? new Date(p.phase_starts_at).getTime() : null
    const windowMs = gen2PhaseWindowMs(p.phase)
    p.window_ends_at =
      startMs != null && Number.isFinite(startMs) && Number.isFinite(windowMs)
        ? new Date(startMs + windowMs).toISOString()
        : null
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
