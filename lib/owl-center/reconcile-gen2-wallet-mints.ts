import { Connection, PublicKey } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { fetchCandyMachine, mplCandyMachine, safeFetchMintCounterFromSeeds } from '@metaplex-foundation/mpl-candy-machine'
import { publicKey } from '@metaplex-foundation/umi'

import { fetchParsedTransactionConfirmed } from '@/lib/gen2-presale/verify-payment'
import { parseCandyMachineMintFromTransaction } from '@/lib/owl-center/parse-candy-machine-mint-tx'
import { detectGen2MintV2GroupLabel } from '@/lib/owl-center/verify-gen2-mint-tx'
import { fetchCandyMachineOnChainSupply } from '@/lib/solana/candy-machine-supply'
import { gen2GuardGroupLabel, type Gen2MintablePhase } from '@/lib/solana/gen2-guards'
import { getLaunchSolanaRpcUrl } from '@/lib/solana/launch-cm'
import {
  getGen2CandyMachineId,
  isDevnetMintEnabled,
  resolveOwlCenterMintVerifyRpcUrl,
  type OwlMintNetwork,
} from '@/lib/solana/network'
import type { OwlCenterLaunchPublic, OwlCenterPhase } from '@/lib/owl-center/types'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

/**
 * Phase-aware on-chain → DB reconciliation for the Gen2 launch.
 *
 * Why this exists: Gen2 mints are recorded by a best-effort, time-boxed CLIENT background loop
 * (`finalizeMintSessionOptimistic`). On mobile (the majority of minters) the page is often closed
 * when the wallet returns, and large batches exceed the confirm budget — so some on-chain mints
 * never reach `owl_center_mint_events`. The generic orphan reconciler bails for anything that is not
 * `mint_mode === 'public_simple'`, so the phased Gen2 launch never self-heals. This module fills
 * that gap WITHOUT trusting the client: each recovered mint is attributed to the phase whose
 * candy-guard group the on-chain `mintV2` actually used.
 *
 * Recording goes through the same `confirm_owl_center_gen2_mint` RPC (idempotent by tx signature,
 * pool/supply-capped, phase-live gated), so reconciliation can only ever bump counts for mints that
 * truly landed in a currently-recordable phase — never inflate supply.
 */

// On-chain candy-guard group → phase. Derived from the (env-overridable) phase→label mapping, so it
// stays in sync with gen2-guards. `pre` maps to PRESALE (the common case; PRESALE_OVERAGE shares the
// `pre` group but is a tiny 13-spot pool reconciled separately if needed).
const GROUP_PHASE_PAIRS = (['AIRDROP', 'PRESALE', 'WHITELIST', 'PUBLIC'] as Gen2MintablePhase[])
  .map((phase) => ({ phase, label: gen2GuardGroupLabel(phase) }))
  .filter((x): x is { phase: Gen2MintablePhase; label: string } => Boolean(x.label))

const PHASE_BY_GROUP_LABEL = new Map<string, OwlCenterPhase>()
for (const { phase, label } of GROUP_PHASE_PAIRS) {
  if (!PHASE_BY_GROUP_LABEL.has(label)) PHASE_BY_GROUP_LABEL.set(label, phase)
}
const CANDIDATE_GROUP_LABELS = [...PHASE_BY_GROUP_LABEL.keys()]

// On-chain mintLimit guard ids (must match scripts/gen2-cm-setup.ts): gen1=1, pub=2, wl=3, pre=4.
// Summing the per-wallet counters for these ids = the wallet's total mints across all groups, which
// is the tamper-proof figure we compare the DB ledger against.
const PHASE_COUNTER_IDS = [1, 2, 3, 4] as const

// The candy guard pubkey (CM mintAuthority) is immutable for a launch — cache it to avoid an RPC
// fetch on every reconcile.
const candyGuardCache = new Map<string, string>()

async function resolveCandyGuardB58(
  umi: ReturnType<typeof createUmi>,
  cmId: string
): Promise<string> {
  const cached = candyGuardCache.get(cmId)
  if (cached) return cached
  const cm = await fetchCandyMachine(umi, publicKey(cmId))
  const b58 = String(cm.mintAuthority)
  candyGuardCache.set(cmId, b58)
  return b58
}

async function recordReconciledMint(
  launch: OwlCenterLaunchPublic,
  cmId: string,
  network: OwlMintNetwork,
  txSignature: string,
  mint: { wallet: string; mintedNftMints: string[]; quantity: number },
  phase: OwlCenterPhase
): Promise<boolean> {
  const db = getSupabaseAdmin()
  const { data, error } = await db.rpc('confirm_owl_center_gen2_mint', {
    p_launch_slug: launch.slug,
    p_wallet: mint.wallet,
    p_tx_signature: txSignature,
    p_quantity: mint.quantity,
    p_phase: phase,
    p_minted_nft_mints: mint.mintedNftMints,
    p_network: network,
    p_event_candy_machine_id: cmId,
  })
  const row = data as { ok?: boolean } | null
  return !error && row?.ok === true
}

/**
 * Reconcile a single wallet's on-chain Gen2 mints into the DB ledger.
 *
 * Cheap drift gate first: read the tamper-proof per-wallet mint counters (sum across groups) and
 * compare to the wallet's recorded quantity. Only when the chain is ahead do we scan the wallet's
 * recent signatures and backfill the missing mints (attributed by their on-chain guard group). Fails
 * closed (records nothing) on any RPC error.
 */
export async function reconcileGen2WalletMints(args: {
  launch: OwlCenterLaunchPublic
  wallet: string
  network: OwlMintNetwork
  maxSignatures?: number
}): Promise<{ recorded: number; drift: number }> {
  const { launch, wallet, network } = args
  const cmId = getGen2CandyMachineId(launch).trim()
  if (!cmId) return { recorded: 0, drift: 0 }

  const db = getSupabaseAdmin()
  const { data: eventRows, error: eventErr } = await db
    .from('owl_center_mint_events')
    .select('tx_signature,quantity')
    .eq('launch_id', launch.id)
    .eq('wallet_address', wallet)
    .eq('network', network)
  if (eventErr) return { recorded: 0, drift: 0 }

  const knownSigs = new Set((eventRows ?? []).map((r) => String((r as { tx_signature: string }).tx_signature)))
  const dbCount = (eventRows ?? []).reduce((s, r) => s + Number((r as { quantity?: number }).quantity ?? 0), 0)

  // Tamper-proof per-wallet on-chain count (sum of group mint counters).
  let onChainCount = 0
  try {
    const umi = createUmi(getLaunchSolanaRpcUrl(network), { commitment: 'confirmed' }).use(mplCandyMachine())
    const cmPk = publicKey(cmId)
    const candyGuardB58 = await resolveCandyGuardB58(umi, cmId)
    const counts = await Promise.all(
      PHASE_COUNTER_IDS.map(async (id) => {
        const counter = await safeFetchMintCounterFromSeeds(umi, {
          id,
          user: publicKey(wallet),
          candyGuard: publicKey(candyGuardB58),
          candyMachine: cmPk,
        })
        return counter ? Number(counter.count) : 0
      })
    )
    onChainCount = counts.reduce((s, n) => s + n, 0)
  } catch {
    return { recorded: 0, drift: 0 }
  }

  const drift = Math.max(0, onChainCount - dbCount)
  if (drift <= 0) return { recorded: 0, drift: 0 }

  const connection = new Connection(resolveOwlCenterMintVerifyRpcUrl(network), 'confirmed')
  let sigInfos
  try {
    sigInfos = await connection.getSignaturesForAddress(new PublicKey(wallet), {
      limit: Math.min(100, Math.max(20, args.maxSignatures ?? 60)),
    })
  } catch {
    return { recorded: 0, drift }
  }

  let recorded = 0
  for (const entry of [...sigInfos].reverse()) {
    if (recorded >= drift) break
    if (entry.err || knownSigs.has(entry.signature)) continue

    const parsed = await fetchParsedTransactionConfirmed(connection, entry.signature).catch(() => null)
    if (!parsed) continue

    const mint = parseCandyMachineMintFromTransaction(parsed, cmId)
    if (!mint || mint.wallet !== wallet) continue

    const groupLabel = detectGen2MintV2GroupLabel(parsed, CANDIDATE_GROUP_LABELS)
    const phase = groupLabel ? PHASE_BY_GROUP_LABEL.get(groupLabel) : undefined
    if (!phase) continue

    if (await recordReconciledMint(launch, cmId, network, entry.signature, mint, phase)) {
      recorded += mint.quantity
      knownSigs.add(entry.signature)
    }
  }

  return { recorded, drift }
}

/**
 * Launch-wide phase-aware reconcile (for the cron). Scans recent Candy Machine signatures and
 * backfills any verified mint that is not already recorded, attributing each to its on-chain guard
 * group. Bounded by `itemsRedeemed` (stops once DB catches up) and a signature window, so cost
 * scales with the actual drift, not total volume.
 */
export async function reconcileGen2LaunchMintsFromChain(
  launch: OwlCenterLaunchPublic,
  opts?: { maxSignatures?: number }
): Promise<{ recorded: number }> {
  const cmId = getGen2CandyMachineId(launch).trim()
  if (!cmId) return { recorded: 0 }

  const network: OwlMintNetwork = isDevnetMintEnabled() ? 'devnet' : 'mainnet'
  const supply = await fetchCandyMachineOnChainSupply(cmId, network)
  if (!supply.ok || supply.itemsRedeemed <= launch.minted_count) return { recorded: 0 }

  const db = getSupabaseAdmin()
  const { data: existing } = await db
    .from('owl_center_mint_events')
    .select('tx_signature')
    .eq('launch_id', launch.id)
    .eq('network', network)
  const knownSigs = new Set((existing ?? []).map((r) => String((r as { tx_signature: string }).tx_signature)))

  const connection = new Connection(resolveOwlCenterMintVerifyRpcUrl(network), 'confirmed')
  let sigInfos
  try {
    sigInfos = await connection.getSignaturesForAddress(new PublicKey(cmId), {
      limit: Math.min(1000, Math.max(100, opts?.maxSignatures ?? 500)),
    })
  } catch {
    return { recorded: 0 }
  }

  let recorded = 0
  let mintedCount = launch.minted_count
  for (const entry of [...sigInfos].reverse()) {
    if (supply.itemsRedeemed <= mintedCount) break
    if (entry.err || knownSigs.has(entry.signature)) continue

    const parsed = await fetchParsedTransactionConfirmed(connection, entry.signature).catch(() => null)
    if (!parsed) continue

    const mint = parseCandyMachineMintFromTransaction(parsed, cmId)
    if (!mint) continue

    const groupLabel = detectGen2MintV2GroupLabel(parsed, CANDIDATE_GROUP_LABELS)
    const phase = groupLabel ? PHASE_BY_GROUP_LABEL.get(groupLabel) : undefined
    if (!phase) continue

    if (await recordReconciledMint(launch, cmId, network, entry.signature, mint, phase)) {
      recorded += mint.quantity
      mintedCount += mint.quantity
      knownSigs.add(entry.signature)
    }
  }

  return { recorded }
}
